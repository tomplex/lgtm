import json
import subprocess
from pathlib import Path


def git_run(repo_path, *args):
    result = subprocess.run(
        ['git'] + list(args),
        capture_output=True, text=True, cwd=repo_path
    )
    return result.stdout.strip()


def detect_base_branch(repo_path):
    for candidate in ['master', 'main']:
        result = subprocess.run(
            ['git', 'rev-parse', '--verify', candidate],
            capture_output=True, text=True, cwd=repo_path
        )
        if result.returncode == 0:
            return candidate
    return 'master'


def get_branch_diff(repo_path, base_branch):
    files_output = git_run(
        repo_path,
        'log', '--first-parent', '--no-merges',
        '--diff-filter=ACDMR', '--name-only', '--format=',
        f'{base_branch}..HEAD'
    )
    if not files_output.strip():
        return ''
    branch_files = sorted(set(f for f in files_output.split('\n') if f.strip()))
    if not branch_files:
        return ''
    merge_base = git_run(repo_path, 'merge-base', base_branch, 'HEAD')
    return git_run(repo_path, 'diff', merge_base, 'HEAD', '--', *branch_files)


def get_selected_commits_diff(repo_path, shas):
    diffs = []
    for sha in shas:
        diffs.append(git_run(repo_path, 'diff-tree', '-p', '--no-commit-id', sha))
    return '\n'.join(diffs)


def get_branch_commits(repo_path, base_branch):
    output = git_run(
        repo_path,
        'log', '--first-parent', '--no-merges',
        '--format=%H|%s|%an|%ar',
        f'{base_branch}..HEAD'
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


def get_repo_meta(repo_path, base_branch):
    branch = git_run(repo_path, 'rev-parse', '--abbrev-ref', 'HEAD')
    meta = {
        'branch': branch,
        'baseBranch': base_branch,
        'repoPath': repo_path,
        'repoName': Path(repo_path).name,
    }
    try:
        result = subprocess.run(
            ['gh', 'pr', 'view', '--json', 'url,number,title'],
            capture_output=True, text=True, cwd=repo_path, timeout=5
        )
        if result.returncode == 0:
            meta['pr'] = json.loads(result.stdout)
    except Exception:
        pass
    return meta


def get_file_lines(repo_path, filepath, start, count, direction='down'):
    full_path = Path(repo_path) / filepath
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
