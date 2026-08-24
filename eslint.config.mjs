// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Single flat config for the whole monorepo. Each workspace runs `eslint .`
 * and ESLint walks up to this file, so rules stay consistent everywhere.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
      'apps/web/public/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },

  // Domain must stay pure: no framework, no I/O, no platform globals.
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nestjs/*', 'next/*', 'react', 'react-dom', 'drizzle-orm*', 'ioredis', 'pg'],
              message:
                'The domain layer must remain free of frameworks and infrastructure. Move this to application or infrastructure.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'The domain layer performs no I/O.' },
        { name: 'process', message: 'The domain layer reads no environment.' },
      ],
    },
  },

  /**
   * NestJS reads constructor parameter types at runtime through
   * `emitDecoratorMetadata`. Rewriting those imports to `import type` erases
   * them from the output and dependency injection silently resolves to
   * `Object`, so the rule is off for the API rather than selectively ignored
   * file by file.
   */
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  // Database CLI scripts report progress to a terminal.
  {
    files: ['apps/api/src/infrastructure/persistence/drizzle/{seed,migrate,smoke}.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // React surfaces.
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...(reactHooks.configs['recommended-latest']?.rules ?? reactHooks.configs.recommended.rules),
    },
  },

  // Tests may be looser.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/e2e/**/*.ts', '**/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Config files.
  {
    files: ['**/*.config.{js,mjs,cjs,ts}', '**/*.cjs', '**/scripts/**/*.{ts,mjs}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  prettier,
);
