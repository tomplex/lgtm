# FastAPI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `http.server` backend with FastAPI + uvicorn, preserving the exact same API contract and frontend.

**Architecture:** Rewrite `server.py` with FastAPI route decorators, async handlers using `asyncio.to_thread` for blocking git ops, `sse-starlette` for SSE, and `StaticFiles` for serving the built frontend. Session mutations move behind methods (no locks needed on single-threaded event loop).

**Tech Stack:** FastAPI, uvicorn, sse-starlette, asyncio

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server.py` | Rewrite | FastAPI app, route handlers, Session class, CLI entry point |
| `git_ops.py` | Untouched | Git subprocess operations |
| `pyproject.toml` | Modify | Add fastapi, uvicorn, sse-starlette dependencies |

---

### Task 1: Add dependencies

**Files:**
- Modify: `pyproject.toml`

- [ ] **Step 1: Add FastAPI dependencies to pyproject.toml**

Change the `dependencies` line in `pyproject.toml` from:

```toml
dependencies = []
```

to:

```toml
dependencies = [
    "fastapi",
    "uvicorn[standard]",
    "sse-starlette",
]
```

- [ ] **Step 2: Install dependencies**

Run: `uv sync`
Expected: packages install successfully

- [ ] **Step 3: Verify imports work**

Run: `uv run python3 -c "import fastapi, uvicorn, sse_starlette; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "add fastapi, uvicorn, sse-starlette dependencies"
```

---

### Task 2: Rewrite Session class with mutation methods

**Files:**
- Modify: `server.py`

This task rewrites the Session class only. The ReviewHandler and main() still exist but won't be called — they get replaced in Task 3. This task produces a server.py that won't run yet (imports will be broken), but the Session class is complete and correct.

- [ ] **Step 1: Rewrite the Session class**

Replace everything in `server.py` from `class Session:` through the end of its `broadcast` method (lines 36-72) with:

```python
class Session:
    def __init__(self, repo_path: str, base_branch: str, description: str = '', output_path: str = ''):
        self.repo_path = repo_path
        self.base_branch = base_branch
        self.description = description
        self.output_path = output_path
        self._round = 0
        self._items: list[dict] = [{
            'id': 'diff',
            'type': 'diff',
            'title': 'Code Changes',
        }]
        self._claude_comments: dict[str, list[dict]] = {}
        self._sse_clients: list[asyncio.Queue] = []

    # --- Queries ---

    @property
    def items(self) -> list[dict]:
        return self._items

    def get_item_data(self, item_id: str, commits: str | None = None) -> dict:
        claude_comments = self._claude_comments.get(item_id, [])

        if item_id == 'diff':
            if commits:
                shas = [s.strip() for s in commits.split(',') if s.strip()]
                diff = get_selected_commits_diff(self.repo_path, shas)
            else:
                diff = get_branch_diff(self.repo_path, self.base_branch)
            return {
                'mode': 'diff',
                'diff': diff,
                'description': self.description,
                'meta': get_repo_meta(self.repo_path, self.base_branch),
                'claudeComments': claude_comments,
            }

        item = next((i for i in self._items if i['id'] == item_id), None)
        if not item:
            return {'mode': 'error', 'error': f'Item not found: {item_id}'}

        p = Path(item['path'])
        content = p.read_text() if p.exists() else ''
        is_markdown = p.name.endswith(('.md', '.mdx', '.markdown'))

        return {
            'mode': 'file',
            'content': content,
            'filename': p.name,
            'filepath': str(p),
            'markdown': is_markdown,
            'title': item.get('title', p.name),
            'claudeComments': claude_comments,
        }

    # --- Mutations ---

    def add_item(self, item_id: str, title: str, filepath: str) -> dict:
        existing = next((i for i in self._items if i['id'] == item_id), None)
        if existing:
            existing['path'] = os.path.abspath(filepath)
            existing['title'] = title
        else:
            self._items.append({
                'id': item_id,
                'type': 'document',
                'title': title,
                'path': os.path.abspath(filepath),
            })
        return {'ok': True, 'id': item_id, 'items': self._items}

    def add_comments(self, item_id: str, comments: list[dict]) -> int:
        if item_id not in self._claude_comments:
            self._claude_comments[item_id] = []
        self._claude_comments[item_id].extend(comments)
        return len(self._claude_comments[item_id])

    def delete_comment(self, item_id: str, index: int) -> None:
        items = self._claude_comments.get(item_id, [])
        if 0 <= index < len(items):
            items.pop(index)

    def clear_comments(self, item_id: str | None = None) -> None:
        if item_id:
            self._claude_comments.pop(item_id, None)
        else:
            self._claude_comments.clear()

    def submit_review(self, comments_text: str) -> int:
        self._round += 1
        current_round = self._round

        with open(self.output_path, 'a') as f:
            f.write(f"\n---\n# Review Round {current_round}\n\n")
            f.write(comments_text)
            f.write('\n')

        signal_path = self.output_path + '.signal'
        with open(signal_path, 'w') as f:
            f.write(str(current_round))

        return current_round

    # --- SSE ---

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self._sse_clients.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._sse_clients = [c for c in self._sse_clients if c is not q]

    def broadcast(self, event: str, data: dict) -> None:
        for q in self._sse_clients:
            try:
                q.put_nowait({'event': event, 'data': json.dumps(data)})
            except asyncio.QueueFull:
                pass
```

Note: `get_item_data` calls blocking git_ops functions directly. This is intentional — the route handler will call it via `asyncio.to_thread` so the blocking happens in a thread, not on the event loop.

- [ ] **Step 2: Add the asyncio import**

Add `import asyncio` to the imports at the top of `server.py` (it will be needed by Session and later by route handlers).

- [ ] **Step 3: Commit**

```bash
git add server.py
git commit -m "rewrite Session class with mutation methods and asyncio SSE"
```

---

### Task 3: Replace ReviewHandler with FastAPI routes and main()

**Files:**
- Modify: `server.py`

This task replaces the entire `ReviewHandler` class and `main()` function with a FastAPI app, async route handlers, and uvicorn startup. After this task, the server should be fully functional.

- [ ] **Step 1: Replace everything from `class ReviewHandler` through end of file**

Delete from `class ReviewHandler(http.server.BaseHTTPRequestHandler):` (line 75) through the end of the file. Replace with:

```python
app = FastAPI()
session: Session  # set in main() before uvicorn.run


# --- GET routes ---

@app.get('/items')
async def get_items():
    return {'items': session.items}


@app.get('/data')
async def get_data(item: str = 'diff', commits: str | None = None):
    return await asyncio.to_thread(session.get_item_data, item, commits)


@app.get('/context')
async def get_context(file: str = '', line: int = 0, count: int = 20, direction: str = 'down'):
    lines = await asyncio.to_thread(get_file_lines, session.repo_path, file, line, count, direction)
    return {'lines': lines}


@app.get('/file')
async def get_file(path: str = ''):
    full_path = Path(session.repo_path) / path
    if not full_path.exists():
        return {'lines': []}
    content = await asyncio.to_thread(full_path.read_text)
    lines = [{'num': i, 'content': line} for i, line in enumerate(content.splitlines(), 1)]
    return {'lines': lines}


@app.get('/commits')
async def get_commits():
    commits = await asyncio.to_thread(get_branch_commits, session.repo_path, session.base_branch)
    return {'commits': commits}


@app.get('/events')
async def get_events():
    q = session.subscribe()

    async def event_generator():
        try:
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=30)
                    yield msg
                except asyncio.TimeoutError:
                    yield {'event': 'keepalive', 'data': ''}
        except asyncio.CancelledError:
            pass
        finally:
            session.unsubscribe(q)

    return EventSourceResponse(event_generator())


# --- POST routes ---

@app.post('/items')
async def post_items(body: dict):
    filepath = body.get('path', '')
    title = body.get('title', '') or Path(filepath).stem
    item_id = body.get('id', '') or slugify(title)

    result = session.add_item(item_id, title, filepath)
    print(f"ITEM_ADDED={item_id}", flush=True)
    session.broadcast('items_changed', {'id': item_id})
    return result


@app.post('/comments')
async def post_comments(body: dict):
    item_id = body.get('item', 'diff')
    new_comments = body.get('comments', [])
    count = session.add_comments(item_id, new_comments)
    print(f"CLAUDE_COMMENTS_ADDED={len(new_comments)} item={item_id}", flush=True)
    session.broadcast('comments_changed', {'item': item_id, 'count': len(new_comments)})
    return {'ok': True, 'count': count}


@app.post('/submit')
async def post_submit(body: dict):
    comments_text = body.get('comments', '')
    current_round = session.submit_review(comments_text)
    print(f"REVIEW_ROUND={current_round}", flush=True)
    return {'ok': True, 'round': current_round}


# --- DELETE routes ---

@app.delete('/comments')
async def delete_comments(item: str = '', index: str = ''):
    if item and index:
        session.delete_comment(item, int(index))
    elif item:
        session.clear_comments(item)
    else:
        session.clear_comments()
    return {'ok': True}


# --- Static files (must be last) ---

DIST_DIR = Path(__file__).parent / 'frontend' / 'dist'
if DIST_DIR.exists():
    app.mount('/', StaticFiles(directory=str(DIST_DIR), html=True), name='static')


# --- CLI entry point ---

def stable_port_for_path(path: str) -> int:
    h = sum(ord(c) * (i + 1) for i, c in enumerate(path))
    return 9850 + (h % 100)


def main():
    global session

    parser = argparse.ArgumentParser(description='Claude Code Review Server')
    parser.add_argument('--repo', default='', help='Path to git repository')
    parser.add_argument('--base', default='', help='Base branch (default: auto-detect)')
    parser.add_argument('--commits', default='', help='Comma-separated commit SHAs')
    parser.add_argument('--description', default='', help='Review description banner')
    parser.add_argument('--output', default='', help='Output path (auto-generated if omitted)')
    parser.add_argument('--port', type=int, default=0, help='Port (0 = auto from path hash)')
    args = parser.parse_args()

    repo_path = args.repo or os.getcwd()
    base_branch = args.base or detect_base_branch(repo_path)

    port = args.port or stable_port_for_path(repo_path)

    review_dir = Path('/tmp/claude-review')
    review_dir.mkdir(exist_ok=True)
    if args.output:
        output_path = args.output
    else:
        branch = git_run(repo_path, 'rev-parse', '--abbrev-ref', 'HEAD')
        slug = branch.replace('/', '-') if branch else Path(repo_path).name
        output_path = str(review_dir / f'{slug}.md')

    with open(output_path, 'w') as f:
        f.write('')

    session = Session(
        repo_path=repo_path,
        base_branch=base_branch,
        description=args.description,
        output_path=output_path,
    )

    url = f'http://127.0.0.1:{port}'
    print(f"REVIEW_URL={url}", flush=True)
    print(f"REVIEW_OUTPUT={output_path}", flush=True)
    print(f"REVIEW_PID={os.getpid()}", flush=True)

    webbrowser.open(url)
    uvicorn.run(app, host='127.0.0.1', port=port, log_level='warning')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Replace the imports at the top of server.py**

Replace everything from `import argparse` through `DIST_DIR = ...` (lines 13-29) with:

```python
import argparse
import asyncio
import json
import os
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from git_ops import (
    detect_base_branch, get_branch_diff, get_selected_commits_diff,
    get_branch_commits, get_repo_meta, get_file_lines, git_run,
)
```

Note: `DIST_DIR` moves down to just above the `app.mount` call (it's in the replacement code from Step 1).

- [ ] **Step 3: Remove stale code**

Delete the old `ReviewHandler` class and its methods if any remain. The file should now contain only:
1. Module docstring
2. Imports
3. `slugify()` function
4. `Session` class (from Task 2)
5. `app = FastAPI()` and route handlers
6. `StaticFiles` mount
7. `stable_port_for_path()` and `main()`

- [ ] **Step 4: Verify the server starts**

Run: `uv run lgtm --repo /Users/tom/dev/claude-review --port 9870`
Expected: Server starts, prints REVIEW_URL/OUTPUT/PID, opens browser.

Kill the server after verifying.

- [ ] **Step 5: Verify API endpoints respond correctly**

Start the server in background, then test:

```bash
uv run lgtm --repo /Users/tom/dev/claude-review --port 9870 &
sleep 2

# GET endpoints
curl -s http://127.0.0.1:9870/items | python3 -m json.tool
curl -s 'http://127.0.0.1:9870/data?item=diff' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['mode'], len(d.get('diff','')))"
curl -s http://127.0.0.1:9870/commits | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['commits']), 'commits')"

# POST endpoints
python3 -c "
import urllib.request, json
data = json.dumps({'item':'diff','comments':[{'file':'test.py','line':1,'comment':'test'}]}).encode()
req = urllib.request.Request('http://127.0.0.1:9870/comments', data=data, headers={'Content-Type':'application/json'})
print(urllib.request.urlopen(req).read().decode())
"

# DELETE endpoint
curl -s -X DELETE 'http://127.0.0.1:9870/comments?item=diff' | python3 -m json.tool

# Static files
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:9870/

kill %1
```

Expected: All return valid JSON responses, static files return 200.

- [ ] **Step 6: Verify SSE works**

Start server, connect SSE, post a comment, check the event arrives:

```bash
uv run lgtm --repo /Users/tom/dev/claude-review --port 9870 &
sleep 2

# Start SSE listener in background, write events to a file
curl -s -N http://127.0.0.1:9870/events > /tmp/sse-test.txt &
SSE_PID=$!
sleep 1

# Post a comment (should trigger SSE event)
python3 -c "
import urllib.request, json
data = json.dumps({'item':'diff','comments':[{'file':'test.py','line':1,'comment':'sse test'}]}).encode()
req = urllib.request.Request('http://127.0.0.1:9870/comments', data=data, headers={'Content-Type':'application/json'})
urllib.request.urlopen(req)
"
sleep 1

kill $SSE_PID 2>/dev/null
cat /tmp/sse-test.txt
kill %1
```

Expected: `/tmp/sse-test.txt` contains `event: comments_changed` with data payload.

- [ ] **Step 7: Commit**

```bash
git add server.py
git commit -m "replace http.server with FastAPI routes and uvicorn"
```

---

### Task 4: Clean up and verify end-to-end

**Files:**
- Possibly modify: `server.py` (if any issues found)

- [ ] **Step 1: Open the review UI in a browser and verify all features**

Run: `uv run lgtm --repo /Users/tom/dev/claude-review --port 9870`

Checklist:
- Page loads with diff view
- File list sidebar shows files
- Clicking a file shows its diff
- Syntax highlighting works
- Comment creation (click line number, type, Cmd+Enter)
- Comment editing and deletion
- File search (f key)
- File navigation (j/k keys)
- Reviewed toggle (e key)
- Commit picker (c key)
- Expand context above/below hunks
- Show whole file / back to diff (w key)
- Submit review works
- Refresh (r key) reloads data

- [ ] **Step 2: Verify SSE live reload in browser**

With the server running, post a comment from another terminal:

```bash
python3 -c "
import urllib.request, json
data = json.dumps({'item':'diff','comments':[{'file':'server.py','line':10,'comment':'Live SSE test!'}]}).encode()
req = urllib.request.Request('http://127.0.0.1:9870/comments', data=data, headers={'Content-Type':'application/json'})
urllib.request.urlopen(req)
"
```

Expected: Comment appears in the browser without manual refresh, toast shows "New comments from Claude".

- [ ] **Step 3: Verify Claude comment dismiss persists**

In the browser, hover over the Claude comment and click the dismiss button. Then press `r` to refresh. The comment should stay dismissed.

- [ ] **Step 4: Commit if any fixes were needed**

```bash
git add server.py
git commit -m "fix: [describe what was fixed]"
```
