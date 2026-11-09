# ADO Jira Sync

> Azure Function em TypeScript que recebe Service Hooks do Azure DevOps e sincroniza o Jira Cloud: transições de status (push, PR, code review, pipeline na main) e comentários de pipeline. Convenção PROJ-123 na branch/PR. Config por variáveis de ambiente. Node 18+, Jest. Docs de setup, workflow e deploy.

Repositório: **`azure-devops-jira-sync`** · Publicar no GitHub: [docs/GITHUB.md](docs/GITHUB.md) · Nomes (Azure, rotas): [docs/NAMING.md](docs/NAMING.md).

## Objetivo

Reduzir trabalho manual entre **repositório/pipeline** (Azure DevOps) e **gestão de tarefas** (Jira):

- Associar eventos de **git**, **pull request** e **pipeline** à issue correta (chave `PROJ-123` no título da PR ou na branch).
- Aplicar **transições de workflow** configuráveis no Jira.
- Registrar **execuções de pipeline** em um comentário consolidado ao finalizar.

## Como funciona (uma frase)

Azure DevOps envia `POST` JSON → a function valida, filtra e extrai a chave Jira → chama a API do Jira → responde `200` (ou erro explícito).

Diagrama e detalhes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Regras de negócio: [docs/WORKFLOW.md](docs/WORKFLOW.md).

## O que você precisa

| Item | Uso |
|------|-----|
| **Jira Cloud** | API token, e-mail, URL da org; nomes de transições iguais aos do fluxo do projeto |
| **Azure DevOps** | Service Hooks apontando para a URL da function |
| **Azure Function App** | Node 18+, Storage account, Application settings com as variáveis |
| **Opcional** | `AZURE_DEVOPS_PAT` (ler commit na `main`); `WEBHOOK_SECRET`; `ALLOWED_REPOS` |

Implementação passo a passo: [docs/SETUP.md](docs/SETUP.md).

## Início rápido (local)

```bash
npm install
cp local.settings.json.example local.settings.json   # preencher Jira e Storage
npm run start:storage   # terminal 1 — Azurite
npm run start           # terminal 2 — build + func start
```

Teste: `POST http://localhost:7071/api/webhook` com JSON contendo `eventType` e `resource` (ver [docs/SETUP.md](docs/SETUP.md#validar-localmente)).

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run build` | TypeScript → `dist/` + copia `webhook/function.json` |
| `npm run start` | Build + Azure Functions Core Tools |
| `npm test` | Testes unitários (Jest) |
| `npm run lint` | ESLint em `src/` |

Deploy (zip ou `func publish`): [docs/SETUP.md](docs/SETUP.md#deploy-no-azure).

## Documentação

| Arquivo | Conteúdo |
|---------|----------|
| [docs/SETUP.md](docs/SETUP.md) | Pré-requisitos, Jira, Azure, Service Hooks, variáveis, deploy |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | Eventos Azure → ações Jira; convenções de branch/PR |
| [docs/GITHUB.md](docs/GITHUB.md) | Título, About (350 chars), topics, primeiro push |
| [docs/HISTORY.md](docs/HISTORY.md) | Datas e marcos de cada fase (POC, v1, v2, unificação) |
| [docs/NAMING.md](docs/NAMING.md) | Nomes oficiais (repo, Function App, rotas) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Estrutura de pastas e fluxo técnico |
| [docs/LIMITATIONS-AND-ROADMAP.md](docs/LIMITATIONS-AND-ROADMAP.md) | O que faz / não faz; melhorias possíveis |
| [src/README.md](src/README.md) | Mapa rápido do código |

Código legado (POC e v1): [archive/README.md](archive/README.md).

## Convenção obrigatória

A chave da issue (ex. `BEESEDI-11`) deve aparecer no **título da PR** ou no **nome da branch**. Sem chave, a function responde `200` e não altera o Jira.

## Licença

MIT — uso livre; ajuste nomes de status e Service Hooks ao seu Jira e ao seu processo.
