import { describe, it, expect } from 'vitest';
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
    expect(result).toEqual({
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
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['src/auth.ts'].priority).toBe('critical');
    expect(result['tests/auth.test.ts'].priority).toBe('normal');
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
    expect(result['server/app.ts'].summary).toBe(
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
    expect(() => parseFileAnalysis(md)).toThrow(/Invalid priority "ultra"/);
  });

  it('throws on invalid phase', () => {
    const md = `## file.ts
- priority: normal
- phase: glance
- category: core

Summary.
`;
    expect(() => parseFileAnalysis(md)).toThrow(/Invalid phase "glance"/);
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
    expect(result['src/auth.ts'].priority).toBe('critical');
    expect(result['src/auth.ts'].summary).toBe('New auth middleware.');
  });

  it('throws on invalid priority in JSON fallback', () => {
    const json = JSON.stringify({
      'file.ts': { priority: 'ultra', phase: 'review', summary: 'x', category: 'y' },
    });
    expect(() => parseFileAnalysis(json)).toThrow(/Invalid priority "ultra"/);
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
    expect(result.overview).toBe('This PR refactors the frontend into focused modules.');
    expect(result.reviewStrategy).toBe(
      'Start with server/git-ops.ts since the throw-on-failure change affects every caller.',
    );
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].name).toBe('Server core changes');
    expect(result.groups[0].description).toBe('Git ops behavior change, MCP refactor');
    expect(result.groups[0].files).toEqual(['server/git-ops.ts', 'server/mcp.ts']);
    expect(result.groups[1].name).toBe('Frontend extraction');
    expect(result.groups[1].description).toBeUndefined();
    expect(result.groups[1].files).toEqual(['frontend/src/diff.ts', 'frontend/src/ui.ts']);
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
    expect(result.groups[0].description).toBeUndefined();
    expect(result.groups[0].files).toEqual(['package.json', 'tsconfig.json']);
  });

  it('throws on missing overview', () => {
    const md = `## Review Strategy

Strategy text.

## Groups

### Group
- file.ts
`;
    expect(() => parseSynthesis(md)).toThrow(/Missing ## Overview/);
  });

  it('throws on missing review strategy', () => {
    const md = `## Overview

Overview text.

## Groups

### Group
- file.ts
`;
    expect(() => parseSynthesis(md)).toThrow(/Missing ## Review Strategy/);
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
    expect(result.overview).toBe('First paragraph of the overview.\n\nSecond paragraph with more detail.');
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
    expect(result.overview).toBe('PR overview text.');
    expect(result.reviewStrategy).toBe('Start with auth files.');
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].description).toBe('Auth logic');
    expect(result.groups[1].description).toBeUndefined();
  });

  it('throws on missing overview in JSON fallback', () => {
    const json = JSON.stringify({ reviewStrategy: 'x', groups: [] });
    expect(() => parseSynthesis(json)).toThrow(/Missing overview/);
  });
});
