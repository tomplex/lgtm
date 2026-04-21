import { describe, it, expect } from 'vitest';
import { toFileUri, fromFileUri, realPath } from '../../lsp/uri.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('toFileUri / fromFileUri', () => {
  it('round-trips a plain absolute path', () => {
    const p = '/tmp/foo/bar.ts';
    const uri = toFileUri(p);
    expect(uri.startsWith('file://')).toBe(true);
    expect(fromFileUri(uri)).toBe(p);
  });

  it('handles spaces and unicode', () => {
    const p = '/tmp/path with spaces/файл.py';
    expect(fromFileUri(toFileUri(p))).toBe(p);
  });
});

describe('realPath', () => {
  it('resolves symlinks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsp-uri-'));
    const real = path.join(dir, 'real.txt');
    const link = path.join(dir, 'link.txt');
    fs.writeFileSync(real, '');
    fs.symlinkSync(real, link);
    expect(realPath(link)).toBe(fs.realpathSync(real));
    fs.rmSync(dir, { recursive: true });
  });

  it('returns input when file does not exist', () => {
    expect(realPath('/does/not/exist')).toBe('/does/not/exist');
  });
});
