# Documentação: Testes e melhorias – Webhook Azure DevOps → Jira

Este documento registra todos os testes realizados, melhorias implementadas e descobertas do projeto de automação que conecta Azure DevOps (Service Hooks) ao Jira.

**Referências:**  
- [estudo-descoberta-azure-service-hooks-jira.md](./estudo-descoberta-azure-service-hooks-jira.md) – contexto e eventos do Azure  
- [webhook-azuro-jira-codigo-node.md](./webhook-azuro-jira-codigo-node.md) – especificação técnica e exemplos de código  

---

## 1. Objetivo e visão geral

**Objetivo:** Ao ocorrer eventos no Azure DevOps (PR atualizada, build/pipeline completada), o servidor recebe um POST, identifica a task do Jira pela chave no título da PR ou na branch, e atualiza o Jira (comentário e/ou mudança de status).

**Fluxos implementados:**

| Fluxo | Evento Azure | Ação no Jira |
|-------|--------------|--------------|
| **1** | **Run state changed** (pipelines YAML) | Comentários **em tempo real** (um ao iniciar, outro ao finalizar). Testado e funcionando. |
| **2** | Pull request updated (ex.: revisor adicionado) | Transição de status da issue para o valor de `JIRA_STATUS_CODE_REVIEW` (ex.: “Code Review”) |

**Ligação PR ↔ Jira:** O Azure não envia o ID da task. A convenção é usar a **chave no título da PR** ou no **nome da branch**, ex.: `[BEESEDI-1] Descrição` ou `feature/BEESEDI-1-xxx`. O servidor extrai a chave com o regex `/[A-Z]+-\d+/` (com ou sem colchetes).

---

## 2. Configuração passo a passo

### 2.1 Projeto (Node/TypeScript)

- **Repositório:** `webhook-automation-azure`
- Comandos: `npm install`, `npm run build`, `npm start` (ou `npm run dev` para desenvolvimento).
- Endpoint do webhook: `POST /webhook/azuro` (body JSON do Azure).
- Health check: `GET /health`.

### 2.2 Variáveis de ambiente (`.env`)

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `JIRA_BASE_URL` | Sim | Base do Jira (ex.: `https://heydev.atlassian.net`). Deve ser o mesmo domínio onde a issue existe. |
| `JIRA_USER_EMAIL` | Sim | E-mail da conta Jira (precisa ter permissão para ver e comentar na issue). |
| `JIRA_API_TOKEN` | Sim | Token de API do Jira. Se o token tiver `=`, usar aspas no `.env`. Gerar em: https://id.atlassian.com/manage-profile/security/api-tokens |
| `JIRA_STATUS_CODE_REVIEW` | Sim | Nome **exato** do status no Jira para “em revisão” (ex.: `Code Review`). Usado no Fluxo 2. |
| `AZURE_DEVOPS_PAT` | Opcional | Quando a pipeline roda na **main** após o merge, o servidor usa este token para buscar a mensagem do commit na API do Azure e extrair a chave Jira. Scope: **Code – Read**. |
| `WEBHOOK_SECRET` | Opcional | Se definido, exige header `X-Webhook-Secret` ou query `?secret=`; senão 401. |
| `EVENT_STORE_DISABLED` | Opcional | `1` para desativar a gravação de eventos em `data/pipeline-events.jsonl`. |
| `PORT` | Não | Porta do servidor (padrão 3000). |

### 2.3 Jira (Space key / Project key)

- Em Jira com **Spaces**, o equivalente ao “project key” é o **Space key** (ex.: BEESEDI, SCRUM).
- As issues ficam com chaves como `BEESEDI-1`, `BEESEDI-2`. O Space key **não** pode ser alterado depois de criado; para outra sigla é preciso criar um novo Space.
- O usuário do token precisa ter acesso ao Space e às issues (senão a API devolve 404).

### 2.4 Azure DevOps – Service Hooks

- **Project settings** → **Service hooks** → **Create subscription**.
- Eventos usados:
- **Run state changed** – para comentários de pipeline **em tempo real** (um ao iniciar, outro ao finalizar). É o evento usado para pipeline → Jira.
- **Pull request updated** – para mudar status quando revisor é adicionado (filtro opcional: Reviewers updated).
- **Build completed** – não é usado para comentários; o servidor ignora (comentários vêm só de Run state changed).
- Em todas as subscriptions, a **URL** deve ser: `https://SUA-URL-DO-TUNNEL-OU-APP/webhook/azuro`.
- A URL precisa ser **HTTPS** e acessível pela internet (em local use túnel).

### 2.5 Expor o servidor (túnel ou hospedagem)

| Opção | Testado? | Resultado / Observação |
|-------|----------|------------------------|
| **Cloudflare Tunnel (trycloudflare)** | Sim | **Funcionou.** Comando: `cloudflared tunnel --url http://localhost:3000`. URL estável enquanto o processo estiver rodando; entrega confiável. **Recomendado para testes locais.** |
| **ngrok** | Sim | **Não deu certo** no ambiente testado: erro `tls: failed to verify certificate: x509: certificate signed by unknown` (proxy/VPN ou certificado corporativo). Exige conta e token; em redes com inspeção TLS pode falhar. |
| **Localtunnel** | Sim | **Instável:** 503 Service Unavailable ou 408 Request Timeout em vários testes; URL muda a cada `npm run tunnel:lt`. Útil só para prova rápida. |
| **webhook.site** | Sim | **Funcionou para validar o envio:** o Azure dispara o POST e a URL recebe; dá para ver o payload completo. **Limitação:** não encaminha para o seu servidor nem chama o Jira — só exibe as requisições. Serve para conferir que o Service Hook está configurado e que o payload está correto; não substitui o app para atualizar o Jira. |
| **Hospedagem (Azure Function, etc.)** | Não testado neste projeto | URL fixa HTTPS; ideal para uso contínuo. Ver **Seção 9** para como seria com Azure Function. |

---

## 3. Testes realizados (cronologia e resultados)

### 3.1 Servidor e saúde

- **Teste:** `curl http://localhost:3000/health`  
- **Resultado:** Resposta `ok` com servidor rodando.

### 3.2 Fluxo 2 – Status no Jira (revisor na PR)

- **Teste 1 (curl local):**  
  `POST /webhook/azuro` com payload `eventType: "git.pullrequest.updated"`, `resource.title: "[BEESEDI-1] Teste"`.  
- **Resultado:** Resposta `{"message":"Status updated for BEESEDI-1"}`; status da BEESEDI-1 no Jira alterado para “Code Review”.
- **Teste 2 (Azure real):** PR com título `[BEESEDI-2] Added new arquive`; revisor adicionado (optional).  
- **Resultado:** Service Hook disparou; servidor recebeu POST; status da BEESEDI-2 atualizado no Jira.

### 3.3 Fluxo 1 – Comentários de pipeline (início e fim)

- **Teste 1 (curl local):**  
  `POST /webhook/azuro` com `eventType: "build.complete"`, `resource` com `title`, `sourceBranch`, `startTime`, `finishTime`, `result`.  
- **Resultado:** Dois comentários adicionados na issue (início e fim em Brasília).
- **Teste 2 (Azure real – pipeline na main após merge):**  
  PR completada (merge); pipeline da main executada; evento `build.complete` com `sourceBranch: refs/heads/main`, sem `title` no payload.  
- **Resultado:** Chave obtida via **API do Azure** (mensagem do commit de merge) quando `AZURE_DEVOPS_PAT` está configurado; comentários enviados para a issue correta (ex.: BEESEDI-2).

**Quando os comentários aparecem no Jira (tempo real vs. só no fim):**

| Evento no Service Hook | Quando o Azure dispara | Comportamento no Jira |
|------------------------|------------------------|------------------------|
| **Build completed** | **Só quando a build termina** (um único POST) | Os **dois** comentários (“Pipeline iniciou…” e “Pipeline finalizou…”) são enviados **juntos**, após a pipeline ter finalizado. Não há comentário “em tempo real” no início. |
| **Run state changed** | **Dois POSTs em tempo real:** um quando a run **inicia** (state inProgress) e outro quando **termina** (state completed) | Comentário “Pipeline iniciou…” é enviado **assim que a pipeline começa**; “Pipeline finalizou…” **assim que termina**. É o evento recomendado para **métricas e gráficos** (ex.: tempo de execução, GAP entre pipelines). |

**Para comentários em tempo real (e métricas):** use a subscription **Run state changed** (Pipelines). Assim que a pipeline iniciar → um comentário no Jira com horário de início; assim que finalizar → comentário com horário de fim e resultado. Esses horários em Brasília permitem depois montar métricas e gráficos (ex.: duração da pipeline, tempo entre conclusão de uma e início da próxima — GAP entre pipelines). Se usar só **Build completed**, os dois comentários só aparecem após a pipeline ter finalizado.

### 3.4 Túnel e entrega

- **Cloudflare Tunnel (trycloudflare):** Foi o que **deu certo** nos testes: `cloudflared tunnel --url http://localhost:3000`; a URL gerada (ex.: `https://xxx.trycloudflare.com`) foi usada no Service Hook e os eventos chegaram ao servidor; comentários e mudança de status no Jira funcionaram.
- **ngrok:** **Não funcionou** no ambiente testado: ao rodar `ngrok http 3000` apareceu erro de TLS (`certificate signed by unknown`), típico de rede com proxy/VPN ou certificado corporativo. Não foi possível usar ngrok para receber os webhooks.
- **Localtunnel:** Em vários testes deu **503 Service Unavailable** ou **408 Request Timeout**; a URL muda a cada reinício do `npm run tunnel:lt`. Não é confiável para testes contínuos.
- **webhook.site:** **Funcionou** para ver o POST: colamos a URL no Service Hook e o Azure enviou o payload; a página do webhook.site exibiu o JSON. **Limitação:** o webhook.site só recebe e mostra — não encaminha para o nosso servidor nem chama a API do Jira, então não atualiza o Jira. Útil só para validar que o Azure está disparando e inspecionar o payload.

### 3.5 Jira – Permissão e URL

- **Problema:** Resposta 404 com mensagem “事务不存在或者您没有查看的权限” (issue não existe ou sem permissão).
- **Causas identificadas:**  
  (1) `JIRA_BASE_URL` apontando para outro domínio que não o da issue (ex.: issue em `heydev.atlassian.net`).  
  (2) Conta do token sem acesso ao Space/issue (mesmo com o mesmo e-mail logado no navegador).  
- **Solução:** Ajustar `JIRA_BASE_URL` para o domínio correto; garantir que o usuário do token tem permissão na issue; gerar novo token se necessário. Script `npm run test:jira BEESEDI-1` criado para testar leitura e transições da issue.

### 3.6 Nome do status no Jira

- **Problema:** Transição não encontrada ao mudar status.  
- **Causa:** Valor de `JIRA_STATUS_CODE_REVIEW` diferente do nome exato no Jira (ex.: “In Code Review” vs “Code Review”).  
- **Solução:** Usar o nome exato exibido no Jira (ex.: `Code Review`). O script `npm run test:jira` lista as transições disponíveis.

---

## 4. Problemas encontrados e soluções

| Problema | Causa | Solução |
|----------|--------|---------|
| Nada aparece no terminal ao adicionar revisor | POST não chega ao servidor | Verificar túnel ativo; URL correta no Service Hook; Delivery history no Azure. |
| 503 / 408 no Delivery history | Túnel instável ou servidor inacessível | Usar Cloudflare Tunnel ou hospedar o app. |
| 404 ao comentar/mudar status no Jira | URL errada ou sem permissão | Conferir `JIRA_BASE_URL` e permissões; rodar `npm run test:jira ISSUE-KEY`. |
| Chave não encontrada em build.complete (main) | Payload da build não traz título da PR nem branch com chave | Configurar `AZURE_DEVOPS_PAT`; servidor busca commit na API do Azure e extrai chave da mensagem do merge. |
| title/sourceBranch vazios no log para build e run-state | Payload é da build/run, não da PR | Esperado; chave obtida por `extractJiraKeyFromPayload` ou `getJiraKeyFromBuildCommit`. |
| Token com `=` no .env | Shell/parser interpreta `=` | Usar aspas: `JIRA_API_TOKEN="valor_com_="`. |

---

## 5. Melhorias implementadas

1. **Logs no servidor**  
   - Log de toda requisição: `[server] METHOD /path`.  
   - Log por evento: `eventType`, `title`, `sourceBranch`, `jiraKey`.  
   - Log ao enviar comentários de pipeline e ao falhar comentário no Jira (`[jira] POST comment falhou`).

2. **Comentários de pipeline em tempo real (apenas Run state changed)**
   - Um comentário quando a pipeline **inicia** (state inProgress); outro quando **finaliza** (state completed), em tempo real. **Build completed** não envia comentários (servidor ignora).

3. **Suporte a Run state changed (YAML) em tempo real**  
   - Tratamento de `ms.vss-pipelines.run-state-changed-event`: **assim que** a run inicia (state inProgress) → comentário “Pipeline iniciou…”; **assim que** termina (state completed) → comentário “Pipeline finalizou…”.  
   - Detecção de estado ampliada: `resource.state`, `resource.runState` e `resource.run.state` / `resource.run.runState`; aceita PascalCase e variações (InProgress, Completed, Cancelled).  
   - Horários de início/fim em Brasília nos comentários permitem métricas e gráficos (ex.: duração da pipeline, GAP entre pipelines).

4. **Chave quando a build roda na main**  
   - Se não houver chave no payload e a branch for main/master, o servidor chama a API do Azure DevOps (com `AZURE_DEVOPS_PAT`) para obter a mensagem do commit da build e extrair a chave (ex.: do merge “Merge PR 2: [BEESEDI-2] …”).

5. **Fallback de extração de chave**  
   - `extractJiraKeyFromPayload(resource)`: procura padrão `SIGLA-NÚMERO` em todo o JSON do `resource`, para build e run-state em que a chave aparece em outro campo.

6. **Script de teste de conexão Jira**  
   - `npm run test:jira [ISSUE-KEY]`: testa leitura da issue e lista de transições; ajuda a diagnosticar 401/404 e nome do status.

7. **Arquivo de exemplo de payload**  
   - `samples/payload-pull-request-updated.json` para testes locais com `curl -d @samples/...`.

8. **Documentação no README**  
   - Instruções para Cloudflare Tunnel, variável `AZURE_DEVOPS_PAT` e testes locais.

9. **Robustez e operação**  
   - **Deduplicação:** identificador do evento (runId + state + jiraKey) guardado em memória com TTL (1h; `WEBHOOK_DEDUP_TTL_MS`). Se o Azure reenviar o mesmo evento (retry), o servidor ignora e retorna 200.  
   - **Retry Jira:** em 429 (rate limit) ou 5xx, o servidor faz até 3 tentativas com backoff exponencial (`JIRA_RETRY_ATTEMPTS`, `JIRA_RETRY_DELAY_MS`).  
   - **Validação do webhook:** se `WEBHOOK_SECRET` estiver definido, a rota `/webhook/azuro` exige header `X-Webhook-Secret` ou query `?secret=` com o mesmo valor; caso contrário 401.  
   - **Health check completo:** `GET /health/ready` testa conectividade com o Jira (GET /rest/api/3/myself); retorna 200 se ok, 503 se não. Útil para Kubernetes ou Azure Function.  
   - **Persistência de eventos:** cada início/fim de pipeline é gravado em `data/pipeline-events.jsonl` (JSONL) para métricas e GAP; desative com `EVENT_STORE_DISABLED=1`.  
   - **Comentário rico no Jira:** além do horário em Brasília, o comentário inclui nome da pipeline, branch, resultado com emoji (✅ sucesso / ❌ falha), e link da run no Azure DevOps quando disponível no payload (`resource._links.web.href` ou `resource.url`).

---

## 6. Descobertas técnicas

- **Payload de build.complete:** O `resource` descreve a **build** (branch buildada, horários, resultado, repositório). Não contém `title` de PR; em pipeline na main, `sourceBranch` é `refs/heads/main`. A chave precisa vir da mensagem do commit (via API) ou de outro campo se existir.
- **Payload de run-state-changed:** Estrutura do run da pipeline; pode não ter `title` nem `sourceBranch` no topo; a chave pode aparecer em campos aninhados (por isso a busca em todo o payload).
- **Payload de pull request updated:** Sempre que o evento for de PR, o `resource` traz `title` (título da PR); a chave é extraída daí.
- **Jira (Space key):** Em Jira com Spaces, a “project key” é o **Space key**; não é editável após criação do Space.

---

## 7. O que é necessário para rodar

1. **Ambiente:** Node 18+, `.env` preenchido (Jira + opcionalmente `AZURE_DEVOPS_PAT`).  
2. **Servidor:** `npm run build && npm start` (ou `npm run dev`).  
3. **URL pública:** Túnel (ex.: Cloudflare) ou app hospedado; URL configurada em todas as subscriptions de Service Hooks.  
4. **Jira:** Issues existentes no mesmo domínio de `JIRA_BASE_URL`; usuário do token com permissão para comentar e transicionar.  
5. **Convenção:** Título da PR ou nome da branch com a chave (ex.: `[BEESEDI-2] Descrição` ou `feature/BEESEDI-2-xxx`).

---

### 7.1 Uso para métricas e gráficos (GAP entre pipelines)

Os comentários enviados no Jira com horário de **início** e **fim** da pipeline (em Brasília) servem como fonte para métricas e gráficos. Com a subscription **Run state changed** em tempo real:

- **Quando a pipeline inicia** → comentário com “Pipeline iniciou em DD/MM HH:mm (Brasília)”.
- **Quando a pipeline termina** → comentário com “Pipeline finalizou em DD/MM HH:mm (Brasília)” e resultado.

A partir desses dados (por issue, por pipeline, por período) dá para calcular, por exemplo:

- **Duração da pipeline** (tempo entre início e fim).
- **GAP entre pipelines** (tempo entre o fim de uma execução e o início da próxima, ou entre merge e início da build).
- Tendências e atrasos por projeto ou branch.

Para isso, use **Run state changed** (e não apenas Build completed), para que os dois comentários sejam disparados em tempo real e os horários reflitam o momento real de início e fim.

---

## 8. Como testar de ponta a ponta

1. Criar uma task no Jira (ex.: BEESEDI-3) e anotar a chave.  
2. No Azure: criar branch com a chave no nome (ex.: `feature/BEESEDI-3-teste`); criar PR com título `[BEESEDI-3] Teste E2E`.  
3. Subir servidor e túnel; conferir URL no Service Hook.  
4. **Fluxo 2:** Adicionar revisor na PR → verificar no Jira se o status da BEESEDI-3 mudou para “Code Review”.  
5. **Fluxo 1:** Completar a PR (merge) e deixar a pipeline da main rodar (ou rodar a pipeline no branch da PR) → verificar na BEESEDI-3 os dois comentários (início e fim da pipeline).  
6. Conferir no terminal os logs `[webhook]` e `[jira]` para confirmar recebimento e sucesso/erro das chamadas ao Jira.

---

## 9. Como seria com Azure Function (hospedagem)

Para uso contínuo, em vez de manter o servidor Node rodando e um túnel (Cloudflare), o webhook pode ser hospedado como **Azure Function**. Assim você obtém uma **URL HTTPS fixa** (ex.: `https://<app>.azurewebsites.net/api/webhook-azuro?code=...`) para colar no Service Hook, sem precisar de túnel nem máquina ligada.

### 9.1 Visão geral

- **Runtime:** Node.js 18+ (ou 20).
- **Trigger:** HTTP (POST para `/api/webhook-azuro`).
- **Variáveis:** As mesmas do `.env` (JIRA_*, AZURE_DEVOPS_PAT) viram **Application settings** do Function App.
- **Lógica:** A mesma do `server.ts`: ler `eventType` e `resource`, extrair chave Jira (título, branch, payload inteiro ou API Azure quando branch = main), e então chamar Jira (comentário e/ou transição).

### 9.2 Estrutura sugerida

```
webhook-azure-function/
  host.json
  package.json
  src/functions/
    webhookAzuro/
      index.js          # handler que replica a lógica do POST /webhook/azuro
  local.settings.json   # não commitar; só para testes locais
```

- **host.json:** versão 2.0 e extensionBundle (Azure Functions).
- **package.json:** sem Express; só as dependências usadas no handler (ou nenhuma se usar apenas `fetch` nativo).
- **webhookAzuro/index.js:** recebe `context.req` (body JSON), aplica a mesma lógica do servidor atual (extrair chave; run-state-changed → comentário início/fim em tempo real; pullrequest.updated → setJiraStatus; build.complete ignorado para comentários), chama as funções de Jira (adaptadas para não depender de `process.env` no load-time — ler de `process.env` dentro do handler ou receber config injetada). Resposta em `context.res`.

### 9.3 Configuração no Azure

1. **Criar Function App** (Portal ou CLI): Runtime Node 18/20, plano Consumption (ou App Service).
2. **Application settings:** Adicionar `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`, `JIRA_STATUS_CODE_REVIEW`, `AZURE_DEVOPS_PAT` (opcional).
3. **Deploy:** Publicar a pasta do projeto (Azure CLI, VS Code, GitHub Actions, etc.).
4. **URL do trigger:** Copiar a URL da função (com query `code=` se usar `authLevel: 'function'`) e colar em **Service Hooks** do Azure DevOps em todas as subscriptions (Build completed, Pull request updated, Run state changed).

### 9.4 Vantagens

- URL fixa; não depende de túnel nem PC ligado.
- Escala sob demanda (Consumption).
- Mesma nuvem Microsoft (Azure DevOps e Function App); latência e rede estáveis.
- As variáveis sensíveis ficam nos Application settings (não vão para o repositório).

### 9.5 Referência de código

O documento [webhook-azuro-jira-codigo-node.md](./webhook-azuro-jira-codigo-node.md) já traz um **Exemplo 3: Azure Function (Node.js)** com estrutura `function.json`, `host.json` e um handler que trata `build.complete` e `git.pullrequest.updated`. Para alinhar ao comportamento atual deste projeto, o handler da Function precisaria:

- Enviar comentários de pipeline **apenas** via **run-state-changed** (comentário início + fim em tempo real); não tratar `build.complete` para comentários.
- Incluir **extractJiraKeyFromPayload** e, quando branch = main, chamada à **API do Azure** (getJiraKeyFromBuildCommit) usando `AZURE_DEVOPS_PAT`.
- Usar o mesmo regex e a mesma convenção de título/branch para extrair a chave Jira.

Ou seja: a **lógica** é a mesma do `server.ts` e dos utils (`jira.ts`, `azure-devops.ts`); só o “wrapper” muda (HTTP trigger da Function em vez de Express).

---

*Última atualização: fevereiro 2026.*
