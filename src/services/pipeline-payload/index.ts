/**
 * Extracts data from Azure payload (run-state-changed) for Jira comments.
 */

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
  const name = resource.name ?? resource.pipeline?.name;
  return typeof name === 'string' ? name : undefined;
}

export function getBranch(resource: AzureResource): string | undefined {
  const raw = resource.sourceBranch ?? resource.run?.sourceBranch;
  return typeof raw === 'string' ? raw.replace(/^refs\/heads\//, '') : undefined;
}
