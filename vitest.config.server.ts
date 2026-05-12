import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.ts'],
    environment: 'node',
    // Many server tests shell out to git/gh (detectBaseBranch alone allows gh
    // up to 5s); under parallel load that easily exceeds vitest's 5s default.
    testTimeout: 30_000,
  },
});
