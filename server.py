#!/usr/bin/env python3
"""
Claude Code Review Server — Session-based

A single review session per branch with multiple review items:
- "diff" item (always present): the branch's code changes
- Document items: markdown/text files added dynamically for review

Usage:
    python3 server.py --repo <path> [--base <branch>] [--description <text>]
"""

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


def slugify(title):
    return title.lower().replace(' ', '-').replace('/', '-')[:40]


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
