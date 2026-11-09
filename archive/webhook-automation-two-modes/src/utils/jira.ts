const JIRA_BASE = (process.env.JIRA_BASE_URL ?? '').replace(/\/$/, '');
const JIRA_USER = process.env.JIRA_USER_EMAIL ?? '';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN ?? '';
const JIRA_STATUS_CODE_REVIEW = process.env.JIRA_STATUS_CODE_REVIEW ?? 'In Code Review';

const JIRA_RETRY_ATTEMPTS = Math.min(Number(process.env.JIRA_RETRY_ATTEMPTS) || 3, 5);
const JIRA_RETRY_DELAY_MS = Number(process.env.JIRA_RETRY_DELAY_MS) || 1000;

function authHeader(): Record<string, string> {
  const auth = Buffer.from(`${JIRA_USER}:${JIRA_TOKEN}`).toString('base64');
  return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
}

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/** Fetch com retry e backoff para 429 e 5xx. */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempt = 1
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.ok || attempt >= JIRA_RETRY_ATTEMPTS || !shouldRetry(res.status)) return res;
  const delayMs = JIRA_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
  console.warn(`[jira] Retry ${attempt}/${JIRA_RETRY_ATTEMPTS} em ${delayMs}ms (status ${res.status})`);
  await new Promise((r) => setTimeout(r, delayMs));
  return fetchWithRetry(url, init, attempt + 1);
}

/** Formata ISO UTC para horário Brasília (DD/MM/YYYY HH:mm) */
export function formatBrasilia(isoDate: string | undefined | null): string {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const JIRA_KEY_REGEX = /\[?([A-Z]+-\d+)\]?/;

/** Extrai chave Jira do título da PR. Ex: "[BEESEDI-12345] Fix" => "BEESEDI-12345" */
export function extractJiraKey(title: string | undefined | null): string | null {
  const m = JIRA_KEY_REGEX.exec(title ?? '');
  return m ? m[1] : null;
}

/** Procura chave Jira em qualquer campo do payload (útil para build/run-state quando branch é main). */
export function extractJiraKeyFromPayload(obj: Record<string, unknown>): string | null {
  try {
    const s = JSON.stringify(obj);
    const m = JIRA_KEY_REGEX.exec(s);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Adiciona comentário na issue do Jira (Jira Cloud API v3) */
export async function addJiraComment(issueKey: string, text: string): Promise<boolean> {
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) {
    console.warn('Jira env vars missing, skipping API call');
    return false;
  }
  const url = `${JIRA_BASE}/rest/api/3/issue/${issueKey}/comment`;
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
    const body = await res.text();
    console.warn('[jira] POST comment falhou:', res.status, issueKey, body);
    return false;
  }
  return true;
}

/** Lista transições disponíveis e aplica a que bate com o nome (ex: "In Code Review") */
export async function setJiraStatus(issueKey: string, statusName: string = JIRA_STATUS_CODE_REVIEW): Promise<boolean> {
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) {
    console.warn('[jira] setJiraStatus: variáveis JIRA_* não configuradas');
    return false;
  }
  const listUrl = `${JIRA_BASE}/rest/api/3/issue/${issueKey}/transitions`;
  const listRes = await fetchWithRetry(listUrl, { method: 'GET', headers: authHeader() });
  if (!listRes.ok) {
    const body = await listRes.text();
    console.warn('[jira] GET transitions falhou:', listRes.status, body);
    return false;
  }
  const data = (await listRes.json()) as { transitions: Array<{ id: string; name: string }> };
  const { transitions } = data;
  const t = transitions.find((tr) => tr.name === statusName);
  if (!t) {
    const names = transitions.map((tr) => tr.name).join(', ');
    console.warn('[jira] Status "' + statusName + '" não encontrado. Transições disponíveis:', names || '(nenhuma)');
    return false;
  }
  const postRes = await fetchWithRetry(listUrl, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ transition: { id: t.id } }),
  });
  if (!postRes.ok) {
    const body = await postRes.text();
    console.warn('[jira] POST transition falhou:', postRes.status, body);
    return false;
  }
  return true;
}

/** Verifica conectividade com o Jira (para GET /health/ready). Não expõe dados sensíveis. */
export async function checkJiraConnectivity(): Promise<boolean> {
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) return false;
  const url = `${JIRA_BASE}/rest/api/3/myself`;
  try {
    const res = await fetch(url, { method: 'GET', headers: authHeader() });
    return res.ok;
  } catch {
    return false;
  }
}
