import { describe, it, expect } from 'vitest';
import { escapeHtml, detectLang, highlightLines, highlightDiffLines } from '../utils';
import type { DiffLine } from '../state';

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

describe('highlightDiffLines', () => {
  // A new function added below a module-level multi-line SQL string. The diff
  // hunk's first context line is the *tail* of that string (`...'{date}'"""`),
  // so the closing `"""` has no opening context inside the hunk.
  const NEW_FILE = [
    'STATS_SQL = """',
    'SELECT *',
    'FROM t p',
    'WHERE DATE(p.fdy_datetime) = \'{date_str}\'"""',
    '',
    '',
    'def generate_zscore_insert_sql(',
    '    target: Locator,',
    ') -> str:',
    '    """Generate INSERT INTO ... SELECT ... for z-scoring a partition.',
    '',
    '    Same SELECT shape as the other helper; this wraps it.',
    '    """',
    '    col_list = sep.join(cols)',
    '    return makesql(target, col_list)',
  ];

  // The diff hunk that adds the function, starting on that string-tail context line.
  const DIFF_LINES: DiffLine[] = [
    { type: 'hunk', content: '@@ -4,3 +4,12 @@', oldLine: null, newLine: null },
    { type: 'context', content: NEW_FILE[3], oldLine: 4, newLine: 4 },
    { type: 'context', content: '', oldLine: 5, newLine: 5 },
    { type: 'context', content: '', oldLine: 6, newLine: 6 },
    ...NEW_FILE.slice(6).map((content, i): DiffLine => ({ type: 'add', content, oldLine: null, newLine: 7 + i })),
  ];

  const lineByContent = (out: string[], content: string) => out[DIFF_LINES.findIndex((l) => l.content === content)];

  it('returns one HTML entry per input line, blank for hunk rows', () => {
    const out = highlightDiffLines(DIFF_LINES, 'python', NEW_FILE);
    expect(out).toHaveLength(DIFF_LINES.length);
    expect(out[0]).toBe('');
  });

  it('keeps code after a docstring as code when the hunk opens mid-string', () => {
    // The reported bug: per-hunk highlighting reads the hunk's leading `"""`
    // (a string *tail*) as an opening quote, inverting string/code coloring so
    // the function body below the docstring renders as one big string.
    const out = highlightDiffLines(DIFF_LINES, 'python', NEW_FILE);

    // `def` is a keyword, not swallowed into the string tail above it.
    expect(lineByContent(out, 'def generate_zscore_insert_sql(')).toContain('hljs-keyword');
    // The docstring body reads as a string.
    expect(lineByContent(out, '    Same SELECT shape as the other helper; this wraps it.')).toContain('hljs-string');
    // Code *after* the docstring is code — `return` is still a keyword.
    expect(lineByContent(out, '    return makesql(target, col_list)')).toContain('hljs-keyword');
  });

  it('falls back to per-hunk highlighting when no file content is supplied', () => {
    const out = highlightDiffLines(DIFF_LINES, 'python', null);
    expect(out).toHaveLength(DIFF_LINES.length);
    // Still produces valid per-line HTML (balanced spans) even without context.
    for (const line of out) {
      const opens = (line.match(/<span\b/g) ?? []).length;
      const closes = (line.match(/<\/span>/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });

  it('escapes content unchanged when language is unknown', () => {
    const lines: DiffLine[] = [{ type: 'add', content: 'a < b && c', oldLine: null, newLine: 1 }];
    expect(highlightDiffLines(lines, null, null)).toEqual(['a &lt; b &amp;&amp; c']);
  });
});
