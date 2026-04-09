import type { AzureResource } from '../../types';

export function getRunId(resource: AzureResource): string {
  const run = resource.run;
  return (
    String(resource.id ?? '') ||
    String(resource.runId ?? '') ||
    (run && String(run.id ?? '')) ||
    String(resource.buildId ?? '') ||
    `unknown-${Date.now()}`
  );
}

export function getRunUrl(resource: AzureResource): string | undefined {
  if (resource._links?.web?.href) return resource._links.web.href;
  if (typeof resource.url === 'string') return resource.url;
  const run = resource.run;
  if (run?._links?.web?.href) return run._links.web.href;
  return undefined;
}

export function getPipelineName(resource: AzureResource): string | undefined {
  const name =
    resource.name ??
    resource.pipeline?.name ??
    resource.run?.pipeline?.name;
  return typeof name === 'string' ? name : undefined;
}

function stripRefsHeads(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

function branchFromRepositories(r: Record<string, unknown>): string | undefined {
  const tryRepos = (repos: unknown): string | undefined => {
    if (!Array.isArray(repos) || repos.length === 0) return undefined;
    const first = repos[0] as Record<string, unknown>;
    const ref = first?.refName ?? first?.name;
    return typeof ref === 'string' ? ref : undefined;
  };
  const run = r.run as Record<string, unknown> | undefined;
  const fromRun =
    run?.resources && typeof run.resources === 'object'
      ? tryRepos((run.resources as Record<string, unknown>).repositories)
      : undefined;
  if (fromRun) return fromRun;
  return tryRepos(r.repositories);
}

export function getBranch(resource: AzureResource): string | undefined {
  const r = resource as Record<string, unknown>;
  const raw =
    resource.sourceBranch ??
    resource.run?.sourceBranch ??
    (typeof r.sourceRefName === 'string' ? r.sourceRefName : undefined) ??
    (typeof r.pullRequestSourceBranch === 'string' ? r.pullRequestSourceBranch : undefined);
  if (typeof raw === 'string') return stripRefsHeads(raw);
  const fromRepos = branchFromRepositories(r);
  return typeof fromRepos === 'string' ? stripRefsHeads(fromRepos) : undefined;
}
