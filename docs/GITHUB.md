# Publicar no GitHub

Copie e cole nos campos ao criar ou editar o repositório.

## Repositório

| Campo | Valor |
|-------|--------|
| **Repository name** | `azure-devops-jira-sync` |
| **Visibility** | Public ou Private (sua escolha) |

## About (descrição — máx. 350 caracteres)

**Português (348 caracteres)** — mesmo texto do bloco de abertura do [README](../README.md):

```text
Azure Function em TypeScript que recebe Service Hooks do Azure DevOps e sincroniza o Jira Cloud: transições de status (push, PR, code review, pipeline na main) e comentários de pipeline. Convenção PROJ-123 na branch/PR. Config por variáveis de ambiente. Node 18+, Jest. Docs de setup, workflow e deploy.
```

**Inglês (349 caracteres)** — opcional se o repo for público internacional:

```text
TypeScript Azure Function: Azure DevOps Service Hooks → Jira Cloud. Auto-transitions from git push, PR reviews, and main pipeline success; pipeline comments on issues. Issue key in branch/PR title. Env-based workflow, Jest tests, setup & deploy docs.
```

## Topics (sugestão)

```text
azure-devops, jira, azure-functions, typescript, webhook, service-hooks, devops-automation, atlassian, serverless
```

## Website (opcional)

Deixe vazio ou link para a documentação renderizada (ex. GitHub Pages no `docs/` depois, se configurar).

## `package.json` — `repository.url`

Após criar o repo, substitua `REPLACE_ME` pelo seu usuário ou org:

```text
git+https://github.com/SEU_USUARIO/azure-devops-jira-sync.git
```

## Primeiro push

```bash
cd azure-devops-jira-sync
git remote set-url origin https://github.com/SEU_USUARIO/azure-devops-jira-sync.git
# ou: git remote add origin ...  se ainda não tiver remote
git push -u origin main
```

Não commite `local.settings.json` nem segredos — já estão no `.gitignore`.
