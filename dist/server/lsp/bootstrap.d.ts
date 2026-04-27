import type { Language } from './types.js';
export interface Installer {
    installer: string;
    command: string[];
    displayCommand: string;
}
export declare function getInstaller(language: Language): Installer;
export declare function detectLanguagesInRepo(repoPath: string): Set<Language>;
export declare function isInstallerAvailable(installer: string): Promise<boolean>;
export interface InstallResult {
    language: Language;
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    command: string;
}
export declare function runInstaller(language: Language): Promise<InstallResult>;
/**
 * Augment PATH with common install dirs so binaries installed via uv / npm -g / rustup
 * are findable even when the server was launched from a context with a stripped PATH.
 * Used both for `which` checks and for spawning LSP processes.
 */
export declare function spawnEnv(): NodeJS.ProcessEnv;
