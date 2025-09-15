module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { project: false, ecmaVersion: 2022, sourceType: 'module' },
  env: { node: true, es2022: true, browser: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:storybook/recommended',
    'prettier'
  ],
  plugins: ['@typescript-eslint'],
  overrides: [
    {
      files: ['**/*.svelte'],
      processor: 'svelte3/svelte3'
    }
  ],
  settings: {
    // For eslint-plugin-svelte3 (if added later)
  }
};
