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
import http.server
import json
import os
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

REPO_PATH = ""
BASE_BRANCH = ""
OUTPUT_PATH = ""
COMMIT_LIST = []
DESCRIPTION = ""
ROUND = 0
ROUND_LOCK = threading.Lock()
TEMPLATE_DIR = Path(__file__).parent

# Session items: list of {id, type, title, path?, description?}
# First item is always the diff
ITEMS = []
ITEMS_LOCK = threading.Lock()

# Claude comments: {item_id: [{file, line, comment} or {block, comment}]}
CLAUDE_COMMENTS = {}
CLAUDE_COMMENTS_LOCK = threading.Lock()


def git_run(*args):
    result = subprocess.run(
        ['git'] + list(args),
        capture_output=True, text=True, cwd=REPO_PATH
    )
    return result.stdout.strip()


def detect_base_branch():
    for candidate in ['master', 'main']:
        result = subprocess.run(
            ['git', 'rev-parse', '--verify', candidate],
            capture_output=True, text=True, cwd=REPO_PATH
        )
        if result.returncode == 0:
            return candidate
    return 'master'


def get_branch_diff():
    files_output = git_run(
        'log', '--first-parent', '--no-merges',
        '--diff-filter=ACDMR', '--name-only', '--format=',
        f'{BASE_BRANCH}..HEAD'
    )
    if not files_output.strip():
        return ''
    branch_files = sorted(set(f for f in files_output.split('\n') if f.strip()))
    if not branch_files:
        return ''
    merge_base = git_run('merge-base', BASE_BRANCH, 'HEAD')
    return git_run('diff', merge_base, 'HEAD', '--', *branch_files)


def get_selected_commits_diff(shas):
    diffs = []
    for sha in shas:
        diffs.append(git_run('diff-tree', '-p', '--no-commit-id', sha))
    return '\n'.join(diffs)


def get_branch_commits():
    output = git_run(
        'log', '--first-parent', '--no-merges',
        '--format=%H|%s|%an|%ar',
        f'{BASE_BRANCH}..HEAD'
    )
    commits = []
    for line in output.split('\n'):
        if '|' not in line:
            continue
        parts = line.split('|', 3)
        if len(parts) < 4:
            continue
        commits.append({
            'sha': parts[0], 'message': parts[1],
            'author': parts[2], 'date': parts[3],
        })
    return commits


def get_repo_meta():
    branch = git_run('rev-parse', '--abbrev-ref', 'HEAD')
    meta = {
        'branch': branch,
        'baseBranch': BASE_BRANCH,
        'repoPath': REPO_PATH,
        'repoName': Path(REPO_PATH).name,
    }
    try:
        result = subprocess.run(
            ['gh', 'pr', 'view', '--json', 'url,number,title'],
            capture_output=True, text=True, cwd=REPO_PATH, timeout=5
        )
        if result.returncode == 0:
            meta['pr'] = json.loads(result.stdout)
    except Exception:
        pass
    return meta


def get_file_lines(filepath, start, count, direction='down'):
    full_path = Path(REPO_PATH) / filepath
    if not full_path.exists():
        return []
    lines = full_path.read_text().splitlines()
    if direction == 'up':
        end = max(start - 1, 0)
        begin = max(end - count, 0)
        return [{'num': i + 1, 'content': lines[i]} for i in range(begin, end)]
    else:
        begin = start
        end = min(begin + count, len(lines))
        return [{'num': i + 1, 'content': lines[i]} for i in range(begin, end)]


def slugify(title):
    return title.lower().replace(' ', '-').replace('/', '-')[:40]


class ReviewHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == '/':
            html = (TEMPLATE_DIR / 'review.html').read_text()
            self._json_or_html(html, 'text/html')

        elif path == '/items':
            self._respond_json({'items': ITEMS})

        elif path == '/data':
            item_id = qs.get('item', ['diff'])[0]
            self._respond_json(self._get_item_data(item_id, qs))

        elif path == '/context':
            filepath = qs.get('file', [''])[0]
            line = int(qs.get('line', ['0'])[0])
            count = int(qs.get('count', ['20'])[0])
            direction = qs.get('direction', ['down'])[0]
            self._respond_json({'lines': get_file_lines(filepath, line, count, direction)})

        elif path == '/file':
            filepath = qs.get('path', [''])[0]
            full_path = Path(REPO_PATH) / filepath
            lines = []
            if full_path.exists():
                for i, line in enumerate(full_path.read_text().splitlines(), 1):
                    lines.append({'num': i, 'content': line})
            self._respond_json({'lines': lines})

        elif path == '/commits':
            self._respond_json({'commits': get_branch_commits()})

        else:
            self.send_response(404)
            self.end_headers()

    def _get_item_data(self, item_id, qs):
        claude_comments = CLAUDE_COMMENTS.get(item_id, [])

        if item_id == 'diff':
            selected = qs.get('commits', [''])[0]
            if selected:
                shas = [s.strip() for s in selected.split(',') if s.strip()]
                diff = get_selected_commits_diff(shas)
            else:
                diff = get_branch_diff()
            return {
                'mode': 'diff',
                'diff': diff,
                'description': DESCRIPTION,
                'meta': get_repo_meta(),
                'claudeComments': claude_comments,
            }

        # Find the document item
        item = next((i for i in ITEMS if i['id'] == item_id), None)
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
        global ROUND
        path = urlparse(self.path).path
        data = self._read_body()

        if path == '/items':
            # Add a document to the session
            filepath = data.get('path', '')
            title = data.get('title', '') or Path(filepath).stem
            item_id = data.get('id', '') or slugify(title)

            # Don't duplicate
            with ITEMS_LOCK:
                if any(i['id'] == item_id for i in ITEMS):
                    # Update path/title if re-added
                    for i in ITEMS:
                        if i['id'] == item_id:
                            i['path'] = os.path.abspath(filepath)
                            i['title'] = title
                else:
                    ITEMS.append({
                        'id': item_id,
                        'type': 'document',
                        'title': title,
                        'path': os.path.abspath(filepath),
                    })

            self._respond_json({'ok': True, 'id': item_id, 'items': ITEMS})
            print(f"ITEM_ADDED={item_id}", flush=True)

        elif path == '/comments':
            item_id = data.get('item', 'diff')
            new_comments = data.get('comments', [])
            with CLAUDE_COMMENTS_LOCK:
                if item_id not in CLAUDE_COMMENTS:
                    CLAUDE_COMMENTS[item_id] = []
                CLAUDE_COMMENTS[item_id].extend(new_comments)
            self._respond_json({'ok': True, 'count': len(CLAUDE_COMMENTS.get(item_id, []))})
            print(f"CLAUDE_COMMENTS_ADDED={len(new_comments)} item={item_id}", flush=True)

        elif path == '/submit':
            with ROUND_LOCK:
                ROUND += 1
                current_round = ROUND

            with open(OUTPUT_PATH, 'a') as f:
                f.write(f"\n---\n# Review Round {current_round}\n\n")
                f.write(data.get('comments', ''))
                f.write('\n')

            signal_path = OUTPUT_PATH + '.signal'
            with open(signal_path, 'w') as f:
                f.write(str(current_round))

            self._respond_json({'ok': True, 'round': current_round})
            print(f"REVIEW_ROUND={current_round}", flush=True)

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

    def _json_or_html(self, content, content_type):
        self.send_response(200)
        self.send_header('Content-Type', f'{content_type}; charset=utf-8')
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
    global BASE_BRANCH, OUTPUT_PATH, REPO_PATH, COMMIT_LIST, DESCRIPTION

    parser = argparse.ArgumentParser(description='Claude Code Review Server')
    parser.add_argument('--repo', default='', help='Path to git repository')
    parser.add_argument('--base', default='', help='Base branch (default: auto-detect)')
    parser.add_argument('--commits', default='', help='Comma-separated commit SHAs')
    parser.add_argument('--description', default='', help='Review description banner')
    parser.add_argument('--output', default='', help='Output path (auto-generated if omitted)')
    parser.add_argument('--port', type=int, default=0, help='Port (0 = auto from path hash)')
    args = parser.parse_args()

    REPO_PATH = args.repo or os.getcwd()
    BASE_BRANCH = args.base or detect_base_branch()
    COMMIT_LIST = [s.strip() for s in args.commits.split(',') if s.strip()] if args.commits else []
    DESCRIPTION = args.description

    # The diff item is always first
    ITEMS.insert(0, {
        'id': 'diff',
        'type': 'diff',
        'title': 'Code Changes',
    })

    port = args.port or stable_port_for_path(REPO_PATH)

    review_dir = Path('/tmp/claude-review')
    review_dir.mkdir(exist_ok=True)
    if args.output:
        OUTPUT_PATH = args.output
    else:
        branch = git_run('rev-parse', '--abbrev-ref', 'HEAD')
        slug = branch.replace('/', '-') if branch else Path(REPO_PATH).name
        OUTPUT_PATH = str(review_dir / f'{slug}.md')

    with open(OUTPUT_PATH, 'w') as f:
        f.write('')

    server = http.server.HTTPServer(('127.0.0.1', port), ReviewHandler)
    url = f'http://127.0.0.1:{port}'

    print(f"REVIEW_URL={url}", flush=True)
    print(f"REVIEW_OUTPUT={OUTPUT_PATH}", flush=True)
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
