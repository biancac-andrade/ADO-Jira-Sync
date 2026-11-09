# Histórico de implementação

Cronologia do **ADO Jira Sync**, com o que entrou em cada fase. Datas vêm do **Git** quando existe histórico; no POC sem repositório Git, da **última alteração conhecida dos arquivos** (aproximada).

Como atualizar: após marcos relevantes, acrescente uma linha na tabela e, se quiser detalhe, um commit com `docs/HISTORY.md`.

---

## Linha do tempo

| Data | Marco | O que foi implementado |
|------|--------|----------------------|
| **2026-02-27** *(aprox.)* | POC local | Servidor **Express** (`archive/webhook-automation-two-modes`): `POST /webhook/azuro`, comentários de pipeline (início/fim), PR → um status, túnel para testes, `events-store` (JSONL). |
| **2026-03-02** | Function v1 — base | Integração webhook Azure → Jira em **TypeScript**; extração de chave Jira; comentários *run-state*; transição em `git.pullrequest.updated`. Commits no legado v1: integração, testes Jest, ESLint/Prettier, logs. |
| **2026-03-03** | Function v1 — docs | README de deploy, troubleshooting e estrutura em camadas (`archive/webhook-azure-function-version-1`). |
| **2026-03-30** | Baseline **v1** | Commit `feat: code version 1` — pacote enxuto: PR → `JIRA_STATUS_CODE_REVIEW`, pipeline com dois comentários, `ALLOWED_REPOS`, dedup, PAT na `main`. |
| **2026-04-09** | **Workflow completo (v2)** | Commit `feat: create version complete automation`: serviço `workflow` (git.push, PR created/updated, votos rework/aprovação), pipeline com **um** comentário ao final, transição **Merged to Main** via `FINAL_PIPELINE_*`, limpeza de campos no rework. |
| **2026-11-09** | Unificação do repositório | Código ativo na raiz; pasta `docs/` enxuta; legado em `archive/`; nomenclatura **ADO Jira Sync** / `azure-devops-jira-sync`; `docs/HISTORY.md` (este arquivo). |

---

## Detalhe por entrega (funcional)

### POC Express (≈ fev/2026)

- Health `GET /health` e `GET /health/ready` (teste Jira).
- Retry na API Jira; deduplicação; `WEBHOOK_SECRET`.
- Azure Function em **JavaScript** embutida na mesma pasta (prova de deploy), sem workflow multi-status.

### Azure Function v1 (mar/2026)

- Handler único + serviços: `jira`, `pipeline-payload`, `deduplication`, `repository-filter`, `azure-devops`.
- Deploy documentado (zip e `func publish`).
- **101** testes unitários na linha v2; na v1 o conjunto era equivalente exceto `workflow`.

### v2 / produção atual (abr/2026 → hoje)

Tudo da v1, mais:

| Área | Implementação |
|------|----------------|
| Git | `git.push` → *In Development* |
| Pull request | `created` / `updated` — draft, revisores, aprovação, rework |
| Pipeline | Sem comentário no início; bloco único no fim; *Merged to Main* condicional |
| Config | `JIRA_STATUS_*` múltiplos, `WORKFLOW_*`, `FINAL_PIPELINE_*`, `JIRA_FIELDS_CLEAR_ON_REWORK` |

---

## Onde conferir no Git

Repositório atual (raiz):

```bash
git log --date=short --format='%ad %s'
```

Histórico mais fino da **v1** (só leitura):

```bash
git -C archive/webhook-azure-function-version-1 log --date=short --oneline
```

Documentação extensa de testes manuais do POC:  
`archive/webhook-automation-two-modes/docs/testes-e-melhorias-webhook-azure-jira.md`.

---

## Próximas entradas (sugestão)

Ao concluir melhorias do [LIMITATIONS-AND-ROADMAP.md](./LIMITATIONS-AND-ROADMAP.md), registre aqui, por exemplo:

- dedup em Redis/Table Storage;
- CI (lint + test + build);
- modo `WORKFLOW_MODE=minimal`;
- renomear função HTTP (`/api/ado-jira`).
