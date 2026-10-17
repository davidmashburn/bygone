import { registerLanguage } from 'monaco-editor/esm/vs/basic-languages/_.contribution.js';

// Monaco 0.55 uses single-line f-string states for triple quotes too. Those
// states pop at EOL (or a single quote), so the closing triple quote starts a
// new docstring and colors subsequent Python as string contents.
registerLanguage({
    id: 'python',
    extensions: ['.py', '.rpy', '.pyw', '.cpy', '.gyp', '.gypi'],
    aliases: ['Python', 'py'],
    firstLine: '^#!/.*\\bpython[0-9.-]*\\b',
    loader: async () => {
        const { conf, language } = await import('monaco-editor/esm/vs/basic-languages/python/python.js');
        return {
            conf,
            language: {
                ...language,
                tokenizer: {
                    ...language.tokenizer,
                    strings: [
                        [/(?:[fF][rR]?|[rR][fF])'''/, 'string.escape', '@tripleFString'],
                        [/(?:[fF][rR]?|[rR][fF])"""/, 'string.escape', '@tripleDoubleFString'],
                        ...language.tokenizer.strings
                    ],
                    tripleFString: [
                        [/'''/, 'string.escape', '@pop'],
                        [/[^\\'{}]+/, 'string'],
                        { include: '@tripleFStringCommon' },
                        [/'/, 'string']
                    ],
                    tripleDoubleFString: [
                        [/"""/, 'string.escape', '@pop'],
                        [/[^\\"{}]+/, 'string'],
                        { include: '@tripleFStringCommon' },
                        [/"/, 'string']
                    ],
                    tripleFStringCommon: [
                        [/\{\{|\}\}/, 'string'],
                        [/\{[^}':!=]+/, 'identifier', '@fStringDetail'],
                        // Consume an escaped quote before looking for a closing
                        // delimiter; preserve the state across escaped newlines.
                        [/\\./, 'string'],
                        [/\\$/, 'string'],
                        [/[{}]/, 'string']
                    ]
                }
            }
        };
    }
});
