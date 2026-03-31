# FastAPI Migration Design

## Goal

Replace the `http.server` + `ThreadingHTTPServer` backend with FastAPI + uvicorn. Same API contract, same frontend, cleaner concurrency model.

## Motivation

The current server hit its limits when we added SSE: `http.server` is single-threaded, so we needed `ThreadingHTTPServer`, manual queue-based SSE, and threading locks. FastAPI gives us async SSE, proper routing, automatic JSON parsing, and a concurrency model where these things just work.

## What Changes

### `server.py` — rewrite

Replace the `ReviewHandler` class and manual routing with a FastAPI app and decorated route handlers.

**Routes** (same endpoints and contracts as today):

- `GET /items` — list session items
- `GET /data?item=<id>&commits=<shas>` — item data (diff or document)
- `GET /context?file=<path>&line=<n>&count=<n>&direction=<dir>` — file context lines
- `GET /file?path=<path>` — full file content
- `GET /commits` — branch commit list
- `GET /events` — SSE stream via `EventSourceResponse`
- `POST /items` — add document to session
- `POST /comments` — add Claude comments
- `POST /submit` — submit review feedback
- `DELETE /comments?item=<id>&index=<n>` — delete Claude comment(s)

**Route handlers** are all `async def`. Blocking git operations called via `await asyncio.to_thread(...)`. Route handlers are thin: parse request, call a Session method or git_ops function, return result.

**Static files** served via Starlette's `StaticFiles` mounted at `/` with `html=True`. This must be mounted last so API routes take priority.

**Server startup**: `uvicorn.run(app, ...)` replaces `HTTPServer.serve_forever()`. CLI args via `argparse` stay the same. `webbrowser.open` called via a FastAPI startup event.

### `Session` class — encapsulate mutations

All state mutations move behind methods. No locks needed because all methods are synchronous (no `await` inside), so they're atomic on the single-threaded event loop. If a future change adds `await` inside a mutation method, that's the natural point to add an `asyncio.Lock`.

```python
class Session:
    # Queries
    def get_item_data(self, item_id, commits=None) -> dict

    # Mutations
    def add_item(self, id, title, path) -> dict
    def add_comments(self, item_id, comments) -> int  # returns count
    def delete_comment(self, item_id, index) -> None
    def clear_comments(self, item_id=None) -> None
    def submit_review(self, comments_text) -> int  # returns round number

    # SSE
    def subscribe(self) -> asyncio.Queue
    def unsubscribe(self, queue) -> None
    def broadcast(self, event, data) -> None  # put_nowait, non-blocking
```

SSE uses `asyncio.Queue` per client instead of `threading.Queue`. `broadcast` iterates clients and calls `put_nowait` (non-blocking, drops if full — same as current behavior). It's a regular method, not async.

### `pyproject.toml` — add dependencies

```
dependencies = [
    "fastapi",
    "uvicorn[standard]",
    "sse-starlette",
]
```

## What Doesn't Change

- `git_ops.py` — untouched, called via `asyncio.to_thread`
- All frontend code — untouched
- `frontend/vite.config.ts` — proxy config stays the same
- CLI arguments, port logic, output file handling — same behavior
- API contract — every endpoint, parameter, and response shape stays identical

## Key Design Decisions

**`asyncio.to_thread` for git ops (explicit):** Rather than relying on FastAPI's implicit thread pool for sync handlers, all git ops are explicitly wrapped in `asyncio.to_thread`. This makes the async boundary visible to the reader.

**Session methods instead of locks:** Mutations go through synchronous Session methods. Since they don't `await`, they're atomic on the event loop. This makes thread-safety a property of the design rather than an unwritten convention.

**`sse-starlette` for SSE:** Handles formatting, keepalives, and client disconnect detection. Worth the dependency since we expect to add more event types (git state changes, submit notifications).

**`StaticFiles` mounted last:** Starlette's `StaticFiles` is a catch-all mount. It goes after all API routes so `/items`, `/data`, etc. resolve to handlers, not file lookups.
