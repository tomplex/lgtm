---
name: lgtm
description: >
  Use when the user asks to register a project for review, start a code review,
  open LGTM, analyze changes, or mentions LGTM. Also use when the user says
  they're done with a task and explicitly asks for a review.
allowed-tools: "mcp__lgtm__claim_reviews,mcp__lgtm__add_document,mcp__lgtm__comment,mcp__lgtm__read_feedback,mcp__lgtm__stop,mcp__plugin_lgtm_lgtm__claim_reviews,mcp__plugin_lgtm_lgtm__add_document,mcp__plugin_lgtm_lgtm__comment,mcp__plugin_lgtm_lgtm__read_feedback,mcp__plugin_lgtm_lgtm__stop,Skill(lgtm:analyze)"
---

# LGTM

LGTM is a web-based code review UI running at http://localhost:9900. It serves a diff
viewer with inline commenting, document review tabs, and AI-powered analysis. The server
is always running — you don't need to start it.

## Workflow

### 1. Claim the review session

Call the `claim_reviews` MCP tool with the repo path. This registers the project
(if not already registered), claims diff-review notifications for this Claude
session, and returns the browser URL. You can optionally pass a `description`
(shown as a banner) or `baseBranch` override.

`claim_reviews` is idempotent and safe to call repeatedly. Other tools
(`comment`, `add_document`, `read_feedback`) auto-register on their own — you
only need `claim_reviews` if you want to be notified when the user submits
feedback, or to set/update the description banner.

### 2. Work phase

While you're working on code, the user can watch diffs arrive in the browser in real
time. You don't need to do anything special — the UI polls for changes automatically.

You can add documents for review alongside the diff using the `add_document` tool.
This is useful for specs, design docs, or any markdown file the user should review.

You can also seed comments on the diff or documents using the `comment` tool. Use
this to flag things you want the reviewer to pay attention to, or to explain non-obvious
decisions.

### 3. Analysis phase

When the user asks for analysis (or when work is mostly done and you think analysis
would help), invoke the `lgtm:analyze` skill. This dispatches agents to classify every
file and produce a review strategy.

Don't run analysis proactively — wait for the user to ask, or suggest it when
appropriate ("Want me to run analysis to help guide the review?").

### 4. Review phase

The user reviews in the browser and clicks "Submit Review" to send feedback. Read
their feedback with the `read_feedback` tool. Address each comment, then let the user
know you've responded. They can submit multiple rounds.

## MCP Tools

| Tool | Purpose |
|------|---------|
| `claim_reviews` | Claim review notifications, set description, get URL — the typical entry point |
| `add_document` | Add a document tab (spec, design doc, markdown file) |
| `comment` | Seed inline comments on a diff or document |
| `read_feedback` | Read submitted review feedback |
| `stop` | Deregister a project |
| `set_analysis` | Submit analysis data (called by the analyze skill, not directly) |

## The /lgtm command

Users can type `/lgtm` to quickly register the current project. This is equivalent to
calling `claim_reviews` with the repo path.
