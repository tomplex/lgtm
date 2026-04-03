#!/usr/bin/env bash
# Start the LGTM server if nothing is listening on port 9900.
# During development, npm run dev:all occupies the port — this is a no-op.
lsof -ti:9900 >/dev/null 2>&1 && exit 0

# Install production deps on first run (or when package.json changes).
# Uses CLAUDE_PLUGIN_DATA for persistent storage across sessions.
if [ -n "${CLAUDE_PLUGIN_DATA}" ]; then
  if ! diff -q "${CLAUDE_PLUGIN_ROOT}/package.json" "${CLAUDE_PLUGIN_DATA}/package.json" >/dev/null 2>&1; then
    cp "${CLAUDE_PLUGIN_ROOT}/package.json" "${CLAUDE_PLUGIN_DATA}/package.json"
    (cd "${CLAUDE_PLUGIN_DATA}" && npm install --production --ignore-scripts >/dev/null 2>&1) || rm -f "${CLAUDE_PLUGIN_DATA}/package.json"
  fi
  export NODE_PATH="${CLAUDE_PLUGIN_DATA}/node_modules"
fi

# Fall back to plugin root node_modules (local dev)
if [ -z "${NODE_PATH}" ] && [ -d "${CLAUDE_PLUGIN_ROOT}/node_modules" ]; then
  export NODE_PATH="${CLAUDE_PLUGIN_ROOT}/node_modules"
fi

nohup node "${CLAUDE_PLUGIN_ROOT}/dist/server/server.js" --port 9900 >/dev/null 2>&1 &
sleep 1
lsof -ti:9900 >/dev/null 2>&1 || echo "Warning: LGTM server failed to start on port 9900" >&2
