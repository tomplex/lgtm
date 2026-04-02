# Comprehensive Server Tests

## Background

The LGTM server has 29 existing tests across three modules (CommentStore, comment migration, parse-analysis). The rest of the server - Express routes, Session class, SessionManager, git-ops and the SQLite store - has zero test coverage. These are the modules where the actual business logic lives.

The server was recently refactored (unified comment model, new persistence layer), so this is a good time to lock in behavior with tests before adding more features.

## Goal

Comprehensive test coverage for all server modules. Tests should use real dependencies (real git repos, real SQLite) rather than mocks, so they catch integration issues.

## Approach

**Real dependencies, no mocks.** Tests create temp git repos and temp SQLite databases. This is slower than mocking but catches the class of bug that matters most in a tool like this - where the git output doesn't match what the parser expects, or the serialization round-trip loses data.

**One test infrastructure change required:** `store.ts` currently hardcodes the DB path to `~/.lgtm/data.db`. Tests need to point at a temp database. The fix: accept an optional path parameter in an init function, or use an env var. The env var approach (`LGTM_DB_PATH`) is simpler and doesn't change any function signatures.

## Test infrastructure

### Shared git fixture

A `beforeAll` hook that creates a temp directory with a real git repo:

- `git init`, configure user.name/email
- Create `main` branch with a few files (e.g., `src/app.ts`, `README.md`, `package.json`)
- A couple of commits on main
- Create `feature` branch with modifications (additions, deletions, edits)
- A couple of commits on feature, leave branch checked out

This gives tests a known diff state they can assert against. All git-ops and Session tests share this fixture. `afterAll` cleans up the temp dir.

### Temp SQLite database

Set `LGTM_DB_PATH` env var before importing store functions. Each test file (or test suite) gets its own temp DB file so tests don't interfere. `afterAll` removes the file.

### supertest for routes

`supertest` wraps the Express app for HTTP-level integration tests. No real server process needed - supertest calls the app directly.

## What to test

### store.ts

Prerequisite: refactor to support `LGTM_DB_PATH` env var.

- `storePut` + `storeGet` round-trip
- `storePut` upserts (overwrites existing)
- `storeGet` returns null for missing slug
- `storeDelete` removes entry, subsequent get returns null
- `storeList` returns all entries
- JSON integrity (blob out matches blob in)

### git-ops.ts

Uses the shared git fixture.

- `detectBaseBranch` returns 'main' when main branch exists
- `gitRun` returns stdout, throws on bad repo path
- `getBranchDiff` returns unified diff with expected additions/deletions
- `getSelectedCommitsDiff` returns diff for specific commit SHAs
- `getBranchCommits` parses log into `{ sha, message, author, date }[]` with correct count
- `getFileLines` reads context lines (up and down) from a given line number
- `getRepoMeta` returns branch name, base branch, repo name

### Session

Uses the shared git fixture + temp DB.

- **Comments:** add returns comment with ID, update changes text/status, delete removes, list with filters (by item, author, file, status)
- **Items:** add item, list includes it, remove item, prevent removing 'diff'
- **Data:** `getItemData('diff')` returns diff string and repo meta, `getItemData` for document item returns file content
- **User state:** toggleReviewed flips state, setSidebarView persists
- **Submit:** submitReview writes markdown to output file, increments round, writes signal file
- **Persistence:** persist() then fromBlob(storeGet(slug)) reconstructs comments, items, user state
- **SSE:** subscribe a mock writable, broadcast delivers event string

### SessionManager

Uses temp DB.

- `register` creates session, returns it with a slug
- Second `register` with same repo returns existing session (deduplication)
- `get` by slug returns session
- `findByRepoPath` reverse lookup works
- `list` returns all registered sessions
- `deregister` removes session, get returns undefined, store entry deleted
- Slug collision: register two repos with the same directory name, get distinct slugs
- Restoration: register sessions, create new manager instance, sessions are restored from store

### Express routes (app.ts)

Uses supertest with a real SessionManager, temp DB and git fixture.

- `POST /projects` with repoPath returns 200 with slug
- `GET /projects` lists registered projects
- `DELETE /projects/:slug` removes project
- `GET /project/:slug/data?item=diff` returns `{ mode: 'diff', diff, meta, comments }`
- `GET /project/:slug/commits` returns commit array
- `POST /project/:slug/comments` creates comment, returns it
- `GET /project/:slug/comments` lists comments, supports filter params
- `PATCH /project/:slug/comments/:id` updates comment
- `DELETE /project/:slug/comments/:id` removes comment
- `POST /project/:slug/submit` returns round number
- `GET /project/:slug/user-state` returns reviewed files and sidebar view
- `PUT /project/:slug/user-state/reviewed` toggles file
- Error cases: GET on missing slug returns 404, POST comments without required fields returns 400

## What we're not testing

- **MCP tools** - thin wrappers around SessionManager, hard to test without MCP client. The route tests cover the same logic.
- **SSE streaming end-to-end** - verifying the EventSource protocol is awkward with supertest. We test Session.broadcast directly instead.
- **Git watcher polling** - timing-dependent, low value. The watcher is simple mtime-check code.

## Dependencies

- `supertest` (new devDependency)
- No other new deps. vitest is already installed.
