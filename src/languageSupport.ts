const LANGUAGE_BY_EXTENSION = new Map<string, string>([
    ['.js', 'javascript'], ['.cjs', 'javascript'], ['.mjs', 'javascript'], ['.jsx', 'javascript'],
    ['.ts', 'typescript'], ['.cts', 'typescript'], ['.mts', 'typescript'], ['.tsx', 'typescript'],
    ['.json', 'json'], ['.jsonc', 'json'], ['.html', 'html'], ['.htm', 'html'],
    ['.css', 'css'], ['.scss', 'scss'], ['.less', 'less'],
    ['.md', 'markdown'], ['.markdown', 'markdown'],
    ['.yaml', 'yaml'], ['.yml', 'yaml'], ['.bygone', 'yaml'],
    ['.py', 'python'], ['.pyw', 'python'],
    ['.sh', 'shell'], ['.bash', 'shell'], ['.zsh', 'shell']
]);

const SUPPORTED_LANGUAGE_IDS = new Set([
    'javascript', 'typescript', 'json', 'html', 'css', 'scss', 'less',
    'markdown', 'yaml', 'python', 'shell', 'plaintext'
]);

export function inferLanguageId(filePath: string | undefined): string {
    if (!filePath) return 'plaintext';
    const parts = filePath.split(/[\\/]/);
    const name = (parts[parts.length - 1] ?? '').toLocaleLowerCase();
    if (['dockerfile', 'makefile'].includes(name)) return 'shell';
    const extensionStart = name.lastIndexOf('.');
    const extension = extensionStart >= 0 ? name.slice(extensionStart) : '';
    return LANGUAGE_BY_EXTENSION.get(extension) ?? 'plaintext';
}

export function normalizeLanguageId(languageId: string | undefined, filePath?: string): string {
    if (languageId && SUPPORTED_LANGUAGE_IDS.has(languageId)) return languageId;
    return inferLanguageId(filePath);
}
