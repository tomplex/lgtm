import { describe, it, expect } from 'vitest';
import { escapeHtml, detectLang } from '../utils';

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
