import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'api-unit',
          include: ['apps/api/tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'api-integration',
          include: ['apps/api/tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 15_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'web-ui',
          include: ['apps/web/tests/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./apps/web/tests/setup.ts'],
          testTimeout: 15_000,
        },
      },
    ],
  },
});
