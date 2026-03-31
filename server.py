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
import http.server
import json
import queue
import mimetypes
import os
import threading
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from git_ops import (
    detect_base_branch, get_branch_diff, get_selected_commits_diff,
    get_branch_commits, get_repo_meta, get_file_lines, git_run,
)

DIST_DIR = Path(__file__).parent / 'frontend' / 'dist'


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


class ReviewHandler(http.server.BaseHTTPRequestHandler):
    session: Session  # set on the class before serving

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        s = self.session

        if path == '/':
            return self._serve_index()

        if path == '/items':
            return self._respond_json({'items': s.items})

        if path == '/data':
            item_id = qs.get('item', ['diff'])[0]
            return self._respond_json(self._get_item_data(item_id, qs))

        if path == '/context':
            filepath = qs.get('file', [''])[0]
            line = int(qs.get('line', ['0'])[0])
            count = int(qs.get('count', ['20'])[0])
            direction = qs.get('direction', ['down'])[0]
            return self._respond_json({
                'lines': get_file_lines(s.repo_path, filepath, line, count, direction)
            })

        if path == '/file':
            filepath = qs.get('path', [''])[0]
            full_path = Path(s.repo_path) / filepath
            lines = []
            if full_path.exists():
                for i, line in enumerate(full_path.read_text().splitlines(), 1):
                    lines.append({'num': i, 'content': line})
            return self._respond_json({'lines': lines})

        if path == '/commits':
            return self._respond_json({
                'commits': get_branch_commits(s.repo_path, s.base_branch)
            })

        if path == '/events':
            return self._serve_sse()

        # Try serving static files from dist/
        return self._serve_static(path)

    def _serve_sse(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()

        q = self.session.add_sse_client()
        try:
            while True:
                try:
                    msg = q.get(timeout=30)
                    self.wfile.write(msg.encode())
                    self.wfile.flush()
                except queue.Empty:
                    # Send keepalive
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            self.session.remove_sse_client(q)

    def _serve_index(self):
        index = DIST_DIR / 'index.html'
        if index.exists():
            content = index.read_text()
            self._send_content(content, 'text/html; charset=utf-8')
        else:
            self.send_response(404)
            self.end_headers()
            self._write(b'Frontend not built. Run: cd frontend && npm run build')

    def _serve_static(self, path):
        # Serve from dist/ for production
        safe_path = path.lstrip('/')
        file_path = DIST_DIR / safe_path
        if file_path.exists() and file_path.is_file():
            content_type, _ = mimetypes.guess_type(str(file_path))
            content = file_path.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', content_type or 'application/octet-stream')
            self.end_headers()
            self._write(content)
        else:
            self.send_response(404)
            self.end_headers()

    def _get_item_data(self, item_id, qs):
        s = self.session
        claude_comments = s.claude_comments.get(item_id, [])

        if item_id == 'diff':
            selected = qs.get('commits', [''])[0]
            if selected:
                shas = [sha.strip() for sha in selected.split(',') if sha.strip()]
                diff = get_selected_commits_diff(s.repo_path, shas)
            else:
                diff = get_branch_diff(s.repo_path, s.base_branch)
            return {
                'mode': 'diff',
                'diff': diff,
                'description': s.description,
                'meta': get_repo_meta(s.repo_path, s.base_branch),
                'claudeComments': claude_comments,
            }

        item = next((i for i in s.items if i['id'] == item_id), None)
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

    def do_POST(self):
        path = urlparse(self.path).path
        data = self._read_body()
        s = self.session

        if path == '/items':
            filepath = data.get('path', '')
            title = data.get('title', '') or Path(filepath).stem
            item_id = data.get('id', '') or slugify(title)

            with s.items_lock:
                existing = next((i for i in s.items if i['id'] == item_id), None)
                if existing:
                    existing['path'] = os.path.abspath(filepath)
                    existing['title'] = title
                else:
                    s.items.append({
                        'id': item_id,
                        'type': 'document',
                        'title': title,
                        'path': os.path.abspath(filepath),
                    })

            self._respond_json({'ok': True, 'id': item_id, 'items': s.items})
            print(f"ITEM_ADDED={item_id}", flush=True)
            s.broadcast('items_changed', {'id': item_id})

        elif path == '/comments':
            item_id = data.get('item', 'diff')
            new_comments = data.get('comments', [])
            with s.claude_comments_lock:
                if item_id not in s.claude_comments:
                    s.claude_comments[item_id] = []
                s.claude_comments[item_id].extend(new_comments)
            self._respond_json({'ok': True, 'count': len(s.claude_comments.get(item_id, []))})
            print(f"CLAUDE_COMMENTS_ADDED={len(new_comments)} item={item_id}", flush=True)
            s.broadcast('comments_changed', {'item': item_id, 'count': len(new_comments)})

        elif path == '/submit':
            with s.round_lock:
                s.round += 1
                current_round = s.round

            with open(s.output_path, 'a') as f:
                f.write(f"\n---\n# Review Round {current_round}\n\n")
                f.write(data.get('comments', ''))
                f.write('\n')

            signal_path = s.output_path + '.signal'
            with open(signal_path, 'w') as f:
                f.write(str(current_round))

            self._respond_json({'ok': True, 'round': current_round})
            print(f"REVIEW_ROUND={current_round}", flush=True)

        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        s = self.session

        if path == '/comments':
            item_id = qs.get('item', [''])[0]
            index = qs.get('index', [''])[0]
            with s.claude_comments_lock:
                if item_id and index:
                    idx = int(index)
                    items = s.claude_comments.get(item_id, [])
                    if 0 <= idx < len(items):
                        items.pop(idx)
                elif item_id:
                    s.claude_comments.pop(item_id, None)
                else:
                    s.claude_comments.clear()
            self._respond_json({'ok': True})
        else:
            self.send_response(404)
            self.end_headers()

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length)) if length else {}

    def _respond_json(self, payload):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self._write(json.dumps(payload).encode())

    def _send_content(self, content, content_type):
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.end_headers()
        self._write(content.encode())

    def _write(self, data):
        try:
            self.wfile.write(data)
        except BrokenPipeError:
            pass

    def log_message(self, format, *args):
        pass


def stable_port_for_path(path):
    h = sum(ord(c) * (i + 1) for i, c in enumerate(path))
    return 9850 + (h % 100)


def main():
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
    ReviewHandler.session = session

    server = http.server.ThreadingHTTPServer(('127.0.0.1', port), ReviewHandler)
    url = f'http://127.0.0.1:{port}'

    print(f"REVIEW_URL={url}", flush=True)
    print(f"REVIEW_OUTPUT={output_path}", flush=True)
    print(f"REVIEW_PID={os.getpid()}", flush=True)

    webbrowser.open(url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
