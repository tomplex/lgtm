import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findSymbol } from '../symbol-lookup.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

function makeRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symbol-lookup-test-'));
  execSync('git init', { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return dir;
}

let repoDir: string;

afterEach(() => {
  if (repoDir && fs.existsSync(repoDir)) {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});

describe('findSymbol', () => {
  it('finds a Python function with docstring', () => {
    repoDir = makeRepo({
      'utils.py': `def greet(name):
    """Say hello to a person."""
    return f"Hello, {name}"

def other():
    pass
`,
    });

    const results = findSymbol(repoDir, 'greet');
    expect(results).toHaveLength(1);
    expect(results[0].file).toContain('utils.py');
    expect(results[0].line).toBe(1);
    expect(results[0].kind).toBe('function');
    expect(results[0].body).toContain('def greet(name):');
    expect(results[0].body).toContain('return f"Hello, {name}"');
    expect(results[0].body).not.toContain('def other');
    expect(results[0].docstring).toBe('Say hello to a person.');
  });

  it('finds a Python class with body including all methods but not the next class', () => {
    repoDir = makeRepo({
      'models.py': `class Animal:
    """Base animal class."""

    def __init__(self, name):
        self.name = name

    def speak(self):
        raise NotImplementedError

class Dog(Animal):
    def speak(self):
        return "Woof"
`,
    });

    const results = findSymbol(repoDir, 'Animal');
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('class');
    expect(results[0].body).toContain('class Animal:');
    expect(results[0].body).toContain('def __init__');
    expect(results[0].body).toContain('def speak');
    expect(results[0].body).not.toContain('class Dog');
    expect(results[0].docstring).toBe('Base animal class.');
  });

  it('finds a TypeScript function', () => {
    repoDir = makeRepo({
      'helpers.ts': `export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function parseDate(s: string): Date {
  return new Date(s);
}
`,
    });

    const results = findSymbol(repoDir, 'formatDate');
    expect(results).toHaveLength(1);
    expect(results[0].file).toContain('helpers.ts');
    expect(results[0].kind).toBe('function');
    expect(results[0].body).toContain('function formatDate');
    expect(results[0].body).toContain("toISOString().split('T')[0]");
    expect(results[0].body).not.toContain('parseDate');
  });

  it('finds a TypeScript interface with JSDoc', () => {
    repoDir = makeRepo({
      'types.ts': `/** Represents a user in the system. */
export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Post {
  id: number;
  title: string;
}
`,
    });

    const results = findSymbol(repoDir, 'User');
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('interface');
    expect(results[0].body).toContain('interface User');
    expect(results[0].body).toContain('email: string');
    expect(results[0].body).not.toContain('interface Post');
    expect(results[0].docstring).toBe('Represents a user in the system.');
  });

  it('finds an arrow function const', () => {
    repoDir = makeRepo({
      'utils.ts': `export const double = (n: number): number => {
  return n * 2;
};

export const triple = (n: number): number => {
  return n * 3;
};
`,
    });

    const results = findSymbol(repoDir, 'double');
    expect(results).toHaveLength(1);
    expect(results[0].kind).toBe('variable');
    expect(results[0].body).toContain('double');
    expect(results[0].body).toContain('n * 2');
    expect(results[0].body).not.toContain('triple');
  });

  it('returns empty array for unknown symbol', () => {
    repoDir = makeRepo({
      'app.ts': `export function hello(): void {
  console.log('hi');
}
`,
    });

    const results = findSymbol(repoDir, 'nonExistentSymbolXYZ');
    expect(results).toEqual([]);
  });

  it('caps results at 10', () => {
    // Create 15 files each defining the same symbol
    const files: Record<string, string> = {};
    for (let i = 0; i < 15; i++) {
      files[`file${i}.py`] = `def myFunc():\n    pass\n`;
    }
    repoDir = makeRepo(files);

    const results = findSymbol(repoDir, 'myFunc');
    expect(results.length).toBeLessThanOrEqual(10);
  });
});
