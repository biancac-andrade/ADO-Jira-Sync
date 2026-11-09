# Limitações e melhorias possíveis

## Limitações atuais (by design)

| Tema | Limitação |
|------|-----------|
| **Issue** | Só atua em issues já criadas; chave via regex no texto |
| **Estado** | Dedup em memória — reinício da Function “esquece” eventos recentes |
| **Workflow Jira** | Nomes de transição devem coincidir; um projeto Jira por configuração |
| **PR merge** | Evento `git.pullrequest.merged` não fecha o ciclo — fecha na pipeline na `main` |
| **Pipeline** | Um comentário ao **fim** (não comenta início; só ack + dedup) |
| **Escala** | Uma instância = cache local; múltiplas instâncias podem duplicar sem store externo |
| **Observabilidade** | Logs em texto; sem dashboard embutido |

## O que ainda dá para fazer **sem** mudar o desenho

- Afinar regex de branch final e lista `FINAL_PIPELINE_NAMES`.
- Ignorar revisores bots (`AZURE_DEVOPS_IGNORE_REVIEWER_IDS`).
- Desabilitar merge automático no Jira mantendo comentários de pipeline.
- Filtrar repos de outros times no mesmo projeto Azure (`ALLOWED_REPOS`).
- Expandir cobertura de testes com payloads reais salvos (samples).

## Melhorias de evolução (roadmap sugerido)

### Confiabilidade

- **Dedup / idempotência** em Redis, Table Storage ou Cosmos (compartilhado entre instâncias).
- **Dead-letter** ou fila (Service Bus) entre hook e processamento para picos e retry.
- **Retry configurável** no Jira (hoje parcial no serviço `jira.ts`).

### Produto

- Modo **simples** via env (`WORKFLOW_MODE=minimal`: só PR + comentários, como a v1 legada).
- **Health endpoint** dedicado (`GET /api/health`) testando Jira.
- Parser de chave configurável (regex por projeto).

### DevEx

- Servidor **Express** opcional em `tools/local-server` espelhando o handler (debug com túnel, sem Azurite).
- CLI `npm run simulate -- --event pr-updated --file payload.json`.
- Pipeline CI (GitHub Actions): `lint`, `test`, `build`.

### Integração

- Suporte a **múltiplos projetos Jira** (mapa repo Azure → project key).
- Sincronizar **build number** ou link da PR em campo customizado Jira.
- Webhook **assinado** (HMAC) além de secret estático.

### Operação

- Exportar eventos de pipeline para métricas (reaproveitar ideia do `events-store` do POC em `archive/`).
- Alertas quando transição falhar N vezes seguidas.

Priorize **dedup persistente** e **CI** se for usar em produção com vários desenvolvedores.
