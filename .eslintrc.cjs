module.exports = {
  root: true,
  env: { node: true, es2022: true, browser: true },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:svelte/recommended',
    'prettier'
  ],
  overrides: [
    {
      files: ['**/*.svelte'],
      parser: 'svelte-eslint-parser',
      parserOptions: {
        parser: {
          ts: '@typescript-eslint/parser'
        },
        extraFileExtensions: ['.svelte']
      },
      rules: {
        // Example relaxations if needed:
        'svelte/no-at-debug-tags': 'warn'
      }
    },
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser'
    }
  ],
  plugins: ['@typescript-eslint', 'svelte'],
  rules: {
    // Potentially noisy with generated/3rd-party code inside node_modules (already ignored by default)
  }
};
