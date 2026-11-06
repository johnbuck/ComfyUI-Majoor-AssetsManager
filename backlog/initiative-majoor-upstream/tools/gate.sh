#!/bin/sh
# usage: gate.sh <worktree>
# Full quality gate inside node:24-bookworm (never node on the host), as the invoking user so
# caches/temp dirs in the worktree stay user-owned.
# Known-red on upstream main 599b47df, handled explicitly:
#   pip-audit -> Pillow 12.x CVEs (requirements pin <13): run, but reported separately, non-blocking.
#   Prettier  -> 237 files fail on main. Changed UI files must not get MORE prettier drift than their
#                merge-base version had (new files must be fully clean).
WT="$1"; shift
GITDIR="$(git -C "$WT" rev-parse --git-common-dir)"
VOL="majoor-nm-u-$(basename "$WT")"
docker run --rm -v "$VOL":/nm alpine chown "$(id -u):$(id -g)" /nm >/dev/null
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
  -v "$WT":/work -v "$GITDIR":"$GITDIR" -v "$VOL":/work/node_modules majoor-gate:local sh -c '
set -e
# pytest scratch from a previous run holds deliberate BOM fixtures that the BOM check would flag
rm -rf tests/__pytest_tmp__
npm ci --no-audit --no-fund >/dev/null 2>&1
python scripts/run_quality_gate.py --skip-pip-audit --skip-js-lint "$@"
echo "==> ESLint"; npm run -s lint:js
# Match upstream CI, which our first gate missed: tsc on app + tests, and mypy on changed Python
# files including tests (the repo-wide mypy config does not cover tests).
echo "==> tsc (app)"; npx tsc -p tsconfig.json --noEmit --pretty false
echo "==> tsc (tests)"; npx tsc -p tsconfig.test.json --noEmit --pretty false
PYBASE=$(git merge-base HEAD refs/remotes/upstream/main)
CHANGED_PY=$(git diff --name-only --diff-filter=ACMR "$PYBASE" -- "*.py" || true)
echo "==> mypy (changed files): ${CHANGED_PY:-none}"
[ -z "$CHANGED_PY" ] || python -m mypy --config-file mypy.ini $CHANGED_PY
BASE=$(git merge-base HEAD refs/remotes/upstream/main)
CHANGED=$(git diff --name-only --diff-filter=ACMR "$BASE" -- "ui/*.ts" "ui/*.js" "ui/*.mjs" "ui/*.vue" | grep -v "^ui/vue/majoor-ui" || true)
echo "==> Prettier drift (changed files vs merge-base): ${CHANGED:-none}"
drift() { npx prettier --stdin-filepath "$1" < "$2" | diff - "$2" | grep -c "^[<>]" || true; }
FAIL=0
for f in $CHANGED; do
  head_d=$(drift "$f" "$f")
  if git cat-file -e "$BASE:$f" 2>/dev/null; then
    git show "$BASE:$f" > /tmp/base_file; base_d=$(drift "$f" /tmp/base_file)
  else base_d=0; fi
  echo "  $f: drift head=$head_d base=$base_d"
  [ "$head_d" -le "$base_d" ] || FAIL=1
  [ "$head_d" -ge "$base_d" ] || echo "  WARNING: $f drift dropped — check for reformatted pre-existing lines"
done
[ "$FAIL" = 0 ] || { echo "Prettier: changed files gained drift"; exit 1; }
echo "==> pip-audit (informational; red on main)"; python -m pip_audit --strict --skip-editable -r requirements.txt >/dev/null 2>&1 && echo pip-audit clean || echo pip-audit: known Pillow CVEs
echo GATE-GREEN
' gate "$@"
