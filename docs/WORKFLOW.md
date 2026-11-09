# Workflow: eventos e Jira

## Mapa evento → ação

| `eventType` (Azure DevOps) | Ação no Jira |
|----------------------------|--------------|
| `git.push` | Novo branch no remoto (exceto `main`/`master`/`develop`) → **In Development** |
| `git.pullrequest.created` | Draft ou PR ativa → transição conforme regras (Ready / In Code Review) |
| `git.pullrequest.updated` | Rework (voto baixo) → In Development (+ limpar campos opcional); aprovação/revisor → In Code Review |
| `git.pullrequest.merged` | **Sem** transição para merge (ignorado para status) |
| `ms.vss-pipelines.run-state-changed-event` | Em progresso: só dedup. **Concluída:** um comentário (início, fim, resultado, link) + opcional **Merged to Main** |
| `build.complete` | Ignorado (comentários só via run-state) |
| Outros | `200` — evento ignorado |

Detalhes das regras de PR/voto: código em `src/services/workflow/workflow.ts`.

## Ciclo de vida esperado (time)

```text
git.push (branch novo)     → In Development
PR aberta (ativa)          → Ready for Code Review / In Code Review
Revisor / aprovação        → In Code Review
Rework                     → In Development
Pipeline final OK na main  → comentário + Merged to Main
```

“Pipeline final” depende de `FINAL_PIPELINE_*` (branch, nome da pipeline, sucesso).

## Variáveis de workflow

| Variável | Padrão típico |
|----------|----------------|
| `JIRA_STATUS_IN_DEVELOPMENT` | `In Development` |
| `JIRA_STATUS_READY_CODE_REVIEW` | `Ready for Code Review` |
| `JIRA_STATUS_CODE_IN_REVIEW` | `In Code Review` |
| `JIRA_STATUS_READY_MERGE_MAIN` | `Merged to Main` |
| `WORKFLOW_REWORK_VOTE_MAX` | `-5` (voto ≤ → rework) |
| `WORKFLOW_APPROVE_VOTE_MIN` | `10` (voto ≥ → aprovação) |
| `AZURE_DEVOPS_IGNORE_REVIEWER_IDS` | IDs de bot/serviço ignorados |
| `JIRA_FIELDS_CLEAR_ON_REWORK` | `customfield_...` separados por vírgula |
| `FINAL_PIPELINE_BRANCH_REGEX` | `^(main\|master)$` |
| `FINAL_PIPELINE_NAMES` | Lista vazia = qualquer pipeline na branch |
| `FINAL_PIPELINE_TRANSITION_ENABLED` | `true` |

### Segurança e filtro

| Variável | Uso |
|----------|-----|
| `WEBHOOK_SECRET` | Header `x-webhook-secret` ou query `secret` |
| `ALLOWED_REPOS` | Nomes de repo (vírgula); vazio = todos |
| `WEBHOOK_DEDUP_TTL_MS` | Dedup de pipeline (padrão 1h) |
| `AZURE_DEVOPS_PAT` | Ler mensagem de commit na main quando a chave não está no payload |

Credenciais Jira obrigatórias: `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`.

## O que você **pode** fazer

- Automatizar status em fluxos que seguem push → PR → review → pipeline na main.
- Restringir por repositório (`ALLOWED_REPOS`) em projeto compartilhado.
- Desligar transição pós-pipeline (`FINAL_PIPELINE_TRANSITION_ENABLED=false`) e manter só comentário.
- Ajustar votos de rework/aprovação aos valores do Azure DevOps.
- Rodar local com Azurite antes do deploy.

## O que você **não deve** esperar

- Criar issues no Jira automaticamente (só atualiza issues **existentes** com chave conhecida).
- Sincronizar descrição da PR, work items nativos do Azure ou links bidirecionais.
- Multi-tenant ou UI de configuração (tudo via env vars).
- Dedup persistente entre reinícios da Function (cache **em memória**).
- Garantir ordem estrita de eventos se o Azure reordenar entregas (use logs para auditoria).

Melhorias sugeridas: [LIMITATIONS-AND-ROADMAP.md](./LIMITATIONS-AND-ROADMAP.md).
