# Webhook Azure DevOps → Jira

Serviço de integração que recebe eventos do **Azure DevOps Service Hooks** e atualiza automaticamente o **Jira Cloud**: comentários de pipeline em tempo real e transição de status quando um revisor é adicionado à Pull Request. Pensado para melhorar visibilidade e rastreabilidade entre desenvolvimento e gestão de tarefas.

---

## Visão geral

| Aspecto | Descrição |
|--------|------------|
| **Objetivo** | Automatizar a sincronização entre Azure DevOps (PRs, pipelines) e Jira, reduzindo trabalho manual e mantendo as issues atualizadas com o estado real do desenvolvimento. |
| **Tecnologias** | Node.js 18+, TypeScript, Express. Sem banco de dados; persistência opcional em arquivo JSONL para métricas. |
| **Integração** | Azure DevOps envia POST (Service Hooks) para uma URL HTTPS; o servidor identifica a issue Jira pelo título da PR ou nome da branch e executa a ação configurada. |

### Fluxos automatizados

| Fluxo | Gatilho (Azure DevOps) | Ação no Jira |
|-------|-------------------------|--------------|
| **Pipeline** | Run state changed (início e fim da execução) | Dois comentários na issue: horário de início e de fim em Brasília, nome da pipeline, branch, resultado (✅/❌) e link da run. Dados persistidos em arquivo para métricas e GAP. |
| **Code Review** | Pull request updated (revisor adicionado) | Transição de status da issue para o valor configurado (ex.: "Code Review"). |

A ligação **PR ↔ Issue** é por convenção: a chave da issue (ex.: `BEESEDI-123`) deve aparecer no **título da PR** ou no **nome da branch** (ex.: `[BEESEDI-123] Descrição` ou `feature/BEESEDI-123-nome`).

A documentação detalhada do estudo e da integração está na pasta **[docs/](docs/)**.

---

## Pré-requisitos

- **Node.js** 18 ou superior  
- **Conta Jira Cloud** com permissão para comentar e transicionar issues do projeto  
- **Token de API do Jira**: [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)  
- **URL HTTPS** acessível pelo Azure (em desenvolvimento local: túnel; em produção: hospedagem com URL fixa)  
- **Azure DevOps**: projeto com Service Hooks habilitados e pipelines YAML (para o evento Run state changed)

---

## Passo a passo: configurar e rodar o projeto

### 1. Clonar e instalar dependências

```bash
git clone <url-do-repositorio>
cd webhook-automation-azure
npm install
```

### 2. Variáveis de ambiente

Copie o arquivo de exemplo e preencha com os valores do seu ambiente:

```bash
cp .env.example .env
```

Edite o `.env`. Variáveis **obrigatórias**:

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `JIRA_BASE_URL` | URL base do Jira (sem barra final) | `https://sua-empresa.atlassian.net` |
| `JIRA_USER_EMAIL` | E-mail da conta Jira que possui o token | `seu-email@empresa.com` |
| `JIRA_API_TOKEN` | Token de API do Jira (sem aspas, exceto se contiver `=` ou espaços) | Gerar em id.atlassian.com |
| `JIRA_STATUS_CODE_REVIEW` | Nome **exato** do status no Jira para "em revisão" (Fluxo 2) | `Code Review` |

Variáveis **opcionais** (recomendadas para cenários reais):

| Variável | Descrição |
|----------|-----------|
| `AZURE_DEVOPS_PAT` | Token do Azure DevOps (scope: **Code – Read**). Usado quando a pipeline roda na branch `main` após o merge: o servidor busca a mensagem do commit para extrair a chave Jira. Criação: Azure DevOps → User settings → Personal access tokens. |
| `WEBHOOK_SECRET` | Secret compartilhado para validar requisições. Se definido, o servidor exige header `X-Webhook-Secret` ou query `?secret=` com o mesmo valor; caso contrário retorna 401. No Service Hook, use a URL com `?secret=SEU_VALOR`. |
| `PORT` | Porta do servidor (padrão: 3000). |

Outras opções (ver `.env.example`): `EVENT_STORE_DISABLED`, `WEBHOOK_DEDUP_TTL_MS`, `JIRA_RETRY_ATTEMPTS`, `JIRA_RETRY_DELAY_MS`, `EVENT_STORE_DIR`, `EVENT_STORE_FILE`.

### 3. Compilar e iniciar o servidor

**Desenvolvimento (com reload):**

```bash
npm run dev
```

**Produção:**

```bash
npm run build
npm start
```

O servidor sobe na porta configurada (padrão 3000). Endpoints disponíveis:

- `GET /health` — health check simples (responde `ok`)  
- `GET /health/ready` — health check completo: testa conectividade com o Jira (útil para Kubernetes/Azure Function)  
- `POST /webhook/azuro` — recebe o payload do Azure DevOps Service Hook  

### 4. Expor o servidor para o Azure (desenvolvimento local)

O Azure DevOps exige uma **URL HTTPS** acessível pela internet. Em máquina local, use um túnel.

**Recomendado: Cloudflare Tunnel**

1. Instale o `cloudflared`: [developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation)  
2. Com o servidor rodando em um terminal, em outro execute:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. Use a URL HTTPS exibida (ex.: `https://xxx.trycloudflare.com`) + `/webhook/azuro` no Service Hook. Se usar `WEBHOOK_SECRET`, adicione `?secret=SEU_VALOR` à URL.

**Alternativas:** Localtunnel (`npm run tunnel:lt`) — pode ser instável (503/408). Ngrok (requer conta e token; em redes com proxy/VPN pode falhar por certificado).

**Apenas para inspecionar o payload (não atualiza Jira):** [webhook.site](https://webhook.site) — cole a URL no Service Hook para ver o JSON enviado pelo Azure.

### 5. Configurar o Azure DevOps Service Hooks

1. No Azure DevOps: **Project settings** → **Service hooks** → **Create subscription**.  
2. **Service:** Web Hooks (Post via HTTP).  
3. **Trigger (eventos)** — crie uma subscription para cada um:
   - **Run state changed** (Pipelines): comentários de pipeline em tempo real (início e fim).  
   - **Pull request updated**: transição de status quando revisor é adicionado (filtro opcional: Reviewers updated).  
4. **URL:** `https://SUA-URL/webhook/azuro` (ou com `?secret=...` se usar `WEBHOOK_SECRET`).  
5. A URL deve ser **HTTPS** e acessível pela internet.

**Nota:** O evento **Build completed** não é usado para comentários neste projeto; os comentários de pipeline vêm apenas de **Run state changed**, permitindo notificações em tempo real (início e fim) e base para métricas (duração, GAP).

### 6. Convenção no Jira e no repositório

- No Jira: crie as issues no projeto desejado (ex.: chave `BEESEDI-123`).  
- No Azure DevOps: ao abrir uma PR, use no **título** a chave (ex.: `[BEESEDI-123] Implementar login`) ou inclua a chave no **nome da branch** (ex.: `feature/BEESEDI-123-login`).  
- O servidor extrai a chave com o padrão `SIGLA-NÚMERO` (ex.: `BEESEDI-123`) e associa o evento à issue correspondente.

### 7. Validar a configuração

- **Health:** `curl http://localhost:3000/health` → deve retornar `ok`.  
- **Ready (Jira):** `curl http://localhost:3000/health/ready` → 200 com `{ "status": "ready", "jira": true }` se as credenciais e a URL do Jira estiverem corretas.  
- **Teste de conexão Jira:** `npm run test:jira BEESEDI-1` (substitua pela chave de uma issue existente) — verifica leitura da issue e lista as transições disponíveis (ajuda a conferir o nome exato do status para `JIRA_STATUS_CODE_REVIEW`).  
- **Fluxo real:** crie uma issue no Jira, uma branch com a chave no nome, uma PR com a chave no título; adicione um revisor na PR e confira se o status da issue mudou; complete a PR e rode a pipeline e confira os comentários de início e fim na issue.

---

## Endpoints

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `POST` | `/webhook/azuro` | Recebe o payload do Azure DevOps Service Hook. Body: JSON. Se `WEBHOOK_SECRET` estiver definido, exige header ou query com o secret. |
| `GET` | `/health` | Health check simples; retorna `ok`. Uso em load balancer ou monitoramento básico. |
| `GET` | `/health/ready` | Health check de prontidão: testa conectividade com o Jira (GET /rest/api/3/myself). Retorna 200 com `{ "status": "ready", "jira": true }` ou 503. Indicado para readiness probe em Kubernetes ou Azure Function. |

---

## Eventos tratados

| Evento Azure | Comportamento |
|--------------|----------------|
| **ms.vss-pipelines.run-state-changed-event** | Comentários em tempo real: um ao **iniciar** a run (state inProgress) e outro ao **finalizar** (state completed). Conteúdo: horário em Brasília, nome da pipeline, branch, resultado com emoji (✅ sucesso / ❌ falha), link da run quando disponível no payload. Eventos duplicados (retry do Azure) são ignorados. Cada evento é persistido em `data/pipeline-events.jsonl` para métricas e análise de GAP (duração, tempo entre runs). |
| **git.pullrequest.updated** | Transição de status da issue Jira para o valor de `JIRA_STATUS_CODE_REVIEW` (ex.: "Code Review"). Útil quando um revisor é adicionado à PR. |
| **build.complete** | Ignorado para comentários (o cenário de pipeline é coberto por Run state changed). Resposta 200 com mensagem informativa. |
| Demais eventos | Resposta 200 com `{ "message": "Event ignored", "eventType": "..." }`. |

---

## Robustez e operação

- **Deduplicação:** eventos já processados (runId + state + jiraKey) são ignorados por um período configurável (padrão 1h), evitando comentários duplicados em caso de retry do Azure.  
- **Retry Jira:** em respostas 429 (rate limit) ou 5xx, o servidor realiza novas tentativas com backoff exponencial (configurável).  
- **Validação do webhook:** com `WEBHOOK_SECRET` definido, apenas requisições que enviem o secret (header ou query) são aceitas.  
- **Persistência de eventos:** pipeline início/fim gravados em JSONL (`data/pipeline-events.jsonl`) para uso em métricas e dashboards; pode ser desativada com `EVENT_STORE_DISABLED=1`.  
- **Health/ready:** endpoint dedicado para verificação de conectividade com o Jira, sem expor dados sensíveis.

---

## Hospedagem em produção

Para uso contínuo (sem túnel na máquina local), hospede o aplicativo em um serviço com **URL HTTPS fixa** e configure essa URL no Service Hook do Azure DevOps. Exemplos:

- **Azure Function** (Node.js): na pasta **[azure-function/](azure-function/)** há um projeto **separado** (Azure Function) com a mesma lógica do webhook. Use-o apenas para deploy no Azure; localmente continue usando o servidor Express da raiz (`npm start`). Ver [azure-function/README.md](azure-function/README.md) para configuração e deploy.  
- **App Service, Railway, Vercel** ou outro host que suporte Node.js e endpoint HTTP POST.

As variáveis de ambiente devem ser configuradas no painel do serviço (Application settings, environment variables, etc.); não commitar o arquivo `.env`.

---

## Como as peças se conectam (visão geral)

Fluxo da integração: quem chama quem e onde entra a configuração.

```
  Azure DevOps (Project)          URL do webhook              Seu serviço              Jira Cloud
  Service Hooks                  (ex.: Azure Function        (Express ou               REST API
  (Pull request updated,            /api/webhookAzuro)          Function)
  Run state changed)
         │                               │                           │                        │
         │  HTTP POST (payload JSON)      │                           │                        │
         └──────────────────────────────►                           │                        │
                                       │  (host descobre função      │                        │
                                       │   por function.json,        │                        │
                                       │   carrega index.js,         │                        │
                                       │   injeta process.env)       │                        │
                                       └────────────────────────────►                        │
                                                                     │  GET/POST transitions  │
                                                                     │  POST comment          │
                                                                     └───────────────────────►
```

- **Azure DevOps → URL:** Service Hooks são configurados no **Project** (uma subscription por evento). Todos os repositórios do projeto disparam para a mesma URL; não é necessário configurar por repositório.
- **URL → seu código:** No caso da Azure Function, o host lê `function.json` em cada pasta de função, registra a rota `/api/<nome-da-pasta>` e invoca o handler (`index.js`) passando `context` e `req`; as variáveis de ambiente (JIRA_*, etc.) vêm das **Application settings** no Azure, não do zip.
- **Seu código → Jira:** O handler extrai a chave Jira do payload (título da PR ou branch), lê credenciais de `process.env`, e chama a API do Jira (comentários e transições de status).

Diagrama detalhado e tabela dos elos (deploy zip, function.json, Application settings) estão em **[azure-function/README.md](azure-function/README.md#como-as-peças-se-conectam-deploy-zip-e-runtime)**.

---

## Scripts disponíveis

| Comando | Descrição |
|---------|------------|
| `npm run build` | Compila o TypeScript para `dist/`. |
| `npm start` | Inicia o servidor a partir de `dist/server.js`. |
| `npm run dev` | Inicia com `ts-node` (desenvolvimento). |
| `npm run typecheck` | Verifica tipos sem gerar arquivos (`tsc --noEmit`). |
| `npm run test:jira [ISSUE-KEY]` | Testa conexão com o Jira: leitura da issue e listagem de transições (ajuda a validar token e nome do status). |
| `npm run tunnel:lt` | Inicia localtunnel na porta 3000 (alternativa ao Cloudflare Tunnel). |

---

## Documentação adicional

### Documentação oficial (Azure DevOps e Jira)

| Recurso | Link | Descrição |
|--------|------|-----------|
| **Service Hooks – visão geral** | [Microsoft Learn: Integrate with Service Hooks](https://learn.microsoft.com/en-us/azure/devops/service-hooks/overview) | O que são Service Hooks, publishers, consumers e como funcionam. |
| **Web Hooks (POST via HTTP)** | [Microsoft Learn: Webhooks with Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/service-hooks/services/webhooks) | Como configurar uma subscription que envia POST para uma URL HTTPS (o que este projeto consome). |
| **Criar subscription** | [Microsoft Learn: Create a Service Hook Subscription](https://learn.microsoft.com/en-us/azure/devops/service-hooks/create-subscription) | Criar subscription pela interface ou via API REST. |
| **Resolver problemas** | [Microsoft Learn: Troubleshoot service hooks](https://learn.microsoft.com/en-us/azure/devops/service-hooks/troubleshoot) | Erros comuns, delivery history e dicas de diagnóstico. |
| **REST API – Hooks** | [Azure DevOps REST API: Hooks](https://learn.microsoft.com/en-us/rest/api/azure/devops/hooks/) | Referência da API de subscriptions (criar/lista/delete). |
| **Jira Cloud REST API** | [Atlassian: Jira Cloud platform REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) | API v3 do Jira (issues, comentários, transições) usada neste projeto. |
| **API Tokens Jira** | [Atlassian: Manage API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) | Onde criar e gerenciar o token de API do Jira. |

### Documentação do projeto (pasta docs/)

Toda a documentação do estudo e da integração está na pasta **[docs/](docs/)**:

- **[docs/testes-e-melhorias-webhook-azure-jira.md](docs/testes-e-melhorias-webhook-azure-jira.md)** — Registro de testes, melhorias implementadas, problemas e soluções, e guia para métricas/GAP.  
- **[docs/estudo-descoberta-azure-service-hooks-jira.md](docs/estudo-descoberta-azure-service-hooks-jira.md)** — Contexto dos Service Hooks e eventos do Azure.  
- **[docs/webhook-azuro-jira-codigo-node.md](docs/webhook-azuro-jira-codigo-node.md)** — Especificação técnica e exemplos (incluindo Azure Function).

---

## Resumo para apresentação

Este projeto oferece uma **integração automatizada e confiável** entre Azure DevOps e Jira:

1. **Visibilidade em tempo real:** comentários na issue quando a pipeline inicia e quando termina, com horário em Brasília, resultado e link.  
2. **Menos trabalho manual:** status da issue atualizado ao adicionar revisor na PR.  
3. **Base para métricas:** eventos de pipeline persistidos para análise de duração e GAP.  
4. **Robustez:** deduplicação, retry no Jira, validação opcional do webhook e health check adequado para ambientes orchestrados.

Requisitos principais: Node.js 18+, credenciais Jira (e opcionalmente Azure DevOps PAT), URL HTTPS para o webhook e convenção de chave da issue no título da PR ou nome da branch.
