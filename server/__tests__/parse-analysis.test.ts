import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFileAnalysis, parseSynthesis } from '../parse-analysis.js';

describe('parseFileAnalysis', () => {
  it('parses a single file block', () => {
    const md = `## server/git-ops.ts
- priority: critical
- phase: review
- category: core logic

gitRun now throws on failure instead of returning empty string.
`;
    const result = parseFileAnalysis(md);
    assert.deepStrictEqual(result, {
      'server/git-ops.ts': {
        priority: 'critical',
        phase: 'review',
        category: 'core logic',
        summary: 'gitRun now throws on failure instead of returning empty string.',
      },
    });
  });

  it('parses multiple file blocks', () => {
    const md = `## src/auth.ts
- priority: critical
- phase: review
- category: core logic

New auth middleware.

## tests/auth.test.ts
- priority: normal
- phase: skim
- category: test

Unit tests for auth middleware.
`;
    const result = parseFileAnalysis(md);
    assert.equal(Object.keys(result).length, 2);
    assert.equal(result['src/auth.ts'].priority, 'critical');
    assert.equal(result['tests/auth.test.ts'].priority, 'normal');
  });

  it('handles multi-line summaries', () => {
    const md = `## server/app.ts
- priority: important
- phase: review
- category: core logic

Adds a global JSON error handler middleware.
The error handler placement relative to static file serving is worth verifying.
`;
    const result = parseFileAnalysis(md);
    assert.equal(
      result['server/app.ts'].summary,
      'Adds a global JSON error handler middleware. The error handler placement relative to static file serving is worth verifying.',
    );
  });

  it('throws on invalid priority', () => {
    const md = `## file.ts
- priority: ultra
- phase: review
- category: core

Summary.
`;
    assert.throws(() => parseFileAnalysis(md), /Invalid priority "ultra"/);
  });

  it('throws on invalid phase', () => {
    const md = `## file.ts
- priority: normal
- phase: glance
- category: core

Summary.
`;
    assert.throws(() => parseFileAnalysis(md), /Invalid phase "glance"/);
  });

  it('handles JSON fallback', () => {
    const json = JSON.stringify({
      'src/auth.ts': {
        priority: 'critical',
        phase: 'review',
        summary: 'New auth middleware.',
        category: 'core logic',
      },
    });
    const result = parseFileAnalysis(json);
    assert.equal(result['src/auth.ts'].priority, 'critical');
    assert.equal(result['src/auth.ts'].summary, 'New auth middleware.');
  });

  it('throws on invalid priority in JSON fallback', () => {
    const json = JSON.stringify({
      'file.ts': { priority: 'ultra', phase: 'review', summary: 'x', category: 'y' },
    });
    assert.throws(() => parseFileAnalysis(json), /Invalid priority "ultra"/);
  });
});

describe('parseSynthesis', () => {
  it('parses overview, strategy, and groups', () => {
    const md = `## Overview

This PR refactors the frontend into focused modules.

## Review Strategy

Start with server/git-ops.ts since the throw-on-failure change affects every caller.

## Groups

### Server core changes
Git ops behavior change, MCP refactor
- server/git-ops.ts
- server/mcp.ts

### Frontend extraction
- frontend/src/diff.ts
- frontend/src/ui.ts
`;
    const result = parseSynthesis(md);
    assert.equal(result.overview, 'This PR refactors the frontend into focused modules.');
    assert.equal(result.reviewStrategy, 'Start with server/git-ops.ts since the throw-on-failure change affects every caller.');
    assert.equal(result.groups.length, 2);
    assert.equal(result.groups[0].name, 'Server core changes');
    assert.equal(result.groups[0].description, 'Git ops behavior change, MCP refactor');
    assert.deepStrictEqual(result.groups[0].files, ['server/git-ops.ts', 'server/mcp.ts']);
    assert.equal(result.groups[1].name, 'Frontend extraction');
    assert.equal(result.groups[1].description, undefined);
    assert.deepStrictEqual(result.groups[1].files, ['frontend/src/diff.ts', 'frontend/src/ui.ts']);
  });

  it('handles groups without descriptions', () => {
    const md = `## Overview

Overview text.

## Review Strategy

Strategy text.

## Groups

### Build files
- package.json
- tsconfig.json
`;
    const result = parseSynthesis(md);
    assert.equal(result.groups[0].description, undefined);
    assert.deepStrictEqual(result.groups[0].files, ['package.json', 'tsconfig.json']);
  });

  it('throws on missing overview', () => {
    const md = `## Review Strategy

Strategy text.

## Groups

### Group
- file.ts
`;
    assert.throws(() => parseSynthesis(md), /Missing ## Overview/);
  });

  it('throws on missing review strategy', () => {
    const md = `## Overview

Overview text.

## Groups

### Group
- file.ts
`;
    assert.throws(() => parseSynthesis(md), /Missing ## Review Strategy/);
  });

  it('handles multi-paragraph overview', () => {
    const md = `## Overview

First paragraph of the overview.

Second paragraph with more detail.

## Review Strategy

Strategy text.

## Groups

### Group
- file.ts
`;
    const result = parseSynthesis(md);
    assert.equal(result.overview, 'First paragraph of the overview.\n\nSecond paragraph with more detail.');
  });

  it('handles JSON fallback', () => {
    const json = JSON.stringify({
      overview: 'PR overview text.',
      reviewStrategy: 'Start with auth files.',
      groups: [
        { name: 'Auth', description: 'Auth logic', files: ['auth.ts'] },
        { name: 'Tests', files: ['test.ts'] },
      ],
    });
    const result = parseSynthesis(json);
    assert.equal(result.overview, 'PR overview text.');
    assert.equal(result.reviewStrategy, 'Start with auth files.');
    assert.equal(result.groups.length, 2);
    assert.equal(result.groups[0].description, 'Auth logic');
    assert.equal(result.groups[1].description, undefined);
  });

  it('throws on missing overview in JSON fallback', () => {
    const json = JSON.stringify({ reviewStrategy: 'x', groups: [] });
    assert.throws(() => parseSynthesis(json), /Missing overview/);
  });
});
