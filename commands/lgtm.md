---
name: lgtm
description: Register the current project with LGTM for code review
arguments:
  - name: description
    description: "Optional: review context shown as a banner in the UI"
    required: false
allowed-tools: "mcp__lgtm__start"
---

# /lgtm command

Register the current project with the LGTM review server.

1. Get the repo root: `git rev-parse --show-toplevel`
2. Call the `start` MCP tool with:
   - `repoPath`: the repo root
   - `description`: `$ARGUMENTS` (if provided)
3. Tell the user the review URL from the response.
