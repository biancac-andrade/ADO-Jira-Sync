const JIRA_BASE = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
const JIRA_USER = process.env.JIRA_USER_EMAIL || '';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || '';
const JIRA_STATUS_CODE_REVIEW = process.env.JIRA_STATUS_CODE_REVIEW || 'Code Review';

const JIRA_KEY_REGEX = /\[?([A-Z]+-\d+)\]?/;

function authHeader(): Record<string, string> {
  const auth = Buffer.from(`${JIRA_USER}:${JIRA_TOKEN}`).toString('base64');
  return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
}

async function fetchWithRetry(url: string, init: RequestInit, attempt = 1): Promise<Response> {
  const res = await fetch(url, init);
  const retry = (res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt < 3;
  if (res.ok || !retry) return res;
  const delay = 1000 * Math.pow(2, attempt - 1);
  await new Promise((r) => setTimeout(r, delay));
  return fetchWithRetry(url, init, attempt + 1);
}

export function formatBrasilia(isoDate: string | undefined): string {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function extractJiraKey(title: string | undefined): string | null {
  const m = JIRA_KEY_REGEX.exec(title || '');
  return m ? m[1] : null;
}

export function extractJiraKeyFromPayload(obj: object): string | null {
  try {
    const m = JIRA_KEY_REGEX.exec(JSON.stringify(obj));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function addJiraComment(issueKey: string, text: string): Promise<boolean> {
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) {
    console.warn(
    '[jira] DEBUG: addJiraComment skipped (missing JIRA_BASE_URL, JIRA_USER_EMAIL or JIRA_API_TOKEN)'
  );
    return false;
  }
  const url = `${JIRA_BASE}/rest/api/3/issue/${issueKey}/comment`;
  console.info('[jira] DEBUG: POST comment for', issueKey);
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    }),
  });
  if (!res.ok) {
    console.warn('[jira] POST comment failed:', res.status, await res.text());
    return false;
  }
  console.info('[jira] DEBUG: POST comment ok for', issueKey);
  return true;
}

export async function clearIssueFields(
  issueKey: string,
  fieldIds: string[],
  log: LogFn = () => {}
): Promise<boolean> {
  if (!fieldIds.length) return true;
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) {
    log('[jira] clearIssueFields: missing credentials');
    return false;
  }
  const fields: Record<string, null | unknown[]> = {};
  for (const id of fieldIds) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    fields[trimmed] = null;
  }
  if (Object.keys(fields).length === 0) return true;
  const url = `${JIRA_BASE}/rest/api/3/issue/${issueKey}`;
  const res = await fetchWithRetry(url, {
    method: 'PUT',
    headers: authHeader(),
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    log('[jira] clearIssueFields failed:', res.status, body);
    return false;
  }
  log('[jira] clearIssueFields ok for', issueKey, Object.keys(fields).join(', '));
  return true;
}

export type LogFn = (...args: unknown[]) => void;

export async function setJiraStatus(
  issueKey: string,
  statusName: string = JIRA_STATUS_CODE_REVIEW,
  log: LogFn = () => {}
): Promise<boolean> {
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) {
    log('[jira] setJiraStatus: missing JIRA_BASE_URL, JIRA_USER_EMAIL or JIRA_API_TOKEN');
    return false;
  }
  const listUrl = `${JIRA_BASE}/rest/api/3/issue/${issueKey}/transitions`;
  const listRes = await fetchWithRetry(listUrl, { method: 'GET', headers: authHeader() });
  if (!listRes.ok) {
    const body = await listRes.text();
    log('[jira] GET transitions failed:', listRes.status, body);
    return false;
  }
  const data = (await listRes.json()) as {
    transitions?: Array<{ id: string; name: string; to?: { name?: string } }>;
  };
  const transitions = data.transitions || [];
  const t =
    transitions.find((tr) => tr.name === statusName) ||
    transitions.find((tr) => tr.to?.name === statusName);
  if (!t) {
    const names = transitions.map((tr) => {
      const dest = tr.to?.name;
      return dest ? `${tr.name} → ${dest}` : tr.name;
    });
    log(
      '[jira] Transition not found. Expected name or destination status:',
      statusName,
      '| Available:',
      names.join(', ') || '(none)'
    );
    return false;
  }
  const postRes = await fetchWithRetry(listUrl, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ transition: { id: t.id } }),
  });
  if (!postRes.ok) {
    const body = await postRes.text();
    log('[jira] POST transition failed:', postRes.status, body);
    return false;
  }
  return true;
}
