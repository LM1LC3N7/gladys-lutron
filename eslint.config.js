// -----------------------------------------------------------------------------
// ESLint flat config.
//
//   - `@eslint/js` recommended  -> real mistakes (undefined vars, dead code…);
//   - layering rule              -> `src/leap/` must never import the Gladys
//                                   SDK nor the Gladys adapter, so the LEAP
//                                   client stays testable alone and extractable
//                                   as its own npm package;
//   - `eslint-config-prettier`   -> Prettier owns formatting.
// -----------------------------------------------------------------------------

import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules/', 'data/', 'coverage/'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
    },
  },
  {
    files: ['src/leap/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@gladysassistant/*'],
              message: 'src/leap/ must not depend on the Gladys SDK (layering rule).',
            },
            {
              group: ['**/gladys/**', '../gladys/*', '../config.js'],
              message: 'src/leap/ must not depend on the Gladys adapter (layering rule).',
            },
          ],
        },
      ],
    },
  },
  prettier,
];
