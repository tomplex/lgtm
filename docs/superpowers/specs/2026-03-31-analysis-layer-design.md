# Analysis Layer for Large PR Review

## Background

LGTM currently treats every file in a diff identically - flat sidebar, same visual weight, no guidance on where to focus. This works fine for small PRs but breaks down on large changesets (thousands of lines, dozens of files). The core problem isn't reading individual diffs - it's knowing where to spend attention.

When working with Claude on a large feature branch over weeks, the reviewer (me) already understands the big picture. The pain is in the details: 80 files where 5 need careful reading, 15 need a skim and 60 are mechanical. The tool should help me triage efficiently so I can rebuild deep understanding of the parts that matter, without burning time on the parts that don't.

## Problem

Three specific pain points for large PRs:

1. **Orientation** - "where do I even start?" The flat file list gives no signal about which files matter.
2. **Prioritization** - trivial renaming and mechanical call-site updates get the same visual weight as core new logic.
3. **Detail overload** - I understand the architecture but get bogged down in the volume of small changes. I need summaries to set expectations before I read each file.

## Solution

An **analysis layer** that Claude generates before the review starts. Claude analyzes the full diff and produces structured metadata: per-file priority/phase/summary, thematic file groupings, and an overall PR summary with suggested review strategy. The review UI consumes this metadata to offer smarter navigation.

This spec covers the **consumption side** only - the data model, API contract, and UI rendering. How the analysis gets generated (prompt engineering, chunking, sub-agents) is a separate concern with a separate spec. The interface between generation and consumption is the `POST /analysis` JSON contract defined below.

### Design principles

- **Progressive enhancement.** Everything works without analysis data. The flat sidebar, diff view, commenting - all unchanged. Analysis enriches the experience when present but is never required.
- **No diff-view changes.** The value is in getting you to the right file with the right expectations. The actual diff rendering, commenting, context expansion, whole-file view - all untouched.
- **View modes, not modes.** Flat, grouped, and phased views are different lenses on the same file list. Switch freely, no state loss.

## API Contract

### `POST /analysis`

Claude pushes analysis results to the session. Calling this again replaces the previous analysis entirely (no merging).

**Request body:**

```json
{
  "overview": "This PR adds JWT-based auth middleware with role-based permissions. Key design decision: permissions are checked at the middleware layer rather than per-handler, using a declarative route config. Risk areas: token refresh logic in token.ts, and the migration adds a unique constraint that could fail on existing data.",
  "reviewStrategy": "Start with the 3 core auth files (middleware.ts, permissions.ts, token.ts) - these are the heart of the change. Then review the migration. The 38 handler files are mechanical (adding an auth context parameter) and can be batch-skimmed.",
  "files": {
    "auth/middleware.ts": {
      "priority": "critical",
      "phase": "review",
      "summary": "New auth middleware - validates JWT, extracts user context, attaches to request",
      "category": "core logic"
    },
    "auth/permissions.ts": {
      "priority": "critical",
      "phase": "review",
      "summary": "Role-based permission checks, resource-level ACLs with declarative route config",
      "category": "core logic"
    },
    "auth/token.ts": {
      "priority": "important",
      "phase": "review",
      "summary": "JWT creation and refresh logic - refresh window timing is subtle",
      "category": "core logic"
    },
    "db/migrations/024_auth.sql": {
      "priority": "important",
      "phase": "review",
      "summary": "Adds users, roles, permissions tables with unique constraint on email",
      "category": "migration"
    },
    "handlers/users.ts": {
      "priority": "low",
      "phase": "rubber-stamp",
      "summary": "Adds auth context parameter - mechanical",
      "category": "call-site update"
    }
  },
  "groups": [
    {
      "name": "Auth middleware (new)",
      "description": "Core authentication and authorization logic",
      "files": ["auth/middleware.ts", "auth/permissions.ts", "auth/token.ts"]
    },
    {
      "name": "Database migration",
      "files": ["db/migrations/024_auth.sql"]
    },
    {
      "name": "Call-site updates",
      "description": "Mechanical - adds auth context parameter to existing handlers",
      "files": ["handlers/users.ts", "handlers/posts.ts"]
    }
  ]
}
```

**Field definitions:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `overview` | string | yes | 1-3 sentence PR summary: what it does, key decisions, risk areas |
| `reviewStrategy` | string | yes | Suggested review order and approach |
| `files` | object | yes | Keyed by file path (matching diff paths). Files in the diff but absent from this object get no enrichment - they render normally |
| `files[].priority` | `"critical"` \| `"important"` \| `"normal"` \| `"low"` | yes | Drives sort order in flat view and colored priority indicators |
| `files[].phase` | `"review"` \| `"skim"` \| `"rubber-stamp"` | yes | Drives phased view tiers |
| `files[].summary` | string | yes | 1-2 sentence description of what changed and why it matters |
| `files[].category` | string | yes | Short label (freeform): "core logic", "test", "migration", "config", "call-site update", etc. |
| `groups` | array | yes | Ordered by review importance (first = most important). Each file appears in at most one group. Files not in any group appear in an "Other" group in grouped view |
| `groups[].name` | string | yes | Display name for the group |
| `groups[].description` | string | no | Optional subtitle shown on the group header |
| `groups[].files` | string[] | yes | File paths belonging to this group |

**Response:** `{"ok": true}`

### `GET /analysis`

Returns the stored analysis, or `{"analysis": null}` if none exists.

**Response (when present):** `{"analysis": { ...same shape as POST body... }}`

## UI Changes

### Sidebar view toggle

A segmented control at the top of the sidebar with three options: **Flat**, **Grouped**, **Phased**. Only rendered when analysis data exists. When no analysis, the sidebar looks exactly like it does today.

The last-used view mode persists in localStorage (same pattern as the existing state persistence).

### Flat view (enhanced)

The current file list, with these additions when analysis exists:

- **Priority indicator**: colored left border on each file item. Red = critical, orange = important, blue = normal, gray = low.
- **Summary subtitle**: the per-file summary rendered as a second line under the filename, in muted text.
- **Default sort**: priority order (critical first) instead of diff order. Within the same priority, files appear in diff order. Diff-order-only sort remains available.
- **Visual dimming**: low-priority files get reduced opacity (same treatment as the existing "reviewed" state).

Files without analysis data render exactly as they do today - no indicator, no summary, normal opacity.

### Grouped view

Files organized under collapsible group headers. Each group header shows:
- Group name
- File count
- Aggregate +/- line stats
- Optional description as subtitle

Groups are ordered as specified in the analysis (most important first). Files not assigned to any group appear in an auto-generated "Other" group at the bottom. Groups start expanded if any constituent file has priority "critical" or "important", collapsed otherwise.

Clicking a file opens the diff as usual. File search works across all groups.

### Phased view

Three fixed sections derived from per-file `phase` values:
- **Review carefully** (phase = `"review"`) - red accent
- **Skim** (phase = `"skim"`) - orange accent
- **Rubber stamp** (phase = `"rubber-stamp"`) - gray accent

Each section shows:
- File count and progress bar (reviewed / total, tied to the existing reviewed-file checkmarks)
- Expandable file list

Sections with no files are hidden. File search works across all sections.

### Overview banner

When analysis exists, a collapsible panel appears below the meta bar (above the diff). Contains:
- The `overview` text
- The `reviewStrategy` text, visually distinct (e.g., italicized or in a callout style)

Starts expanded on first load, collapsed state persists in localStorage. Collapsing it should feel natural - small toggle, not a big UI event.

### File header summary

The existing sticky `diff-file-header` gets a second line when a file has analysis data: the per-file summary in muted text, same style as the meta bar. No analysis = header looks exactly like today.

## Out of Scope

- **Analysis generation.** How Claude produces the analysis JSON (prompting strategy, chunking for large diffs, sub-agents) is a separate spec.
- **Inline Q&A.** Live Claude integration for asking questions during review. Deferred - the data model accommodates it later but we don't build it now.
- **Multi-group files.** Files appear in at most one group for v1. If this becomes a real pain point, a tagging model can replace it later.
- **SSE for analysis.** No live-update event when analysis arrives. It's expected to be set once before the review session opens. If the analysis is pushed after the page is open, a manual refresh picks it up (the `r` shortcut already exists).
