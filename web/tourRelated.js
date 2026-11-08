/** An explicit lookup never changes the reader's location until a result is chosen. */
export function createRelatedExplanations({ navigate, restoreFocus }) {
    const dialog = document.createElement('dialog');
    dialog.id = 'tour-related-dialog';
    dialog.className = 'tour-related-dialog';
    dialog.setAttribute('aria-labelledby', 'tour-related-title');
    const title = document.createElement('h2');
    title.id = 'tour-related-title';
    title.textContent = 'Related explanations';
    const scope = document.createElement('p');
    scope.textContent = 'Resolved references in the loaded tour that overlap the selected code.';
    const status = document.createElement('p');
    status.id = 'tour-related-status';
    status.setAttribute('role', 'status');
    const results = document.createElement('div');
    results.id = 'tour-related-results';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    dialog.append(title, scope, status, results, close);
    let origin = null;
    dialog.addEventListener('close', () => {
        if (origin) restoreFocus(origin);
        origin = null;
    });
    return {
        clear() {
            origin = null;
            if (dialog.open) dialog.close();
            results.replaceChildren();
        },
        show(message, matches, description) {
            if (!dialog.isConnected) document.body.append(dialog);
            origin = message;
            status.textContent = description;
            results.replaceChildren(...matches.map(match => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'tour-search-result';
                button.title = match.label;
                const label = document.createElement('span');
                label.className = 'tour-search-location';
                label.textContent = match.label;
                const preview = document.createElement('span');
                preview.className = 'tour-search-preview';
                preview.textContent = match.preview;
                button.append(label, preview);
                button.addEventListener('click', async () => {
                    button.disabled = true;
                    try {
                        await navigate(match);
                        origin = null;
                        if (dialog.open) dialog.close();
                    } catch (error) {
                        status.textContent = error.message;
                        button.disabled = false;
                    }
                });
                return button;
            }));
            if (!dialog.open) dialog.showModal();
            (results.firstElementChild || close).focus();
        }
    };
}
