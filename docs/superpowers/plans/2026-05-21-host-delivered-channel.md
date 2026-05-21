# Host-Delivered Channel Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When LGTM runs embedded in Periscope, route LGTM→Claude channel notifications through Periscope's reliable injection path instead of LGTM's flaky MCP channel.

**Architecture:** Periscope embeds LGTM with a new `?host=periscope` URL param. The LGTM frontend then sends an `X-LGTM-Host: periscope` header on the three mutating requests that trigger channel notifications (`/submit`, `/comments` direct-question, `/refresh-analysis`). The server, seeing that header, skips its own `notifyChannel` MCP push and returns the channel payload `{content, meta}` in the HTTP response. The frontend `postMessage`s that payload to the Periscope parent window, which delivers `content` to the pane's Claude via Periscope's existing `POST /api/channel/push` endpoint. LGTM's MCP channel and claim machinery are untouched — they remain the delivery path for standalone (non-embedded) LGTM.

**Tech Stack:** LGTM server — TypeScript / Express / Vitest + supertest. LGTM frontend — SolidJS / TypeScript. Periscope frontend — vanilla JS (`static/modal.js`). Periscope backend — Python / FastAPI (no changes; `POST /api/channel/push` already exists).

**Repos touched:**
- LGTM — `/Users/tom/dev/lgtm`
- Periscope — `/Users/tom/dev/periscope`

**Task order rationale:** The frontend task (Task 3) is the activation switch — it is the only change that makes LGTM send the `X-LGTM-Host` header and thereby suppress its own channel. The server task (Task 1) and Periscope task (Task 2) are both backward-compatible no-ops until then: the old frontend never sends the header so the server never suppresses, and the old LGTM ignores the `host` param so Periscope never receives `lgtm-notify-claude`. Doing the frontend last means there is no window where LGTM suppresses its channel but Periscope cannot yet deliver.

---

## File Structure

**LGTM repo:**
- `server/app.ts` — modify three route handlers (`/submit`, `/comments`, `/refresh-analysis`) to branch on the `X-LGTM-Host` header.
- `server/__tests__/routes.test.ts` — add tests for the host-delivery branch of each route.
- `frontend/src/api.ts` — add `embeddedHost()`, `hostHeaders()`, `ChannelPayload`, `forwardChannelToHost()`; wire `submitReview()`.
- `frontend/src/comment-api.ts` — wire `createComment()`.
- `frontend/src/refresh-api.ts` — wire `postRefreshAnalysis()`.

**Periscope repo:**
- `static/modal.js` — append `&host=periscope` to the two LGTM iframe URLs; add an `lgtm-notify-claude` case to the `message` event handler.

---

## Task 1: LGTM server — host-delivery branch for the three channel routes

**Files:**
- Modify: `/Users/tom/dev/lgtm/server/app.ts` (`/submit` ~720-738, `/comments` ~662-694, `/refresh-analysis` ~740-762)
- Test: `/Users/tom/dev/lgtm/server/__tests__/routes.test.ts`

The contract: when a request carries header `X-LGTM-Host: periscope`, the route skips `notifyChannel(...)` and instead includes `channel: { content, meta }` in its JSON response. When the header is absent, behaviour is exactly as today.

- [ ] **Step 1: Write failing tests for `/submit`**

Add these two tests inside the existing `describe('submit', () => { ... })` block in `server/__tests__/routes.test.ts`:

```ts
    it('POST /submit with X-LGTM-Host: periscope returns a channel payload', async () => {
      const res = await request(app)
        .post(`/project/${slug}/submit`)
        .set('X-LGTM-Host', 'periscope')
        .send({ comments: 'Periscope-routed feedback' })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(typeof res.body.round).toBe('number');
      expect(res.body.channel).toBeDefined();
      expect(res.body.channel.content).toBe('Periscope-routed feedback');
      expect(res.body.channel.meta.event).toBe('review_submitted');
      expect(res.body.channel.meta.round).toBe(String(res.body.round));
    });

    it('POST /submit without the host header omits the channel payload', async () => {
      const res = await request(app)
        .post(`/project/${slug}/submit`)
        .send({ comments: 'Normal feedback' })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.channel).toBeUndefined();
    });
```

- [ ] **Step 2: Run the `/submit` tests to verify they fail**

Run: `npx vitest run server/__tests__/routes.test.ts -t submit`
Expected: the periscope test FAILS (`res.body.channel` is `undefined`). The no-header test passes (channel already absent today).

- [ ] **Step 3: Implement the `/submit` host-delivery branch**

In `server/app.ts`, replace the body of the `/submit` route (currently lines ~728-737, from the `// Push review feedback...` comment through the final `res.json(...)`) with:

```ts
    // Channel notification. When an embedding host (periscope) can deliver
    // to Claude over its own reliable channel, hand it the payload and skip
    // our own MCP push — that push rides a flaky long-lived SSE stream.
    const meta: Record<string, string> = {
      event: 'review_submitted',
      project: slug,
      round: String(currentRound),
    };
    if (item) meta.item = item;

    if (req.get('X-LGTM-Host') === 'periscope') {
      res.json({ ok: true, round: currentRound, channel: { content: commentsText, meta } });
      return;
    }
    notifyChannel(commentsText, meta);
    res.json({ ok: true, round: currentRound });
```

- [ ] **Step 4: Run the `/submit` tests to verify they pass**

Run: `npx vitest run server/__tests__/routes.test.ts -t submit`
Expected: PASS (both tests).

- [ ] **Step 5: Write failing tests for `/comments` direct-question**

Add these two tests inside the existing `describe('comments', () => { ... })` block:

```ts
    it('POST /comments direct mode with X-LGTM-Host: periscope returns a channel payload', async () => {
      const res = await request(app)
        .post(`/project/${slug}/comments`)
        .set('X-LGTM-Host', 'periscope')
        .send({ author: 'user', text: 'Why this approach?', item: 'diff', mode: 'direct' })
        .expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.channel).toBeDefined();
      expect(res.body.channel.content).toContain('Why this approach?');
      expect(res.body.channel.meta.event).toBe('question');
    });

    // Guard test: review-mode comments must never carry a channel payload.
    // Note this passes against an unimplemented server too — the test that
    // actually proves the feature is the direct-mode one above.
    it('POST /comments review mode does not return a channel payload', async () => {
      const res = await request(app)
        .post(`/project/${slug}/comments`)
        .set('X-LGTM-Host', 'periscope')
        .send({ author: 'user', text: 'nit', item: 'diff' })
        .expect(200);
      expect(res.body.channel).toBeUndefined();
    });
```

- [ ] **Step 6: Run the `/comments` tests to verify they fail**

Run: `npx vitest run server/__tests__/routes.test.ts -t comments`
Expected: the direct-mode periscope test FAILS (`res.body.channel` is `undefined`). The review-mode test passes.

- [ ] **Step 7: Implement the `/comments` host-delivery branch**

In `server/app.ts`, the `/comments` route currently ends with a `if (mode === 'direct' && !parentId) { ... notifyChannel(content, meta); }` block followed by `res.json({ ok: true, comment });`. Replace **only** from the `// Push direct questions...` comment through that final `res.json(...)` with the snippet below. Do **not** touch the lines just above the comment — `const slug = ...`, `const where = ...`, and the `COMMENT_ADDED` `console.log(...)` — the replacement relies on `slug`, `where`, and `comment` already being in scope:

```ts
    // Direct-mode questions push to Claude via the channel. When an
    // embedding host (periscope) can deliver to Claude itself, hand back the
    // payload instead of using our own flaky MCP push.
    let channel: { content: string; meta: Record<string, string> } | undefined;
    if (mode === 'direct' && !parentId) {
      let content = text;
      if (file && line != null) {
        content = `Question on ${file}:${line}:\n\n${text}`;
        const context = getFileLines(session.repoPath, file, Math.max(1, line - 3), 7);
        if (context.length > 0) {
          content += `\n\nContext:\n${context.map(l => `${l.num}: ${l.content}`).join('\n')}`;
        }
      }
      const meta: Record<string, string> = { event: 'question', project: slug, commentId: comment.id };
      if (file) meta.file = file;
      if (line != null) meta.line = String(line);
      console.log(`QUESTION_TO_CLAUDE slug=${slug} where=${where} commentId=${comment.id} len=${content.length}`);
      if (req.get('X-LGTM-Host') === 'periscope') {
        channel = { content, meta };
      } else {
        notifyChannel(content, meta);
      }
    }

    res.json({ ok: true, comment, ...(channel ? { channel } : {}) });
```

- [ ] **Step 8: Run the `/comments` tests to verify they pass**

Run: `npx vitest run server/__tests__/routes.test.ts -t comments`
Expected: PASS.

- [ ] **Step 9: Write a failing test for `/refresh-analysis`**

Add this test inside the existing `describe('refresh analysis', () => { ... })` block:

```ts
    it('POST /refresh-analysis with X-LGTM-Host: periscope returns a channel payload and bypasses the claim check', async () => {
      const f = createGitFixture();
      try {
        const reg = manager.register(f.repoPath);
        const session = manager.get(reg.slug)!;
        const blobMap = session.getCurrentBlobMap();
        const paths = Object.keys(blobMap.blobsByPath);
        if (paths.length === 0) return; // skip in fixtures with no diff
        const path = paths[0];
        session.setAnalysis({
          overview: 'o', reviewStrategy: 's',
          files: { [path]: { priority: 'normal', phase: 'review', summary: '', category: '' } },
          groups: [],
          synthesizedAtFileSet: [path],
        });

        const res = await request(app)
          .post(`/project/${reg.slug}/refresh-analysis`)
          .set('X-LGTM-Host', 'periscope');
        expect(res.status).toBe(200);
        expect(res.body.delivered).toBe(true);
        expect(res.body.channel).toBeDefined();
        expect(res.body.channel.meta.event).toBe('refresh_analysis_requested');
        expect(typeof res.body.channel.content).toBe('string');
      } finally {
        f.cleanup();
      }
    });
```

- [ ] **Step 10: Run the `/refresh-analysis` test to verify it fails**

Run: `npx vitest run server/__tests__/routes.test.ts -t "refresh analysis"`
Expected: the periscope test FAILS — without the header branch the route reaches the claim check and returns `delivered: false` (no live claim in the test).

- [ ] **Step 11: Implement the `/refresh-analysis` host-delivery branch**

In `server/app.ts`, replace the entire `/refresh-analysis` route handler body with:

```ts
  projectRouter.post('/refresh-analysis', (req, res) => {
    const session: Session = res.locals.session;
    const slug = (req.params as Record<string, string>).slug;
    const result = session.getAnalysisWithFreshness();
    if (!result) {
      res.status(404).json({ delivered: false, reason: 'No analysis set' });
      return;
    }
    const content = JSON.stringify({
      staleFiles: result.freshness.staleFiles,
      missingFiles: result.freshness.missingFiles,
      removedFiles: result.freshness.removedFiles,
      staleSynthesis: result.freshness.staleSynthesis,
    });
    const meta: Record<string, string> = { event: 'refresh_analysis_requested', project: slug };
    console.log(`REFRESH_ANALYSIS_REQUESTED slug=${slug} stale=${result.freshness.staleFiles.length}`);

    // An embedding host (periscope) delivers to Claude itself, so it has no
    // need of a live MCP claim — that claim is exactly the unreliable thing
    // we are routing around here.
    if (req.get('X-LGTM-Host') === 'periscope') {
      res.json({ delivered: true, channel: { content, meta } });
      return;
    }
    const claim = getProjectClaim(slug);
    if (!claim || !isClaimAlive(slug)) {
      res.json({ delivered: false, reason: 'No live Claude claim' });
      return;
    }
    notifyChannel(content, meta);
    res.json({ delivered: true });
  });
```

- [ ] **Step 12: Run the full server test suite to verify everything passes**

Run: `npm run test:server`
Expected: PASS — all tests, including the five new ones. Confirm the final summary line shows 0 failures.

- [ ] **Step 13: Commit**

```bash
git add server/app.ts server/__tests__/routes.test.ts
git commit -m "feat: let an embedding host deliver channel events via X-LGTM-Host header"
```

---

## Task 2: Periscope — embed param and `lgtm-notify-claude` handler

**Files:**
- Modify: `/Users/tom/dev/periscope/static/modal.js` (LGTM iframe URLs ~541 and ~567; `message` handler ~1038-1042)

This task is backward-compatible: an old LGTM build ignores the `host` param and never sends `lgtm-notify-claude`, so the new handler simply never fires until Task 3 ships.

- [ ] **Step 1: Add `&host=periscope` to the walkthrough iframe URL**

In `static/modal.js`, function `renderLgtmWalkthrough`, change the URL line (currently `const url = \`${baseUrl}?embedded=1&view=walkthrough\`;`) to:

```js
  const url = `${baseUrl}?embedded=1&view=walkthrough&host=periscope`;
```

- [ ] **Step 2: Add `&host=periscope` to the item iframe URL**

In `static/modal.js`, function `renderLgtmItem`, change the URL line (currently `const url = \`${baseUrl}?embedded=1&item=${encodeURIComponent(itemId)}\`;`) to:

```js
  const url = `${baseUrl}?embedded=1&item=${encodeURIComponent(itemId)}&host=periscope`;
```

- [ ] **Step 3: Extend the `message` event handler with the `lgtm-notify-claude` case**

In `static/modal.js`, inside `initModal()`, replace the existing `window.addEventListener("message", ...)` block (currently lines ~1038-1042, the `lgtm-embedded-escape`-only handler) with:

```js
  // Messages from the embedded LGTM iframe.
  window.addEventListener("message", (e) => {
    // Forwarded Escape — focus inside the iframe means the keystroke never
    // bubbles to us, so LGTM postMessages it instead.
    if (e.data?.type === "lgtm-embedded-escape" && !modal.classList.contains("hidden")) {
      closeModal();
      return;
    }
    // LGTM channel event. When embedded with ?host=periscope, LGTM skips its
    // own (flaky) MCP channel push and hands us the payload; we deliver it to
    // this pane's Claude over periscope's reliable channel.
    if (e.data?.type === "lgtm-notify-claude") {
      const pane = lastPaneData?.pane_id;
      const content = e.data.content;
      if (!content) return;
      if (!pane) {
        console.warn("lgtm-notify-claude: no pane_id for the open modal; channel event dropped");
        return;
      }
      fetch(`/api/channel/push?pane=${encodeURIComponent(pane)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      }).catch(() => {});
    }
  });
```

`lastPaneData` is the module-scoped variable (declared near the top of `modal.js`) holding the latest `/api/pane` response for the open modal; `lastPaneData.pane_id` is the `%N` tmux pane id that `POST /api/channel/push` requires.

- [ ] **Step 4: Commit (in the periscope repo)**

```bash
git -C /Users/tom/dev/periscope add static/modal.js
git -C /Users/tom/dev/periscope commit -m "Route embedded LGTM channel events to the pane's Claude via /api/channel/push"
```

---

## Task 3: LGTM frontend — host helpers and wiring (activation)

**Files:**
- Modify: `/Users/tom/dev/lgtm/frontend/src/api.ts`
- Modify: `/Users/tom/dev/lgtm/frontend/src/comment-api.ts`
- Modify: `/Users/tom/dev/lgtm/frontend/src/refresh-api.ts`

This is the activation switch — after this task the feature is live.

- [ ] **Step 1: Add the host helpers to `api.ts`**

In `frontend/src/api.ts`, immediately after the `baseUrl()` function (ends at line ~12, before `checkedJson`), insert:

```ts
/**
 * When LGTM runs embedded in a host that can deliver channel events to
 * Claude over its own reliable channel, this returns the host id —
 * currently only 'periscope'. Empty string means no host-delivery: LGTM
 * uses its own MCP channel push.
 */
export function embeddedHost(): string {
  return new URLSearchParams(window.location.search).get('host') ?? '';
}

/**
 * Request header that tells the server to skip its own MCP channel push and
 * return the channel payload in the response body, so the embedding host
 * can deliver it instead.
 */
export function hostHeaders(): Record<string, string> {
  return embeddedHost() === 'periscope' ? { 'X-LGTM-Host': 'periscope' } : {};
}

/** Channel payload the server hands back when host-delivery is active. */
export interface ChannelPayload {
  content: string;
  meta: Record<string, string>;
}

/**
 * Forward a server-returned channel payload to the embedding host via
 * postMessage; the host delivers `content` to its wrapped Claude session.
 * No-op when not host-embedded or when the response carried no payload.
 */
export function forwardChannelToHost(channel: ChannelPayload | undefined): void {
  if (!channel || embeddedHost() !== 'periscope') return;
  window.parent?.postMessage({ type: 'lgtm-notify-claude', content: channel.content }, '*');
}
```

- [ ] **Step 2: Wire `submitReview()` in `api.ts`**

In `frontend/src/api.ts`, replace the `submitReview` function with:

```ts
export async function submitReview(
  comments: string,
  raw: Record<string, string>,
  item?: string,
): Promise<{ ok: boolean; round: number }> {
  const resp = await fetch(`${baseUrl()}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...hostHeaders() },
    body: JSON.stringify({ comments, raw, item }),
  });
  const data = await checkedJson<{ ok: boolean; round: number; channel?: ChannelPayload }>(resp);
  forwardChannelToHost(data.channel);
  return data;
}
```

- [ ] **Step 3: Wire `createComment()` in `comment-api.ts`**

In `frontend/src/comment-api.ts`, change the import line `import { baseUrl } from './api';` to:

```ts
import { baseUrl, hostHeaders, forwardChannelToHost, type ChannelPayload } from './api';
```

Then replace the `createComment` function with:

```ts
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
  const resp = await fetch(`${baseUrl()}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...hostHeaders() },
    body: JSON.stringify(input),
  });
  const data = await checkedJson<{ ok: boolean; comment: Comment; channel?: ChannelPayload }>(resp);
  forwardChannelToHost(data.channel);
  return data.comment;
}
```

- [ ] **Step 4: Wire `postRefreshAnalysis()` in `refresh-api.ts`**

In `frontend/src/refresh-api.ts`, change the import line `import { baseUrl } from './api';` to:

```ts
import { baseUrl, hostHeaders, forwardChannelToHost, type ChannelPayload } from './api';
```

Then replace the `postRefreshAnalysis` function with:

```ts
export async function postRefreshAnalysis(): Promise<{ delivered: boolean; reason?: string }> {
  const res = await fetch(`${baseUrl()}/refresh-analysis`, {
    method: 'POST',
    headers: { ...hostHeaders() },
  });
  const data = (await res.json()) as { delivered: boolean; reason?: string; channel?: ChannelPayload };
  forwardChannelToHost(data.channel);
  return data;
}
```

- [ ] **Step 5: Typecheck and build the frontend**

Run: `npm run build:frontend`
Expected: TypeScript compile + Vite build succeed with no errors.

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api.ts frontend/src/comment-api.ts frontend/src/refresh-api.ts
git commit -m "feat: forward channel events to the embedding host when host=periscope"
```

---

## Task 4: End-to-end verification

**Files:** none — manual verification across both running apps.

This feature's behaviour cannot be unit-tested end-to-end (it needs a live Periscope, a tmux-wrapped Claude session, and the LGTM iframe). Verify by hand.

- [ ] **Step 1: Build and restart LGTM**

Run from the LGTM repo root: `npm run build`
Then restart the LGTM server so the new `dist/` is served.

- [ ] **Step 2: Reload Periscope**

Restart Periscope (or hard-reload its browser page) so the updated `static/modal.js` is loaded.

- [ ] **Step 3: Open an embedded LGTM review**

In Periscope, open a pane whose Claude session has an LGTM review (or click "Start review" in the modal's review pane to create one). Open an LGTM item tab so the iframe mounts. Confirm the iframe `src` includes `&host=periscope` (DevTools → inspect the iframe element).

- [ ] **Step 4: Submit a review and verify host delivery**

Add at least one review comment in the LGTM iframe, then submit. Verify:
- The Periscope server log shows a `POST /api/channel/push?pane=%...` request.
- The LGTM server log does **not** show a `CHANNEL_PUSH` line for this `review_submitted` event (the MCP push was suppressed).
- The wrapped Claude session receives a `<channel source="periscope">` block containing the review feedback.

Paste the relevant Periscope and LGTM log lines as evidence.

- [ ] **Step 5: Verify a direct question routes the same way**

In the LGTM iframe, add a direct-mode question on a diff line. Verify the Periscope log shows another `POST /api/channel/push` and the LGTM log shows no `CHANNEL_PUSH` for the `question` event.

- [ ] **Step 6: Verify standalone LGTM still uses its own channel**

Open LGTM directly in a normal browser tab (not via Periscope — no `host` param). Submit a review. Verify the LGTM server log **does** show a `CHANNEL_PUSH` line — the non-embedded path is unchanged.

- [ ] **Step 7: Final full test run**

Run from the LGTM repo root: `npm test`
Expected: PASS — frontend and server suites, 0 failures. Paste the final summary lines.

---

## Self-Review Notes

- **Spec coverage:** Decision 1 (postMessage bridge) → Tasks 2 & 3. Decision 2 (suppress LGTM's channel when embedded) → Task 1's `X-LGTM-Host` branch skips `notifyChannel`. Decision 3 (`&host=periscope` query param) → Task 2 Steps 1-2 emit it, Task 3 Step 1 reads it. All three `notifyChannel` call sites (`/submit`, `/comments` direct, `/refresh-analysis`) are covered by Task 1.
- **Type consistency:** `ChannelPayload { content, meta }` is the single shape used by the server response (Task 1), the frontend helpers (Task 3), and `forwardChannelToHost`. The postMessage type string `lgtm-notify-claude` matches between `forwardChannelToHost` (Task 3 Step 1) and the Periscope handler (Task 2 Step 3).
- **Out of scope:** LGTM's MCP channel, `notifyChannel`, and the claim machinery (`claimedDiff`, `projectClaims`) are deliberately left in place — they remain the delivery path for standalone LGTM. No Periscope Python changes: `POST /api/channel/push` and `emit_channel_event` already exist.
