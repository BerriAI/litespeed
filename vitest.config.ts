import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], exclude: ['tests/e2e/**'], testTimeout: process.env.CI ? 30000 : 15000, ...(process.env.CI ? { maxWorkers: 2 } : {}) } });
