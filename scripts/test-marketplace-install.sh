#!/usr/bin/env bash
# Smoke-test that LGTM works as a fresh marketplace install.
#
# Mimics the install path Claude Code uses (~/.claude/plugins/cache/...) inside
# a clean Docker container, runs the SessionStart hook, and verifies that:
#   - the server boots (validates ESM resolution, native binding rebuild)
#   - GET / serves index.html (Bug 2 from #1)
#   - static assets serve under .claude/ paths (Bug 3 from #1)
#   - SPA fallback serves index.html for registered slugs (Bug 3 from #1)
#
# Run from repo root: ./scripts/test-marketplace-install.sh
set -e
docker run --rm -i -v "$(pwd):/src:ro" node:24-bookworm bash -s <<'INNER'
set -euo pipefail
apt-get update -qq && apt-get install -y -qq curl lsof git python3 rsync >/dev/null
git config --global user.email test@example.com
git config --global user.name test

PLUGIN_ROOT=/root/.claude/plugins/cache/local-test/lgtm/0.1.1
PLUGIN_DATA=/root/.claude/plugins/data/lgtm
mkdir -p "$PLUGIN_ROOT" "$PLUGIN_DATA"

# rsync the working tree, mimicking what marketplace install would receive.
# Iterating on uncommitted hook/server changes is the whole point.
rsync -a --exclude=node_modules --exclude=.git --exclude='images/Screenshot*' \
      /src/ "$PLUGIN_ROOT/"
cd "$PLUGIN_ROOT"

echo "=== installed files ==="
ls dist/server/ frontend/dist/ frontend/dist/assets/

echo "=== running SessionStart hook ==="
export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" CLAUDE_PLUGIN_DATA="$PLUGIN_DATA"
bash hooks/ensure-server.sh
sleep 3

echo "=== server up? ==="
lsof -ti:9900 >/dev/null || { echo "FAIL: not listening"; cat "$PLUGIN_DATA/server.log"; exit 1; }
echo "PID=$(lsof -ti:9900)"

echo "=== GET / serves index.html through .claude/ path ==="
code=$(curl -s -o /tmp/body -w "%{http_code}" http://127.0.0.1:9900/)
[ "$code" = "200" ] || { echo "FAIL: $code"; head -5 /tmp/body; exit 1; }
grep -q 'script' /tmp/body && echo "OK"

echo "=== static asset under .claude/ path ==="
asset=$(ls frontend/dist/assets/ | head -1)
code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:9900/assets/$asset")
[ "$code" = "200" ] || { echo "FAIL: $code on /assets/$asset"; exit 1; }
echo "OK: /assets/$asset"

echo "=== SPA fallback (sendFile through .claude/ path) ==="
mkdir -p /tmp/fake-repo && cd /tmp/fake-repo && git init -q && git commit -q --allow-empty -m init
slug=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"repoPath":"/tmp/fake-repo"}' http://127.0.0.1:9900/projects \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["slug"])')
code=$(curl -s -o /tmp/body -w "%{http_code}" "http://127.0.0.1:9900/project/$slug/")
[ "$code" = "200" ] || { echo "FAIL: $code on /project/$slug/"; head -5 /tmp/body; exit 1; }
grep -q 'script' /tmp/body && echo "OK"

echo "=== server.log tail ==="
tail -20 "$PLUGIN_DATA/server.log" || true

echo
echo "ALL CHECKS PASSED"
INNER
