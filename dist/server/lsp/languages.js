export function extensionToLanguage(filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.py'))
        return 'python';
    if (lower.endsWith('.ts') || lower.endsWith('.tsx'))
        return 'typescript';
    if (lower.endsWith('.js') || lower.endsWith('.jsx'))
        return 'typescript';
    if (lower.endsWith('.rs'))
        return 'rust';
    return null;
}
const CONFIGS = {
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
export function getLanguageConfig(language) {
    return CONFIGS[language];
}
