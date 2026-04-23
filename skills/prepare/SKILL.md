---
name: prepare
description: >
  Generate full review preparation for an LGTM session: classification (analyze)
  + narrated walkthrough. Convenience skill that chains /lgtm analyze and
  /lgtm walkthrough. Use when the user asks to prepare a review, or wants
  everything ready before opening the UI.
---

# Prepare Skill

Run both analysis and walkthrough generation for an active LGTM review session.

## Pipeline

### Step 1: Analyze

Invoke the `analyze` skill. Follow its full pipeline (file-classifier + synthesizer
agents, then `set_analysis`).

### Step 2: Walkthrough

Invoke the `walkthrough` skill. Follow its full pipeline (walkthrough-author agent,
then `set_walkthrough`).

## On errors

If `/lgtm analyze` fails, stop and report. Don't attempt walkthrough — it's
independent, but running it while analysis is broken surfaces more confusion
than it solves.

If `/lgtm walkthrough` fails after analysis succeeded, report the walkthrough
error and note that analysis is complete and usable on its own.
