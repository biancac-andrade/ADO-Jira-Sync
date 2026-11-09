/**
 * Azure Function: webhook Azure DevOps → Jira
 * Mesma lógica do servidor Express (src/server.ts), em formato Function.
 * Use este projeto apenas para deploy no Azure; localmente use o servidor na raiz do repositório.
 */

const JIRA_BASE = (process.env.JIRA_BASE_URL || '').replace(/\/$/, '');
const JIRA_USER = process.env.JIRA_USER_EMAIL || '';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || '';
const JIRA_STATUS_CODE_REVIEW = process.env.JIRA_STATUS_CODE_REVIEW || 'Code Review';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const AZURE_PAT = process.env.AZURE_DEVOPS_PAT || '';

const JIRA_KEY_REGEX = /\[?([A-Z]+-\d+)\]?/;
const TTL_MS = Number(process.env.WEBHOOK_DEDUP_TTL_MS) || 60 * 60 * 1000;
const dedupStore = new Map();

// Opcional: lista de repositórios permitidos (ex.: "repo-a,repo-b,repo-c"). Se vazio, processa todos.
const ALLOWED_REPOS_RAW = (process.env.ALLOWED_REPOS || '').trim();
const ALLOWED_REPOS = ALLOWED_REPOS_RAW ? new Set(ALLOWED_REPOS_RAW.split(',').map((s) => s.trim()).filter(Boolean)) : null;

function getRepoName(resource) {
  const repo = resource.repository;
  if (repo && typeof repo.name === 'string') return repo.name;
  return null;
}

function authHeader() {
  const auth = Buffer.from(`${JIRA_USER}:${JIRA_TOKEN}`).toString('base64');
  return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
}

function formatBrasilia(isoDate) {
  if (!isoDate) return '—';
  return new Date(isoDate).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function extractJiraKey(title) {
  const m = JIRA_KEY_REGEX.exec(title || '');
  return m ? m[1] : null;
}

function extractJiraKeyFromPayload(obj) {
  try {
    const m = JIRA_KEY_REGEX.exec(JSON.stringify(obj));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function getRunId(resource) {
  const run = resource.run;
  return resource.id || resource.runId || (run && run.id) || resource.buildId || `unknown-${Date.now()}`;
}

function getRunUrl(resource) {
  if (resource._links && resource._links.web && resource._links.web.href) return resource._links.web.href;
  if (typeof resource.url === 'string') return resource.url;
  const run = resource.run;
  if (run && run._links && run._links.web && run._links.web.href) return run._links.web.href;
  return undefined;
}

function getPipelineName(resource) {
  const name = resource.name || (resource.pipeline && resource.pipeline.name);
  return typeof name === 'string' ? name : undefined;
}

function getBranch(resource) {
  const raw = resource.sourceBranch || (resource.run && resource.run.sourceBranch);
  return typeof raw === 'string' ? raw.replace(/^refs\/heads\//, '') : undefined;
}

function isDuplicate(eventType, runId, state, jiraKey) {
  const now = Date.now();
  for (const [k, entry] of dedupStore.entries()) {
    if (entry.expiresAt <= now) dedupStore.delete(k);
  }
  const key = `${eventType}:${runId}:${state}:${jiraKey}`;
  const entry = dedupStore.get(key);
  if (entry && entry.expiresAt > now) return true;
  return false;
}

function markProcessed(eventType, runId, state, jiraKey) {
  const key = `${eventType}:${runId}:${state}:${jiraKey}`;
  dedupStore.set(key, { expiresAt: Date.now() + TTL_MS });
}

async function fetchWithRetry(url, init, attempt = 1) {
  const res = await fetch(url, init);
  const retry = (res.status === 429 || (res.status >= 500 && res.status < 600)) && attempt < 3;
  if (res.ok || !retry) return res;
  const delay = 1000 * Math.pow(2, attempt - 1);
  await new Promise((r) => setTimeout(r, delay));
  return fetchWithRetry(url, init, attempt + 1);
}

async function addJiraComment(issueKey, text) {
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) return false;
  const url = `${JIRA_BASE}/rest/api/3/issue/${issueKey}/comment`;
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({
      body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    }),
  });
  if (!res.ok) {
    console.warn('[jira] POST comment falhou:', res.status, await res.text());
    return false;
  }
  return true;
}

async function setJiraStatus(issueKey, statusName = JIRA_STATUS_CODE_REVIEW, log = () => {}) {
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) {
    log('[jira] setJiraStatus: faltam JIRA_BASE_URL, JIRA_USER_EMAIL ou JIRA_API_TOKEN');
    return false;
  }
  const listUrl = `${JIRA_BASE}/rest/api/3/issue/${issueKey}/transitions`;
  const listRes = await fetchWithRetry(listUrl, { method: 'GET', headers: authHeader() });
  if (!listRes.ok) {
    const body = await listRes.text();
    log('[jira] GET transitions falhou:', listRes.status, body);
    return false;
  }
  const data = await listRes.json();
  const transitions = data.transitions || [];
  const t = transitions.find((tr) => tr.name === statusName);
  if (!t) {
    const names = transitions.map((tr) => tr.name);
    log('[jira] Transição não encontrada. Esperado:', statusName, '| Disponíveis:', names.join(', ') || '(nenhuma)');
    return false;
  }
  const postRes = await fetchWithRetry(listUrl, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ transition: { id: t.id } }),
  });
  if (!postRes.ok) {
    const body = await postRes.text();
    log('[jira] POST transition falhou:', postRes.status, body);
    return false;
  }
  return true;
}

async function getJiraKeyFromBuildCommit(resource) {
  if (!AZURE_PAT) return null;
  const repo = resource.repository;
  const repoUrl = (repo && repo.url) || '';
  const sourceVersion = resource.sourceVersion || (resource.lastMergeCommit && resource.lastMergeCommit.commitId) || '';
  if (!repoUrl || !sourceVersion) return null;
  const commitUrl = `${repoUrl.replace(/\/$/, '')}/commits/${sourceVersion}?api-version=7.1`;
  const auth = Buffer.from(`:${AZURE_PAT}`).toString('base64');
  try {
    const res = await fetch(commitUrl, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return extractJiraKey(data.comment);
  } catch {
    return null;
  }
}

module.exports = async function (context, req) {
  context.log('[webhook] POST recebido', req.method, req.url);

  if (WEBHOOK_SECRET) {
    const secret = (req.headers && req.headers['x-webhook-secret']) || (req.query && req.query.secret);
    if (secret !== WEBHOOK_SECRET) {
      context.res = { status: 401, body: { error: 'Unauthorized' } };
      return;
    }
  }

  const payload = req.body || req.rawBody;
  const eventType = (payload && payload.eventType) || '';

  if (!payload || !payload.resource || typeof payload.resource !== 'object') {
    context.res = { status: 400, body: { error: 'Expected JSON body with resource' } };
    return;
  }

  const resource = payload.resource;
  if (ALLOWED_REPOS) {
    const repoName = getRepoName(resource);
    if (repoName && !ALLOWED_REPOS.has(repoName)) {
      context.log('[webhook] Repositório fora da lista permitida, ignorando:', repoName);
      context.res = { status: 200, body: { message: 'Repository not in ALLOWED_REPOS, skipping' } };
      return;
    }
  }
  const title = resource.title || '';
  // Pull request updated usa sourceRefName; build/run-state usa sourceBranch
  const sourceBranch = resource.sourceBranch || resource.sourceRefName || '';

  let jiraKey = extractJiraKey(title);
  if (!jiraKey && sourceBranch) jiraKey = extractJiraKey(sourceBranch.replace(/^refs\/heads\//, ''));
  if (!jiraKey && (eventType === 'build.complete' || eventType === 'ms.vss-pipelines.run-state-changed-event')) {
    jiraKey = extractJiraKeyFromPayload(resource);
  }
  const isMainBranch = /refs\/heads\/(main|master)$/.test(sourceBranch);
  if (!jiraKey && (eventType === 'build.complete' || eventType === 'ms.vss-pipelines.run-state-changed-event') && isMainBranch) {
    const keyFromCommit = await getJiraKeyFromBuildCommit(resource);
    if (keyFromCommit) jiraKey = keyFromCommit;
  }

  context.log('[webhook]', { eventType, title: title || '(vazio)', sourceBranch: sourceBranch || '(vazio)', jiraKey: jiraKey || '(não encontrada)' });

  if (!jiraKey) {
    context.res = { status: 200, body: { message: 'No Jira key in title or branch, skipping' } };
    return;
  }

  if (eventType === 'build.complete') {
    context.res = { status: 200, body: { message: 'Pipeline comments are sent via Run state changed (real time)' } };
    return;
  }

  if (eventType === 'ms.vss-pipelines.run-state-changed-event') {
    const run = resource.run;
    const state = resource.state || resource.runState || (run && run.state) || (run && run.runState) || '';
    const startTime = resource.startTime || resource.createdDate || resource.queuedTime || (run && run.createdDate) || new Date().toISOString();
    const finishTime = resource.finishTime || (run && run.finishTime);
    const result = resource.result || (run && run.result) || '—';
    const runId = getRunId(resource);
    const runUrl = getRunUrl(resource);
    const pipelineName = getPipelineName(resource);
    const branch = getBranch(resource);

    if (isDuplicate(eventType, runId, state, jiraKey)) {
      context.res = { status: 200, body: { message: 'Duplicate event ignored' } };
      return;
    }

    const isInProgress = /inprogress|in_progress|running|in progress/i.test(state);
    const isCompleted = /completed|finished|complete|cancelled|canceled/i.test(state);

    if (isInProgress) {
      const startBr = formatBrasilia(startTime);
      const parts = [`Pipeline iniciou em ${startBr} (Brasília).`];
      if (pipelineName) parts.push(`Pipeline: ${pipelineName}.`);
      if (branch) parts.push(`Branch: ${branch}.`);
      if (runUrl) parts.push(`Ver execução: ${runUrl}`);
      const ok = await addJiraComment(jiraKey, parts.join('\n'));
      if (ok) markProcessed(eventType, runId, state, jiraKey);
      context.res = { status: ok ? 200 : 500, body: ok ? { message: `Comment added to ${jiraKey} (start)` } : { error: 'Jira comment failed' } };
      return;
    }

    if (isCompleted) {
      const finishBr = finishTime ? formatBrasilia(finishTime) : formatBrasilia(startTime);
      const emoji = /succeed|success/i.test(result) ? '✅' : /fail|cancel/i.test(result) ? '❌' : '➖';
      const parts = [`Pipeline finalizou em ${finishBr} (Brasília).`, `Resultado: ${emoji} ${result}.`];
      if (pipelineName) parts.push(`Pipeline: ${pipelineName}.`);
      if (branch) parts.push(`Branch: ${branch}.`);
      if (runUrl) parts.push(`Ver execução: ${runUrl}`);
      const ok = await addJiraComment(jiraKey, parts.join('\n'));
      if (ok) markProcessed(eventType, runId, state, jiraKey);
      context.res = { status: ok ? 200 : 500, body: ok ? { message: `Comment added to ${jiraKey} (finish)` } : { error: 'Jira comment failed' } };
      return;
    }

    context.res = { status: 200, body: { message: 'Run state event ignored', state } };
    return;
  }

  if (eventType === 'git.pullrequest.updated') {
    context.log('[webhook] Tentando mudar status no Jira:', jiraKey, '→', JIRA_STATUS_CODE_REVIEW);
    const ok = await setJiraStatus(jiraKey, JIRA_STATUS_CODE_REVIEW, (...args) => context.log(...args));
    if (ok) context.log('[webhook] Status atualizado com sucesso para', jiraKey);
    context.res = { status: ok ? 200 : 500, body: ok ? { message: `Status updated for ${jiraKey}` } : { error: 'Jira transition failed' } };
    return;
  }

  context.res = { status: 200, body: { message: 'Event ignored', eventType } };
};
