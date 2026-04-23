import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../diff-hash.js';

describe('sha256Hex', () => {
  it('returns 64-char hex', () => {
    expect(sha256Hex('')).toHaveLength(64);
  });

  it('is deterministic', () => {
    expect(sha256Hex('diff --git a/b a/b\n+line')).toBe(sha256Hex('diff --git a/b a/b\n+line'));
  });

  it('differs for different input', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });
});
