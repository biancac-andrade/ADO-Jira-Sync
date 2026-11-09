# Nomenclatura do projeto

Um único vocabulário evita confusão entre pasta no disco, repositório Git, Function App no Azure e rotas HTTP.

## Nomes oficiais

| O quê | Nome recomendado | Notas |
|-------|------------------|--------|
| **Produto / README** | **ADO Jira Sync** | Título legível (Azure DevOps + Jira). |
| **Pasta e repositório Git** | `azure-devops-jira-sync` | Substitui `webhook-automation`, `webhook-function-version-*`, etc. |
| **Pacote npm** | `azure-devops-jira-sync` | Campo `name` em `package.json`. |
| **Function App (Azure)** | `func-ado-jira-sync` ou `ado-jira-sync-<env>` | Ex.: `func-ado-jira-sync-prod`. Evite `webhookazurojira` — difícil de ler e sem padrão. |
| **Função HTTP (código)** | pasta `webhook/` | Gera a rota **`/api/webhook`**. Mantida de propósito para não quebrar Service Hooks já configurados. |
| **Service Hook (URL)** | `https://<app>.azurewebsites.net/api/webhook` | Path fixo pela pasta da function no Azure. |

## Prefixos de variáveis de ambiente

Já seguem um padrão claro — não renomear sem migrar Application settings:

| Prefixo | Exemplos |
|---------|----------|
| `JIRA_*` | `JIRA_BASE_URL`, `JIRA_STATUS_IN_DEVELOPMENT` |
| `AZURE_DEVOPS_*` | `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_IGNORE_REVIEWER_IDS` |
| `FINAL_PIPELINE_*` | Regras da pipeline “final” na `main` |
| `WORKFLOW_*` | Votos de rework/aprovação |
| `WEBHOOK_*` | Segredo e deduplicação |

## O que evitar em nomes novos

| Evitar | Por quê |
|--------|---------|
| `webhook-automation` | Genérico; não diz Azure nem Jira. |
| `azuro` / `webhook-azuro` | Grafia informal; legado do POC Express (`/webhook/azuro`). |
| `version-1` / `version-2` | Versão no nome de pasta, não no produto. |
| `webhook-azure-function` | Repete “webhook” e não descreve o **sync** com Jira. |

## Legado (`archive/`)

Pastas antigas mantêm nomes históricos só para referência. Não renomear — apontam para commits e docs antigos.

## Renomear a pasta local

Se a pasta ainda se chama `webhook-automation`:

```bash
cd ~/Desktop/Developer
mv webhook-automation azure-devops-jira-sync
```

Reabra o projeto no Cursor/VS Code a partir de `azure-devops-jira-sync`. Atualize o `remote` do Git e o nome do repositório no GitHub/GitLab para bater com o slug acima.
