import type { AzureResource } from '../../types';
import { extractJiraKey } from '../jira/jira';

const AZURE_PAT = process.env.AZURE_DEVOPS_PAT || '';

export async function getJiraKeyFromBuildCommit(resource: AzureResource): Promise<string | null> {
  if (!AZURE_PAT) {
    console.info(
      '[azure-devops] DEBUG: getJiraKeyFromBuildCommit skipped (AZURE_DEVOPS_PAT not set)'
    );
    return null;
  }
  const repo = resource.repository;
  const repoUrl = (repo?.url ?? '').toString();
  const sourceVersion = (
    resource.sourceVersion ??
    resource.lastMergeCommit?.commitId ??
    ''
  ).toString();
  if (!repoUrl || !sourceVersion) {
    console.info(
      '[azure-devops] DEBUG: getJiraKeyFromBuildCommit skipped (repoUrl or sourceVersion empty)'
    );
    return null;
  }
  const commitUrl = `${String(repoUrl).replace(/\/$/, '')}/commits/${sourceVersion}?api-version=7.1`;
  const auth = Buffer.from(`:${AZURE_PAT}`).toString('base64');
  try {
    const res = await fetch(commitUrl, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      console.warn('[azure-devops] DEBUG: GET commit failed:', res.status);
      return null;
    }
    const data = (await res.json()) as { comment?: string };
    const key = extractJiraKey(data.comment);
    if (key) console.info('[azure-devops] DEBUG: Key extracted from commit:', key);
    return key;
  } catch (err) {
    console.warn('[azure-devops] DEBUG: getJiraKeyFromBuildCommit error:', err);
    return null;
  }
}
