#!/usr/bin/env bash
# Start the LGTM server if nothing is listening on port 9900.
# During development, npm run dev:all occupies the port — this is a no-op.
lsof -ti:9900 >/dev/null 2>&1 && exit 0
nohup node "${CLAUDE_PLUGIN_ROOT}/dist/server/server.js" --port 9900 >/dev/null 2>&1 &
