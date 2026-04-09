/**
 * Azure DevOps → Jira: nomes de transição via JIRA_STATUS_* e filtros opcionais.
 *
 * Fluxo pretendido (ordem):
 * 1. Novo branch no remoto (git.push) → In Progress / In Development (`JIRA_STATUS_IN_DEVELOPMENT`)
 * 2. PR aberta (ativa) → Ready Code Review (`JIRA_STATUS_READY_CODE_REVIEW`)
 * 3. Revisor required/optional ou aprovação → Code in Review (`JIRA_STATUS_CODE_IN_REVIEW`)
 * 4. Em Code in Review (revisores) → próximo passo é pipeline concluir com sucesso na main
 * 5. Pipeline (main + regras FINAL_*) com sucesso → comentário único (horário início, fim, resultado) + Ready to Merge Main (`JIRA_STATUS_READY_MERGE_MAIN`). PR mergeada sozinha não altera Jira.
 */

import type { AzureResource } from '../../types';

export type WorkflowDecision =
  | {
      kind: 'transition';
      statusName: string;
      reason: string;
      clearReviewerFields?: boolean;
    }
  | { kind: 'skip'; reason: string };

export interface WorkflowEnv {
  inDevelopment: string;
  readyCodeReview: string;
  codeInReview: string;
  readyMergeMain: string;
  ignoredReviewerIds: Set<string>;
  finalPipelineBranchRegex: RegExp;
  finalPipelineNames: Set<string>;
  finalPipelineTransitionEnabled: boolean;
  finalPipelineAllowEmptyBranch: boolean;
  reworkVoteMax: number;
  approveVoteMin: number;
}

function splitCsv(s: string | undefined): string[] {
  if (!s?.trim()) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseIntEnv(key: string, defaultValue: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

export function loadWorkflowEnv(): WorkflowEnv {
  const legacy = process.env.JIRA_STATUS_CODE_REVIEW || '';
  return {
    inDevelopment: process.env.JIRA_STATUS_IN_DEVELOPMENT || 'In Development',
    readyCodeReview: process.env.JIRA_STATUS_READY_CODE_REVIEW || legacy || 'Ready in Code Review',
    codeInReview: process.env.JIRA_STATUS_CODE_IN_REVIEW || legacy || 'Code in Review',
    readyMergeMain: process.env.JIRA_STATUS_READY_MERGE_MAIN || 'Ready to Merge Main',
    ignoredReviewerIds: new Set(
      splitCsv(process.env.AZURE_DEVOPS_IGNORE_REVIEWER_IDS).map((x) => x.toLowerCase())
    ),
    finalPipelineBranchRegex: new RegExp(
      process.env.FINAL_PIPELINE_BRANCH_REGEX || '^(main|master)$',
      'i'
    ),
    finalPipelineNames: new Set(
      splitCsv(process.env.FINAL_PIPELINE_NAMES).map((x) => x.toLowerCase())
    ),
    finalPipelineTransitionEnabled:
      process.env.FINAL_PIPELINE_TRANSITION_ENABLED !== '0' &&
      process.env.FINAL_PIPELINE_TRANSITION_ENABLED !== 'false',
    finalPipelineAllowEmptyBranch:
      process.env.FINAL_PIPELINE_ALLOW_EMPTY_BRANCH === '1' ||
      process.env.FINAL_PIPELINE_ALLOW_EMPTY_BRANCH === 'true',
    reworkVoteMax: parseIntEnv('WORKFLOW_REWORK_VOTE_MAX', -5),
    approveVoteMin: parseIntEnv('WORKFLOW_APPROVE_VOTE_MIN', 10),
  };
}

/** Evita `String(object)` → "[object Object]" em valores de payload Azure. */
function stringFromUnknownStatus(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.trim().toLowerCase();
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw).trim().toLowerCase();
  }
  if (typeof raw === 'bigint') return raw.toString().trim().toLowerCase();
  if (typeof raw === 'symbol') return '';
  if (typeof raw === 'object') return '';
  return '';
}

function stringFromUnknownId(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

const PR_ROOT_OVERLAY_KEYS = [
  'title',
  'sourceBranch',
  'sourceRefName',
  'status',
  'isDraft',
] as const;

export function getPrLifecycleState(
  eventType: string,
  pr: Record<string, unknown>
): 'abandoned' | 'completed' | 'active' | 'other' {
  if (eventType === 'git.pullrequest.merged') {
    return 'completed';
  }

  const raw = pr.status;
  if (typeof raw === 'number') {
    if (raw === 2) return 'abandoned';
    if (raw === 3) return 'completed';
    if (raw === 1) return 'active';
  }

  const s = stringFromUnknownStatus(raw);
  if (s === '2' || s === 'abandoned') return 'abandoned';
  if (s === '3' || s === 'completed') return 'completed';
  if (s === '1' || s === 'active') return 'active';

  return 'other';
}

function mergePullRequestStatus(nestedStatus: unknown, rootStatus: unknown): unknown {
  const rootEmpty = rootStatus === undefined || rootStatus === null || rootStatus === '';
  if (rootEmpty) {
    return nestedStatus;
  }
  const nestedEmpty = nestedStatus === undefined || nestedStatus === null || nestedStatus === '';
  if (nestedEmpty) {
    return rootStatus;
  }
  const rootLife = getPrLifecycleState('git.pullrequest.updated', { status: rootStatus });
  const nestedLife = getPrLifecycleState('git.pullrequest.updated', { status: nestedStatus });
  if (rootLife === 'completed' || rootLife === 'abandoned') {
    return rootStatus;
  }
  if (nestedLife === 'completed' || nestedLife === 'abandoned') {
    return nestedStatus;
  }
  return nestedStatus;
}

function overlayRootPullRequestFields(
  nested: Record<string, unknown>,
  root: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...nested };
  for (const k of PR_ROOT_OVERLAY_KEYS) {
    if (k === 'status') {
      out.status = mergePullRequestStatus(nested.status, root.status);
      continue;
    }
    const v = root[k];
    if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out;
}

export function getPrObject(resource: AzureResource): Record<string, unknown> {
  const r = resource as Record<string, unknown>;
  const nested = r.pullRequest;
  if (nested && typeof nested === 'object') {
    return overlayRootPullRequestFields(nested as Record<string, unknown>, r);
  }
  const inner = r.resource;
  if (inner && typeof inner === 'object') {
    const ir = inner as Record<string, unknown>;
    if (ir.pullRequest && typeof ir.pullRequest === 'object') {
      const merged = overlayRootPullRequestFields(ir.pullRequest as Record<string, unknown>, ir);
      return overlayRootPullRequestFields(merged, r);
    }
    if ('pullRequestId' in ir || 'status' in ir || 'isDraft' in ir) {
      return ir;
    }
  }
  return r;
}

export function collectPrReviewers(resource: AzureResource): Record<string, unknown>[] {
  const pr = getPrObject(resource);
  const a = pr.reviewers;
  if (Array.isArray(a) && a.length) return a as Record<string, unknown>[];
  const top = resource as Record<string, unknown>;
  if (Array.isArray(top.reviewers) && top.reviewers.length) {
    return top.reviewers as Record<string, unknown>[];
  }
  const inner = top.resource;
  if (
    inner &&
    typeof inner === 'object' &&
    Array.isArray((inner as Record<string, unknown>).reviewers)
  ) {
    return (inner as Record<string, unknown>).reviewers as Record<string, unknown>[];
  }
  return [];
}

function reviewerId(r: Record<string, unknown>): string {
  const nested = r.reviewer;
  const fromNested =
    nested && typeof nested === 'object'
      ? stringFromUnknownId((nested as Record<string, unknown>).id)
      : '';
  const id = r.id ?? r.reviewerId ?? fromNested;
  return stringFromUnknownId(id).toLowerCase();
}

function isIgnoredReviewer(r: Record<string, unknown>, ignored: Set<string>): boolean {
  if (ignored.size === 0) return false;
  const id = reviewerId(r);
  const name = stringFromUnknownId(
    r.displayName ?? r.uniqueName ?? r['uniqueName']
  ).toLowerCase();
  if (id && ignored.has(id)) return true;
  if (name && ignored.has(name)) return true;
  return false;
}

function voteOf(r: Record<string, unknown>): number {
  const v = r.vote;
  return typeof v === 'number' ? v : Number(v) || 0;
}

function hasReworkSignal(reviewers: Record<string, unknown>[], reworkVoteMax: number): boolean {
  return reviewers.some((rev) => voteOf(rev) <= reworkVoteMax);
}

function hasHumanApproval(
  reviewers: Record<string, unknown>[],
  ignored: Set<string>,
  approveVoteMin: number
): boolean {
  return reviewers.some((rev) => voteOf(rev) >= approveVoteMin && !isIgnoredReviewer(rev, ignored));
}

function hasNonIgnoredReviewer(
  reviewers: Record<string, unknown>[],
  ignored: Set<string>
): boolean {
  return reviewers.some((rev) => !isIgnoredReviewer(rev, ignored));
}

function decidePullRequestCreated(
  isDraft: boolean,
  reviewers: Record<string, unknown>[],
  env: WorkflowEnv
): WorkflowDecision {
  if (isDraft) {
    return { kind: 'transition', statusName: env.inDevelopment, reason: 'PR criada em draft' };
  }
  if (hasHumanApproval(reviewers, env.ignoredReviewerIds, env.approveVoteMin)) {
    return {
      kind: 'transition',
      statusName: env.codeInReview,
      reason: 'PR criada com aprovação humana',
    };
  }
  if (hasNonIgnoredReviewer(reviewers, env.ignoredReviewerIds)) {
    return {
      kind: 'transition',
      statusName: env.codeInReview,
      reason: 'PR criada já com revisor atribuído (required/optional)',
    };
  }
  return {
    kind: 'transition',
    statusName: env.readyCodeReview,
    reason: 'PR criada (ativa)',
  };
}

function decidePullRequestUpdated(
  isDraft: boolean,
  reviewers: Record<string, unknown>[],
  env: WorkflowEnv
): WorkflowDecision {
  if (isDraft) {
    return { kind: 'transition', statusName: env.inDevelopment, reason: 'PR em draft' };
  }
  if (hasReworkSignal(reviewers, env.reworkVoteMax)) {
    return {
      kind: 'transition',
      statusName: env.inDevelopment,
      reason: 'Revisor pediu alterações / rework (voto)',
      clearReviewerFields: true,
    };
  }
  if (hasHumanApproval(reviewers, env.ignoredReviewerIds, env.approveVoteMin)) {
    return {
      kind: 'transition',
      statusName: env.codeInReview,
      reason: 'Aprovação humana registada na PR',
    };
  }
  if (hasNonIgnoredReviewer(reviewers, env.ignoredReviewerIds)) {
    return {
      kind: 'transition',
      statusName: env.codeInReview,
      reason: 'Revisor atribuído (required/optional)',
    };
  }
  return {
    kind: 'skip',
    reason:
      'pullrequest.updated sem merge, draft, rework, aprovação ou revisor atribuído (não ignorado)',
  };
}

export function decidePullRequestEvent(
  eventType: string,
  resource: AzureResource,
  env: WorkflowEnv
): WorkflowDecision {
  const pr = getPrObject(resource);
  const lifecycle = getPrLifecycleState(eventType, pr);
  const reviewers = collectPrReviewers(resource);

  if (lifecycle === 'abandoned') {
    return { kind: 'skip', reason: 'PR abandoned' };
  }

  if (lifecycle === 'completed') {
    return {
      kind: 'skip',
      reason:
        'PR concluída no Azure — Ready to Merge Main é aplicado ao finalizar a pipeline com sucesso (não neste evento)',
    };
  }

  const isDraft = pr.isDraft === true;

  if (eventType === 'git.pullrequest.created') {
    return decidePullRequestCreated(isDraft, reviewers, env);
  }

  if (eventType === 'git.pullrequest.updated') {
    return decidePullRequestUpdated(isDraft, reviewers, env);
  }

  return { kind: 'skip', reason: `eventType PR não mapeado: ${eventType}` };
}

export function decideGitPush(resource: AzureResource, env: WorkflowEnv): WorkflowDecision {
  const r = resource as Record<string, unknown>;
  const updates = r.refUpdates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return { kind: 'skip', reason: 'git.push sem refUpdates' };
  }
  for (const u of updates) {
    if (!u || typeof u !== 'object') continue;
    const uo = u as Record<string, unknown>;
    const ref = stringFromUnknownId(uo.name);
    const oldId = stringFromUnknownId(uo.oldObjectId);
    const isNewRef = /^0+$/.test(oldId) && oldId.length >= 20;
    if (!isNewRef || !ref.startsWith('refs/heads/')) continue;
    const short = ref.replace(/^refs\/heads\//, '');
    if (/^(main|master|develop)$/i.test(short)) {
      continue;
    }
    return {
      kind: 'transition',
      statusName: env.inDevelopment,
      reason: `Novo branch no remoto: ${short}`,
    };
  }
  return { kind: 'skip', reason: 'git.push sem novo branch (ou só main/master/develop)' };
}

export function shouldTransitionOnPipelineSuccess(
  _resource: AzureResource,
  result: string,
  branch: string | undefined,
  pipelineName: string | undefined,
  env: WorkflowEnv
): boolean {
  if (!env.finalPipelineTransitionEnabled) return false;
  if (!/succeed|success/i.test(result)) return false;
  const b = (branch ?? '').trim();
  const pn = (pipelineName ?? '').toLowerCase();

  if (!b) {
    if (
      env.finalPipelineAllowEmptyBranch &&
      env.finalPipelineNames.size > 0 &&
      pn &&
      env.finalPipelineNames.has(pn)
    ) {
      return true;
    }
    return false;
  }

  if (!env.finalPipelineBranchRegex.test(b)) return false;
  if (env.finalPipelineNames.size === 0) return true;
  if (!pn) return false;
  return env.finalPipelineNames.has(pn);
}

export function getJiraFieldIdsToClearOnRework(): string[] {
  return splitCsv(process.env.JIRA_FIELDS_CLEAR_ON_REWORK);
}
