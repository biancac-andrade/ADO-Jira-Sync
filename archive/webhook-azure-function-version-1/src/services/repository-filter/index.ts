/**
 * Optional repository filter (ALLOWED_REPOS). If empty, processes all repos in the project.
 */

import type { AzureResource } from '../../types';

const ALLOWED_REPOS_RAW = (process.env.ALLOWED_REPOS || '').trim();
const ALLOWED_REPOS: Set<string> | null = ALLOWED_REPOS_RAW
  ? new Set(
      ALLOWED_REPOS_RAW.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  : null;

export function getRepoName(resource: AzureResource): string | null {
  const repo = resource.repository;
  if (repo && typeof repo.name === 'string') return repo.name;
  return null;
}

export function isRepoAllowed(resource: AzureResource): boolean {
  if (!ALLOWED_REPOS) return true;
  const repoName = getRepoName(resource);
  if (!repoName) return true;
  return ALLOWED_REPOS.has(repoName);
}
