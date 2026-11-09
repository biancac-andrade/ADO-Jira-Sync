# Arquivo legado

Estas pastas são **versões anteriores** do mesmo projeto, mantidas só como referência histórica. **Não use para deploy.**

| Pasta | O que era |
|-------|-----------|
| `webhook-automation-two-modes` | POC com **Express** (teste local + túnel) e Function em **JavaScript** embutida; documentação extensa de estudo. |
| `webhook-azure-function-version-1` | Primeira Function em **TypeScript** “enxuta”: PR → um status + comentários de pipeline (início e fim). |
| `webhook-function-version-2` | Cópia de trabalho da v1 com serviço **`workflow`** (fluxo completo). O código ativo foi **promovido para a raiz** do repositório. |

Para desenvolvimento e produção, use apenas a raiz do projeto **ADO Jira Sync** (`azure-devops-jira-sync`): `src/`, `package.json`, `docs/`.

O monorepo antigo costumava chamar-se `webhook-automation`.

Pode apagar `archive/` quando não precisar mais comparar com versões antigas.

Cronologia com datas: [../docs/HISTORY.md](../docs/HISTORY.md).
