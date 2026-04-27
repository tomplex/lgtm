import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitRun } from '../git-ops.js';
const execFileAsync = promisify(execFile);
const INSTALLERS = {
    python: {
        installer: 'uv',
        command: ['uv', 'tool', 'install', 'ty'],
        displayCommand: 'uv tool install ty',
    },
    typescript: {
        installer: 'npm',
        command: ['npm', 'install', '-g', 'typescript-language-server', 'typescript'],
        displayCommand: 'npm install -g typescript-language-server typescript',
    },
    rust: {
        installer: 'rustup',
        command: ['rustup', 'component', 'add', 'rust-analyzer'],
        displayCommand: 'rustup component add rust-analyzer',
    },
};
const EXTS = {
    python: ['.py'],
    typescript: ['.ts', '.tsx', '.js', '.jsx'],
    rust: ['.rs'],
};
const ALL = ['python', 'typescript', 'rust'];
export function getInstaller(language) {
    return INSTALLERS[language];
}
export function detectLanguagesInRepo(repoPath) {
    const present = new Set();
    let output;
    try {
        output = gitRun(repoPath, 'ls-files');
    }
    catch {
        return present;
    }
    for (const line of output.split('\n')) {
        const lower = line.toLowerCase();
        for (const lang of ALL) {
            if (EXTS[lang].some((ext) => lower.endsWith(ext)))
                present.add(lang);
        }
    }
    return present;
}
export async function isInstallerAvailable(installer) {
    try {
        await execFileAsync('which', [installer], { env: spawnEnv() });
        return true;
    }
    catch {
        return false;
    }
}
export async function runInstaller(language) {
    const inst = INSTALLERS[language];
    try {
        const { stdout, stderr } = await execFileAsync(inst.command[0], inst.command.slice(1), {
            env: spawnEnv(),
            timeout: 10 * 60_000,
            maxBuffer: 8 * 1024 * 1024,
        });
        return {
            language,
            ok: true,
            stdout: stdout.toString(),
            stderr: stderr.toString(),
            exitCode: 0,
            command: inst.displayCommand,
        };
    }
    catch (err) {
        const e = err;
        return {
            language,
            ok: false,
            stdout: e.stdout?.toString() ?? '',
            stderr: e.stderr?.toString() ?? e.message ?? '',
            exitCode: typeof e.code === 'number' ? e.code : null,
            command: inst.displayCommand,
        };
    }
}
/**
 * Augment PATH with common install dirs so binaries installed via uv / npm -g / rustup
 * are findable even when the server was launched from a context with a stripped PATH.
 * Used both for `which` checks and for spawning LSP processes.
 */
export function spawnEnv() {
    const home = process.env.HOME || '';
    const extras = [
        home && `${home}/.local/bin`,
        home && `${home}/.cargo/bin`,
        home && `${home}/.npm-global/bin`,
        '/opt/homebrew/bin',
        '/usr/local/bin',
    ].filter(Boolean);
    const parts = (process.env.PATH ?? '').split(':');
    for (const dir of extras) {
        if (!parts.includes(dir))
            parts.unshift(dir);
    }
    return { ...process.env, PATH: parts.join(':') };
}
