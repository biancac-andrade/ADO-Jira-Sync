# Estudo de descobertas: Azure DevOps Service Hooks + Jira

**Objetivo:** Automatizar atualizações no Jira com base em eventos do Azure DevOps (PR completada, pipeline, reviewers), usando Service Hooks, **sem impactar métricas do time** durante os testes.

**Contexto:** Pesquisa com a Erika sobre uso de Hooks do Azure para:
1. Ao **completar uma PR** → comentar no Jira com horário de início da pipeline (ou status da build).
2. Ao **incluir optional/required reviewer na PR** → disparar Hook e mudar status no Jira.

---

## 1. O que são Azure Service Hooks?

Service Hooks permitem **executar ações em serviços externos** quando certos **eventos** acontecem em um projeto do Azure DevOps.

- **Publisher:** define os eventos (ex.: build completed, pull request updated).
- **Subscription:** associa um evento a um **consumer** (ex.: Web Hooks, Teams, Slack).
- **Consumer:** é quem recebe o evento e age (ex.: enviar HTTP POST para uma URL).

Documentação oficial:
- [Create a service hook subscription (programático)](https://learn.microsoft.com/en-us/azure/devops/service-hooks/create-subscription?view=azure-devops)
- [Service hook events](https://learn.microsoft.com/en-us/azure/devops/service-hooks/events?view=azure-devops)
- [Webhooks (consumer)](https://learn.microsoft.com/en-us/azure/devops/service-hooks/services/webhooks?view=azure-devops)

---

## 2. Permissões necessárias

| Onde | O que |
|------|--------|
| **Criar subscription (UI)** | **Project settings → Service hooks** → precisa de **Edit subscriptions** e **View subscriptions**. Por padrão só **Project Administrators** têm. |
| **Criar subscription (API)** | [Prerequisites](https://learn.microsoft.com/en-us/azure/devops/service-hooks/create-subscription?view=azure-devops): **Project member** + Project ID, Event ID, Consumer/Action IDs. |
| **Webhooks (destino)** | Doc diz: para configurar webhooks no projeto é necessário ser **Project Collection Administrators** (ou Organization owners). **Importante:** confirmar na sua org se “Service Hooks” está liberado para o projeto ou só para collection. |

**O que precisamos verificar no ambiente Bees:**
- Se o seu usuário (ou um service account) tem permissão de **Edit subscriptions** no projeto onde quer testar.
- Se há política da organização que restringe criação de Service Hooks (ex.: só admins de coleção).

### 2.1 "You do not have sufficient permissions" — é assinatura paga?

**Não.** A mensagem *"You do not have sufficient permissions to view or configure subscriptions"* indica **falta de permissão de usuário/grupo** no projeto ou na coleção, **não** que o recurso seja pago.

- A documentação da Microsoft afirma: *"Azure DevOps doesn't charge for setting up service hooks or integrating with external services."*  
  ([Webhooks - Azure DevOps](https://learn.microsoft.com/en-us/azure/devops/service-hooks/services/webhooks?view=azure-devops))
- Service Hooks fazem parte do Azure DevOps; não existe “plano pago específico” para ativar Service Hooks.
- O que bloqueia é: sua conta não ter **Edit subscriptions** (e em alguns casos **View subscriptions**) no projeto. Por padrão isso fica com **Project Administrators** (e para webhooks a doc menciona **Project Collection Administrators**).

**Conclusão:** não é necessário assinatura paga; é uma questão de **permissão** no projeto/coleção.

### 2.2 Testar com conta pessoal (Azure DevOps + Jira) sem prejudicar o time

**Sim, é uma boa opção.** Você pode usar contas pessoais/gratuitas para validar o fluxo sem depender de permissão no repo do time e sem impactar métricas:

| Serviço | Como usar para teste |
|--------|----------------------|
| **Azure DevOps** | Criar uma **organização pessoal** em [dev.azure.com](https://dev.azure.com) com sua conta Microsoft (e-mail pessoal ou outro). O tier gratuito inclui 5 usuários, repositórios privados e **Service Hooks**. Você será admin e terá permissão para criar subscriptions. |
| **Jira** | Usar [Jira Free](https://www.atlassian.com/software/jira/free) (Atlassian Cloud) ou uma instância de teste. Crie um projeto de teste e issues para receber comentários/transições vindos do seu backend. |
| **Backend (opcional)** | Para receber o webhook: pode usar [webhook.site](https://webhook.site) só para ver o payload; ou uma Azure Function / App Service na sua assinatura pessoal (há free tier) para chamar a API do Jira. |

**Vantagens:**
- Não depende de alguém te dar permissão de Service Hooks no projeto do time.
- Não afeta repositórios, pipelines ou métricas do time.
- Depois que validar, você pode documentar e propor ao time (e aí um admin cria as subscriptions no projeto real, se fizer sentido).

---

## 3. Eventos relevantes para o caso de uso

### 3.1 PR completada / pipeline

| Evento | Event ID | Uso |
|--------|----------|-----|
| **Build completed** | `build.complete` | Quando a build termina (inclui sucesso/falha). Payload tem `queueTime`, `startTime`, `finishTime` — dá para mandar “início da pipeline” e resultado no Jira. |
| **Pull request merged** | `git.pullrequest.merged` | Quando o merge da PR é concluído. |
| **Pull request updated** | `git.pullrequest.updated` | Quando status, lista de reviewers ou voto de reviewer mudam (ver abaixo). |
| **Run state changed** (YAML pipeline) | `ms.vss-pipelines.run-state-changed-event` | Quando um run da pipeline muda de estado (ex.: completed). |

Para “comentar no Jira com horário de início da pipeline”:
- **Opção A:** Subscription em `build.complete` (ou `ms.vss-pipelines.run-state-changed-event`) → Webhook envia payload para um serviço intermediário que comenta no Jira (via API Jira).
- **Opção B:** Subscription em `git.pullrequest.merged` se quiser só “PR completada”, e aí o mesmo serviço busca dados da última build associada (via Azure DevOps API) e comenta no Jira.

### 3.2 Incluir optional/required reviewer na PR

O evento **Pull request updated** cobre isso.

- **Event ID:** `git.pullrequest.updated`
- **Descrição oficial:** “A pull request is updated: the status, review list, or a reviewer vote changes, or a push updates the source branch.”
- **Filtro útil:** `notificationType` com valores:
  - `ReviewersUpdateNotification` — **quando a lista de reviewers muda** (incluir optional/required dispara isso).
  - `ReviewerVoteNotification` — quando o voto de um reviewer muda.
  - `StatusUpdateNotification` — quando o status da PR muda.
  - `PushNotification` — quando a branch de origem é atualizada.

**Conclusão:** Sim, **incluir optional ou required reviewer na PR pode disparar o Hook** usando o evento `git.pullrequest.updated` com filtro `notificationType = ReviewersUpdateNotification`. O serviço que receber o webhook pode então chamar a API do Jira para mudar o status do issue (ex.: “In Code Review”).

---

## 4. Consumer: Web Hooks

Para integrar com **qualquer backend** (incluindo um que fale com Jira), o consumer indicado é **Web Hooks**:

- **Consumer ID:** `webHooks`
- **Action ID:** `httpRequest`
- Envio: **HTTP POST** com JSON do evento para uma **URL HTTPS** que você definir.
- **Requisitos:** URL deve ser HTTPS; não pode ser localhost ou IPs especiais (ver doc de Webhooks).

Fluxo:
1. Azure DevOps dispara o evento → POST na sua URL.
2. Seu serviço (Azure Function, App Service, etc.):
   - Parseia o payload (ex.: `resource.repository`, `resource.pullRequestId`, `resource.status`, dados de build).
   - Extrai o ID do card Jira (ex.: do título da PR ou branch, ou de custom field na PR).
   - Chama Jira API (comentar, transição de status, etc.).

---

## 4.1 Aprofundando na automação do webhook: caminho e implementação

### Caminho completo (fluxo)

```
[Azure DevOps]  →  evento (ex.: PR updated, build complete)
       ↓
[Service Hook]  →  HTTP POST (JSON) para a sua URL
       ↓
[Seu endpoint]  →  1) Recebe POST  2) Parseia JSON  3) Extrai dados  4) Chama Jira API
       ↓
[Jira]          →  comentário e/ou transição de status no issue
```

Ou seja: **não existe “webhook do Jira”** — o Azure envia para **uma URL sua**; quem fala com o Jira é o **seu código** nessa URL.

### Tem linguagem de programação específica?

**Não.** Qualquer stack que consiga:

1. **Expor um endpoint HTTP(S)** que aceite POST com JSON  
2. **Fazer chamadas HTTP** para a API do Jira (REST)

serve. Exemplos:

| Linguagem / stack | Onde costuma rodar | Observação |
|-------------------|--------------------|------------|
| **Node.js** (Express, Fastify, ou Azure Function) | Azure Function, App Service, Vercel, etc. | Muito usado para webhooks; ecosystem rico. |
| **Python** (FastAPI, Flask, ou Azure Function) | Azure Function, App Service, AWS Lambda | Simples para parse de JSON e `requests`/`httpx`. |
| **C#** (.NET, Azure Function) | Azure Function, App Service | Integração natural com Azure. |
| **Java** (Spring Boot, Quarkus) | App Service, qualquer servidor | Bom se o time já usa Java. |
| **Power Automate / Logic Apps** | Azure | Low-code; “When HTTP request received” + ação Jira (se houver conector). |

Recomendação prática para POC: **Azure Function** em **Node.js** ou **Python** — pouca configuração, URL HTTPS pronta, e você controla toda a lógica (parse + Jira).

### O que seu endpoint precisa fazer (em qualquer linguagem)

1. **Receber**  
   - Método: `POST`  
   - Body: JSON (payload do Azure; ver [Service hook events](https://learn.microsoft.com/en-us/azure/devops/service-hooks/events?view=azure-devops)).

2. **Identificar o tipo de evento**  
   - Ex.: `eventType === "git.pullrequest.updated"` ou `"build.complete"`  
   - Assim você decide se comenta no Jira, muda status, ou ignora.

3. **Extrair dados**  
   - PR: `resource.title`, `resource.pullRequestId`, `resource.status`, `resource.reviewers`, etc.  
   - Build: `resource.buildNumber`, `resource.queueTime`, `resource.startTime`, `resource.startTime`, `resource.result`, etc.  
   - Mapear PR ↔ issue: por exemplo extrair a chave do Jira do título da PR (ex.: `[BEESEDI-12345]`).

4. **Chamar a API do Jira**  
   - **Comentar:** `POST /rest/api/3/issue/{issueIdOrKey}/comment`  
   - **Mudar status:** `GET /rest/api/3/issue/{issueIdOrKey}/transitions` e depois `POST /rest/api/3/issue/{issueIdOrKey}/transitions`  
   - Autenticação: Basic (user + API token) ou OAuth, conforme o Jira Cloud.

5. **Responder ao Azure**  
   - Retornar **200** (e opcionalmente um body) para o Azure considerar o envio ok.  
   - Em caso de erro (ex.: Jira indisponível), retornar 5xx se quiser que o Azure tente reenviar (depende da política de retry).

### Onde hospedar o endpoint (URL HTTPS)

O Service Hook exige **HTTPS** e uma URL acessível pela internet (não localhost). Opções comuns:

| Opção | Prós | Contras |
|-------|------|--------|
| **Azure Function** | HTTP trigger, escala sob demanda, free tier generoso, mesma nuvem do DevOps | Precisa de conta Azure (pode ser pessoal) |
| **Azure App Service** | Controle total do processo, várias linguagens | Mais configuração que Function |
| **Vercel / Netlify (serverless)** | Fácil para Node/TS | Limites de timeout e cold start |
| **ngrok** (túnel para sua máquina) | Só para teste local rápido | Não é para produção |

Para estudo/POC, **Azure Function** (Node ou Python) na sua conta pessoal costuma ser o caminho mais direto.

### Esboço de código (Azure Function – Node.js)

Estrutura mínima para você ter um ponto de partida (sem tratar todos os erros):

```javascript
// Azure Function (Node.js) - HTTP trigger
// Recebe POST do Service Hook e comenta no Jira

module.exports = async function (context, req) {
  if (req.method !== 'POST' || !req.body) {
    context.res = { status: 400, body: 'Expected POST with JSON body' };
    return;
  }

  const payload = req.body;
  const eventType = payload.eventType;  // ex: "git.pullrequest.updated", "build.complete"

  // 1) Extrair chave Jira do título da PR (ex: "[BEESEDI-12345] Minha alteração")
  const title = payload.resource?.title || '';
  const jiraKeyMatch = title.match(/\[([A-Z]+-\d+)\]/);
  const jiraKey = jiraKeyMatch ? jiraKeyMatch[1] : null;

  if (!jiraKey) {
    context.res = { status: 200, body: 'No Jira key in title, skipping' };
    return;
  }

  // 2) Montar texto do comentário conforme o evento
  let commentText = '';
  if (eventType === 'build.complete') {
    const build = payload.resource || {};
    commentText = `Build ${build.buildNumber} ${build.result}.\nStarted: ${build.startTime}\nFinished: ${build.finishTime}`;
  } else if (eventType === 'git.pullrequest.updated') {
    commentText = `PR updated: ${payload.message?.text || 'Reviewers or status changed'}.`;
  }

  if (!commentText) {
    context.res = { status: 200, body: 'Event type not handled' };
    return;
  }

  // 3) Chamar Jira API (comentar no issue)
  const jiraBaseUrl = process.env.JIRA_BASE_URL;   // ex: https://sua-org.atlassian.net
  const jiraToken = process.env.JIRA_API_TOKEN;   // token de usuário
  const jiraUser = process.env.JIRA_USER_EMAIL;

  const response = await fetch(
    `${jiraBaseUrl}/rest/api/3/issue/${jiraKey}/comment`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${jiraUser}:${jiraToken}`).toString('base64'),
      },
      body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: commentText }] }] } }),
    }
  );

  if (!response.ok) {
    context.res = { status: 500, body: `Jira API error: ${response.status}` };
    return;
  }

  context.res = { status: 200, body: `Comment added to ${jiraKey}` };
};
```

Variáveis de ambiente sugeridas: `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`. A URL da Function você cola no Service Hook como “URL do webhook”.

### Esboço equivalente em Python (Azure Function)

```python
# Azure Function (Python) - HTTP trigger
import os
import re
import json
import base64
import azure.functions as func

def main(req: func.HttpRequest) -> func.HttpResponse:
    if req.method != 'POST' or not req.get_json():
        return func.HttpResponse('Expected POST with JSON body', status_code=400)

    payload = req.get_json()
    event_type = payload.get('eventType', '')
    resource = payload.get('resource', {})

    title = resource.get('title', '')
    match = re.search(r'\[([A-Z]+-\d+)\]', title)
    jira_key = match.group(1) if match else None

    if not jira_key:
        return func.HttpResponse(json.dumps({'message': 'No Jira key in title'}), status_code=200)

    if event_type == 'build.complete':
        comment_text = f"Build {resource.get('buildNumber')} {resource.get('result')}. Started: {resource.get('startTime')} Finished: {resource.get('finishTime')}"
    elif event_type == 'git.pullrequest.updated':
        comment_text = f"PR updated: {payload.get('message', {}).get('text', 'Reviewers or status changed')}."
    else:
        return func.HttpResponse(json.dumps({'message': 'Event not handled'}), status_code=200)

    import urllib.request
    jira_url = os.environ.get('JIRA_BASE_URL')
    token = os.environ.get('JIRA_API_TOKEN')
    user = os.environ.get('JIRA_USER_EMAIL')
    url = f"{jira_url}/rest/api/3/issue/{jira_key}/comment"
    body = json.dumps({
        "body": {
            "type": "doc", "version": 1,
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": comment_text}]}]
        }
    }).encode('utf-8')
    req_jira = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + base64.b64encode(f'{user}:{token}'.encode()).decode(),
    })
    with urllib.request.urlopen(req_jira) as resp:
        pass  # 2xx
    return func.HttpResponse(json.dumps({'message': f'Comment added to {jira_key}'}), status_code=200)
```

(Em produção use `httpx` ou `requests` e trate exceções/status 4xx/5xx.)

### Resumo do caminho

| Etapa | O que fazer |
|-------|-------------|
| 1 | Criar um projeto no Azure (ou usar conta pessoal) e publicar uma **Azure Function** (Node ou Python) com HTTP trigger. |
| 2 | Configurar **variáveis de ambiente** (Jira URL, usuário, API token). |
| 3 | Copiar a **URL da Function** (ex.: `https://sua-function.azurewebsites.net/api/azuro-webhook`) e colar em **Service Hooks → Web Hooks** no projeto do Azure DevOps. |
| 4 | Escolher o **evento** (ex.: `git.pullrequest.updated`, `build.complete`) e **filtros** (ex.: repositório, `notificationType`). |
| 5 | Testar: abrir/atualizar PR ou rodar build e ver o comentário aparecer no Jira. |

Não há linguagem obrigatória: o importante é ter um endpoint HTTPS que receba o POST, interprete o `eventType` e o `resource`, e chame a API do Jira conforme as regras que você definir.

---

## 5. Como testar sem impactar métricas do time

Para validar o fluxo **sem usar tasks reais do time** e sem sujar métricas de projeto/repo:

### 5.1 Ambiente de teste no Azure DevOps

1. **Projeto de teste**
   - Criar um **projeto** dedicado (ex.: `NFA-ServiceHooks-POC` ou usar um projeto de sandbox já existente).
   - Ou usar um **repositório** de teste dentro do mesmo projeto, se as métricas forem por repo.

2. **Repo + PR de teste**
   - Criar um repo de teste (ex.: `service-hooks-poc`).
   - Abrir uma **PR fake** (ex.: branch `test/hook-jira` → `main`).
   - Não mergear em branches oficiais do produto; manter tudo em branch/repo de POC.

3. **Pipeline de teste (opcional)**
   - Se for testar `build.complete` ou `run-state-changed`, criar uma **pipeline simples** só nesse projeto/repo (um step “echo”), para não afetar pipelines reais.

### 5.2 Receber o payload sem Jira (só validar Hook)

1. **Webhook público temporário**
   - Usar [webhook.site](https://webhook.site) ou [RequestBin](https://requestbin.com) para gerar uma URL HTTPS.
   - No Azure DevOps: **Project settings → Service hooks → Create subscription → Web Hooks**.
   - Configurar o evento desejado (ex.: `git.pullrequest.updated` ou `build.complete`) e colar a URL do webhook.site.
   - **Test:** criar/atualizar PR ou rodar a pipeline de teste e ver o JSON no webhook.site.
   - Assim você valida permissões, formato do payload e filtros **sem tocar no Jira**.

2. **Filtros para não disparar em tudo**
   - Restringir por `repository` (só o repo de POC) e, no caso de PR updated, por `notificationType` (ex.: `ReviewersUpdateNotification`), para reduzir ruído.

### 5.3 Testar integração com Jira sem impactar backlog

1. **Projeto/issue de teste no Jira**
   - Usar um **projeto de teste** no Jira (ex.: time de engenharia interna ou um projeto “POC”) **ou**
   - Um **issue type**/board que não seja usado para métricas de entrega (ex.: “Discovery” ou “Spike”).
   - Não usar tasks reais de sprint/backlog.

2. **Link PR ↔ Jira**
   - Na PR de teste, colocar no **título** a chave do issue (ex.: `[BEESEDI-99999] Teste Service Hook`).
   - Seu serviço que recebe o webhook pode extrair `BEESEDI-99999` do título e comentar/mudar status só nesse issue.

3. **Serviço intermediário**
   - Desenvolver uma Azure Function (ou app equivalente) que:
     - Recebe POST do Service Hook.
     - Valida que é do repo/projeto de POC (e, se quiser, ignora eventos de outros projetos).
     - Extrai dados (PR id, build times, reviewers, etc.).
     - Chama Jira API (comentar e/ou transição) apenas para issues que você definir como “teste” (ex.: por projeto ou por label).

Assim você prova o fluxo ponta a ponta **sem afetar métricas** de projeto, sprint ou tempo de ciclo em backlog real.

---

## 6. Resumo das descobertas

| Pergunta | Resposta |
|----------|----------|
| Azure tem Hook que dispara automação? | Sim. **Service Hooks** (subscriptions) associam eventos do Azure DevOps a consumers (ex.: Web Hooks). |
| Completar PR → comentar no Jira com horário da pipeline? | Sim. Usar evento `build.complete` ou `ms.vss-pipelines.run-state-changed-event` → Webhook → seu serviço comenta no Jira (payload tem `queueTime`, `startTime`, `finishTime`). |
| Incluir optional/required reviewer na PR dispara Hook e muda status no Jira? | Sim. Evento `git.pullrequest.updated` com filtro `notificationType = ReviewersUpdateNotification`; seu serviço recebe o POST e chama Jira API para mudar status. |
| Temos permissão para criar? | Depende da org. Por padrão: **Project Administrators** (Edit/View subscriptions). Webhooks na doc mencionam **Project Collection Administrators**. Verificar no seu tenant. |
| Como testar sem impactar o time? | Projeto/repo de POC no Azure DevOps; PR e pipeline de teste; webhook.site para ver payload; projeto/issue de teste no Jira; serviço intermediário que só age em issues de teste. |

---

## 7. Próximos passos sugeridos

1. **Confirmar permissões** no Azure DevOps (quem pode criar Service Hooks no projeto/coleção).
2. **Criar projeto/repo de POC** e uma subscription **Web Hooks** apontando para webhook.site com evento `git.pullrequest.updated` (filtro `ReviewersUpdateNotification`) e depois `build.complete`.
3. **Documentar payloads** capturados (ex.: onde vêm PR id, branch, link para Jira).
4. **Implementar** um backend mínimo (ex.: Azure Function) que recebe o POST, parseia e chama Jira API (comentar/transição) apenas para um issue de teste.
5. **Repetir** para “PR completada + horário da pipeline” usando `build.complete` ou `run-state-changed`.
6. **Socializar** com a Erika e o time e, se aprovado, desenhar a versão para uso em projetos reais (com mapeamento PR↔Jira e tratamento de erros).

---

## 8. Referências

- [Create a service hook subscription (programático)](https://learn.microsoft.com/en-us/azure/devops/service-hooks/create-subscription?view=azure-devops)
- [Service hook events](https://learn.microsoft.com/en-us/azure/devops/service-hooks/events?view=azure-devops)
- [Webhooks (consumer)](https://learn.microsoft.com/en-us/azure/devops/service-hooks/services/webhooks?view=azure-devops)
- [Integrate with service hooks (overview)](https://learn.microsoft.com/en-us/azure/devops/service-hooks/overview?view=azure-devops)
- [Troubleshoot service hooks](https://learn.microsoft.com/en-us/azure/devops/service-hooks/troubleshoot?view=azure-devops)
