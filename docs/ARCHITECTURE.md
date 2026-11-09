# Arquitetura

## Visão geral

```text
Azure DevOps (Service Hooks)
        │ POST JSON (eventType + resource)
        ▼
Azure Function  /api/webhook
        │ webhook.handler.ts
        ├── validate secret, body, ALLOWED_REPOS
        ├── resolve Jira key (título, branch, payload, commit API)
        └── por eventType:
              ├── workflow.ts  → setJiraStatus / skip
              ├── jira.ts      → addJiraComment, clearIssueFields
              └── deduplication.ts
        ▼
Jira Cloud REST API v3
```

## Repositório (raiz)

| Item | Função |
|------|--------|
| `host.json` | Configuração do host Azure Functions |
| `src/webhook/function.json` | Template HTTP; copiado para `webhook/` no build |
| `webhook/` | Gerado no build — o runtime Azure usa esta pasta |
| `dist/` | JavaScript compilado (não commitar) |
| `local.settings.json.example` | Modelo de variáveis locais |
| `docs/` | Documentação |
| `archive/` | Versões antigas (não deployar) |

## Camadas no código

1. **Handler** — I/O HTTP, logging, sem regra de negócio pesada.
2. **Workflow** — decisões “qual transição” a partir do payload Azure.
3. **Integrações** — Jira e Azure DevOps (HTTP).
4. **Utilitários** — dedup, filtro de repo, parsing de pipeline.

Testes unitários ficam ao lado de cada serviço (`*.test.ts`), com Jest mockando HTTP.

## Runtime

- **Node 18+**, worker modelo v4 (programming model clássico: `function.json` + `entryPoint`).
- Sem banco de dados; estado efêmero só para deduplicação.
- Segredos somente em Application settings / `local.settings.json` (gitignored).

## Logs

Prefixos para filtro em Application Insights:

- `[webhook]` — request, chave Jira, tipo de evento
- `[workflow]` — decisões de transição
- `[jira]` — chamadas à API
- `[azure-devops]` — leitura de commit

Mapa de arquivos: [src/README.md](../src/README.md).
