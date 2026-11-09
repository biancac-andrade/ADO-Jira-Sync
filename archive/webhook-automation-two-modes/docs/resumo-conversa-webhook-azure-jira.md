# Resumo da conversa: Webhook Azure DevOps → Jira

Documento para levar o contexto das decisões e do que foi feito nesta sessão.

---

## 1. Estrutura: teste local vs Azure

- **`webhook-automation-azure/`** (este repositório): servidor **Express** em TypeScript (`src/`), testes locais, túnel, documentação em `docs/`. **Não foi alterado** na separação.
- **`webhook-azure-function/`** (pasta separada em `Desktop/Developer/`): **só** a Azure Function, em JavaScript, pronta para subir em **outro repositório** (não mistura com código de teste local).

A Azure Function **não depende** da pasta `src/`: a lógica foi replicada em um único `index.js` (e depois separada em `utils/` no repo da function). Tudo que sobe no Azure está dentro da pasta da Function.

---

## 2. Onde está cada coisa

| O que | Onde |
|-------|------|
| Teste local (Express, TypeScript) | `webhook-automation-azure/` (raiz: `npm start`, `src/server.ts`, `src/utils/`) |
| Deploy Azure (Function, JavaScript) | `webhook-azure-function/` (repositório separado) |
| Documentação (motivação, benefícios, guia técnico, diagrama) | `webhook-automation-azure/docs/`, READMEs, e página no Notion "Integracoes & Automatizacao entre azure e jira" |
| Configuração sensível (Jira, ALLOWED_REPOS) | **Application settings** no Portal Azure (ou `local.settings.json` local); não vai no zip. |
| ALLOWED_REPOS (filtrar por repositório) | Application settings no Azure; ou `.env` / `local.settings.json` no exemplo. Documentado em `.env.example` e `local.settings.json.example`. |

---

## 3. Webhook: por projeto, não por repositório

- Service Hooks são configurados no **Project** do Azure DevOps.
- **Uma** subscription por evento (ex.: Pull request updated, Run state changed) → **uma** URL → **todos** os repositórios desse projeto disparam para a mesma URL.
- Não é preciso configurar webhook por repositório.
- Se o projeto for compartilhado com outros times e você quiser processar só os repos do seu time: use a variável **ALLOWED_REPOS** (lista de nomes de repos separados por vírgula) no Application settings da Function.

---

## 4. Como as peças se conectam (deploy zip)

1. Azure DevOps (Project) envia POST para a URL do webhook.
2. O host do Azure Functions lê `host.json`, descobre a função pela pasta `webhookAzuro/` (que tem `function.json`), carrega `index.js` (e agora os `utils/`).
3. As variáveis (JIRA_*, ALLOWED_REPOS, etc.) vêm das **Application settings** no Portal; o código usa `process.env`.
4. O handler em `index.js` parseia o payload, chama os utils (jira, dedup, azure-payload, etc.) e responde ao Azure DevOps / chama a API do Jira.

Diagrama detalhado está no README da Azure Function e na página do Notion.

---

## 5. Repositório `webhook-azure-function`: estrutura com utils

A pasta `webhook-azure-function` foi organizada com **utils** (espelhando a ideia do `src/utils/` do projeto principal):

- `webhookAzuro/index.js` — orquestração (recebe POST, valida, chama utils, define resposta).
- `webhookAzuro/utils/jira.js` — Jira (formatBrasilia, extractJiraKey, addJiraComment, setJiraStatus).
- `webhookAzuro/utils/azure-payload.js` — getRunId, getRunUrl, getPipelineName, getBranch.
- `webhookAzuro/utils/dedup.js` — isDuplicate, markProcessed.
- `webhookAzuro/utils/azure-devops.js` — getJiraKeyFromBuildCommit.
- `webhookAzuro/utils/repo-filter.js` — isRepoAllowed, getRepoName (ALLOWED_REPOS).

Assim fica alinhado ao projeto principal, mas em JS e sem depender do `src/`.

---

## 6. Próximos passos (quando quiser)

- **Subir `webhook-azure-function` em um repo próprio:** `git init` na pasta, commit, `git remote add origin <url>`, push.
- **Migrar para TypeScript:** pode ser feita dentro de `webhook-azure-function` (sem mexer em `webhook-automation-azure`).
- **Exportar este resumo para o Notion:** copiar o conteúdo deste arquivo e colar na página "Integracoes & Automatizacao entre azure e jira" ou criar uma subpágina "Resumo da conversa".

---

## 7. Arquivos de referência no projeto

- `README.md` (raiz) — visão geral, endpoints, eventos, como as peças se conectam.
- `azure-function/README.md` — deploy da Function (no projeto antigo); estrutura e diagrama.
- `webhook-azure-function/README.md` — deploy e estrutura do repositório separado.
- `docs/estrutura-azure-webhook-por-time-e-repos.md` — webhook por time/repos, ALLOWED_REPOS.
- `docs/notion-integracao-automatizacao-azure-jira.md` — texto usado na página do Notion.
- `.env.example` e `azure-function/local.settings.json.example` — variáveis, incluindo ALLOWED_REPOS.

---

*Gerado a partir do resumo da conversa para facilitar levar o contexto.*
