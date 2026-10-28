import js from '@eslint/js';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  files: ['src/**/*.{ts,tsx}'], plugins: { 'react-hooks': hooks, 'react-refresh': refresh },
  rules: { ...hooks.configs.recommended.rules, ...refresh.configs.vite.rules },
}, { ignores: ['dist/**'] });
