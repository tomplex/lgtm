#!/usr/bin/env bash
# Verify that tracked build artifacts (dist/, frontend/dist/) match what the
# current source would produce. This repo ships as a Claude plugin, so the
# built files have to stay in sync with the source on `main`.
#
# On stale dist: leaves the freshly-rebuilt files in the working tree so the
# dev can commit them and re-push.

set -euo pipefail

echo "Building to check dist is in sync with source…"
npm run build >/dev/null

if ! git diff --quiet -- dist frontend/dist; then
  echo
  echo "✗ Build artifacts are out of sync with source." >&2
  echo "  The current build produced changes in:" >&2
  git diff --name-only -- dist frontend/dist | sed 's/^/    /' >&2
  echo
  echo "  Commit the rebuilt files and push again." >&2
  exit 1
fi

echo "✓ Build artifacts in sync."
