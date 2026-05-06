# Help modal: `?` opens a keyboard-shortcuts overlay

## Problem

LGTM has ~20 keyboard shortcuts split across three modes (sidebar nav, comment editing, walkthrough). New users don't know they exist; experienced users forget the less-used ones (`[`/`]` for folder jumps, `o` to toggle a folder collapsed). The README has a shortcut table but reading it requires leaving the review.

We need an in-app reference that's discoverable and dismissable without a full settings page.

## Proposal

Add a `?` keyboard shortcut that opens a modal listing every keyboard shortcut, grouped by section (Navigation, Review, Walkthrough, Global). The modal is purely informational — no settings, no rebinding, no state.

## Interaction

- `?` from any non-input context opens the modal.
- `?` again, `Esc`, or click outside closes it.
- Modal is keyboard-focusable; arrow keys do nothing inside it (intentional — it's a reference card, not a navigable list).

## Visual

Two-column grid on desktop, single column under 600px. Each section has a small uppercase header. Each row is `<kbd>` keycaps + a description, rendered via a `<dl>` for semantic correctness.

The shortcut data lives in `frontend/src/components/help/shortcuts.ts` as a typed list. Adding a new shortcut means adding a row to that file — the modal renders it automatically.

## Why not a tooltip / footer hint?

We already have the `keyboard-hint` footer for context-specific tips ("Click any block to comment · Cmd+Enter save · Esc cancel" in document mode). That's good for the *current* mode's most relevant 1–3 shortcuts. The help modal serves the different need of "what else can I do here?" — a comprehensive cheatsheet you summon when you're forgetful or curious.

## Implementation notes

- `helpModalOpen` signal in `state.ts` mirrors the existing `paletteOpen`/`symbolSearchOpen` pattern.
- `useKeyboardShortcuts` gets a new `onOpenHelp` option, called when `?` is pressed outside text inputs.
- The modal closes on `Escape` and on a second `?` press, matching the symmetry of the existing palette behavior.
- Component file: `frontend/src/components/help/HelpModal.tsx`. Data file: `frontend/src/components/help/shortcuts.ts`. CSS lives next to the project palette styles in `style.css`.

## Out of scope

- Rebinding shortcuts (no settings UI in LGTM, period — keys are hardcoded).
- Translating shortcuts per OS (everything is Cmd-style; Linux/Windows users get the same keycaps).
- Animating the modal in/out.
- Highlighting the most-recently-used shortcut.

## Open questions

1. Should `?` work inside text inputs too (with Esc-out-then-`?`)? Current answer: no — keep it consistent with all other letter shortcuts which are suppressed inside textareas.
2. Should the modal be keyboard-navigable (arrow keys to scroll sections)? Current answer: no — the body is short enough to fit on screen at default sizes; native scroll is fine.
