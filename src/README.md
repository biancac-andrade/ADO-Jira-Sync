# Código-fonte (`src/`)

Ponto único da aplicação. Tudo aqui compila para `dist/` e é o que sobe no **Azure Function App**.

| Pasta / arquivo | Responsabilidade |
|-----------------|------------------|
| `webhook/function.json` | Binding HTTP da Azure Function (`POST /api/webhook`). **Não** contém lógica de negócio. |
| `handlers/webhook.handler.ts` | Entrada HTTP: validação, filtro de repo, extração da chave Jira, despacho por `eventType`. |
| `services/workflow/` | Regras **Azure DevOps → transições Jira** (push, PR, pipeline “final”). |
| `services/jira/` | API Jira: comentários, transições, limpeza de campos customizados. |
| `services/pipeline-payload/` | Leitura normalizada do payload de pipeline (runId, URL, branch, nome). |
| `services/azure-devops/` | REST Azure DevOps (ex.: chave Jira na mensagem do commit na `main`). |
| `services/deduplication/` | Cache em memória para não reprocessar o mesmo evento de pipeline. |
| `services/repository-filter/` | `ALLOWED_REPOS` — processar só repositórios da lista. |
| `types.ts` | Tipos do payload Azure DevOps e do contexto HTTP da Function. |

Fluxo resumido: **Service Hook → handler → (workflow \| jira \| dedup) → resposta HTTP 200/4xx/5xx**.

Documentação completa: [`../docs/`](../docs/).
