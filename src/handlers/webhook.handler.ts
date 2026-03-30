/**
 * Main webhook handler: receives POST from Azure DevOps and orchestrates Jira, dedup, and repository filter.
 */

import type { AzureResource, InvocationContext, HttpRequest, WebhookPayload } from '../types';
import {
  extractJiraKey,
  extractJiraKeyFromPayload,
  formatBrasilia,
  addJiraComment,
  setJiraStatus,
} from '../services/jira';
import { getRunId, getRunUrl, getPipelineName, getBranch } from '../services/pipeline-payload';
import { isDuplicate, markProcessed } from '../services/deduplication';
import { getJiraKeyFromBuildCommit } from '../services/azure-devops';
import { isRepoAllowed, getRepoName } from '../services/repository-filter';

interface RunStateContext {
  eventType: string;
  runId: string;
  state: string;
  startTime: string;
  finishTime: string | undefined;
  result: string;
  pipelineName: string | undefined;
  branch: string | undefined;
  runUrl: string | undefined;
}

function validateSecret(
  context: InvocationContext,
  req: HttpRequest,
  webhookSecret: string
): boolean {
  if (!webhookSecret) {
    context.log('[webhook] DEBUG: WEBHOOK_SECRET not set, skipping validation');
    return true;
  }
  const secret = req?.headers?.['x-webhook-secret'] ?? req?.query?.secret;
  if (secret !== webhookSecret) {
    context.log('[webhook] DEBUG: Invalid or missing secret → 401 Unauthorized');
    context.res = { status: 401, body: { error: 'Unauthorized' } };
    return false;
  }
  context.log('[webhook] DEBUG: Secret validated successfully');
  return true;
}

function getPayloadAndResource(
  req: HttpRequest
): { payload: WebhookPayload; resource: AzureResource; eventType: string } | null {
  const payload: WebhookPayload | undefined = req?.body ?? req?.rawBody;
  const eventType = payload?.eventType ?? '';
  if (!payload?.resource || typeof payload.resource !== 'object') {
    return null;
  }
  return { payload, resource: payload.resource, eventType };
}

async function resolveJiraKey(
  eventType: string,
  resource: AzureResource
): Promise<string | null> {
  const title = resource.title ?? '';
  const sourceBranch = resource.sourceBranch ?? resource.sourceRefName ?? '';

  let jiraKey = extractJiraKey(title);
  if (!jiraKey && sourceBranch) {
    jiraKey = extractJiraKey(sourceBranch.replace(/^refs\/heads\//, ''));
  }
  const isPipelineEvent =
    eventType === 'build.complete' || eventType === 'ms.vss-pipelines.run-state-changed-event';
  if (!jiraKey && isPipelineEvent) {
    jiraKey = extractJiraKeyFromPayload(resource);
  }
  const isMainBranch = /refs\/heads\/(main|master)$/.test(sourceBranch);
  if (!jiraKey && isPipelineEvent && isMainBranch) {
    const keyFromCommit = await getJiraKeyFromBuildCommit(resource);
    if (keyFromCommit) jiraKey = keyFromCommit;
  }
  return jiraKey;
}

function appendOptionalParts(
  parts: string[],
  pipelineName: string | undefined,
  branch: string | undefined,
  runUrl: string | undefined
): string[] {
  const out = [...parts];
  if (pipelineName) out.push(`Pipeline: ${pipelineName}.`);
  if (branch) out.push(`Branch: ${branch}.`);
  if (runUrl) out.push(`Ver execução: ${runUrl}`);
  return out;
}

async function sendRunStateCommentAndResponse(
  context: InvocationContext,
  jiraKey: string,
  messageKey: 'start' | 'finish',
  parts: string[],
  runState: Pick<RunStateContext, 'eventType' | 'runId' | 'state'>
): Promise<void> {
  context.log('[webhook] DEBUG: Calling addJiraComment for', jiraKey, `(${messageKey})`);
  const ok = await addJiraComment(jiraKey, parts.join('\n'));
  if (ok) {
    markProcessed(runState.eventType, runState.runId, runState.state, jiraKey);
    context.log('[webhook] DEBUG: addJiraComment ok, marked as processed');
  } else {
    context.log('[webhook] DEBUG: addJiraComment failed → 500');
  }
  context.res = {
    status: ok ? 200 : 500,
    body: ok
      ? { message: `Comment added to ${jiraKey} (${messageKey})` }
      : { error: 'Jira comment failed' },
  };
}

async function handleRunStateInProgress(
  context: InvocationContext,
  jiraKey: string,
  runState: RunStateContext
): Promise<void> {
  const startBr = formatBrasilia(runState.startTime);
  const parts = appendOptionalParts(
    [`Pipeline iniciou em ${startBr} (Brasília).`],
    runState.pipelineName,
    runState.branch,
    runState.runUrl
  );
  await sendRunStateCommentAndResponse(context, jiraKey, 'start', parts, runState);
}

async function handleRunStateCompleted(
  context: InvocationContext,
  jiraKey: string,
  runState: RunStateContext
): Promise<void> {
  const finishBr = runState.finishTime
    ? formatBrasilia(runState.finishTime)
    : formatBrasilia(runState.startTime);
  const emoji = /succeed|success/i.test(runState.result)
    ? '✅'
    : /fail|cancel/i.test(runState.result)
      ? '❌'
      : '➖';
  const parts = appendOptionalParts(
    [
      `Pipeline finalizou em ${finishBr} (Brasília).`,
      `Resultado: ${emoji} ${runState.result}.`,
    ],
    runState.pipelineName,
    runState.branch,
    runState.runUrl
  );
  await sendRunStateCommentAndResponse(context, jiraKey, 'finish', parts, runState);
}

async function handleRunStateChanged(
  context: InvocationContext,
  resource: AzureResource,
  jiraKey: string
): Promise<void> {
  const runState: RunStateContext = {
    eventType: 'ms.vss-pipelines.run-state-changed-event',
    state:
      resource.state ?? resource.runState ?? resource.run?.state ?? resource.run?.runState ?? '',
    startTime:
      resource.startTime ??
      resource.createdDate ??
      resource.queuedTime ??
      resource.run?.createdDate ??
      new Date().toISOString(),
    finishTime: resource.finishTime ?? resource.run?.finishTime,
    result: resource.result ?? resource.run?.result ?? '—',
    runId: getRunId(resource),
    runUrl: getRunUrl(resource),
    pipelineName: getPipelineName(resource),
    branch: getBranch(resource),
  };

  if (isDuplicate(runState.eventType, runState.runId, runState.state, jiraKey)) {
    context.log('[webhook] DEBUG: Duplicate event (dedup), runId=', runState.runId, '→ 200');
    context.res = { status: 200, body: { message: 'Duplicate event ignored' } };
    return;
  }

  const isInProgress = /inprogress|in_progress|running|in progress/i.test(runState.state);
  const isCompleted = /completed|finished|complete|cancelled|canceled/i.test(runState.state);

  if (isInProgress) {
    context.log('[webhook] DEBUG: State "in progress", sending start comment');
    await handleRunStateInProgress(context, jiraKey, runState);
    context.log('[webhook] DEBUG: Comment (start) sent, status=', context.res?.status);
    return;
  }

  if (isCompleted) {
    context.log('[webhook] DEBUG: State "completed", sending finish comment');
    await handleRunStateCompleted(context, jiraKey, runState);
    context.log('[webhook] DEBUG: Comment (finish) sent, status=', context.res?.status);
    return;
  }

  context.log('[webhook] DEBUG: State not mapped:', runState.state, '→ 200 (ignored)');
  context.res = {
    status: 200,
    body: { message: 'Run state event ignored', state: runState.state },
  };
}

async function handlePullRequestUpdated(
  context: InvocationContext,
  jiraKey: string,
  jiraStatusCodeReview: string
): Promise<void> {
  context.log('[webhook] Attempting to update Jira status:', jiraKey, '→', jiraStatusCodeReview);
  context.log('[webhook] DEBUG: Calling setJiraStatus');
  const ok = await setJiraStatus(jiraKey, jiraStatusCodeReview, (...args) =>
    context.log(...args)
  );
  if (ok) {
    context.log('[webhook] Status updated successfully for', jiraKey);
    context.log('[webhook] DEBUG: setJiraStatus ok → 200');
  } else {
    context.log('[webhook] DEBUG: setJiraStatus failed → 500');
  }
  context.res = {
    status: ok ? 200 : 500,
    body: ok ? { message: `Status updated for ${jiraKey}` } : { error: 'Jira transition failed' },
  };
}

export async function webhook(context: InvocationContext, req: HttpRequest): Promise<void> {
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  const jiraStatusCodeReview = process.env.JIRA_STATUS_CODE_REVIEW || 'Code Review';

  context.log('[webhook] POST received', req?.method, req?.url);

  if (!validateSecret(context, req, webhookSecret)) return;

  const parsed = getPayloadAndResource(req);
  if (!parsed) {
    context.log('[webhook] DEBUG: Body missing resource or invalid → 400 Bad Request');
    context.res = { status: 400, body: { error: 'Expected JSON body with resource' } };
    return;
  }

  const { resource, eventType } = parsed;
  context.log('[webhook] DEBUG: Payload ok, eventType=', eventType);

  if (!isRepoAllowed(resource)) {
    context.log(
      '[webhook] Repository not in allowed list, skipping:',
      getRepoName(resource)
    );
    context.log('[webhook] DEBUG: Repo not allowed → 200 (skipping)');
    context.res = { status: 200, body: { message: 'Repository not in ALLOWED_REPOS, skipping' } };
    return;
  }

  const jiraKey = await resolveJiraKey(eventType, resource);

  context.log('[webhook]', {
    eventType,
    title: resource.title ?? '(empty)',
    sourceBranch: resource.sourceBranch ?? resource.sourceRefName ?? '(empty)',
    jiraKey: jiraKey ?? '(not found)',
  });

  if (!jiraKey) {
    context.log('[webhook] DEBUG: Jira key not found in title/branch/payload → 200 (skipping)');
    context.res = { status: 200, body: { message: 'No Jira key in title or branch, skipping' } };
    return;
  }

  if (eventType === 'build.complete') {
    context.log('[webhook] DEBUG: build.complete event → 200 (comments via run-state-changed)');
    context.res = {
      status: 200,
      body: { message: 'Pipeline comments are sent via Run state changed (real time)' },
    };
    return;
  }

  if (eventType === 'ms.vss-pipelines.run-state-changed-event') {
    context.log('[webhook] DEBUG: Processing run-state-changed for', jiraKey);
    await handleRunStateChanged(context, resource, jiraKey);
    context.log(
      '[webhook] DEBUG: run-state-changed completed, status=',
      context.res?.status ?? '(not set)'
    );
    return;
  }

  if (eventType === 'git.pullrequest.updated') {
    context.log('[webhook] DEBUG: Processing git.pullrequest.updated for', jiraKey);
    await handlePullRequestUpdated(context, jiraKey, jiraStatusCodeReview);
    context.log(
      '[webhook] DEBUG: pullrequest.updated completed, status=',
      context.res?.status ?? '(not set)'
    );
    return;
  }

  context.log('[webhook] DEBUG: Event not mapped:', eventType, '→ 200 (ignored)');
  context.res = { status: 200, body: { message: 'Event ignored', eventType } };
}
