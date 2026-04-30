#!/usr/bin/env bash
# Start the LGTM server if nothing is listening on port 9900.
# During development, npm run dev:all occupies the port — this is a no-op.
LOCKFILE="/tmp/lgtm-server-starting.lock"

# Already running? Done.
lsof -ti:9900 >/dev/null 2>&1 && exit 0

# Atomic lock: mkdir is atomic on POSIX — only one process wins the race.
if ! mkdir "$LOCKFILE" 2>/dev/null; then
  # Another hook instance is already spawning the server. Wait for it.
  sleep 2
  exit 0
fi
trap 'rm -rf "$LOCKFILE"' EXIT

# Re-check after acquiring lock (another instance may have started between
# the first lsof check and acquiring the lock).
lsof -ti:9900 >/dev/null 2>&1 && exit 0

# Install production deps on first run (or when package.json changes).
# Uses CLAUDE_PLUGIN_DATA for persistent storage across sessions.
# `--ignore-scripts` blocks better-sqlite3's prebuild-install, so rebuild it
# explicitly to fetch (or compile) the native binding.
if [ -n "${CLAUDE_PLUGIN_DATA}" ]; then
  INSTALL_LOG="${CLAUDE_PLUGIN_DATA}/install.log"
  if ! diff -q "${CLAUDE_PLUGIN_ROOT}/package.json" "${CLAUDE_PLUGIN_DATA}/package.json" >/dev/null 2>&1; then
    cp "${CLAUDE_PLUGIN_ROOT}/package.json" "${CLAUDE_PLUGIN_DATA}/package.json"
    if ! (cd "${CLAUDE_PLUGIN_DATA}" \
          && npm install --production --ignore-scripts \
          && npm rebuild better-sqlite3) >"${INSTALL_LOG}" 2>&1; then
      rm -f "${CLAUDE_PLUGIN_DATA}/package.json"
      echo "Warning: LGTM dependency install failed. See ${INSTALL_LOG}" >&2
      exit 0
    fi
  fi
  export NODE_PATH="${CLAUDE_PLUGIN_DATA}/node_modules"
fi

# Fall back to plugin root node_modules (local dev)
if [ -z "${NODE_PATH}" ] && [ -d "${CLAUDE_PLUGIN_ROOT}/node_modules" ]; then
  export NODE_PATH="${CLAUDE_PLUGIN_ROOT}/node_modules"
fi

SERVER_LOG="${CLAUDE_PLUGIN_DATA:-/tmp}/server.log"
nohup node "${CLAUDE_PLUGIN_ROOT}/dist/server/server.js" --port 9900 >>"${SERVER_LOG}" 2>&1 &
sleep 1
lsof -ti:9900 >/dev/null 2>&1 || echo "Warning: LGTM server failed to start on port 9900. See ${SERVER_LOG}" >&2
