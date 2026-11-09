import type { AzureResource, InvocationContext, HttpRequest, WebhookPayload } from '../types';
import {
  extractJiraKey,
  extractJiraKeyFromPayload,
  formatBrasilia,
  addJiraComment,
  setJiraStatus,
  clearIssueFields,
} from '../services/jira/jira';
import { getRunId, getRunUrl, getPipelineName, getBranch } from '../services/pipeline-payload/pipeline-payload';
import { isDuplicate, markProcessed } from '../services/deduplication/deduplication';
import { getJiraKeyFromBuildCommit } from '../services/azure-devops/azure-devops';
import { isRepoAllowed, getRepoName } from '../services/repository-filter/repository-filter';
import {
  loadWorkflowEnv,
  decidePullRequestEvent,
  decideGitPush,
  shouldTransitionOnPipelineSuccess,
  getJiraFieldIdsToClearOnRework,
  getPrObject,
  type WorkflowEnv,
} from '../services/workflow/workflow';

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

/** Evita `String(object)` → "[object Object]" em títulos do payload Azure. */
function stringFromUnknownTitle(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function titleForJiraKey(resource: AzureResource): string {
  const prView = getPrObject(resource);
  return stringFromUnknownTitle(prView.title) || stringFromUnknownTitle(resource.title) || '';
}

function branchRefForJiraKey(resource: AzureResource): string {
  const prView = getPrObject(resource);
  return (
    (typeof prView.sourceBranch === 'string' ? prView.sourceBranch : null) ??
    (typeof prView.sourceRefName === 'string' ? prView.sourceRefName : null) ??
    resource.sourceBranch ??
    resource.sourceRefName ??
    ''
  );
}

function jiraKeyFromGitPushRefs(resource: AzureResource): string | null {
  if (!Array.isArray(resource.refUpdates)) return null;
  for (const u of resource.refUpdates) {
    const short = (u?.name ?? '').replace(/^refs\/heads\//, '');
    if (!short) continue;
    const k = extractJiraKey(short);
    if (k) return k;
  }
  return null;
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
  const title = titleForJiraKey(resource);
  const branchRef = branchRefForJiraKey(resource);

  let jiraKey = extractJiraKey(title);
  if (!jiraKey && branchRef) {
    jiraKey = extractJiraKey(branchRef.replace(/^refs\/heads\//, ''));
  }
  const isPipelineEvent =
    eventType === 'build.complete' || eventType === 'ms.vss-pipelines.run-state-changed-event';
  if (!jiraKey && isPipelineEvent) {
    jiraKey = extractJiraKeyFromPayload(resource);
  }
  const isMainBranch = /refs\/heads\/(main|master)$/.test(branchRef);
  if (!jiraKey && isPipelineEvent && isMainBranch) {
    const keyFromCommit = await getJiraKeyFromBuildCommit(resource);
    if (keyFromCommit) jiraKey = keyFromCommit;
  }
  if (!jiraKey && eventType === 'git.push') {
    jiraKey = jiraKeyFromGitPushRefs(resource);
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

function pipelineResultEmoji(result: string): string {
  if (/succeed|success/i.test(result)) return '✅';
  if (/fail|cancel/i.test(result)) return '❌';
  return '➖';
}

function buildPipelineCompletedComment(runState: RunStateContext): string {
  const startBr = formatBrasilia(runState.startTime);
  const finishBr = runState.finishTime
    ? formatBrasilia(runState.finishTime)
    : formatBrasilia(runState.startTime);
  const headLines = [
    'Pipeline (Azure DevOps)',
    `Horário início: ${startBr} (Brasília).`,
    `Horário fim: ${finishBr} (Brasília).`,
    `Resultado: ${pipelineResultEmoji(runState.result)} ${runState.result}.`,
  ];
  return appendOptionalParts(
    headLines,
    runState.pipelineName,
    runState.branch,
    runState.runUrl
  ).join('\n');
}

async function tryMergeMainTransition(
  context: InvocationContext,
  jiraKey: string,
  workflowEnv: WorkflowEnv,
  shouldMergeMain: boolean,
  commentOk: boolean
): Promise<boolean> {
  if (!shouldMergeMain) {
    return true;
  }
  if (commentOk) {
    const transitionOk = await setJiraStatus(
      jiraKey,
      workflowEnv.readyMergeMain,
      (...args) => context.log(...args)
    );
    context.log('[workflow] Ready to Merge Main transition:', transitionOk);
    return transitionOk;
  }
  context.log(
    '[webhook] Ready to Merge Main skipped: comentário na task falhou (exige comentário + transição)'
  );
  return false;
}

async function handleRunStateInProgress(
  context: InvocationContext,
  jiraKey: string,
  runState: RunStateContext
): Promise<void> {
  context.log('[webhook] Pipeline: sem comentário no início (apenas um bloco ao finalizar)');
  markProcessed(runState.eventType, runState.runId, runState.state, jiraKey);
  context.res = {
    status: 200,
    body: {
      message: `Pipeline start acknowledged for ${jiraKey} (comment only on completion)`,
    },
  };
}

async function handleRunStateCompleted(
  context: InvocationContext,
  jiraKey: string,
  runState: RunStateContext,
  resource: AzureResource,
  workflowEnv: WorkflowEnv
): Promise<void> {
  const commentText = buildPipelineCompletedComment(runState);
  context.log('[webhook] DEBUG: Calling addJiraComment for', jiraKey, '(finish)');
  const commentOk = await addJiraComment(jiraKey, commentText);

  const shouldReadyMergeMain = shouldTransitionOnPipelineSuccess(
    resource,
    runState.result,
    runState.branch,
    runState.pipelineName,
    workflowEnv
  );
  context.log('[workflow] pipeline finish', {
    pipelineName: runState.pipelineName ?? '(none)',
    branch: runState.branch ?? '(none)',
    result: runState.result,
    shouldReadyMergeMain,
    finalPipelineNames: [...workflowEnv.finalPipelineNames],
    allowEmptyBranch: workflowEnv.finalPipelineAllowEmptyBranch,
  });

  const transitionOk = await tryMergeMainTransition(
    context,
    jiraKey,
    workflowEnv,
    shouldReadyMergeMain,
    commentOk
  );

  const ok = shouldReadyMergeMain ? commentOk && transitionOk : commentOk;
  if (ok) {
    markProcessed(runState.eventType, runState.runId, runState.state, jiraKey);
  }

  context.res = {
    status: ok ? 200 : 500,
    body: ok
      ? {
          message: shouldReadyMergeMain
            ? `Comment + Ready to Merge Main aplicados a ${jiraKey}`
            : `Comment added to ${jiraKey} (finish)`,
        }
      : {
          error: shouldReadyMergeMain
            ? 'Comentário na task ou transição Ready to Merge Main falhou (ambos são necessários nesta pipeline)'
            : 'Jira comment failed',
        },
  };
}

async function handleRunStateChanged(
  context: InvocationContext,
  resource: AzureResource,
  jiraKey: string,
  workflowEnv: WorkflowEnv
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
    await handleRunStateCompleted(context, jiraKey, runState, resource, workflowEnv);
    context.log('[webhook] DEBUG: Comment (finish) sent, status=', context.res?.status);
    return;
  }

  context.log('[webhook] DEBUG: State not mapped:', runState.state, '→ 200 (ignored)');
  context.res = {
    status: 200,
    body: { message: 'Run state event ignored', state: runState.state },
  };
}

async function handlePullRequestWorkflow(
  context: InvocationContext,
  eventType: string,
  resource: AzureResource,
  jiraKey: string,
  env: WorkflowEnv
): Promise<void> {
  const decision = decidePullRequestEvent(eventType, resource, env);
  context.log('[workflow] PR decision:', decision);
  if (decision.kind === 'skip') {
    context.res = { status: 200, body: { message: decision.reason, jiraKey } };
    return;
  }
  const ok = await setJiraStatus(jiraKey, decision.statusName, (...args) =>
    context.log(...args)
  );
  if (ok) {
    context.log('[webhook] Status updated successfully for', jiraKey, '→', decision.statusName);
    if (decision.clearReviewerFields) {
      const fieldIds = getJiraFieldIdsToClearOnRework();
      if (fieldIds.length) {
        await clearIssueFields(jiraKey, fieldIds, (...args) => context.log(...args));
      } else {
        context.log('[workflow] clearReviewerFields: JIRA_FIELDS_CLEAR_ON_REWORK empty, skip');
      }
    }
  }
  context.res = {
    status: ok ? 200 : 500,
    body: ok
      ? { message: `Transition: ${decision.statusName}`, reason: decision.reason, jiraKey }
      : { error: 'Jira transition failed' },
  };
}

async function handleGitPushWorkflow(
  context: InvocationContext,
  resource: AzureResource,
  jiraKey: string,
  env: WorkflowEnv
): Promise<void> {
  const decision = decideGitPush(resource, env);
  context.log('[workflow] git.push decision:', decision);
  if (decision.kind === 'skip') {
    context.res = { status: 200, body: { message: decision.reason, jiraKey } };
    return;
  }
  const ok = await setJiraStatus(jiraKey, decision.statusName, (...args) =>
    context.log(...args)
  );
  context.res = {
    status: ok ? 200 : 500,
    body: ok
      ? { message: `Transition: ${decision.statusName}`, reason: decision.reason, jiraKey }
      : { error: 'Jira transition failed' },
  };
}

export async function webhook(context: InvocationContext, req: HttpRequest): Promise<void> {
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  const workflowEnv = loadWorkflowEnv();

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
    await handleRunStateChanged(context, resource, jiraKey, workflowEnv);
    context.log(
      '[webhook] DEBUG: run-state-changed completed, status=',
      context.res?.status ?? '(not set)'
    );
    return;
  }

  if (eventType === 'git.push') {
    context.log('[webhook] DEBUG: Processing git.push for', jiraKey);
    await handleGitPushWorkflow(context, resource, jiraKey, workflowEnv);
    context.log(
      '[webhook] DEBUG: git.push completed, status=',
      context.res?.status ?? '(not set)'
    );
    return;
  }

  if (
    eventType === 'git.pullrequest.created' ||
    eventType === 'git.pullrequest.updated' ||
    eventType === 'git.pullrequest.merged'
  ) {
    context.log('[webhook] DEBUG: Processing PR event', eventType, jiraKey);
    await handlePullRequestWorkflow(context, eventType, resource, jiraKey, workflowEnv);
    context.log(
      '[webhook] DEBUG: PR workflow completed, status=',
      context.res?.status ?? '(not set)'
    );
    return;
  }

  context.log('[webhook] DEBUG: Event not mapped:', eventType, '→ 200 (ignored)');
  context.res = { status: 200, body: { message: 'Event ignored', eventType } };
}
