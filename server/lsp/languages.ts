import type { Language } from './types.js';

export interface LanguageConfig {
  command: string;
  args: string[];
  initializeTimeoutMs: number;
  initializationOptions?: Record<string, unknown>;
  experimentalCapabilities?: Record<string, unknown>;
  /** Whether this language requires `textDocument/didOpen` before requests resolve. */
  requiresOpen: boolean;
  /** For rust-analyzer: wait for experimental/serverStatus quiescent before ready. */
  waitForServerStatus?: boolean;
}

export function extensionToLanguage(filename: string): Language | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'typescript';
  if (lower.endsWith('.rs')) return 'rust';
  return null;
}

const CONFIGS: Record<Language, LanguageConfig> = {
  python: {
    command: 'ty',
    args: ['server'],
    initializeTimeoutMs: 10_000,
    requiresOpen: true,
  },
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    initializeTimeoutMs: 15_000,
    requiresOpen: true,
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    initializeTimeoutMs: 180_000,
    experimentalCapabilities: { serverStatusNotification: true },
    initializationOptions: { check: { targetDir: true } },
    requiresOpen: true,
    waitForServerStatus: true,
  },
};

export function getLanguageConfig(language: Language): LanguageConfig {
  return CONFIGS[language];
}
