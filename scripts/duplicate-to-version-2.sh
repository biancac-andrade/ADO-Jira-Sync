#!/usr/bin/env bash
# Sincroniza o código da v1 (webhook-azure-function-version-1) para esta pasta v2.
# Motivo: se o projeto já se chama webhook-function-version-2, o destino antigo
# (../webhook-function-version-2) era a própria pasta — não copiava nada de fora.
#
# Uso (na raiz deste repo):
#   bash scripts/duplicate-to-version-2.sh
#
# Opcional: origem customizada
#   SOURCE=/caminho/para/v1 bash scripts/duplicate-to-version-2.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT="$(dirname "$ROOT")"
DEFAULT_V1="$PARENT/webhook-azure-function-version-1"

SOURCE="${SOURCE:-$DEFAULT_V1}"
DEST="$ROOT"

echo "Origem:  $SOURCE"
echo "Destino: $DEST"

if [[ ! -d "$SOURCE" ]]; then
  echo "Erro: pasta de origem não encontrada: $SOURCE"
  echo "Defina SOURCE=/caminho/correto ou crie o clone em: $DEFAULT_V1"
  exit 1
fi

if [[ "$SOURCE" -ef "$DEST" ]] || [[ "$(cd "$SOURCE" && pwd)" == "$(cd "$DEST" && pwd)" ]]; then
  echo "Erro: origem e destino são o mesmo diretório."
  exit 1
fi

rsync -a \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=.git \
  --exclude=coverage \
  --exclude=deploy.zip \
  --exclude=.azurite \
  --exclude='__azurite_db_*' \
  --exclude='__blobstorage__' \
  --exclude='__queuestorage__' \
  --exclude=local.settings.json \
  "$SOURCE/" "$DEST/"

if [[ -f "$DEST/package.json" ]]; then
  node -e "
    const fs = require('fs');
    const p = '$DEST/package.json';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.name = 'webhook-function-version-2';
    const tag = '(v2 — melhorias pós-apresentação).';
    if (!(j.description || '').includes('v2 — melhorias')) {
      j.description = ((j.description || '').trim() + ' ' + tag).trim();
    }
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  "
fi

if [[ -f "$DEST/README.md" ]] && ! grep -q '^## webhook-function-version-2$' "$DEST/README.md" 2>/dev/null; then
  NOTE=$'## webhook-function-version-2\n\nCópia de trabalho para **melhorias** após a apresentação. Código base sincronizado a partir de `webhook-azure-function-version-1`. Repositório Git: `git init` aqui se quiser histórico separado.\n\n---\n\n'
  printf '%s' "$NOTE" | cat - "$DEST/README.md" > "$DEST/README.md.tmp" && mv "$DEST/README.md.tmp" "$DEST/README.md"
fi

echo "Pronto. Próximos passos:"
echo "  cd \"$DEST\""
echo "  npm install"
echo "  cp local.settings.json.example local.settings.json   # se precisar"
echo "  git init   # opcional"
