---
name: lgtm
description: Register the current project with LGTM for code review
arguments:
  - name: description
    description: "Optional: review context shown as a banner in the UI"
    required: false
allowed-tools: "mcp__lgtm__claim_reviews,mcp__plugin_lgtm_lgtm__claim_reviews"
---

# /lgtm command

Register the current project with the LGTM review server and claim review-feedback notifications for this Claude session.

1. Get the repo root: `git rev-parse --show-toplevel`
2. Call the `claim_reviews` MCP tool with:
   - `repoPath`: the repo root
   - `description`: `$ARGUMENTS` (if provided)
3. Tell the user the review URL from the response.

`claim_reviews` auto-registers the project if it isn't already, so this is idempotent. Calling it again from a new Claude session re-claims notifications without losing existing comments or analysis.
