/**
 * Extrai dados do payload do Azure (run-state-changed) para comentário e persistência.
 */

export function getRunId(resource: Record<string, unknown>): string {
  const run = resource.run as Record<string, unknown> | undefined;
  return (
    (resource.id as string) ??
    (resource.runId as string) ??
    (run?.id as string) ??
    (resource.buildId as string) ??
    `unknown-${Date.now()}`
  );
}

export function getRunUrl(resource: Record<string, unknown>): string | undefined {
  const links = resource._links as Record<string, { href?: string }> | undefined;
  if (links?.web?.href) return links.web.href;
  if (typeof resource.url === 'string') return resource.url;
  const run = resource.run as Record<string, unknown> | undefined;
  const runLinks = run?._links as Record<string, { href?: string }> | undefined;
  if (runLinks?.web?.href) return runLinks.web.href;
  return undefined;
}

export function getPipelineName(resource: Record<string, unknown>): string | undefined {
  const name = resource.name ?? (resource.pipeline as Record<string, unknown>)?.name;
  return typeof name === 'string' ? name : undefined;
}

export function getBranch(resource: Record<string, unknown>): string | undefined {
  const raw = (resource.sourceBranch as string) ?? (resource.run as Record<string, unknown>)?.sourceBranch;
  if (typeof raw !== 'string') return undefined;
  return raw.replace(/^refs\/heads\//, '');
}
