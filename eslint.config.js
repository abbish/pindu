// ESLint 9 flat config（规范：.claude/skills/deliver-frontend-react/references/frontend-code-standard.md §4–§5）
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'src-tauri/**', 'scripts/**', '.claude/**', 'public/**'],
  },
  js.configs.recommended,
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // 时间与时区：解析与格式化只经 src/utils/datetime.ts
    // （规范：.claude/skills/deliver-contract-and-data/references/time-and-timezone.md）
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/utils/datetime.ts', 'src/**/*.test.ts', 'src/components/ui/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=1]",
          message: '不要 new Date(值) 解析时间：时刻用 parseInstant，日历日期用 parseLocalDate（utils/datetime）。new Date(y, m, d) 构造本地日期可以。',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='parse']",
          message: '不要 Date.parse：用 utils/datetime 的 parseInstant / instantMs。',
        },
        {
          selector: "CallExpression[callee.property.name=/^toLocale(Date|Time)String$/]",
          message: '不要 toLocaleDateString / toLocaleTimeString：用 utils/datetime 的 formatDate / formatTime / formatDateTime（统一 zh-CN 与本机时区）。',
        },
        {
          selector: "CallExpression[callee.property.name=/^(slice|substring|substr|split)$/][callee.object.callee.property.name='toISOString']",
          message: 'toISOString() 是 UTC，截取它得到的是 UTC 日期：本地日期用 utils/datetime 的 localToday / toLocalDateKey / localDateOf。',
        },
      ],
    },
  },
  {
    files: ['src/**/*.test.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
];
