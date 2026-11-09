import 'dotenv/config';
import express, { Request, Response } from 'express';
import { getJiraKeyFromBuildCommit } from './utils/azure-devops';
import { getBranch, getPipelineName, getRunId, getRunUrl } from './utils/azure-payload';
import { isDuplicate, markProcessed } from './utils/dedup';
import { appendPipelineEvent } from './utils/events-store';
import { addJiraComment, checkJiraConnectivity, extractJiraKey, extractJiraKeyFromPayload, formatBrasilia, setJiraStatus } from './utils/jira';

const app = express();
app.use(express.json({ limit: '1mb' }));

// Log de toda requisição (para ver se algo chega)
app.use((req, _res, next) => {
  console.log('[server]', req.method, req.path);
  next();
});

const JIRA_STATUS_CODE_REVIEW = process.env.JIRA_STATUS_CODE_REVIEW ?? 'In Code Review';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';

// Validação opcional do webhook: header X-Webhook-Secret ou query ?secret=
app.use('/webhook/azuro', (req: Request, res: Response, next) => {
  if (!WEBHOOK_SECRET) return next();
  const secret = (req.headers['x-webhook-secret'] as string) ?? (req.query.secret as string);
  if (secret !== WEBHOOK_SECRET) {
    console.warn('[webhook] Secret inválido ou ausente');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

app.post('/webhook/azuro', async (req: Request, res: Response) => {
  try {
    const payload = req.body as Record<string, unknown>;
    const eventType = (payload?.eventType as string) ?? '';

    // Log toda requisição recebida (para debugar)
    console.log('[webhook] POST recebido', { eventType, hasResource: !!payload?.resource });

    if (!payload?.resource || typeof payload.resource !== 'object') {
      console.warn('[webhook] Body inválido: sem resource');
      return res.status(400).json({ error: 'Expected JSON body with resource' });
    }

    const resource = payload.resource as Record<string, unknown>;
    const title = (resource.title as string) ?? '';
    // Pull request updated usa sourceRefName; build/run-state usa sourceBranch
    const sourceBranch = (resource.sourceBranch as string) ?? (resource.sourceRefName as string) ?? '';

    let jiraKey = extractJiraKey(title);
    if (!jiraKey && sourceBranch) {
      jiraKey = extractJiraKey(sourceBranch.replace(/^refs\/heads\//, ''));
    }
    // Build/Run-state no main: branch não tem a chave; tenta achar em qualquer campo do resource (pipeline name, refs, etc.)
    if (!jiraKey && (eventType === 'build.complete' || eventType === 'ms.vss-pipelines.run-state-changed-event')) {
      jiraKey = extractJiraKeyFromPayload(resource);
    }

    // Build na main após merge: busca a chave na mensagem do commit (merge commit costuma ter o título da PR)
    const isMainBranch = /refs\/heads\/(main|master)$/.test(sourceBranch);
    if (!jiraKey && (eventType === 'build.complete' || eventType === 'ms.vss-pipelines.run-state-changed-event') && isMainBranch) {
      const keyFromCommit = await getJiraKeyFromBuildCommit(resource);
      if (keyFromCommit) jiraKey = keyFromCommit;
    }

    // Para build.complete e run-state-changed, title/sourceBranch costumam vir vazios no payload;
    // a chave é obtida de extractJiraKeyFromPayload (busca no JSON) ou getJiraKeyFromBuildCommit (API Azure).
    console.log('[webhook]', { eventType, title: title || '(vazio)', sourceBranch: sourceBranch || '(vazio)', jiraKey: jiraKey ?? '(não encontrada)' });

    if (!jiraKey) {
      console.log('[webhook] Ignorando: chave Jira não encontrada no título nem na branch');
      return res.status(200).json({ message: 'No Jira key in title or branch, skipping' });
    }

    // —— Fluxo 1: Pipeline → comentários em tempo real (apenas Run state changed; build.complete não envia comentários)
    if (eventType === 'build.complete') {
      console.log('[webhook] Build completed ignorado para comentários (use Run state changed para tempo real)');
      return res.status(200).json({ message: 'Pipeline comments are sent via Run state changed (real time)' });
    }

    // —— Fluxo 1 (único): Run state changed – um comentário ao iniciar, outro ao finalizar (tempo real)
    const runStateEvent = eventType === 'ms.vss-pipelines.run-state-changed-event';
    if (runStateEvent) {
      const run = resource.run as Record<string, unknown> | undefined;
      const state =
        (resource.state as string) ??
        (resource.runState as string) ??
        (run?.state as string) ??
        (run?.runState as string) ??
        '';
      const startTime =
        (resource.startTime as string) ??
        (resource.createdDate as string) ??
        (resource.queuedTime as string) ??
        (run?.createdDate as string) ??
        new Date().toISOString();
      const finishTime = (resource.finishTime as string) ?? (run?.finishTime as string);
      const result = (resource.result as string) ?? (run?.result as string) ?? '—';
      const runId = getRunId(resource);
      const runUrl = getRunUrl(resource);
      const pipelineName = getPipelineName(resource);
      const branch = getBranch(resource);

      // Deduplicação: evita comentar de novo se o Azure reenviar o mesmo evento
      if (isDuplicate(eventType, runId, state, jiraKey)) {
        console.log('[webhook] Evento duplicado ignorado:', runId, state, jiraKey);
        return res.status(200).json({ message: 'Duplicate event ignored' });
      }

      const isInProgress = /inprogress|in_progress|running|in progress|inprogress/i.test(state);
      const isCompleted = /completed|finished|complete|cancelled|canceled/i.test(state);

      console.log('[webhook] Run state changed:', state, '→', isInProgress ? 'início' : isCompleted ? 'fim' : 'ignorado');

      if (isInProgress) {
        const startBr = formatBrasilia(startTime);
        const parts = [`Pipeline iniciou em ${startBr} (Brasília).`];
        if (pipelineName) parts.push(`Pipeline: ${pipelineName}.`);
        if (branch) parts.push(`Branch: ${branch}.`);
        if (runUrl) parts.push(`Ver execução: ${runUrl}`);
        const comment = parts.join('\n');
        const ok = await addJiraComment(jiraKey, comment);
        if (ok) {
          markProcessed(eventType, runId, state, jiraKey);
          appendPipelineEvent({
            runId,
            state,
            jiraKey,
            timestamp: startTime,
            pipelineName,
            branch,
            runUrl,
            eventType,
          });
          console.log('[webhook] Comentário de início enviado para', jiraKey);
        }
        return res.status(ok ? 200 : 500).json(ok ? { message: `Comment added to ${jiraKey} (start)` } : { error: 'Jira comment failed' });
      }
      if (isCompleted) {
        const finishBr = finishTime ? formatBrasilia(finishTime) : formatBrasilia(startTime);
        const emoji = /succeed|success/i.test(result) ? '✅' : /fail|cancel/i.test(result) ? '❌' : '➖';
        const parts = [`Pipeline finalizou em ${finishBr} (Brasília).`, `Resultado: ${emoji} ${result}.`];
        if (pipelineName) parts.push(`Pipeline: ${pipelineName}.`);
        if (branch) parts.push(`Branch: ${branch}.`);
        if (runUrl) parts.push(`Ver execução: ${runUrl}`);
        const comment = parts.join('\n');
        const ok = await addJiraComment(jiraKey, comment);
        if (ok) {
          markProcessed(eventType, runId, state, jiraKey);
          appendPipelineEvent({
            runId,
            state,
            jiraKey,
            timestamp: finishTime || startTime,
            pipelineName,
            branch,
            result,
            runUrl,
            eventType,
          });
          console.log('[webhook] Comentário de fim enviado para', jiraKey);
        }
        return res.status(ok ? 200 : 500).json(ok ? { message: `Comment added to ${jiraKey} (finish)` } : { error: 'Jira comment failed' });
      }
      console.warn('[webhook] Run state não reconhecido (state=%s). Payload state/runState:', state, resource.state, resource.runState);
      return res.status(200).json({ message: 'Run state event ignored', state });
    }

    // —— Fluxo 2: PR atualizada (ex: revisor adicionado) → mudar status no Jira
    if (eventType === 'git.pullrequest.updated') {
      console.log('[webhook] Tentando mudar status no Jira:', jiraKey, '→', JIRA_STATUS_CODE_REVIEW);
      const ok = await setJiraStatus(jiraKey, JIRA_STATUS_CODE_REVIEW);
      if (ok) {
        console.log('[webhook] Status atualizado com sucesso para', jiraKey);
      } else {
        console.warn('[webhook] Falha ao atualizar status no Jira para', jiraKey, '- veja logs acima');
      }
      return res
        .status(ok ? 200 : 500)
        .json(ok ? { message: `Status updated for ${jiraKey}` } : { error: 'Jira transition failed' });
    }

    console.log('[webhook] Evento ignorado:', eventType);
    res.status(200).json({ message: 'Event ignored', eventType });
  } catch (e) {
    console.error('[webhook] Erro:', e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/health', (_req: Request, res: Response) => res.status(200).send('ok'));

/** Health check completo: testa conectividade com o Jira (para Kubernetes / Azure Function). */
app.get('/health/ready', async (_req: Request, res: Response) => {
  const jiraOk = await checkJiraConnectivity();
  if (!jiraOk) {
    return res.status(503).json({ status: 'not_ready', jira: false });
  }
  res.status(200).json({ status: 'ready', jira: true });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Webhook server listening on port ${port}`));
