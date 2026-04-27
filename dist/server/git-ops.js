import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export function gitRun(repoPath, ...args) {
    return execFileSync('git', args, {
        cwd: repoPath,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
    }).trim();
}
export function detectBaseBranch(repoPath) {
    // Try the PR's actual base branch first (handles stacked PRs correctly)
    try {
        const base = execFileSync('gh', ['pr', 'view', '--json', 'baseRefName', '-q', '.baseRefName'], {
            cwd: repoPath,
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (base) {
            // Fetch the base branch so we have origin/<base> available
            try {
                gitRun(repoPath, 'fetch', 'origin', base);
            }
            catch { /* best effort */ }
            return `origin/${base}`;
        }
    }
    catch {
        // gh not installed or no open PR — fall back
    }
    // Fall back to main/master if they exist locally
    for (const candidate of ['main', 'master']) {
        try {
            gitRun(repoPath, 'rev-parse', '--verify', candidate);
            return candidate;
        }
        catch {
            continue;
        }
    }
    // Last resort: use HEAD (e.g. detached head, no main/master)
    return 'HEAD';
}
// Intentionally includes working-tree and staged changes alongside committed
// branch changes, so the review UI reflects the live state of the checkout.
export function getBranchDiff(repoPath, baseBranch) {
    const mergeBase = gitRun(repoPath, 'merge-base', baseBranch, 'HEAD');
    if (!mergeBase)
        return '';
    const filesOutput = gitRun(repoPath, 'log', '--first-parent', '--no-merges', '--diff-filter=ACDMR', '--name-only', '--format=', `${baseBranch}..HEAD`);
    const branchFiles = new Set(filesOutput.split('\n').filter(f => f.trim()));
    // Uncommitted and staged files are nice-to-have — don't fail if these error
    try {
        const uncommitted = gitRun(repoPath, 'diff', '--name-only', 'HEAD');
        const staged = gitRun(repoPath, 'diff', '--name-only', '--cached');
        for (const output of [uncommitted, staged]) {
            for (const f of output.split('\n').filter(f => f.trim())) {
                branchFiles.add(f);
            }
        }
    }
    catch {
        // working-tree/staged lookup failed — continue with committed files only
    }
    if (branchFiles.size === 0)
        return '';
    return gitRun(repoPath, 'diff', mergeBase, '--', ...Array.from(branchFiles).sort());
}
export function getSelectedCommitsDiff(repoPath, shas) {
    return shas
        .map(sha => gitRun(repoPath, 'diff-tree', '-p', '--no-commit-id', sha))
        .join('\n');
}
export function getBranchCommits(repoPath, baseBranch) {
    let output = gitRun(repoPath, 'log', '--first-parent', '--no-merges', '--format=%H|%s|%an|%ar', `${baseBranch}..HEAD`);
    // On main (or when range is empty), show recent commits
    if (!output.trim()) {
        output = gitRun(repoPath, 'log', '--first-parent', '--no-merges', '--format=%H|%s|%an|%ar', '-20', 'HEAD');
    }
    const commits = [];
    for (const line of output.split('\n')) {
        if (!line.includes('|'))
            continue;
        const parts = line.split('|', 4);
        if (parts.length < 4)
            continue;
        commits.push({
            sha: parts[0],
            message: parts[1],
            author: parts[2],
            date: parts[3],
        });
    }
    return commits;
}
export function parseOwnerRepo(url) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match)
        return undefined;
    return { owner: match[1], repo: match[2] };
}
export function getRepoMeta(repoPath, baseBranch) {
    const branch = gitRun(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
    const meta = {
        branch,
        baseBranch,
        repoPath,
        repoName: basename(repoPath),
    };
    try {
        // gh is optional — not a git command, so call execFileSync directly
        const result = execFileSync('gh', ['pr', 'view', '--json', 'url,number,title'], {
            cwd: repoPath,
            encoding: 'utf-8',
            timeout: 5000,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const pr = JSON.parse(result);
        const ownerRepo = parseOwnerRepo(pr.url);
        if (ownerRepo) {
            meta.pr = { ...pr, ...ownerRepo };
        }
    }
    catch {
        // gh not installed or no PR
    }
    return meta;
}
export async function getRepoMetaAsync(repoPath, baseBranch) {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: repoPath,
    });
    const meta = {
        branch: stdout.trim(),
        baseBranch,
        repoPath,
        repoName: basename(repoPath),
    };
    try {
        const { stdout: ghOut } = await execFileAsync('gh', ['pr', 'view', '--json', 'url,number,title'], {
            cwd: repoPath,
            timeout: 5000,
        });
        const pr = JSON.parse(ghOut);
        const ownerRepo = parseOwnerRepo(pr.url);
        if (ownerRepo) {
            meta.pr = { ...pr, ...ownerRepo };
        }
    }
    catch {
        // gh not installed or no PR
    }
    return meta;
}
export function getFileLines(repoPath, filepath, start, count, direction = 'down') {
    const fullPath = join(repoPath, filepath);
    if (!existsSync(fullPath))
        return [];
    const lines = readFileSync(fullPath, 'utf-8').split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '')
        lines.pop();
    if (direction === 'up') {
        const end = Math.max(start - 1, 0);
        const begin = Math.max(end - count, 0);
        return Array.from({ length: end - begin }, (_, i) => ({
            num: begin + i + 1,
            content: lines[begin + i],
        }));
    }
    else {
        const begin = start;
        const end = Math.min(begin + count, lines.length);
        return Array.from({ length: end - begin }, (_, i) => ({
            num: begin + i + 1,
            content: lines[begin + i],
        }));
    }
}
