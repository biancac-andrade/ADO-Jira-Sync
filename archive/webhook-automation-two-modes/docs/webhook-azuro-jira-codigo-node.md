# Webhook Azure DevOps → Jira (código Node/TypeScript e Java)

Documento **técnico** com exemplos de código para o endpoint que recebe o Service Hook do Azure DevOps e chama a API do Jira.  
Inclui **Node/TypeScript** e **Java (Spring Boot)** — a lógica é a mesma; a complexidade não é maior em Java.  
Para o contexto completo (o que é Service Hook, permissões, eventos), veja [estudo-descoberta-azure-service-hooks-jira.md](./estudo-descoberta-azure-service-hooks-jira.md).

---

## Os dois fluxos de automação

### Fluxo 1: Ao completar a PR → comentário no Jira com horário da pipeline (Brasília)

- **O que:** Quando a pipeline da PR termina, o webhook dispara e seu código **comenta na task do Jira** com:
  - Horário em **Brasília** em que a pipeline **iniciou**
  - Horário em **Brasília** em que a pipeline **finalizou**
- **Evento Azure:** `build.complete` (ou `ms.vss-pipelines.run-state-changed-event` se usarem só YAML pipelines). O payload já traz `startTime` e `finishTime` (UTC); você converte para America/Sao_Paulo e monta o texto do comentário.
- **Observação:** “Completar a PR” aqui é a **pipeline/build** associada à PR (ex.: build disparada pelo push na branch da PR). O evento é da **build**, não do merge da PR. Se quiser comentar também quando a PR for **mergeada**, dá para usar `git.pullrequest.merged` em paralelo.

### Fluxo 2: Alguém coloca revisor na PR → mudar status da task no Jira

- **O que:** Quando alguém **adiciona** (ou altera) **revisor** na PR (optional ou required), o webhook dispara e seu código faz **transição de status** na task do Jira (ex.: para “In Code Review”).
- **Evento Azure:** `git.pullrequest.updated` com filtro **`notificationType = ReviewersUpdateNotification`** (no Service Hook você configura esse filtro).
- **Ação no Jira:** `GET /rest/api/3/issue/{key}/transitions` para achar o ID da transição desejada e `POST /rest/api/3/issue/{key}/transitions` para aplicar.

### Como a PR fica “ligada” à task do Jira?

O Azure **não** envia o ID da task do Jira. A ligação é por **convenção no título da PR** (e opcionalmente na branch).

- **Padrão recomendado:** no **título da PR** sempre incluir a chave do Jira, por exemplo:
  - `[BEESEDI-12345] Descrição da alteração`
  - `BEESEDI-12345 - Descrição da alteração`
- O payload do Service Hook traz `resource.title` (título da PR). Seu código usa um **regex** para extrair a chave (ex.: `BEESEDI-12345`) e usa essa chave para comentar ou mudar status na issue correspondente no Jira.
- **Regex sugerido:** `\[?([A-Z]+-\d+)\]?` — aceita com ou sem colchetes. Exemplo em JS: `title.match(/\[?([A-Z]+-\d+)\]?/)` e pegar o grupo 1.

Assim, **quem “conecta” a PR à task é o próprio time**, ao colocar a chave no título. Não existe vínculo automático Azure ↔ Jira além disso, a não ser que você use custom fields ou outro mecanismo no futuro.

### Padrões de título aceitos (exemplos)

| Título da PR | Chave extraída |
|--------------|-----------------|
| `[BEESEDI-12345] Ajuste no fluxo` | `BEESEDI-12345` |
| `BEESEDI-12345 - Ajuste no fluxo` | `BEESEDI-12345` |
| `BEESEDI-12345 Ajuste no fluxo` | `BEESEDI-12345` |

Regex que aceita os casos acima: **`/\[?([A-Z]+-\d+)\]?/`** (primeiro match no título).

---

## Preciso hospedar para a automação funcionar?

**Sim.** O Azure DevOps envia um **HTTP POST** para uma **URL que você informar** no Service Hook. Essa URL precisa ser:

- **Pública** (acessível pela internet)
- **HTTPS** (a doc do Azure exige HTTPS)
- **Sempre disponível** quando o evento ocorrer (PR atualizada, build concluída, etc.)

Ou seja: para a automação rodar de verdade, o seu código precisa estar **hospedado** em algum lugar. Em desenvolvimento você pode usar **ngrok** (túnel) para expor o `localhost`; para uso contínuo use um serviço (Azure Function, Vercel, Railway, etc.).

| Cenário | O que usar |
|--------|------------|
| **Testar localmente** | Servidor Node no seu PC + **ngrok** para gerar uma URL HTTPS temporária e colar no Service Hook. |
| **Automação “de verdade”** | Hospedar o endpoint (ex.: **Azure Function**, **Vercel**, **Railway**) e colar a URL da função no Service Hook. |

---

## Estrutura do payload (lembrete)

O Azure envia um JSON no body do POST. Exemplo mínimo:

```json
{
  "eventType": "git.pullrequest.updated",
  "publisherId": "tfs",
  "resource": {
    "title": "[BEESEDI-12345] Minha PR",
    "pullRequestId": 42,
    "status": "active",
    "reviewers": [...]
  },
  "message": { "text": "...", "markdown": "..." }
}
```

Para `build.complete` o `resource` traz `buildNumber`, `result`, `startTime`, `finishTime`, etc.  
Para `git.pullrequest.updated` o `resource` traz `title`, `pullRequestId`, `status`, `reviewers`, etc.

---

## Exemplo completo: os dois fluxos (comentário + mudar status)

Este exemplo une os dois comportamentos: **comentário com horário em Brasília** (build complete) e **mudar status no Jira** (quando revisor é adicionado na PR). A ligação PR ↔ task é pelo **título da PR** (chave no título).

### Utilitários: horário Brasília, extrair chave, comentar, transição

```javascript
// utils/jira.js (Node 18+ ou use node-fetch)
const JIRA_BASE = process.env.JIRA_BASE_URL?.replace(/\/$/, '') || '';
const JIRA_USER = process.env.JIRA_USER_EMAIL || '';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || '';
const JIRA_STATUS_CODE_REVIEW = process.env.JIRA_STATUS_CODE_REVIEW || 'In Code Review'; // nome do status no Jira

function authHeader() {
  const auth = Buffer.from(`${JIRA_USER}:${JIRA_TOKEN}`).toString('base64');
  return { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };
}

/** Formata ISO UTC para horário Brasília (DD/MM/YYYY HH:mm) */
function formatBrasilia(isoDate) {
  if (!isoDate) return '—';
  const date = new Date(isoDate);
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Extrai chave Jira do título da PR. Ex: "[BEESEDI-12345] Fix" => "BEESEDI-12345" */
function extractJiraKey(title) {
  const m = (title || '').match(/\[?([A-Z]+-\d+)\]?/);
  return m ? m[1] : null;
}

/** Adiciona comentário na issue do Jira (Jira Cloud API v3) */
async function addJiraComment(issueKey, text) {
  const url = `${JIRA_BASE}/rest/api/3/issue/${issueKey}/comment`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    }),
  });
  return res.ok;
}

/** Lista transições disponíveis e aplica a que bate com o nome (ex: "In Code Review") */
async function setJiraStatus(issueKey, statusName) {
  const listUrl = `${JIRA_BASE}/rest/api/3/issue/${issueKey}/transitions`;
  const listRes = await fetch(listUrl, { method: 'GET', headers: authHeader() });
  if (!listRes.ok) return false;
  const { transitions } = await listRes.json();
  const t = transitions.find((tr) => tr.name === statusName);
  if (!t) return false;
  const postRes = await fetch(listUrl, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ transition: { id: t.id } }),
  });
  return postRes.ok;
}
```

### Handler: Fluxo 1 (pipeline) + Fluxo 2 (revisor → status)

```javascript
// POST /webhook/azuro
app.post('/webhook/azuro', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload?.resource) {
      return res.status(400).json({ error: 'Expected JSON body with resource' });
    }

    const eventType = payload.eventType;
    const resource = payload.resource;

    // Título pode vir da PR (pull request) ou da build (source branch / PR link)
    // Para build.complete, o título da PR não vem no resource; dá para usar resource.sourceBranch ou
    // você pode ter uma subscription por build e outra por PR — aqui assumimos que em build.complete
    // o resource tem repository e podemos precisar do PR title de outra forma. Na prática o build
    // é associado a uma branch; para ter a chave Jira no build você pode usar o nome da branch
    // (ex: feature/BEESEDI-12345-desc) ou garantir que o mesmo evento também envie o título.
    // O payload de build.complete às vezes inclui "triggerInfo" ou você pode extrair da branch.
    let jiraKey = extractJiraKey(resource.title);

    if (!jiraKey && resource.sourceBranch) {
      // Fallback: extrair da branch, ex: refs/heads/feature/BEESEDI-12345-desc
      jiraKey = extractJiraKey(resource.sourceBranch.replace(/^refs\/heads\//, ''));
    }

    if (!jiraKey) {
      return res.status(200).json({ message: 'No Jira key in title or branch, skipping' });
    }

    // —— Fluxo 1: Build/Pipeline completou → comentar com horário Brasil
    if (eventType === 'build.complete') {
      const startBr = formatBrasilia(resource.startTime);
      const finishBr = formatBrasilia(resource.finishTime);
      const commentText = [
        `Pipeline iniciou em ${startBr} (Brasília).`,
        `Pipeline finalizou em ${finishBr} (Brasília).`,
        `Resultado: ${resource.result || '—'}.`,
      ].join('\n');
      const ok = await addJiraComment(jiraKey, commentText);
      return res.status(ok ? 200 : 500).json(ok ? { message: `Comment added to ${jiraKey}` } : { error: 'Jira comment failed' });
    }

    // —— Fluxo 2: PR atualizada (ex: revisor adicionado) → mudar status no Jira
    if (eventType === 'git.pullrequest.updated') {
      const ok = await setJiraStatus(jiraKey, JIRA_STATUS_CODE_REVIEW);
      return res.status(ok ? 200 : 500).json(ok ? { message: `Status updated for ${jiraKey}` } : { error: 'Jira transition failed' });
    }

    res.status(200).json({ message: 'Event ignored', eventType });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});
```

**Configuração:**

- **Fluxo 1:** No Azure DevOps, crie uma subscription **Web Hooks** para o evento **Build completed** (e, se quiser, filtre por `definitionName` ou `projectId`). A URL é o seu endpoint (ex.: `https://seu-app.com/webhook/azuro`).
- **Fluxo 2:** Crie outra subscription para **Pull request updated** e use o filtro **Notification type** = **Reviewers updated** (ou equivalente ao `ReviewersUpdateNotification`). Mesma URL.
- **Chave Jira:** Sempre colocar no **título da PR** a chave, ex.: `[BEESEDI-12345] Descrição`. Opcionalmente usar o mesmo padrão na **branch** para o evento de build (ex.: `feature/BEESEDI-12345-desc`).
- **Variável `JIRA_STATUS_CODE_REVIEW`:** Nome exato do status no Jira para “em revisão” (ex.: `In Code Review`). O código busca a transição pelo nome.

**Observação sobre build e título:** No evento `build.complete`, o `resource` nem sempre traz o título da PR; costuma trazer `sourceBranch`. Por isso o exemplo tenta primeiro `resource.title` e depois `resource.sourceBranch`. Se a pipeline for disparada pela PR, o branch já terá o nome da branch da PR; usar convenção na branch (ex.: `BEESEDI-12345`) garante que a chave seja encontrada. Se no seu payload vier o título da PR em outro campo, use esse campo para extrair a chave.

---

## Exemplo 1: Express (Node.js ou TypeScript) — mínimo

Servidor HTTP que recebe o POST, extrai a chave Jira do título da PR e comenta no Jira.

### Dependências

```bash
npm init -y
npm install express
npm install -D typescript @types/node @types/express ts-node
# opcional: dotenv para variáveis de ambiente
npm install dotenv
```

### Código (TypeScript) — `src/server.ts`

```typescript
import express, { Request, Response } from 'express';

const app = express();
app.use(express.json({ limit: '1mb' }));

const JIRA_BASE = process.env.JIRA_BASE_URL || '';
const JIRA_USER = process.env.JIRA_USER_EMAIL || '';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || '';

function extractJiraKey(title: string): string | null {
  const match = title.match(/\[([A-Z]+-\d+)\]/);
  return match ? match[1] : null;
}

async function addJiraComment(issueKey: string, text: string): Promise<boolean> {
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) {
    console.warn('Jira env vars missing, skipping API call');
    return false;
  }
  const auth = Buffer.from(`${JIRA_USER}:${JIRA_TOKEN}`).toString('base64');
  const url = `${JIRA_BASE.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}/comment`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text }],
          },
        ],
      },
    }),
  });
  return res.ok;
}

app.post('/webhook/azuro', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ error: 'Expected JSON body' });
      return;
    }

    const eventType = payload.eventType as string;
    const resource = payload.resource || {};
    const title = resource.title || '';

    const jiraKey = extractJiraKey(title);
    if (!jiraKey) {
      res.status(200).json({ message: 'No Jira key in title, skipping' });
      return;
    }

    let commentText = '';
    if (eventType === 'build.complete') {
      commentText = [
        `Build ${resource.buildNumber} ${resource.result}.`,
        `Started: ${resource.startTime}`,
        `Finished: ${resource.finishTime}`,
      ].join('\n');
    } else if (eventType === 'git.pullrequest.updated') {
      commentText = `PR updated: ${(payload.message && payload.message.text) || 'Reviewers or status changed'}.`;
    } else if (eventType === 'git.pullrequest.created') {
      commentText = `PR created: ${title}`;
    } else {
      res.status(200).json({ message: 'Event type not handled', eventType });
      return;
    }

    const ok = await addJiraComment(jiraKey, commentText);
    if (!ok) {
      res.status(500).json({ error: 'Failed to add Jira comment' });
      return;
    }

    res.status(200).json({ message: `Comment added to ${jiraKey}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Health check (útil para hospedagem)
app.get('/health', (_req, res) => res.status(200).send('ok'));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Webhook server listening on port ${port}`));
```

### Variáveis de ambiente (`.env`)

```env
PORT=3000
JIRA_BASE_URL=https://sua-org.atlassian.net
JIRA_USER_EMAIL=seu-email@empresa.com
JIRA_API_TOKEN=seu-token-jira
```

### Rodar

```bash
npx ts-node src/server.ts
# ou com dotenv: node -r dotenv/config dist/server.js
```

A URL que o Azure deve chamar é: `https://SEU_HOST/webhook/azuro`. Em local: use ngrok e coloque `https://xxxx.ngrok.io/webhook/azuro` no Service Hook.

---

## Exemplo 2: Mesmo fluxo em JavaScript puro (Express)

Se preferir sem TypeScript:

```javascript
// server.js
const express = require('express');
const app = express();
app.use(express.json({ limit: '1mb' }));

const JIRA_BASE = process.env.JIRA_BASE_URL || '';
const JIRA_USER = process.env.JIRA_USER_EMAIL || '';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || '';

function extractJiraKey(title) {
  const match = (title || '').match(/\[([A-Z]+-\d+)\]/);
  return match ? match[1] : null;
}

async function addJiraComment(issueKey, text) {
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) return false;
  const auth = Buffer.from(`${JIRA_USER}:${JIRA_TOKEN}`).toString('base64');
  const url = `${JIRA_BASE.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}/comment`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    }),
  });
  return res.ok;
}

app.post('/webhook/azuro', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Expected JSON body' });
    }
    const eventType = payload.eventType;
    const resource = payload.resource || {};
    const title = resource.title || '';
    const jiraKey = extractJiraKey(title);
    if (!jiraKey) {
      return res.status(200).json({ message: 'No Jira key in title, skipping' });
    }
    let commentText = '';
    if (eventType === 'build.complete') {
      commentText = `Build ${resource.buildNumber} ${resource.result}. Started: ${resource.startTime} Finished: ${resource.finishTime}`;
    } else if (eventType === 'git.pullrequest.updated') {
      commentText = `PR updated: ${(payload.message && payload.message.text) || 'Reviewers or status changed'}.`;
    } else if (eventType === 'git.pullrequest.created') {
      commentText = `PR created: ${title}`;
    } else {
      return res.status(200).json({ message: 'Event type not handled', eventType });
    }
    const ok = await addJiraComment(jiraKey, commentText);
    if (!ok) return res.status(500).json({ error: 'Failed to add Jira comment' });
    res.status(200).json({ message: `Comment added to ${jiraKey}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/health', (_, res) => res.status(200).send('ok'));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Webhook server on port ${port}`));
```

---

## Exemplo 3: Azure Function (Node.js) — para hospedar no Azure

Assim você gera uma URL HTTPS pronta para colar no Service Hook, sem manter um servidor 24/7.

### Estrutura sugerida

```
webhook-function/
  package.json
  host.json
  local.settings.json   (não commitar; só local)
  src/
    webhook/
      function.json
      index.js
```

### `package.json`

```json
{
  "name": "azuro-webhook-jira",
  "version": "1.0.0",
  "main": "src/webhook/index.js",
  "description": "Receives Azure DevOps Service Hook and posts to Jira"
}
```

### `host.json`

```json
{
  "version": "2.0",
  "extensionBundle": {
    "id": "Microsoft.Azure.Functions.ExtensionBundle",
    "version": "[4.*, 5.0.0)"
  }
}
```

### `src/webhook/function.json`

```json
{
  "bindings": [
    {
      "authLevel": "function",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["post", "get"]
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

### `src/webhook/index.js`

```javascript
const JIRA_BASE = process.env.JIRA_BASE_URL || '';
const JIRA_USER = process.env.JIRA_USER_EMAIL || '';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || '';

function extractJiraKey(title) {
  const match = (title || '').match(/\[([A-Z]+-\d+)\]/);
  return match ? match[1] : null;
}

async function addJiraComment(issueKey, text) {
  if (!JIRA_BASE || !JIRA_USER || !JIRA_TOKEN) return false;
  const auth = Buffer.from(`${JIRA_USER}:${JIRA_TOKEN}`).toString('base64');
  const url = `${JIRA_BASE.replace(/\/$/, '')}/rest/api/3/issue/${issueKey}/comment`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
      },
    }),
  });
  return res.ok;
}

module.exports = async function (context, req) {
  if (req.method === 'GET') {
    context.res = { status: 200, body: 'Webhook endpoint. Use POST with Azure DevOps payload.' };
    return;
  }

  if (req.method !== 'POST' || !req.body) {
    context.res = { status: 400, body: 'Expected POST with JSON body' };
    return;
  }

  try {
    const payload = req.body;
    const eventType = payload.eventType;
    const resource = payload.resource || {};
    const title = resource.title || '';

    const jiraKey = extractJiraKey(title);
    if (!jiraKey) {
      context.res = { status: 200, body: JSON.stringify({ message: 'No Jira key in title, skipping' }) };
      return;
    }

    let commentText = '';
    if (eventType === 'build.complete') {
      commentText = `Build ${resource.buildNumber} ${resource.result}. Started: ${resource.startTime} Finished: ${resource.finishTime}`;
    } else if (eventType === 'git.pullrequest.updated') {
      commentText = `PR updated: ${(payload.message && payload.message.text) || 'Reviewers or status changed'}.`;
    } else if (eventType === 'git.pullrequest.created') {
      commentText = `PR created: ${title}`;
    } else {
      context.res = { status: 200, body: JSON.stringify({ message: 'Event not handled', eventType }) };
      return;
    }

    const ok = await addJiraComment(jiraKey, commentText);
    if (!ok) {
      context.res = { status: 500, body: JSON.stringify({ error: 'Failed to add Jira comment' }) };
      return;
    }

    context.res = { status: 200, body: JSON.stringify({ message: `Comment added to ${jiraKey}` }) };
  } catch (err) {
    context.log.error(err);
    context.res = { status: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
```

### Rodar localmente (Azure Functions Core Tools)

```bash
cd webhook-function
npm install
# Defina JIRA_* em local.settings.json ou no ambiente
func start
```

A URL local será algo como `http://localhost:7071/api/webhook`. Para o Azure DevOps usar, você precisa de HTTPS: publique a function no Azure e use a URL da function (ex.: `https://sua-function.azurewebsites.net/api/webhook?code=...`).

### Hospedar no Azure

1. Criar um Function App no Azure (Runtime: Node).
2. Configurar Application settings com `JIRA_BASE_URL`, `JIRA_USER_EMAIL`, `JIRA_API_TOKEN`.
3. Fazer deploy (VS Code, Azure CLI ou CI/CD).
4. Copiar a URL do trigger (com `code` se usar `authLevel: 'function'`) e colar em **Service Hooks → Web Hooks**.

---

## Exemplo em Java (Spring Boot) — mesmo fluxo, sem mais complexidade

Se o backend do Bees Link é Java, dá para fazer o mesmo webhook em **Spring Boot** com a **mesma lógica**: um controller que recebe o POST, extrai a chave Jira do título (ou branch), comenta ou muda status no Jira. Não é mais complexo — só outra stack.

### Dependências (Maven)

```xml
<dependencies>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-json</artifactId>
  </dependency>
</dependencies>
```

### Controller + serviço Jira (um único fluxo no controller)

```java
package com.example.webhook;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/webhook")
public class AzuroWebhookController {

    private static final Pattern JIRA_KEY_PATTERN = Pattern.compile("\\[?([A-Z]+-\\d+)\\]?");
    private static final DateTimeFormatter BRASILIA = DateTimeFormatter
            .ofPattern("dd/MM/yyyy HH:mm")
            .withZone(ZoneId.of("America/Sao_Paulo"));

    @Value("${jira.base-url:}")
    private String jiraBaseUrl;

    @Value("${jira.user-email:}")
    private String jiraUser;

    @Value("${jira.api-token:}")
    private String jiraToken;

    @Value("${jira.status-code-review:In Code Review}")
    private String statusCodeReview;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper objectMapper = new ObjectMapper();

    @PostMapping("/azuro")
    public ResponseEntity<?> handle(@RequestBody Map<String, Object> payload) {
        if (payload == null || !payload.containsKey("resource")) {
            return ResponseEntity.badRequest().body(Map.of("error", "Expected JSON with resource"));
        }

        String eventType = (String) payload.get("eventType");
        @SuppressWarnings("unchecked")
        Map<String, Object> resource = (Map<String, Object>) payload.getOrDefault("resource", Map.of());

        String jiraKey = extractJiraKey(getStr(resource, "title"));
        if (jiraKey == null) {
            jiraKey = extractJiraKey(getStr(resource, "sourceBranch").replace("refs/heads/", ""));
        }
        if (jiraKey == null) {
            return ResponseEntity.ok(Map.of("message", "No Jira key in title or branch, skipping"));
        }

        try {
            if ("build.complete".equals(eventType)) {
                String startBr = formatBrasilia(getStr(resource, "startTime"));
                String finishBr = formatBrasilia(getStr(resource, "finishTime"));
                String result = getStr(resource, "result");
                String comment = String.format(
                    "Pipeline iniciou em %s (Brasília).%nPipeline finalizou em %s (Brasília).%nResultado: %s.",
                    startBr, finishBr, result.isEmpty() ? "—" : result
                );
                boolean ok = addJiraComment(jiraKey, comment);
                return ok ? ResponseEntity.ok(Map.of("message", "Comment added to " + jiraKey))
                         : ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "Jira comment failed"));
            }

            if ("git.pullrequest.updated".equals(eventType)) {
                boolean ok = setJiraStatus(jiraKey, statusCodeReview);
                return ok ? ResponseEntity.ok(Map.of("message", "Status updated for " + jiraKey))
                         : ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "Jira transition failed"));
            }

            return ResponseEntity.ok(Map.of("message", "Event ignored", "eventType", eventType));
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "Internal error"));
        }
    }

    private static String getStr(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v != null ? v.toString() : "";
    }

    private static String extractJiraKey(String text) {
        if (text == null) return null;
        Matcher m = JIRA_KEY_PATTERN.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    private static String formatBrasilia(String isoDate) {
        if (isoDate == null || isoDate.isEmpty()) return "—";
        return BRASILIA.format(Instant.parse(isoDate));
    }

    private boolean addJiraComment(String issueKey, String text) {
        if (jiraBaseUrl == null || jiraBaseUrl.isEmpty()) return false;
        String auth = Base64.getEncoder().encodeToString((jiraUser + ":" + jiraToken).getBytes(StandardCharsets.UTF_8));
        String body = """
            {"body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"%s"}]}]}}
            """.formatted(text.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n"));
        try {
            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(jiraBaseUrl.replaceAll("/$", "") + "/rest/api/3/issue/" + issueKey + "/comment"))
                .header("Authorization", "Basic " + auth)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
            return http.send(req, HttpResponse.BodyHandlers.discarding()).statusCode() / 100 == 2;
        } catch (Exception e) {
            return false;
        }
    }

    @SuppressWarnings("unchecked")
    private boolean setJiraStatus(String issueKey, String statusName) {
        if (jiraBaseUrl == null || jiraBaseUrl.isEmpty()) return false;
        String auth = Base64.getEncoder().encodeToString((jiraUser + ":" + jiraToken).getBytes(StandardCharsets.UTF_8));
        String base = jiraBaseUrl.replaceAll("/$", "") + "/rest/api/3/issue/" + issueKey + "/transitions";
        try {
            HttpRequest getReq = HttpRequest.newBuilder()
                .uri(URI.create(base))
                .header("Authorization", "Basic " + auth)
                .GET()
                .build();
            HttpResponse<String> getRes = http.send(getReq, HttpResponse.BodyHandlers.ofString());
            if (getRes.statusCode() != 200) return false;
            Map<String, Object> map = objectMapper.readValue(getRes.body(), new TypeReference<Map<String, Object>>() {});
            List<Map<String, Object>> transitions = (List<Map<String, Object>>) map.get("transitions");
            if (transitions == null) return false;
            String transitionId = transitions.stream()
                .filter(t -> statusName.equals(t.get("name")))
                .map(t -> (String) t.get("id"))
                .findFirst()
                .orElse(null);
            if (transitionId == null) return false;
            String postBody = "{\"transition\":{\"id\":\"" + transitionId + "\"}}";
            HttpRequest postReq = HttpRequest.newBuilder()
                .uri(URI.create(base))
                .header("Authorization", "Basic " + auth)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(postBody))
                .build();
            return http.send(postReq, HttpResponse.BodyHandlers.discarding()).statusCode() / 100 == 2;
        } catch (Exception e) {
            return false;
        }
    }
}

### application.properties

```properties
jira.base-url=https://sua-org.atlassian.net
jira.user-email=seu-email@empresa.com
jira.api-token=seu-token-jira
jira.status-code-review=In Code Review
server.port=8080
```

### Resumo Java

- **Um controller**, um método `POST /webhook/azuro`, mesmo payload do Azure.
- **Mesma lógica:** extrair chave do título/branch, `build.complete` → comentário com horário Brasília, `git.pullrequest.updated` → transição de status.
- **Sem libs pesadas:** só `HttpClient` (Java 11+) e Jackson (já no Spring) para JSON. Dá para integrar no backend Bees Link como um endpoint a mais ou um microserviço pequeno.

Não é mais complexo que Node — só a sintaxe e o ecossistema que mudam.

---

## Resumo

| Pergunta | Resposta |
|----------|----------|
| Preciso hospedar para automatizar? | **Sim.** O Azure envia POST para uma URL pública HTTPS; em local use ngrok para testar. |
| Linguagem | **Node (JavaScript/TypeScript)** e **Java (Spring Boot)** — mesma lógica, não é mais complexo em Java. |
| Onde hospedar | Azure Function, Vercel (serverless), Railway, App Service, etc. |
| **Fluxo 1 – Pipeline** | Evento `build.complete` → comentar no Jira com horário **Brasília** (início e fim da pipeline). Chave Jira vinda do **título da PR** ou do **nome da branch** (`sourceBranch`). |
| **Fluxo 2 – Revisor** | Evento `git.pullrequest.updated` (filtro Reviewers updated) → **mudar status** da task no Jira (ex.: “In Code Review”). Chave Jira do **título da PR**. |
| Como a PR sabe qual task? | **Padrão no título (e opcionalmente na branch):** ex. `[BEESEDI-12345] Descrição` ou `BEESEDI-12345 - Descrição`. Regex: `/\[?([A-Z]+-\d+)\]?/`. |

---

## O que significa “evoluir” o webhook (explicação)

No resumo aparece “para evoluir” com três itens. Abaixo está o que cada um quer dizer, em linguagem simples.

### 1. Validar origem do request (secret / query param)

**O que é:** Sua URL do webhook é **pública**. Qualquer pessoa que descobrir o endereço pode mandar um POST fingindo ser o Azure. Validar a origem é garantir que você só processa chamadas que **realmente vêm do Azure DevOps**.

**Como fazer (ideia):**
- No Service Hook do Azure, ao configurar a URL, você pode colocar um parâmetro secreto na query string, por exemplo:  
  `https://seu-servidor.com/webhook/azuro?secret=uma-senha-escolhida-por-voce`
- No seu código, ao receber o POST, você lê esse `secret` da URL e compara com um valor que só o seu backend conhece (variável de ambiente). Se for diferente, você responde 401 e **não processa**.
- Assim, só quem sabe o segredo (no caso, só a configuração do Service Hook no Azure) consegue “acertar” a URL. Não é à prova de tudo, mas evita que qualquer um na internet dispare a sua lógica.

**Resumo:** “Validar origem” = só aceitar o POST se vier com o segredo certo (ex.: na URL ou em um header), para não processar chamadas falsas.

---

### 2. Tratar erros da API do Jira (retry, log)

**O que é:** Seu código chama a API do Jira (comentar, mudar status). Às vezes essa chamada **falha** (Jira fora do ar, limite de requisições, token inválido, etc.). “Tratar erros” é não deixar isso passar em branco e, quando fizer sentido, tentar de novo ou registrar o que aconteceu.

- **Log:** Quando der erro na chamada ao Jira, registrar em log (arquivo, Sentry, etc.) com a mensagem de erro e, se possível, o payload do webhook (ou pelo menos a chave do Jira e o evento). Assim você consegue debugar e ver quantas vezes o Jira falhou.
- **Retry:** Se a falha for temporária (ex.: timeout, 503), fazer **algumas tentativas** (ex.: 2 ou 3) com um pequeno intervalo antes de desistir. Só faz retry em erros que fazem sentido tentar de novo (não adianta retentar em 401/403).

**Resumo:** “Tratar erros” = logar as falhas e, quando for adequado, fazer retry nas chamadas ao Jira para não perder eventos por instabilidade momentânea.

---

### 3. Buscar o título da PR via Azure DevOps API quando o evento for só de build

**O que é:** No evento **build.complete**, o payload do Azure costuma trazer dados da **build** (branch, horários, resultado), mas **não** o título da PR. Se a chave do Jira estiver só no **título da PR** e não no nome da branch, você não consegue extrair a chave só com o payload do build.

**Solução (quando precisar):** Nesse caso, seu backend pode **chamar a API do Azure DevOps** para obter a PR associada àquela build (por exemplo pela branch ou pelo build ID) e então ler o **título da PR**. Com o título em mãos, você usa o mesmo regex de sempre para extrair a chave (ex.: `[BEESEDI-12345]`) e comenta ou muda status no Jira.

**Quando fazer:** Só vale a pena se você **não** estiver usando o nome da branch para extrair a chave (ex.: `feature/BEESEDI-12345-desc`). Se a convenção for “chave sempre na branch”, o payload do build já traz `sourceBranch` e você não precisa buscar o título da PR na API do Azure.

**Resumo:** “Buscar o título da PR via Azure DevOps API” = quando o evento for só de build e a chave Jira estiver no título da PR (e não na branch), fazer uma chamada extra à API do Azure para pegar o título da PR e daí extrair a chave.
