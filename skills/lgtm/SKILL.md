---
name: lgtm
description: >
  Use when the user asks to register a project for review, start a code review,
  open LGTM, analyze changes, or mentions LGTM. Also use when you want to offer
  the user a review of completed work.
allowed-tools: "mcp__plugin_lgtm_lgtm__start,mcp__plugin_lgtm_lgtm__add_document,mcp__plugin_lgtm_lgtm__comment,mcp__plugin_lgtm_lgtm__read_feedback,mcp__plugin_lgtm_lgtm__stop,Skill(lgtm:analyze)"
---

# LGTM

LGTM is a web-based code review UI running at http://localhost:9900. It serves a diff
viewer with inline commenting, document review tabs, and AI-powered analysis. The server
is always running — you don't need to start it.

## Workflow

### 1. Register the project

Call the `start` MCP tool with the repo path. This registers the project with the
server and returns the browser URL. The user can optionally provide a description
(shown as a banner in the UI).

If the project is already registered, `start` is idempotent — it returns the existing
session info.

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
| `start` | Register a project — returns the browser URL |
| `add_document` | Add a document tab (spec, design doc, markdown file) |
| `comment` | Seed inline comments on a diff or document |
| `read_feedback` | Read submitted review feedback |
| `stop` | Deregister a project |
| `set_analysis` | Submit analysis data (called by the analyze skill, not directly) |

## The /lgtm command

Users can type `/lgtm` to quickly register the current project. This is equivalent to
calling `start` with the repo path.
