import { describe, it, expect } from 'vitest';
import { escapeHtml, detectLang, highlightLines } from '../utils';

describe('escapeHtml', () => {
  it('escapes special characters', () => {
    expect(escapeHtml('<div class="foo">&bar</div>')).toBe('&lt;div class=&quot;foo&quot;&gt;&amp;bar&lt;/div&gt;');
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('detectLang', () => {
  it('detects common extensions', () => {
    expect(detectLang('src/app.ts')).toBe('typescript');
    expect(detectLang('main.py')).toBe('python');
    expect(detectLang('lib/utils.go')).toBe('go');
    expect(detectLang('style.css')).toBe('css');
    expect(detectLang('config.json')).toBe('json');
    expect(detectLang('README.md')).toBe('markdown');
  });

  it('detects special filenames', () => {
    expect(detectLang('Dockerfile')).toBe('dockerfile');
    expect(detectLang('Makefile')).toBe('makefile');
    expect(detectLang('Gemfile')).toBe('ruby');
  });

  it('returns null for unknown extensions', () => {
    expect(detectLang('data.xyz')).toBeNull();
    expect(detectLang('noext')).toBeNull();
  });
});

describe('highlightLines', () => {
  it('returns one entry per input line', () => {
    const out = highlightLines(['def foo():', '    return 1', '    # bye'], 'python');
    expect(out).toHaveLength(3);
  });

  it('carries multi-line string state across lines (the reported bug)', () => {
    // Python triple-quoted docstring opens on line 1, closes on line 3.
    // Per-line highlighting would treat lines 2 and 3 as code; block
    // highlighting keeps all three inside a hljs-string span.
    const lines = ['"""first', 'second', 'third"""'];
    const out = highlightLines(lines, 'python');
    expect(out).toHaveLength(3);
    // Every line must be wrapped in the string span class for the docstring to read as one token.
    for (const line of out) {
      expect(line).toContain('hljs-string');
    }
    // Line 2 ("second") must not contain a keyword/built-in span — proving the
    // tokenizer didn't reset to code mode.
    expect(out[1]).not.toMatch(/hljs-keyword|hljs-built_in/);
  });

  it('reopens spans cleanly so each line is independently valid HTML', () => {
    const out = highlightLines(['"""a', 'b', 'c"""'], 'python');
    for (const line of out) {
      const opens = (line.match(/<span\b/g) ?? []).length;
      const closes = (line.match(/<\/span>/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });

  it('falls back to escaped text when language is unknown', () => {
    const out = highlightLines(['<x>', 'y & z'], '');
    expect(out).toEqual(['&lt;x&gt;', 'y &amp; z']);
  });

  it('handles a single line with no newlines', () => {
    const out = highlightLines(['def foo():'], 'python');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('hljs-keyword');
  });

  it('handles empty lines without collapsing', () => {
    const out = highlightLines(['a = 1', '', 'b = 2'], 'python');
    expect(out).toHaveLength(3);
    expect(out[1]).toBe('');
  });
});
