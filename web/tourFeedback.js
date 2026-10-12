import { buildTourFeedbackRequest } from '../src/tourFeedback.ts';

/** The capture callback runs once when opened, never again while editing/copying. */
export function openTourFeedback(intent, capture) {
    const snapshot = capture();
    const dialog = document.createElement('dialog');
    dialog.className = 'tour-feedback-dialog';
    dialog.setAttribute('aria-labelledby', 'tour-feedback-title');
    const title = document.createElement('h2');
    title.id = 'tour-feedback-title';
    title.textContent = intent === 'explain' ? 'Explain this' : 'Question this change';
    const intro = document.createElement('p');
    intro.textContent = 'Describe what is unclear or seems wrong. Copy the request and paste it into your coding agent.';
    const label = document.createElement('label');
    label.htmlFor = 'tour-feedback-concern';
    label.textContent = 'Your question or concern';
    const concern = document.createElement('textarea');
    concern.id = 'tour-feedback-concern';
    concern.rows = 3;
    const disclosure = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Review the captured context';
    const context = document.createElement('pre');
    context.textContent = snapshot;
    disclosure.append(summary, context);
    const output = document.createElement('textarea');
    output.readOnly = true;
    output.rows = 8;
    output.hidden = true;
    output.setAttribute('aria-label', 'Request to copy manually');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'tour-feedback-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy request';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => dialog.close());
    concern.addEventListener('input', () => { output.hidden = true; status.textContent = ''; });
    copy.addEventListener('click', async () => {
        const request = buildTourFeedbackRequest(intent, concern.value, snapshot);
        copy.disabled = true;
        concern.readOnly = true;
        try {
            await navigator.clipboard.writeText(request);
            status.textContent = 'Copied. Paste into your agent to continue.';
        } catch {
            output.value = request;
            output.hidden = false;
            output.focus();
            output.select();
            status.textContent = 'Clipboard unavailable. Copy the selected request manually.';
        } finally { copy.disabled = false; concern.readOnly = false; }
    });
    actions.append(copy, close);
    dialog.append(title, intro, label, concern, disclosure, output, status, actions);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.append(dialog);
    dialog.showModal();
    concern.focus();
}
