import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'out/**',
            'media/*.worker.js',
            'media/webview.js',
            'web/web-host.js'
        ]
    },
    {
        ...js.configs.recommended,
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-console': 'off',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            'prefer-const': 'error',
            eqeqeq: ['error', 'always']
        }
    },
    {
        files: [
            'bin/**/*.js',
            'eslint.config.mjs',
            'scripts/**/*.mjs',
            'standalone/main.js',
            'test/**/*.js'
        ],
        languageOptions: {
            globals: globals.node
        }
    },
    {
        files: ['media/**/*.js', 'web/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                acquireVsCodeApi: 'readonly'
            }
        }
    },
    {
        files: ['standalone/preload.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node
            }
        }
    },
    ...tseslint.configs.recommended.map((config) => ({
        ...config,
        files: ['src/**/*.ts'],
        languageOptions: {
            ...config.languageOptions,
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.node,
            parserOptions: {
                ...config.languageOptions?.parserOptions,
                projectService: false
            }
        },
        rules: {
            ...config.rules,
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            'prefer-const': 'error',
            eqeqeq: ['error', 'always']
        }
    }))
];
