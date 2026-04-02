import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // SolidJS uses `let ref!: Type` pattern assigned via JSX ref={ref} prop
      'no-unassigned-vars': 'off',
    },
  },
  {
    ignores: ['dist/**'],
  },
);
