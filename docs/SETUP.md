# Configuração e implementação

Guia enxuto para o **ADO Jira Sync** (`azure-devops-jira-sync`): produção ou teste local.

## 1. Pré-requisitos

- Node.js **18+**, npm
- [Azure Functions Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) v4
- Conta **Jira Cloud** com permissão de comentar e transicionar issues
- **Azure**: Function App (Linux ou Windows, runtime Node), Storage Account
- **Azure CLI** + **Azure Functions** CLI (recomendado para deploy)

## 2. Jira

1. Crie um [API token](https://id.atlassian.com/manage-profile/security/api-tokens).
2. No projeto Jira, confira o **workflow** e anote os nomes **exatos** das transições que você vai usar (ex.: `In Development`, `Ready for Code Review`, `In Code Review`, `Merged to Main`).
3. Preencha no `local.settings.json` (local) ou Application settings (Azure) — ver [WORKFLOW.md](./WORKFLOW.md#variáveis-de-workflow).

Teste mental: se o nome no portal não bater com a variável, a API retorna erro de transição (veja logs `[jira]`).

## 3. Azure Function App

1. Crie o Function App na mesma região desejada.
2. Em **Configuration → Application settings**, configure todas as variáveis do `local.settings.json.example` (nunca commite `local.settings.json`).
3. `AzureWebJobsStorage`: connection string da storage do app.
4. `FUNCTIONS_WORKER_RUNTIME`: `node`.

## 4. Azure DevOps — Service Hooks

URL do webhook: `https://<seu-app>.azurewebsites.net/api/webhook`  
(Com `WEBHOOK_SECRET`, use header `x-webhook-secret` ou `?secret=...` na URL do hook.)

Crie **uma subscription por evento** (Project settings → Service hooks → Web Hooks):

| Ordem | Evento | Por quê |
|-------|--------|---------|
| 1 | **Code pushed** | Primeiro push de branch → *In Development* |
| 2 | **Pull request created** | Abertura de PR |
| 3 | **Pull request updated** | Revisores, draft, votos |
| 4 | **Run state changed** (Pipelines) | Comentário ao concluir + *Merged to Main* quando aplicável |

Opcional: **Pull request merged** — hoje **não** dispara transição de merge (o merge “oficial” no Jira é pela pipeline na `main`).

**Importante:** o hook é no **projeto** Azure DevOps; todos os repos do projeto disparam na mesma URL. Para restringir repos, use `ALLOWED_REPOS`.

## 5. Convenção no time

- Branch ou título de PR com a chave Jira: `[PROJ-42] descrição` ou `feature/PROJ-42-nome`.
- Pipelines que devem fechar o ciclo na `main`: configure `FINAL_PIPELINE_NAMES` e `FINAL_PIPELINE_BRANCH_REGEX`.

## 6. Desenvolvimento local

```bash
npm install
cp local.settings.json.example local.settings.json
```

Edite `local.settings.json`:

- `AzureWebJobsStorage`: `"UseDevelopmentStorage=true"` se usar Azurite.
- Credenciais Jira e nomes de status.

Terminal 1: `npm run start:storage`  
Terminal 2: `npm run start`

### Validar localmente

```bash
# 400 esperado — function no ar
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:7071/api/webhook \
  -H "Content-Type: application/json" -d '{}'

# PR de exemplo (ajuste chave e repo)
curl -X POST http://localhost:7071/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"eventType":"git.pullrequest.updated","resource":{"title":"[PROJ-1] Teste","repository":{"name":"meu-repo"},"sourceBranch":"refs/heads/feature/PROJ-1"}}'
```

## 7. Deploy no Azure

Ordem: **variáveis no Portal** → `npm install` → `npm run build` → publicar.

### Opção A — `func publish`

```bash
npm run build
func azure functionapp publish <nome-app> --resource-group <rg>
```

### Opção B — zip (se `func publish` falhar)

Inclua: `host.json`, `package.json`, `webhook/`, `dist/`.  
Exclua: `src/`, `local.settings.json`, `node_modules` (opcional incluir para evitar install no Azure).

```bash
npm run build
zip -r deploy.zip . \
  -x "*.git*" -x "local.settings.json" -x "deploy.zip" -x "src/*" \
  -x "*.ts" -x "tsconfig.json" -x ".env*" -x "*.md" -x "node_modules/*" -x "archive/*"

az functionapp deployment source config-zip \
  --resource-group <rg> --name <nome-app> --src deploy.zip
```

## 8. Pós-deploy

1. Portal → Function App → função **webhook** visível e URL pública.
2. Atualize a URL nos Service Hooks.
3. **Log stream** ou Application Insights: prefixos `[webhook]`, `[workflow]`, `[jira]`.

## Solução rápida de problemas

| Sintoma | Verificar |
|---------|-----------|
| 401 | `WEBHOOK_SECRET` vs header/query |
| 200 sem mudar Jira | Chave na PR/branch; `ALLOWED_REPOS`; logs `jiraKey` |
| Transição falha | Nome da transição no Jira = variável `JIRA_STATUS_*` |
| Host local não sobe | Azurite rodando + `UseDevelopmentStorage=true` |
| Porta 7071 ocupada | `func start --port 7072` |
