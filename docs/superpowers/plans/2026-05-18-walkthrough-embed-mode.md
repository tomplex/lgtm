# Walkthrough Embed Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LGTM's walkthrough view embeddable as a standalone iframe so Periscope can show it as a tab alongside the diff tab.

**Architecture:** The diff already supports embedded mode via `?embedded=1`. This plan adds a `?view=walkthrough` URL param that sets the walkthrough signal at boot, a `postMessage` from inside the iframe announcing whether a walkthrough exists, and CSS rules that hide the in-frame mode-switch UI when embedded. Both iframes share the same LGTM session, so SSE-driven comment sync already works across them.

**Tech Stack:** SolidJS, Vite, TypeScript. No new dependencies.

---

## Context & Background

The session-level model is already there:
- `frontend/src/state.ts:373` — `walkthroughMode` signal toggles between diff and walkthrough surfaces.
- `frontend/src/main.tsx:11-27` — reads `?embedded=1`, sets `body.embedded`, forwards Escape to parent.
- `frontend/src/ProjectView.tsx:553-564` — renders `WalkthroughView` when `walkthroughMode()`, falls back to diff.
- `frontend/src/style.css:3049-3057` — already hides `.header-top`, `.tab-bar`, `.project-palette-backdrop` when `body.embedded`.
- `frontend/src/ProjectView.tsx:329-333` — `createEffect` already calls `ensureDiffLoaded()` whenever a walkthrough is present, so the diff data backing the artifacts is fetched even if the user lands on walkthrough first.

What's missing for a periscope-style embed:
1. No way to deep-link directly to walkthrough mode at boot.
2. No way for the host to know whether a walkthrough exists (so it can hide its tab when there is none).
3. The "← Back to diff" button and the Header's "Walkthrough" toggle are still visible in embedded mode — the host owns the mode switch, so these are confusing.

## File Touchpoints

- Modify: `frontend/src/main.tsx` — read `?view=walkthrough` and seed the signal before `render`.
- Modify: `frontend/src/ProjectView.tsx` — add a `createEffect` that postMessages walkthrough availability when embedded.
- Modify: `frontend/src/style.css` — hide `.wt-back` and the Header's walkthrough toggle when `body.embedded`.
- Modify: `frontend/src/components/header/Header.tsx` — add a stable class (`header-walkthrough-toggle`) on the Walkthrough button so CSS can target it.

No new files. No new tests — the URL-param read is one line and the postMessage is one effect; per `tom-personal` CLAUDE.md ("UI work: test in the browser"), this is verified by loading the iframe manually rather than by unit tests.

---

## Task 1: Seed walkthrough mode from URL at boot

**Files:**
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Import the walkthrough-mode setter**

Edit the imports at the top of `main.tsx`:

```ts
import 'highlight.js/styles/github-dark.css';
import './style.css';
import { render } from 'solid-js/web';
import App from './App';
import { setWalkthroughMode } from './state';
```

- [ ] **Step 2: Read `?view=walkthrough` before render and seed the signal**

Replace the existing embedded-mode block in `main.tsx`. The diff:

```ts
// before:
const isEmbedded = new URLSearchParams(window.location.search).get('embedded') === '1';
if (isEmbedded) {
  document.body.classList.add('embedded');
  // ... ESC forwarding ...
}

// after:
const params = new URLSearchParams(window.location.search);
const isEmbedded = params.get('embedded') === '1';
const initialView = params.get('view');

if (isEmbedded) {
  document.body.classList.add('embedded');
  // ... existing ESC forwarding stays unchanged ...
}

// `?view=walkthrough` deep-links into walkthrough mode. Setting the signal
// before render avoids a flash of the diff surface on first paint. Works in
// embedded and non-embedded contexts so the param doubles as a shareable
// deep link.
if (initialView === 'walkthrough') {
  setWalkthroughMode(true);
}
```

Keep the existing `keydown` handler for ESC forwarding intact inside the `if (isEmbedded)` block.

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev:all`

In a browser tab, open `http://localhost:9900/project/<slug>?embedded=1&view=walkthrough` for a project that has a walkthrough set. Expected:
- Page loads directly into the walkthrough view (no flash of the diff).
- Project chrome (header-top, tab bar) is hidden.

Open the same URL without `&view=walkthrough`. Expected: diff view, as before.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main.tsx
git commit -m "embed: ?view=walkthrough deep-links into walkthrough mode at boot"
```

---

## Task 2: Announce walkthrough availability to the host

**Files:**
- Modify: `frontend/src/ProjectView.tsx`

- [ ] **Step 1: Add the postMessage effect**

In `ProjectView.tsx`, find the existing `createEffect` block around line 329-333:

```tsx
// When a walkthrough exists but the diff hasn't been loaded (user is on a
// document tab), fetch it so artifacts have something to render against.
createEffect(() => {
  if (walkthrough()) ensureDiffLoaded();
});
```

Immediately after it, add a new effect that announces availability to the embedding host:

```tsx
// When embedded (iframed by another tool, e.g. periscope), tell the parent
// window whether this session has a walkthrough. The host uses this to
// conditionally show or hide its walkthrough tab. Fires on the initial
// reactive flush (likely `has: false` because `loadWalkthrough()` hasn't
// resolved yet) and on every subsequent walkthrough change (SSE
// walkthrough_changed, git_changed). The host MUST treat the most recent
// message as authoritative, not the first one.
createEffect(() => {
  if (!document.body.classList.contains('embedded')) return;
  const has = walkthrough() !== null;
  window.parent?.postMessage({ type: 'lgtm-walkthrough-availability', has }, '*');
});
```

- [ ] **Step 2: Verify in the browser**

Run: `npm run dev:all`

Open `http://localhost:9900/project/<slug>?embedded=1` (any view) inside a tiny test page that runs:

```html
<script>
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'lgtm-walkthrough-availability') {
      console.log('availability:', e.data.has);
    }
  });
</script>
<iframe src="http://localhost:9900/project/<slug>?embedded=1" width="800" height="600"></iframe>
```

Expected:
- A `has: false` log fires first (initial reactive flush before `loadWalkthrough()` resolves), then a `has: true` log fires shortly after — for a session that has a walkthrough.
- For a session with no walkthrough: only `has: false` logs fire (the null→null no-op after fetch doesn't retrigger).
- Hosts treat the latest message as authoritative — document this expectation when wiring up periscope.

Then trigger an MCP `set_walkthrough` (or clear it) and confirm another message fires with the updated value.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/ProjectView.tsx
git commit -m "embed: postMessage walkthrough availability to host so it can toggle its tab"
```

---

## Task 3: Hide in-frame mode-switch UI when embedded

**Files:**
- Modify: `frontend/src/components/header/Header.tsx`
- Modify: `frontend/src/style.css`

- [ ] **Step 1: Tag the Header walkthrough toggle with a stable class**

In `Header.tsx`, find the walkthrough toggle button around line 121-136 and add a class:

```tsx
// before:
<button
  class="header-btn"
  classList={{ 'header-btn-active': walkthroughMode() }}
  onClick={() => setWalkthroughMode(!walkthroughMode())}
  title="Walkthrough (W)"
>

// after:
<button
  class="header-btn header-walkthrough-toggle"
  classList={{ 'header-btn-active': walkthroughMode() }}
  onClick={() => setWalkthroughMode(!walkthroughMode())}
  title="Walkthrough (W)"
>
```

Only the `class=` attribute changes — everything else stays the same.

- [ ] **Step 2: Add CSS rules to hide the back button and toggle in embedded mode**

In `frontend/src/style.css`, find the existing embedded block at line 3049-3057 and append to it:

```css
/* In embedded mode the host (e.g. periscope) provides tab switching between
   diff and walkthrough, so the in-frame mode-switch affordances are
   redundant. Hide them so each iframe presents a single, focused surface. */
body.embedded .wt-back,
body.embedded .header-walkthrough-toggle {
  display: none !important;
}
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev:all`

Open `http://localhost:9900/project/<slug>?embedded=1&view=walkthrough`. Expected:
- No "← Back to diff" button visible at the top of the walkthrough surface.
- No "Walkthrough" toggle button in the header row.
- The walkthrough title and progress indicator remain visible. Note: with `.wt-back` hidden, `.wt-topbar` (flex with `justify-content: space-between`) now has two children — title pins to the left, progress to the right. If that looks off, add `body.embedded .wt-topbar { justify-content: flex-end; }` to the same CSS block.

Open `http://localhost:9900/project/<slug>` (non-embedded). Expected: both buttons present and functional, as before.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/header/Header.tsx frontend/src/style.css
git commit -m "embed: hide in-frame walkthrough mode-switch UI; host owns tab switching"
```

---

## Task 4: End-to-end manual verification

- [ ] **Step 1: Run full local check**

```bash
npm run lint && npm run format:check && npm test
```

Expected: all green. If lint/format fail on touched files, run `npm run format` and re-run.

- [ ] **Step 2: Two-iframe smoke test**

Create a throwaway HTML file (`/tmp/lgtm-embed-test.html`) — do NOT commit it:

```html
<!doctype html>
<html><body>
  <h2>Diff</h2>
  <iframe id="diff" src="http://localhost:9900/project/<slug>?embedded=1&view=diff" width="900" height="400"></iframe>
  <h2>Walkthrough</h2>
  <iframe id="wt" src="http://localhost:9900/project/<slug>?embedded=1&view=walkthrough" width="900" height="400"></iframe>
  <script>
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'lgtm-walkthrough-availability') console.log('availability:', e.data.has);
      if (e.data?.type === 'lgtm-embedded-escape') console.log('escape forwarded');
    });
  </script>
</body></html>
```

Open this file directly in the browser with `npm run dev:all` running. Replace `<slug>` with a real project slug that has both a diff and a walkthrough set.

Verify:
- Diff iframe shows the diff surface; no header-top, no tab bar, no walkthrough toggle.
- Walkthrough iframe shows the walkthrough surface; no header-top, no tab bar, no "Back to diff" button.
- Console shows exactly one `availability: true` log from the walkthrough iframe (the diff iframe also runs the effect and posts an identical message — that's fine, the host will just see both).
- Adding a comment in the diff iframe causes it to appear in the walkthrough iframe (and vice versa) via SSE.
- Pressing Escape inside either iframe (with focus not on a textarea) logs `escape forwarded`.

- [ ] **Step 3: Confirm graceful fallback for sessions without a walkthrough**

In an LGTM project where `set_walkthrough` has NOT been called:
- Open `?embedded=1&view=walkthrough`. Expected: `EmptyState` renders inside the walkthrough surface; console logs `availability: false`.

---

## Out of Scope (deferred)

- **Stale banner emphasis in embedded mode.** The current `StaleBanner` is fine; if it turns out to be missed in isolation, treat it as a follow-up.
- **Item switching coordination between the two iframes.** Each iframe just renders its URL. If the host wants to keep them in sync on item changes, that's a host-side concern (periscope reloads or updates the iframe `src`).
- **Disabling the walkthrough-mode keyboard shortcuts inside embedded mode.** `Shift+W` enters walkthrough and `d` exits to diff (per `useKeyboardShortcuts.ts:92-122`). With the visible toggles hidden, these shortcuts still work and will produce a confusing in-frame mode switch (e.g. diff appearing inside the walkthrough iframe). Low-impact, easy to recover by reload. Revisit if it becomes a real complaint.
- **Pop-out-to-full-review link.** Not needed when the host provides a diff tab. If a non-Periscope embed wants this, add it then.
