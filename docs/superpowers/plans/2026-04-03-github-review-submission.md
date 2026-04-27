# GitHub Review Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let reviewers submit their LGTM review comments directly to a GitHub PR as an atomic review with inline comments, as an alternative to the existing "submit to Claude" flow.

**Architecture:** Add `side` field to Comment so we know which diff side a comment targets. Add `owner`/`repo` to RepoMeta (parsed from PR URL). New server route shells out to `gh api` to post the review. Frontend gets a dropdown on the submit button to choose target.

**Tech Stack:** TypeScript, Express, SolidJS, `gh` CLI (`gh api`), vitest + supertest

**Spec:** `docs/superpowers/specs/2026-04-03-github-review-submission-design.md`

---

### Task 1: Add `side` to Comment type

**Files:**
- Modify: `server/comment-types.ts:1-23`
- Modify: `frontend/src/comment-types.ts:1-13`

- [ ] **Step 1: Add `side` field to server Comment interface**

In `server/comment-types.ts`, add `side` to the `Comment` interface:

```typescript
export interface Comment {
  id: string;
  author: 'user' | 'claude';
  text: string;
  status: 'active' | 'resolved' | 'dismissed';
  parentId?: string;
  item: string;
  file?: string;
  line?: number;
  side?: 'RIGHT' | 'LEFT';
  block?: number;
  mode?: 'review' | 'direct';
}
```

- [ ] **Step 2: Add `side` field to frontend Comment interface**

In `frontend/src/comment-types.ts`, add the same field:

```typescript
export interface Comment {
  id: string;
  author: 'user' | 'claude';
  text: string;
  status: 'active' | 'resolved' | 'dismissed';
  parentId?: string;
  item: string;
  file?: string;
  line?: number;
  side?: 'RIGHT' | 'LEFT';
  block?: number;
  mode?: 'review' | 'direct';
}
```

- [ ] **Step 3: Commit**

```bash
git add server/comment-types.ts frontend/src/comment-types.ts
git commit -m "feat: add side field to Comment type for GitHub review support"
```

---

### Task 2: Populate `side` when creating diff comments in DiffLine.tsx

**Files:**
- Modify: `frontend/src/components/diff/DiffLine.tsx:38-41` (absLine derivation)
- Modify: `frontend/src/components/diff/DiffLine.tsx:97-120` (handleSaveNew)
- Modify: `frontend/src/components/diff/DiffLine.tsx:126-153` (handleAskClaude)

- [ ] **Step 1: Add `absSide` memo next to `absLine`**

In `DiffLine.tsx`, after the existing `absLine` memo (line 41), add a `absSide` derivation:

```typescript
  // Use the absolute line number (newLine for adds/context, oldLine for deletes)
  const absLine = () => props.line.newLine ?? props.line.oldLine;
  const absSide = (): 'RIGHT' | 'LEFT' => props.line.newLine != null ? 'RIGHT' : 'LEFT';
```

- [ ] **Step 2: Pass `side` in handleSaveNew**

In `handleSaveNew` (~line 97), add `side` to both the local comment and the API call:

```typescript
  async function handleSaveNew(text: string) {
    const tempId = `temp-${Date.now()}`;
    const lineNum = absLine();
    const localComment: Comment = {
      id: tempId,
      author: 'user',
      text,
      status: 'active',
      item: 'diff',
      file: props.filePath,
      line: lineNum ?? undefined,
      side: absSide(),
      mode: 'review',
    };
    addLocalComment(localComment);
    setShowNewComment(false);
    try {
      const created = await apiCreateComment({
        author: 'user',
        text,
        item: 'diff',
        file: props.filePath,
        line: lineNum ?? undefined,
        side: absSide(),
        mode: 'review',
      });
      updateLocalComment(tempId, { id: created.id });
    } catch {
      /* optimistic update already applied */
    }
  }
```

- [ ] **Step 3: Pass `side` in handleAskClaude**

Same change in `handleAskClaude` (~line 127):

```typescript
  async function handleAskClaude(text: string) {
    const tempId = `temp-${Date.now()}`;
    const lineNum = absLine();
    const localComment: Comment = {
      id: tempId,
      author: 'user',
      text,
      status: 'active',
      item: 'diff',
      file: props.filePath,
      line: lineNum ?? undefined,
      side: absSide(),
      mode: 'direct',
    };
    addLocalComment(localComment);
    setShowNewComment(false);
    try {
      const created = await apiCreateComment({
        author: 'user',
        text,
        item: 'diff',
        file: props.filePath,
        line: lineNum ?? undefined,
        side: absSide(),
        mode: 'direct',
      });
      updateLocalComment(tempId, { id: created.id });
    } catch {
      /* optimistic update already applied */
    }
  }
```

- [ ] **Step 4: Add `side` to createComment input type**

In `frontend/src/comment-api.ts`, add `side` to the `createComment` input parameter type (line 25-34):

```typescript
export async function createComment(input: {
  author: 'user' | 'claude';
  text: string;
  item: string;
  file?: string;
  line?: number;
  side?: 'RIGHT' | 'LEFT';
  block?: number;
  parentId?: string;
  mode?: 'review' | 'direct';
}): Promise<Comment> {
```

- [ ] **Step 5: Pass `side` through in server comment route**

In `server/app.ts`, update the POST `/comments` handler (line 227-255) to extract and pass `side`:

```typescript
  projectRouter.post('/comments', (req, res) => {
    const session = res.locals.session;
    const { author, text, item, file, line, side, block, parentId, mode } = req.body;
    if (!author || !text || !item) {
      res.status(400).json({ error: 'author, text, and item are required' });
      return;
    }
    const comment = session.addComment({ author, text, item, file, line, side, block, parentId, mode });
```

The rest of the handler stays the same.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/diff/DiffLine.tsx frontend/src/comment-api.ts server/app.ts
git commit -m "feat: populate side field when creating diff comments"
```

---

### Task 3: Extend RepoMeta with owner/repo

**Files:**
- Modify: `server/git-ops.ts:123-152`
- Test: `server/__tests__/git-ops.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test to `server/__tests__/git-ops.test.ts` that verifies `parseOwnerRepo` extracts owner and repo from a GitHub PR URL:

```typescript
import { parseOwnerRepo } from '../git-ops.js';

describe('parseOwnerRepo', () => {
  it('parses owner and repo from GitHub PR URL', () => {
    const result = parseOwnerRepo('https://github.com/tomplex/lgtm/pull/42');
    expect(result).toEqual({ owner: 'tomplex', repo: 'lgtm' });
  });

  it('returns undefined for non-GitHub URLs', () => {
    expect(parseOwnerRepo('https://gitlab.com/foo/bar/merge_requests/1')).toBeUndefined();
  });

  it('returns undefined for malformed URLs', () => {
    expect(parseOwnerRepo('not-a-url')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/git-ops.test.ts -t "parseOwnerRepo"`
Expected: FAIL — `parseOwnerRepo` doesn't exist yet.

- [ ] **Step 3: Implement parseOwnerRepo and update RepoMeta**

In `server/git-ops.ts`, add the function and update the interface and `getRepoMeta`:

```typescript
export interface RepoMeta {
  branch: string;
  baseBranch: string;
  repoPath: string;
  repoName: string;
  pr?: { url: string; number: number; title: string; owner: string; repo: string };
}

export function parseOwnerRepo(url: string): { owner: string; repo: string } | undefined {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return undefined;
  return { owner: match[1], repo: match[2] };
}
```

In `getRepoMeta`, after parsing the PR JSON (line 147), merge in owner/repo:

```typescript
    const pr = JSON.parse(result);
    const ownerRepo = parseOwnerRepo(pr.url);
    if (ownerRepo) {
      meta.pr = { ...pr, ...ownerRepo };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/git-ops.test.ts -t "parseOwnerRepo"`
Expected: PASS

- [ ] **Step 5: Update frontend RepoMeta type**

In `frontend/src/state.ts`, update the `pr` type on `RepoMeta` (line 33):

```typescript
  pr?: { url: string; number: number; title: string; owner: string; repo: string };
```

- [ ] **Step 6: Commit**

```bash
git add server/git-ops.ts server/__tests__/git-ops.test.ts frontend/src/state.ts
git commit -m "feat: parse owner/repo from PR URL into RepoMeta"
```

---

### Task 4: Add submit-github server route

**Files:**
- Modify: `server/app.ts:281-299` (after existing `/submit` route)
- Test: `server/__tests__/routes.test.ts`

- [ ] **Step 1: Write failing tests for the new route**

Add a new describe block in `server/__tests__/routes.test.ts`:

```typescript
  describe('submit to GitHub', () => {
    it('POST /project/:slug/submit-github returns 400 when no PR detected', async () => {
      const res = await request(app)
        .post(`/project/${slug}/submit-github`)
        .send({ event: 'COMMENT' })
        .expect(400);
      expect(res.body.error).toContain('No PR detected');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/routes.test.ts -t "submit to GitHub"`
Expected: FAIL — 404 (route doesn't exist)

- [ ] **Step 3: Implement the route**

In `server/app.ts`, add the new route after the existing `/submit` route (after line 299):

```typescript
  projectRouter.post('/submit-github', (req, res) => {
    const session = res.locals.session;
    const meta = getRepoMeta(session.repoPath, session.baseBranch);

    if (!meta.pr) {
      res.status(400).json({ error: 'No PR detected for this project' });
      return;
    }

    const { event = 'COMMENT', body = '' } = req.body;
    if (!['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(event)) {
      res.status(400).json({ error: 'event must be COMMENT, APPROVE, or REQUEST_CHANGES' });
      return;
    }

    // Collect active diff review comments (top-level only)
    const topComments = session.listComments({
      item: 'diff',
      author: 'user',
      mode: 'review',
      status: 'active',
    }).filter(c => !c.parentId && c.file && c.line != null);

    // Flatten reply threads into parent comment body
    const allComments = session.listComments({ item: 'diff' });
    const ghComments = topComments.map(c => {
      const replies = allComments
        .filter(r => r.parentId === c.id)
        .map(r => r.text);
      const fullText = replies.length > 0
        ? c.text + '\n\n' + replies.join('\n\n')
        : c.text;
      return {
        path: c.file!,
        line: c.line!,
        side: c.side ?? 'RIGHT',
        body: fullText,
      };
    });

    const payload = JSON.stringify({
      event,
      body: body || 'Review submitted via LGTM',
      comments: ghComments,
    });

    try {
      const result = execFileSync('gh', [
        'api',
        `repos/${meta.pr.owner}/${meta.pr.repo}/pulls/${meta.pr.number}/reviews`,
        '--method', 'POST',
        '--input', '-',
      ], {
        cwd: session.repoPath,
        encoding: 'utf-8',
        input: payload,
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const review = JSON.parse(result);
      res.json({ ok: true, reviewUrl: review.html_url });
    } catch (e: any) {
      const msg = e.stderr?.trim() || e.message || 'GitHub API call failed';
      res.status(502).json({ error: msg });
    }
  });
```

Add the import at the top of `server/app.ts`:

```typescript
import { execFileSync } from 'node:child_process';
```

Also add the import for `getRepoMeta`:

```typescript
import { getFileLines, getBranchCommits, gitRun, getRepoMeta } from './git-ops.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/routes.test.ts -t "submit to GitHub"`
Expected: PASS (the "no PR" test should now get 400 as expected)

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/__tests__/routes.test.ts
git commit -m "feat: add submit-github route for posting reviews to GitHub PRs"
```

---

### Task 5: Add submitGithub API function in frontend

**Files:**
- Modify: `frontend/src/api.ts:114-125` (after existing `submitReview`)

- [ ] **Step 1: Add the API function**

In `frontend/src/api.ts`, after the existing `submitReview` function (after line 125), add:

```typescript
export async function submitGithub(
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
  body?: string,
): Promise<{ ok: boolean; reviewUrl: string }> {
  const resp = await fetch(`${baseUrl()}/submit-github`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, body }),
  });
  return checkedJson<{ ok: boolean; reviewUrl: string }>(resp);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add submitGithub API function"
```

---

### Task 6: Add submit dropdown to Header

**Files:**
- Modify: `frontend/src/components/header/Header.tsx:1-76`
- Modify: `frontend/src/style.css:118-135`

- [ ] **Step 1: Update Header props and component**

Replace the entire `Header.tsx` with the dropdown version:

```tsx
import { Show, createSignal, createMemo } from 'solid-js';
import { repoMeta, files, reviewedFiles, userCommentCount, activeItemId, sessionItems } from '../../state';

export type SubmitTarget = 'claude' | 'github';
export type GithubEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

interface Props {
  onRefresh: () => void;
  onSubmit: () => void;
  onSubmitGithub: (event: GithubEvent) => void;
  onToggleCommits: () => void;
  showCommitToggle: boolean;
}

export default function Header(props: Props) {
  const meta = repoMeta;
  const [dropdownOpen, setDropdownOpen] = createSignal(false);
  const [submitTarget, setSubmitTarget] = createSignal<SubmitTarget>('claude');

  const canSubmitGithub = createMemo(() => !!meta().pr && activeItemId() === 'diff');

  const totalAdd = createMemo(() => files().reduce((s, f) => s + f.additions, 0));
  const totalDel = createMemo(() => files().reduce((s, f) => s + f.deletions, 0));
  const reviewedCount = createMemo(() => files().filter((f) => reviewedFiles[f.path]).length);
  const remainingLines = createMemo(() =>
    files()
      .filter((f) => !reviewedFiles[f.path])
      .reduce((s, f) => s + f.additions, 0),
  );

  function handleSubmitClick() {
    if (submitTarget() === 'github') {
      setDropdownOpen(false);
      props.onSubmitGithub('COMMENT');
    } else {
      props.onSubmit();
    }
  }

  function handleGithubEvent(event: GithubEvent) {
    setDropdownOpen(false);
    props.onSubmitGithub(event);
  }

  return (
    <header>
      <h1>
        <strong>{meta().repoName || 'Code Review'}</strong>{' '}
        <Show when={meta().branch}>
          <span class="header-branch">
            {meta().branch} → {meta().baseBranch || 'main'}
          </span>
        </Show>
        <Show when={meta().pr}>
          {(pr) => (
            <a class="header-pr" href={pr().url} target="_blank">
              PR #{pr().number}
            </a>
          )}
        </Show>
      </h1>
      <div class="stats" id="stats">
        {files().length} file{files().length !== 1 ? 's' : ''} &middot; <span class="add">+{totalAdd()}</span>{' '}
        <span class="del">-{totalDel()}</span>
        <Show when={reviewedCount() === files().length && files().length > 0}> &middot; All files reviewed</Show>
        <Show when={reviewedCount() < files().length && remainingLines() > 0}>
          {' '}
          &middot; {remainingLines()} line{remainingLines() !== 1 ? 's' : ''} to review
        </Show>
        <Show when={userCommentCount() > 0}>
          {' '}
          &middot; {userCommentCount()} comment{userCommentCount() !== 1 ? 's' : ''}
        </Show>
      </div>
      <div class="header-actions">
        <Show when={props.showCommitToggle}>
          <div class="commit-toggle" id="commit-toggle-wrap">
            <button class="header-btn" onClick={props.onToggleCommits}>
              Commits
            </button>
          </div>
        </Show>
        <button class="header-btn" onClick={props.onRefresh}>
          Refresh
        </button>
        <div class="submit-group">
          <button id="submit-btn" onClick={handleSubmitClick}>
            {submitTarget() === 'github' ? 'Submit to GitHub' : 'Submit Review'}
          </button>
          <button
            class="submit-dropdown-toggle"
            onClick={() => setDropdownOpen(!dropdownOpen())}
            aria-label="Submit options"
          >
            &#9662;
          </button>
          <Show when={dropdownOpen()}>
            <div class="submit-dropdown">
              <button
                class="submit-dropdown-item"
                classList={{ active: submitTarget() === 'claude' }}
                onClick={() => { setSubmitTarget('claude'); setDropdownOpen(false); }}
              >
                Submit to Claude
              </button>
              <Show when={canSubmitGithub()}>
                <button
                  class="submit-dropdown-item"
                  classList={{ active: submitTarget() === 'github' }}
                  onClick={() => { setSubmitTarget('github'); setDropdownOpen(false); }}
                >
                  Submit to GitHub PR
                </button>
                <Show when={submitTarget() === 'github'}>
                  <div class="submit-dropdown-divider" />
                  <button class="submit-dropdown-item" onClick={() => handleGithubEvent('APPROVE')}>
                    Approve
                  </button>
                  <button class="submit-dropdown-item" onClick={() => handleGithubEvent('REQUEST_CHANGES')}>
                    Request Changes
                  </button>
                </Show>
              </Show>
            </div>
          </Show>
        </div>
        <Show when={activeItemId() !== 'diff'}>
          <div style="font-size:10px;color:var(--text-muted);text-align:right;margin-top:2px">
            {sessionItems().find((i) => i.id === activeItemId())?.title ?? activeItemId()}
          </div>
        </Show>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Add CSS for the submit dropdown**

In `frontend/src/style.css`, replace the `#submit-btn` block (lines 118-135) with:

```css
.submit-group {
  display: flex;
  position: relative;
}
#submit-btn {
  padding: 8px 20px;
  background: #238636;
  color: white;
  border: none;
  border-radius: 6px 0 0 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
#submit-btn:hover {
  background: #2ea043;
}
#submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.submit-dropdown-toggle {
  padding: 8px 10px;
  background: #238636;
  color: white;
  border: none;
  border-left: 1px solid rgba(255,255,255,0.2);
  border-radius: 0 6px 6px 0;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
.submit-dropdown-toggle:hover {
  background: #2ea043;
}
.submit-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  z-index: 100;
  min-width: 180px;
  overflow: hidden;
}
.submit-dropdown-item {
  display: block;
  width: 100%;
  padding: 8px 14px;
  background: none;
  color: var(--text);
  border: none;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.submit-dropdown-item:hover {
  background: var(--hover);
}
.submit-dropdown-item.active {
  color: var(--accent);
  font-weight: 600;
}
.submit-dropdown-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/header/Header.tsx frontend/src/style.css
git commit -m "feat: add submit target dropdown to Header"
```

---

### Task 7: Wire up handleSubmitGithub in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx:30-36` (imports)
- Modify: `frontend/src/App.tsx:151-173` (after handleSubmit)
- Modify: `frontend/src/App.tsx:317-324` (Header JSX)

- [ ] **Step 1: Add import for submitGithub and GithubEvent**

In `frontend/src/App.tsx`, update the import from `./api` (line 30) to include `submitGithub`:

```typescript
import {
  fetchItems,
  fetchItemData,
  fetchCommits,
  fetchAnalysis,
  submitReview as apiSubmitReview,
  submitGithub as apiSubmitGithub,
  removeItem,
  baseUrl,
} from './api';
```

Add the type import from Header:

```typescript
import type { GithubEvent } from './components/header/Header';
```

- [ ] **Step 2: Add handleSubmitGithub function**

After the existing `handleSubmit` function (after line 173), add:

```typescript
  async function handleSubmitGithub(event: GithubEvent) {
    try {
      const result = await apiSubmitGithub(event);
      showToast('Review submitted to GitHub!', 3000);
      if (result.reviewUrl) {
        window.open(result.reviewUrl, '_blank');
      }
      setComments('list', (prev) => prev.filter((c) => c.item !== 'diff'));
      clearPersistedState();
    } catch (e: any) {
      showToast('GitHub submit failed: ' + e.message);
    }
  }
```

- [ ] **Step 3: Pass onSubmitGithub to Header**

Update the Header JSX (around line 321) to pass the new handler:

```tsx
      <Header
        onRefresh={handleRefresh}
        onSubmit={handleSubmit}
        onSubmitGithub={handleSubmitGithub}
        onToggleCommits={() => setCommitPanelOpen(!commitPanelOpen())}
        showCommitToggle={appMode() === 'diff' && allCommits().length > 0}
      />
```

- [ ] **Step 4: Build and verify no type errors**

Run: `npx vite build`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: wire up GitHub review submission in App.tsx"
```

---

### Task 8: Build frontend dist

**Files:**
- Modify: `frontend/dist/` (rebuilt assets)

- [ ] **Step 1: Build frontend**

Run: `npx vite build`
Expected: Build completes, assets written to `frontend/dist/`.

- [ ] **Step 2: Commit dist**

```bash
git add frontend/dist/
git commit -m "build: rebuild frontend dist with GitHub submit feature"
```

---

### Task 9: Run all tests

- [ ] **Step 1: Run server tests**

Run: `npx vitest run --config vitest.config.server.ts`
Expected: All tests pass.

- [ ] **Step 2: Run frontend tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Fix any failures and commit if needed**
