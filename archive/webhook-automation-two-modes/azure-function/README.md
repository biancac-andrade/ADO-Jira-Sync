# Webhook Azure DevOps → Jira (Azure Function)

Este diretório contém uma **Azure Function** que replica a lógica do servidor Express (raiz do repositório) para uso em **hospedagem no Azure**. É um projeto **separado**: o servidor local (Node/Express) continua na raiz e não é alterado por este código.

Use este projeto **somente** quando for fazer deploy do webhook como Azure Function. Para desenvolvimento e testes locais, use o servidor na raiz (`npm start` na raiz do repositório).

---

## Diferenças em relação ao servidor local

| Aspecto | Servidor local (raiz) | Azure Function (esta pasta) |
|--------|------------------------|------------------------------|
| **Execução** | `npm start` ou `npm run dev` na raiz | Deploy no Azure; URL fixa `https://<app>.azurewebsites.net/api/webhookAzuro` |
| **Persistência de eventos** | Opcional em `data/pipeline-events.jsonl` | Não implementada aqui (em Azure pode usar Blob/Table Storage) |
| **Health /health/ready** | Disponível | Não incluído (Azure usa o health nativo do Function App) |
| **Lógica de negócio** | Idêntica: Run state changed → comentários; PR updated → status; dedup e retry Jira |

---

## Pré-requisitos

- **Azure Functions Core Tools** (v4): [Documentação](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local)
- **Node.js 18+**
- Conta Azure para publicar o Function App

---

## Configuração

1. **Copie as variáveis de ambiente:**

   ```bash
   cp local.settings.json.example local.settings.json
   ```

2. **Edite `local.settings.json`** e preencha (os mesmos valores do `.env` do servidor local):

   - `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`, `JIRA_STATUS_CODE_REVIEW`
   - `AZURE_DEVOPS_PAT` (opcional, para pipeline na main)
   - `WEBHOOK_SECRET` (opcional)

   **Importante:** `local.settings.json` não deve ser commitado (já está no `.gitignore`). No Azure, configure as mesmas variáveis em **Application settings** do Function App.

3. **No Azure (após o deploy):** em **Configuration** → **Application settings**, adicione as mesmas chaves. Não use `local.settings.json` em produção.

---

## Rodar localmente (opcional)

Para testar a Function na máquina antes do deploy:

```bash
cd azure-function
npm install
npx func start
```

A URL local será algo como `http://localhost:7071/api/webhookAzuro`. O Azure DevOps não consegue chamar localhost; use apenas para testes com `curl` ou Postman.

---

## Deploy no Azure

1. Crie um **Function App** no Azure (Portal ou CLI), runtime **Node.js 18** (ou 20), modelo **HTTP trigger**.
2. **Configure o host storage (obrigatório):** o Function App precisa da configuração **AzureWebJobsStorage** (conexão com uma conta de Storage). Sem isso, o `func ... publish` falha com *"Function App is missing host storage configuration"*.
   - **Opção A – Connection string:** crie uma conta de Storage no mesmo resource group, copie a connection string e adicione em **Configuration** → **Application settings** com o nome `AzureWebJobsStorage`. Exemplo via CLI (ajuste `<resource-group>` e `<storage-name>` para nomes únicos):
     ```bash
     # Criar conta de Storage (nome globalmente único, 3–24 caracteres, só minúsculas e números)
     az storage account create --name <storage-name> --resource-group <resource-group> --location brazilsouth --sku Standard_LRS
     # Obter connection string e definir no Function App
     STORAGE_CONN=$(az storage account show-connection-string --name <storage-name> --resource-group <resource-group> --query connectionString -o tsv)
     az functionapp config appsettings set --name <nome-do-seu-function-app> --resource-group <resource-group> --settings "AzureWebJobsStorage=$STORAGE_CONN"
     ```
   - **Opção B – Identity-based:** use as configurações `AzureWebJobsStorage__accountName` (e opcionalmente `AzureWebJobsStorage__credential=managedidentity`) conforme a [documentação](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference#connecting-to-host-storage-with-an-identity).
3. **Defina as configurações obrigatórias do runtime** (evita o erro *"Value cannot be null. (Parameter 'input')"* no publish). No mesmo resource group do Function App:
   ```bash
   STORAGE_CONN=$(az storage account show-connection-string --name <storage-name> --resource-group <resource-group> --query connectionString -o tsv)
   az functionapp config appsettings set --name <nome-do-seu-function-app> --resource-group <resource-group> --settings \
     "FUNCTIONS_EXTENSION_VERSION=~4" \
     "FUNCTIONS_WORKER_RUNTIME=node" \
     "WEBSITE_NODE_DEFAULT_VERSION=~20" \
     "AzureWebJobsStorage=$STORAGE_CONN"
   ```
4. Configure as **Application settings** restantes (JIRA_*, AZURE_DEVOPS_PAT, WEBHOOK_SECRET). Opcional: **ALLOWED_REPOS** — lista separada por vírgulas de nomes de repositórios (ex.: `repo-a,repo-b`) para processar só eventos desses repos; útil quando o Project tem vários times e você quer a automação só para os repos do seu time. Ver [Estrutura Azure: webhook por time e repositórios](../docs/estrutura-azure-webhook-por-time-e-repos.md).
5. Faça o deploy a partir desta pasta, por exemplo:

   ```bash
   cd azure-function
   func azure functionapp publish <nome-do-seu-function-app> --javascript
   ```

   **Se aparecer "Value cannot be null" no publish:** faça o deploy por zip (o Azure instala dependências no servidor). A função deve ficar na **raiz** do projeto (`webhookAzuro/`), não dentro de `src/`, para o host do Azure descobri-la (evita 404).
   ```bash
   cd azure-function
   zip -r deploy.zip . -x "*.git*" -x "node_modules/*" -x "*.env" -x "local.settings.json" -x "deploy.zip"
   az functionapp deployment source config-zip --resource-group <resource-group> --name <nome-do-seu-function-app> --src deploy.zip
   ```

6. Use a URL da função no Azure DevOps (ver seção abaixo).

---

## Como obter e usar a URL do webhook (Azure Function)

A URL do webhook é o endereço que o **Azure DevOps Service Hooks** vai chamar em cada evento (Run state changed, Pull request updated). Ela aponta para a sua Azure Function.

### 1. Obter a URL após o deploy

**Opção A – Portal do Azure**

1. Acesse o [Portal do Azure](https://portal.azure.com) e abra o **Function App** que você criou.
2. No menu lateral, clique em **Functions**.
3. Clique na função **webhookAzuro**.
4. No topo, clique em **Get Function URL** (ou **Obter URL da função**).
5. Se a função tiver **nível de autorização "Function"**, escolha **default** (ou o nome da chave) e copie a URL. Ela virá no formato:
   ```text
   https://<nome-do-seu-app>.azurewebsites.net/api/webhookAzuro?code=<chave-longa>
   ```
6. Se a autorização for **Anonymous** (como neste projeto), a URL é só:
   ```text
   https://<nome-do-seu-app>.azurewebsites.net/api/webhookAzuro
   ```

**Opção B – Após publicar pelo terminal**

Ao rodar (use `--javascript` para o `func` reconhecer o projeto como Node.js):

```bash
func azure functionapp publish <nome-do-seu-app> --javascript
```

o comando mostra no final as URLs das funções. Procure a linha que contém **webhookAzuro** e copie a URL completa.

**Opção C – Montar a URL manualmente**

- **Anonymous:** `https://<nome-do-seu-app>.azurewebsites.net/api/webhookAzuro`
- **Function key:** `https://<nome-do-seu-app>.azurewebsites.net/api/webhookAzuro?code=<sua-function-key>`

A **Function key** fica em: Portal → Function App → **Functions** → **webhookAzuro** → **Function Keys** (ou **Chaves de função**).

### 2. Usar a URL no Azure DevOps (Service Hooks)

1. No **Azure DevOps**, abra o seu projeto.
2. Vá em **Project settings** (engrenagem) → **Service hooks**.
3. Clique em **Create subscription**.
4. Em **Select a service**, escolha **Web Hooks** (ou **Webhooks**).
5. Em **Configure**, em **URL**, cole exatamente a URL que você copiou (a do webhook da Azure Function).
6. Se você usa **WEBHOOK_SECRET** no Application settings da Function, adicione o valor na URL como query:
   ```text
   https://<app>.azurewebsites.net/api/webhookAzuro?secret=SEU_VALOR
   ```
   (Se usar Function key, fica: `...?code=XXX&secret=SEU_VALOR`.)
7. Crie uma subscription para **Run state changed** (Pipelines) e outra para **Pull request updated**, usando **a mesma URL** em ambas.
8. Salve. O Azure DevOps passará a enviar um POST para essa URL sempre que os eventos ocorrerem.

### 3. Testar se a URL está correta

- No Azure DevOps, em **Service hooks**, abra a subscription e use **Delivery history** para ver se as requisições retornaram 200 ou erro.
- Ou dispare um evento (por exemplo, adicione um revisor em uma PR) e confira no **Monitor** da função no Portal do Azure se a execução apareceu.

---

## Estrutura

```
azure-function/
  host.json
  package.json
  local.settings.json.example   # copiar para local.settings.json (não commitar)
  webhookAzuro/
    function.json               # HTTP trigger, POST (host descobre a função por esta pasta)
    index.js                    # Handler: recebe (context, req), lê process.env, chama Jira
  README.md                     # Este arquivo
```

A função exposta é **webhookAzuro**: um único endpoint HTTP POST que recebe o payload do Azure DevOps e aplica a mesma lógica do servidor (comentários de pipeline em tempo real, transição de status na PR, deduplicação, retry Jira).

---

## Como as peças se conectam (deploy zip e runtime)

Ao fazer deploy por zip, o Azure recebe apenas arquivos (código + `host.json`, `package.json`). As **configurações** (Jira, ALLOWED_REPOS, etc.) ficam em **Application settings** no Portal e são injetadas como variáveis de ambiente. Abaixo: como o host do Azure Functions descobre e executa o seu código, e como tudo se liga ao Azure DevOps e ao Jira.

### Diagrama de conexões

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  AZURE DEVOPS (Project)                                                         │
│  • Repositórios, Pipelines, Pull Requests                                        │
│  • Service Hooks: 2 subscriptions (Pull request updated + Run state changed)     │
│  • Cada evento → HTTP POST para a mesma URL                                      │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  URL do webhook (ex.: https://<app>.azurewebsites.net/api/webhookAzuro)           │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  AZURE FUNCTION APP (runtime no Azure)                                            │
│                                                                                  │
│  1. Host lê host.json e varre o projeto                                          │
│  2. Encontra a pasta webhookAzuro/ com function.json → registra função          │
│     "webhookAzuro" e rota POST /api/webhookAzuro                                  │
│  3. Carrega webhookAzuro/index.js (scriptFile da função)                        │
│  4. Injeta process.env a partir de Application settings (JIRA_*, ALLOWED_REPOS…) │
│  5. Para cada POST em /api/webhookAzuro: chama module.exports(context, req)     │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  webhookAzuro/index.js (seu código)                                              │
│  • req.body = payload do Azure DevOps (eventType, resource, repository…)         │
│  • process.env.JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_API_TOKEN, etc.             │
│  • Lógica: extrai chave Jira, chama Jira API (comentar / transição de status)   │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  JIRA CLOUD (REST API)                                                           │
│  • GET/POST /rest/api/3/issue/{key}/transitions  (mudar status)                  │
│  • POST /rest/api/3/issue/{key}/comment         (comentários de pipeline)       │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Resumo dos elos

| Elo | O que conecta |
|-----|----------------|
| **Azure DevOps → URL** | Service Hooks (Project settings) enviam POST para a URL que você configurou. Não há configuração por repositório: uma subscription por evento no Project cobre todos os repos. |
| **URL → Function App** | O host do Azure Functions escuta em `/api/<nome-da-função>`. O nome da função vem da **pasta** que contém `function.json` (no seu caso, `webhookAzuro`). |
| **function.json → index.js** | O `function.json` declara o trigger (HTTP POST) e os bindings. O host carrega o arquivo indicado (por convenção `index.js` na mesma pasta) e invoca a função exportada. |
| **Código → configuração** | Nada do zip é “configuração sensível”. `JIRA_*`, `ALLOWED_REPOS`, etc. vêm de **Application settings** no Portal; o runtime injeta como `process.env` quando o `index.js` roda. |
| **index.js → Jira** | O código usa `process.env.JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN` para montar as requisições à API do Jira (comentários e transições). |

---

## Documentação de referência

- [Azure Functions overview](https://learn.microsoft.com/en-us/azure/azure-functions/functions-overview) — Visão geral: serverless, cenários, opções de hospedagem (Microsoft Learn).
- [Azure Functions Node.js developer guide](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node)
- [Hospedagem do webhook (visão geral)](../docs/testes-e-melhorias-webhook-azure-jira.md) — Seção 9 no doc do projeto.
