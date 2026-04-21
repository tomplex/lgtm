import { describe, it, expect } from 'vitest';
import { extensionToLanguage, getLanguageConfig } from '../../lsp/languages.js';

describe('extensionToLanguage', () => {
  it('maps Python files', () => {
    expect(extensionToLanguage('foo.py')).toBe('python');
  });

  it('maps TypeScript files', () => {
    expect(extensionToLanguage('foo.ts')).toBe('typescript');
    expect(extensionToLanguage('foo.tsx')).toBe('typescript');
    expect(extensionToLanguage('foo.js')).toBe('typescript');
    expect(extensionToLanguage('foo.jsx')).toBe('typescript');
  });

  it('maps Rust files', () => {
    expect(extensionToLanguage('foo.rs')).toBe('rust');
  });

  it('returns null for unsupported extensions', () => {
    expect(extensionToLanguage('foo.md')).toBe(null);
    expect(extensionToLanguage('foo')).toBe(null);
    expect(extensionToLanguage('foo.go')).toBe(null);
  });
});

describe('getLanguageConfig', () => {
  it('python config uses ty with LSP args', () => {
    const cfg = getLanguageConfig('python');
    expect(cfg.command).toBe('ty');
    expect(cfg.args).toContain('server');
    expect(cfg.initializeTimeoutMs).toBe(10_000);
  });

  it('typescript config uses typescript-language-server with stdio', () => {
    const cfg = getLanguageConfig('typescript');
    expect(cfg.command).toBe('typescript-language-server');
    expect(cfg.args).toContain('--stdio');
    expect(cfg.initializeTimeoutMs).toBe(15_000);
  });

  it('rust config uses rust-analyzer with serverStatus capability + per-worktree targetDir', () => {
    const cfg = getLanguageConfig('rust');
    expect(cfg.command).toBe('rust-analyzer');
    expect(cfg.experimentalCapabilities).toEqual({ serverStatusNotification: true });
    expect(cfg.initializationOptions).toMatchObject({ check: { targetDir: true } });
    expect(cfg.initializeTimeoutMs).toBe(180_000);
  });
});
