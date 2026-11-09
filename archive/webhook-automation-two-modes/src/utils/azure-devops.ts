import { extractJiraKey } from './jira';

const AZURE_PAT = process.env.AZURE_DEVOPS_PAT ?? process.env.AZURE_PAT ?? '';

/**
 * Quando a build roda na main (após merge da PR), o payload não traz o título da PR.
 * Busca o commit da build na API do Azure DevOps e extrai a chave Jira da mensagem
 * do commit (merge commit costuma incluir o título da PR, ex.: "Merge PR 2: [BEESEDI-2] Added...").
 */
export async function getJiraKeyFromBuildCommit(
  resource: Record<string, unknown>,
  pat: string = AZURE_PAT
): Promise<string | null> {
  if (!pat) return null;

  const repo = resource.repository as Record<string, unknown> | undefined;
  const repoUrl = (repo?.url as string) ?? '';
  const lastMerge = resource.lastMergeCommit as { commitId?: string } | undefined;
const sourceVersion = (resource.sourceVersion as string) ?? lastMerge?.commitId ?? '';

  if (!repoUrl || !sourceVersion) return null;

  const commitUrl = `${repoUrl.replace(/\/$/, '')}/commits/${sourceVersion}?api-version=7.1`;
  const auth = Buffer.from(`:${pat}`).toString('base64');

  try {
    const res = await fetch(commitUrl, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      console.warn('[azure] GET commit falhou:', res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { comment?: string };
    const message = data.comment ?? '';
    const key = extractJiraKey(message);
    if (key) console.log('[azure] Chave obtida da mensagem do commit:', key);
    return key;
  } catch (e) {
    console.warn('[azure] Erro ao buscar commit:', e);
    return null;
  }
}
