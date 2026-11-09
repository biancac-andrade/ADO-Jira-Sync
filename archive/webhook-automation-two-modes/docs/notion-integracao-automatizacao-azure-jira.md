# Integrações & Automação entre Azure e Jira

> [!NOTE]
> Documento para apoio à decisão e implementação: motivo, benefícios e guia técnico da integração Azure DevOps → Jira via webhooks.

---

## Por que usar essa tecnologia?

### O problema

Times que usam **Azure DevOps** para código e **Jira** para gestão de tarefas acabam fazendo atualizações manuais: copiar link da PR no Jira, mudar status quando a PR entra em revisão, anotar quando a pipeline rodou. Isso gera atraso, inconsistência e perda de visibilidade.

### A solução

Uma **integração automatizada** que:

- Recebe eventos do Azure DevOps (Pull request atualizada, Pipeline iniciada/finalizada) em tempo real.
- Atualiza o Jira automaticamente: **mudança de status** quando um revisor é adicionado à PR e **comentários** quando a pipeline inicia e termina (com horário em Brasília, resultado e link).
- Exige apenas uma **convenção**: a chave da issue no título da PR ou no nome da branch (ex.: `[BEESEDI-123]` ou `feature/BEESEDI-123-nome`).

### Benefícios para a empresa

| Benefício | Descrição |
|-----------|-----------|
| **Visibilidade em tempo real** | Gestão e produto veem na issue do Jira quando a PR entrou em revisão e quando a pipeline começou e terminou, sem perguntar ao time. |
| **Menos trabalho manual** | Ninguém precisa lembrar de mudar status no Jira ao abrir PR ou adicionar revisor. |
| **Rastreabilidade** | Cada issue fica ligada ao ciclo de vida real (PR, pipeline) por comentários e status. |
| **Base para métricas** | Eventos de pipeline podem ser persistidos para análise de duração, GAP entre runs e dashboards. |
| **Tecnologia padrão** | Azure DevOps Service Hooks + endpoint HTTPS (Azure Function ou servidor Node); sem ferramentas pagas extras. |

---

## O que a integração faz (resumo)

| Fluxo | Gatilho no Azure DevOps | Ação no Jira |
|-------|--------------------------|--------------|
| **Code Review** | Pull request updated (ex.: revisor adicionado) | Transição de status da issue para "Code Review" (ou o nome configurado). |
| **Pipeline em tempo real** | Run state changed (início e fim da execução) | Dois comentários na issue: "Pipeline iniciou em DD/MM HH:mm (Brasília)" e "Pipeline finalizou em DD/MM HH:mm – ✅ sucesso / ❌ falha" + link da run. |

A ligação **PR ↔ Issue** é por convenção: a chave da issue (ex.: `BEESEDI-123`) deve aparecer no **título da PR** ou no **nome da branch**.

---

## Pré-requisitos (visão geral)

- [ ] **Node.js** 18+ (para rodar o servidor ou a Azure Function).
- [ ] **Conta Jira Cloud** com permissão para comentar e transicionar issues.
- [ ] **Token de API do Jira** ([id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)).
- [ ] **URL HTTPS** acessível pelo Azure (em produção: Azure Function ou outro host; em teste local: túnel como Cloudflare Tunnel).
- [ ] **Azure DevOps**: projeto com Service Hooks habilitados (permissão de Edit subscriptions, em geral Project Administrators).

---

## Parte técnica: como instalar e configurar

### Opção A – Servidor local (Node.js + Express)

Para desenvolvimento e testes com túnel.

**1. Clonar e instalar**

```bash
git clone <url-do-repositorio>
cd webhook-automation-azure
npm install
```

**2. Variáveis de ambiente**

```bash
cp .env.example .env
```

Edite o `.env` com:

| Variável | Descrição |
|----------|-----------|
| `JIRA_BASE_URL` | URL base do Jira (sem barra final), ex.: `https://sua-empresa.atlassian.net` |
| `JIRA_USER_EMAIL` | E-mail da conta Jira |
| `JIRA_API_TOKEN` | Token de API do Jira |
| `JIRA_STATUS_CODE_REVIEW` | Nome **exato** do status no Jira para "em revisão", ex.: `Code Review` |

**3. Compilar e iniciar**

```bash
npm run build
npm start
```

O servidor sobe na porta 3000. Endpoint do webhook: `POST /webhook/azuro`.

**4. Expor para o Azure (teste local)**

Use um túnel HTTPS, por exemplo **Cloudflare Tunnel**:

```bash
cloudflared tunnel --url http://localhost:3000
```

Use a URL gerada + `/webhook/azuro` no Service Hook do Azure DevOps.

---

### Opção B – Azure Function (produção, recomendado)

Para uso contínuo sem manter servidor ligado. A URL fica fixa e o Azure escala sob demanda.

**1. Criar recursos no Azure**

- [ ] Criar **Function App** (Portal ou CLI), runtime **Node.js 18 ou 20**, modelo HTTP trigger.
- [ ] Criar **conta de Storage** no mesmo resource group (obrigatório para o host da Function).
- [ ] Configurar **Application settings** no Function App (ver abaixo).

**2. Configurações obrigatórias no Function App**

No Portal: **Function App** → **Configuration** → **Application settings**. Adicionar:

| Nome | Valor |
|------|--------|
| `AzureWebJobsStorage` | Connection string da conta de Storage |
| `FUNCTIONS_EXTENSION_VERSION` | `~4` |
| `FUNCTIONS_WORKER_RUNTIME` | `node` |
| `WEBSITE_NODE_DEFAULT_VERSION` | `~20` |
| `JIRA_BASE_URL` | URL base do Jira |
| `JIRA_USER_EMAIL` | E-mail Jira |
| `JIRA_API_TOKEN` | Token de API do Jira |
| `JIRA_STATUS_CODE_REVIEW` | Nome exato do status (ex.: `Code Review`) |

**3. Deploy da função**

Na pasta do projeto da Azure Function:

```bash
cd azure-function
zip -r deploy.zip . -x "*.git*" -x "node_modules/*" -x "*.env" -x "local.settings.json" -x "deploy.zip"
az functionapp deployment source config-zip --resource-group <resource-group> --name <nome-do-function-app> --src deploy.zip
```

A URL do webhook será algo como:  
`https://<nome-do-app>.azurewebsites.net/api/webhookAzuro`  
(em algumas regiões: `https://<nome>-<sufixo>.brazilsouth-01.azurewebsites.net/api/webhookAzuro`).

**4. Configurar o Azure DevOps Service Hooks**

- [ ] **Project settings** → **Service hooks** → **Create subscription**.
- [ ] **Service:** Web Hooks (Post via HTTP).
- [ ] **Trigger:** criar uma subscription para **Run state changed** (Pipelines) e outra para **Pull request updated**.
- [ ] **URL:** colar a URL da Azure Function (ex.: `https://.../api/webhookAzuro`).
- [ ] Salvar.

---

## Convenção no dia a dia

- [ ] No **Jira**: criar as issues no projeto (ex.: chave `BEESEDI-123`).
- [ ] No **Azure DevOps**: ao abrir uma PR, usar no **título** a chave (ex.: `[BEESEDI-123] Implementar login`) ou incluir a chave no **nome da branch** (ex.: `feature/BEESEDI-123-login`).
- [ ] O webhook extrai a chave com o padrão `SIGLA-NÚMERO` e associa o evento à issue correspondente.

---

## Validação e troubleshooting

| O que verificar | Onde / como |
|-----------------|-------------|
| Service Hook está disparando? | Azure DevOps → Service hooks → sua subscription → **Delivery history** (status 200 = ok). |
| Função está recebendo? | Portal Azure → Function App → **webhookAzuro** → **Monitor** ou **Log stream**. |
| Jira não atualiza status? | Conferir **Application settings** (JIRA_*). No Monitor da função, procurar logs `[jira]` (ex.: "Transição não encontrada" mostra o nome exato a usar). |
| Nome do status errado? | No Jira, abrir a issue → "Mudar status" e usar o **nome exato** da transição em `JIRA_STATUS_CODE_REVIEW`. |

---

## Documentação de referência do projeto

- **README (raiz):** visão geral, endpoints, eventos tratados, scripts.
- **azure-function/README.md:** deploy Azure Function, URL do webhook, configurações.
- **docs/estudo-descoberta-azure-service-hooks-jira.md:** contexto dos Service Hooks, eventos e permissões.
- **docs/testes-e-melhorias-webhook-azure-jira.md:** testes realizados, problemas e soluções, túneis.
- **docs/webhook-azuro-jira-codigo-node.md:** especificação técnica e exemplos de código.

---

## Resumo para apresentação à empresa

1. **Visibilidade em tempo real:** comentários na issue quando a pipeline inicia e quando termina, com horário em Brasília, resultado e link.
2. **Menos trabalho manual:** status da issue atualizado ao adicionar revisor na PR.
3. **Base para métricas:** eventos de pipeline podem ser persistidos para análise de duração e GAP.
4. **Robustez:** deduplicação de eventos, retry no Jira, validação opcional do webhook (secret), health check para ambientes cloud.
5. **Requisitos:** Node.js 18+, credenciais Jira (e opcionalmente Azure DevOps PAT), URL HTTPS (Azure Function ou servidor), convenção de chave no título da PR ou branch.
