# Estrutura Azure DevOps: webhook por time e repositórios

Este documento explica como a automação Azure → Jira se comporta em uma empresa com vários times e vários repositórios, e se é necessário configurar webhook por repositório.

---

## 1. Estrutura típica no Azure DevOps

Em uma empresa grande, a hierarquia costuma ser:

| Nível | Nome no Azure DevOps | Contém |
|-------|----------------------|--------|
| **Organização** | Organization | Toda a conta (ex.: `minhaempresa.visualstudio.com` ou `dev.azure.com/minhaempresa`) |
| **Projeto** | **Project** | Repositórios, pipelines, boards, Service Hooks. É o “workspace” onde as subscriptions são criadas. |
| **Repositórios** | Repos | Vários repositórios dentro de um mesmo projeto |

Ou seja: **um Project pode ter vários repositórios**. O seu time pode ter 4 repositórios dentro de **um** Project (só do time) ou dentro de um Project **compartilhado** com outros times.

---

## 2. Onde o webhook é configurado: por projeto, não por repositório

Os **Service Hooks** no Azure DevOps são configurados no nível do **Project**, não por repositório.

- Você **não** configura um webhook para cada um dos 4 repositórios.
- Você configura **uma subscription** (por tipo de evento) no **Project**.
- Essa subscription envia **todos** os eventos daquele tipo que acontecem em **qualquer repositório** daquele projeto para a **mesma URL**.

Resumo:

- **Uma subscription** no Project → **uma URL** (ex.: sua Azure Function).
- **Todos os repositórios** desse projeto disparam para essa mesma URL quando o evento ocorre (ex.: PR updated, Run state changed).

---

## 3. Cenário A: automação só para o seu time (4 repositórios)

### 3.1 Se o seu time tem um Project só dele

- Os 4 repositórios do time estão em **um Project** separado (ex.: “Time-X” ou “Produto-Y”).
- Você (ou um Project Admin) vai em **Project Settings** desse projeto → **Service hooks** → **Create subscription**.
- Cria **uma** subscription para “Pull request updated” e **uma** para “Run state changed”, ambas apontando para a URL da sua Azure Function (ou servidor).
- **Nenhuma configuração por repositório**: os 4 repositórios passam a enviar eventos para a mesma URL automaticamente.

Resultado: só o seu time (esses 4 repos) dispara o webhook; outros times em outros Projects não são afetados.

### 3.2 Se o seu time divide o mesmo Project com outros times

- Existe **um** Project grande com vários repositórios (seu time com 4 + outros times com outros N).
- Ao criar a subscription no Project, **todos** os repositórios desse projeto passam a enviar eventos para a sua URL.
- Para aplicar a automação **só aos 4 repositórios do seu time**, você tem duas opções:

1. **Filtrar no código (recomendado)**  
   No backend (Azure Function ou servidor), ler o nome do repositório no payload (ex.: `resource.repository.name`) e processar apenas se estiver em uma lista permitida (variável de ambiente, ex.: `ALLOWED_REPOS=repo-a,repo-b,repo-c,repo-d`). Eventos de outros repos retornam 200 e são ignorados.

2. **Ter um Project só para o seu time**  
   Se a empresa permitir, criar um Project apenas com os 4 repositórios do time e configurar o webhook só nesse Project. Aí não precisa filtrar por repo.

---

## 4. Cenário B: automação para o “workspace” inteiro

- “Workspace” = um **Project** que contém todos os repositórios que você quer incluir.
- Você configura **uma vez** no Project: **Project Settings** → **Service hooks** → subscriptions para “Pull request updated” e “Run state changed” com a URL do webhook.
- **Todos** os repositórios desse projeto passam a disparar o webhook.
- O mesmo backend (Azure Function) atende a todos; a convenção (chave Jira no título da PR ou na branch) vale para todos os repos.

Não é necessário criar subscription por repositório: uma por evento no Project cobre todos os repos do projeto.

---

## 5. Respostas diretas às suas dúvidas

| Pergunta | Resposta |
|----------|----------|
| Preciso aplicar webhook em cada repositório? | **Não.** O webhook é configurado **por Project**. Todos os repositórios do projeto disparam para a mesma URL. |
| Como fica se eu quiser só para o meu time? | Se o time tem um **Project próprio**: configure o webhook só nesse Project. Se o time **compartilha** o Project: use filtro por nome de repositório no backend (lista permitida). |
| Como fica para o workspace todo? | Configure **uma** subscription por tipo de evento no **Project** que representa o “workspace”. Todos os repos desse projeto passam a usar a mesma automação. |

---

## 6. Onde está o repositório no payload

Para implementar o filtro “só meus repos” (Cenário A, projeto compartilhado), o payload do Azure DevOps inclui o repositório, por exemplo:

- **Pull request updated:** `payload.resource.repository.name` (e possivelmente `repository.id`).
- **Run state changed:** o `resource` da pipeline costuma ter referência ao repositório (nome ou id) associado ao run.

No código da Azure Function você pode checar `resource.repository.name` (ou o campo equivalente no evento de pipeline) e comparar com uma lista configurável (ex.: variável de ambiente `ALLOWED_REPOS`).

---

## 7. Resumo visual

```
Organização (Azure DevOps)
└── Project "Time-X" (só seu time)
    ├── repo-1  ──┐
    ├── repo-2   │  Uma subscription no Project → uma URL
    ├── repo-3   │  → todos os 4 repos disparam para a mesma URL.
    └── repo-4  ──┘  Não configura webhook por repo.

OU

Organização
└── Project "Produto-Grande" (vários times)
    ├── repo-time-A (4 repos)  ──┐
    ├── repo-time-B (3 repos)   │  Uma subscription no Project
    ├── repo-time-C (2 repos)   │  → todos disparam para a mesma URL.
    └── ...                     │  Para só o seu time: filtrar por repo no backend.
                                └─ (ex.: ALLOWED_REPOS=repo-time-A,repo-1,repo-2,repo-3,repo-4)
```

Em resumo: **uma configuração de webhook no Project cobre todos os repositórios desse projeto**; para restringir ao seu time, use um Project exclusivo ou filtro por repositório no código.
