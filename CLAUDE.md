# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev

**IMPORTANT:** Always run build/dev commands from the project root. `vite.config.ts` lives at the root with `root: 'frontend'` — running vite from `frontend/` skips the solid plugin and produces broken output.

```bash
npm run build              # Build server + frontend
npm run build:server       # TypeScript compile server/ → dist/server/
npm run build:frontend     # TypeScript compile + Vite build frontend/ → frontend/dist/
npm run dev:all            # Run server + frontend dev concurrently (port 9900)
npm run dev                # Server only (tsx watch)
npm run dev:frontend       # Frontend only (Vite HMR)
```

## Testing

```bash
npm test                       # Run all tests (frontend + server)
npm run test:server            # Server tests only
npm run test:frontend          # Frontend tests only
npm run test:server:watch      # Server watch mode
npm run test:frontend:watch    # Frontend watch mode
```

Server tests: `server/__tests__/*.test.ts` (~103 tests, vitest + supertest)
Frontend tests: `frontend/src/__tests__/*.test.ts` (~15 tests, vitest)

Run a single test file: `npx vitest run server/__tests__/routes.test.ts` (server) or `npx vitest run frontend/src/__tests__/diff.test.ts` (frontend — uses vite.config.ts automatically).

## Linting & Formatting

```bash
npm run lint               # ESLint server/ + frontend/src/
npm run format:check       # Prettier check
npm run format             # Prettier fix
```

## Architecture

This is a Claude Code plugin providing a browser-based code review UI. Claude posts comments via MCP tools, the user reviews in a web UI, and Claude reads the feedback.

**Server** (Express + MCP on port 9900):
- `server/server.ts` — entry point, CLI arg parsing
- `server/app.ts` — Express REST routes (project CRUD, diff, comments, SSE)
- `server/mcp.ts` — MCP tool definitions (start, comment, read_feedback, set_analysis, etc.)
- `server/session.ts` — Session class: owns items, comments, SSE clients per review session
- `server/session-manager.ts` — maps repo paths → Session objects by slug
- `server/store.ts` — SQLite persistence (~/.lgtm/data.db)
- `server/git-ops.ts` — shell-spawned git commands for diffs, commits, file content
- `server/symbol-lookup.ts` — ripgrep-based symbol definition lookup

**Frontend** (SolidJS + Vite):
- `frontend/src/state.ts` — all app state: SolidJS signals (replace wholesale) and stores (partial updates)
- `frontend/src/api.ts` — HTTP client, auto-prefixes `/project/:slug` from URL
- `frontend/src/App.tsx` — top-level layout, data loading, SSE connection, keyboard shortcuts
- `frontend/src/diff.ts` — unified diff parser → DiffLine[]
- `frontend/src/style.css` — all styles (CSS custom properties, no framework)
- Components: `diff/` (DiffView, DiffLine, PeekPanel, SymbolSearch), `sidebar/` (FileList, FileSearch), `comments/`, `header/`, `tabs/`, `document/`

**Data flow:** App mounts → fetchItems → user selects file → fetchItemData → parseDiff → render DiffLines. Comments stored in SolidJS store, synced via REST + SSE. Review submission formats comments to markdown → POST /submit.

**Plugin structure** (`.claude-plugin/`): hooks (SessionStart auto-starts server), skills (/lgtm, /lgtm analyze), agents (file-classifier, synthesizer), MCP config.

## Key Conventions

- **SolidJS, not React.** JSX compiles via vite-plugin-solid. Fragments (`<>`) work. State uses `createSignal`/`createStore`, not useState/useReducer.
- **Single-line git commit messages.** No multi-line bodies or heredocs.
- Server imports use `.js` extensions (NodeNext module resolution): `import { foo } from './bar.js'`
- Frontend CSS uses custom properties defined in `:root` in `style.css` (--bg, --text, --accent, --border, etc.)
- The `/symbol` endpoint and PeekPanel use ripgrep heuristics — no LSP or tree-sitter.
