#!/bin/sh
# usage: node.sh <worktree> <command...>
# Runs a node/npm command inside node:24-bookworm as the invoking user (never node on the host).
# Example: node.sh "$PWD" npx vitest run ui/tests/grid_bulk_delete.vitest.ts
#          node.sh "$PWD" npm run build
WT="$1"; shift
GITDIR="$(git -C "$WT" rev-parse --git-common-dir)"
VOL="majoor-nm-u-$(basename "$WT")"
docker run --rm -v "$VOL":/nm alpine chown "$(id -u):$(id -g)" /nm >/dev/null
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$WT":/work -v "$GITDIR":"$GITDIR" -v "$VOL":/work/node_modules -w /work majoor-gate:local \
  sh -c '[ -x node_modules/.bin/vite ] || npm ci --no-audit --no-fund >/dev/null 2>&1; exec "$@"' node "$@"
