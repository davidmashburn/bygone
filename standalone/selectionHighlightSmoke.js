/* global require, module */
const assert = require('node:assert/strict');

async function runSelectionHighlightSmoke({ window, show }) {
    const evaluate = code => window.webContents.executeJavaScript(code, true);
    const originalClass = await evaluate('document.body.className');
    const originalStyle = await evaluate('document.documentElement.style.cssText');
    try {
        await show({ type: 'showDiff', file1: 'before.txt', file2: 'after.txt',
            leftContent: 'identifier identifier\n', rightContent: 'identifier identifier changed\n' });
        for (const theme of ['vscode-dark', 'vscode-light']) {
            await evaluate(`{
                document.documentElement.style.setProperty('--vscode-editor-background', '${theme === 'vscode-dark' ? '#1e1e1e' : '#ffffff'}');
                document.documentElement.style.setProperty('--vscode-foreground', '${theme === 'vscode-dark' ? '#d4d4d4' : '#333333'}');
                document.body.classList.remove('vscode-dark', 'vscode-light', 'vscode-high-contrast', 'vscode-high-contrast-light');
                document.body.classList.add('${theme}');
                const editor = window.monaco.editor.getEditors()[0];
                editor.focus();
                editor.setSelection(new window.monaco.Range(1, 3, 1, 7));
            }`);
            const paint = await evaluate(`new Promise((resolve, reject) => {
                const deadline = performance.now() + 3000;
                const check = () => {
                    const editor = window.monaco.editor.getEditors()[0];
                    const node = editor.getDomNode();
                    const matches = [...node.querySelectorAll('.wordHighlightText')];
                    const selected = node.querySelector('.selected-text');
                    if (matches.length >= 2 && selected) {
                        const style = element => {
                            const css = getComputedStyle(element);
                            return { background: css.backgroundColor, border: css.borderTopColor,
                                borderWidth: css.borderTopWidth, width: element.getBoundingClientRect().width };
                        };
                        resolve({ matches: matches.map(style), selected: style(selected),
                            text: editor.getModel().getValueInRange(editor.getSelection()) });
                    } else if (performance.now() > deadline) {
                        reject(new Error('Partial-word selection did not render occurrence highlights'));
                    } else requestAnimationFrame(check);
                };
                requestAnimationFrame(check);
            })`);
            assert.equal(paint.text, 'enti', 'Only the selected substring is selected');
            assert.notEqual(paint.selected.background, 'rgba(0, 0, 0, 0)', `${theme}: selection has a visible fill`);
            for (const match of paint.matches) {
                assert.equal(match.background, 'rgba(0, 0, 0, 0)', `${theme}: whole-word matches must not add another fill`);
                assert.notEqual(match.border, 'rgba(0, 0, 0, 0)', `${theme}: matches remain visible as outlines`);
                assert.equal(match.borderWidth, '1px');
                assert.ok(match.width > paint.selected.width, 'The full-word outline is distinct from the partial selection');
            }
        }
    } finally {
        await evaluate(`{
            document.documentElement.style.cssText = ${JSON.stringify(originalStyle)};
            document.body.className = ${JSON.stringify(originalClass)};
        }`);
    }
}

module.exports = { runSelectionHighlightSmoke };
