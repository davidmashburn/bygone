/** One static evidence image at a time, with an accessible enlargement. */
export function createTourImageViewer() {
    let figure;
    let dialog;
    function clear() {
        dialog?.close();
        dialog?.remove();
        figure?.remove();
        dialog = figure = undefined;
        document.body.classList.remove('tour-image-active');
    }
    function show(image, title) {
        clear();
        figure = document.createElement('figure');
        figure.className = 'tour-image-evidence';
        const caption = document.createElement('figcaption');
        const label = document.createElement('span');
        label.textContent = title;
        const expand = document.createElement('button');
        expand.type = 'button';
        expand.textContent = 'Expand image';
        const img = document.createElement('img');
        img.src = image.dataUrl;
        img.alt = image.alt;
        img.addEventListener('error', () => { label.textContent = `${title} — image could not be decoded`; });
        caption.append(label, expand);
        figure.append(caption, img);
        document.getElementById('container').append(figure);
        document.body.classList.add('tour-image-active');
        expand.addEventListener('click', () => {
            dialog?.remove();
            dialog = document.createElement('dialog');
            dialog.className = 'tour-image-dialog';
            dialog.setAttribute('aria-label', title);
            const close = document.createElement('button');
            close.type = 'button';
            close.textContent = 'Close image';
            close.addEventListener('click', () => dialog.close());
            dialog.append(close, img.cloneNode());
            document.body.append(dialog);
            dialog.showModal();
        });
    }
    return { show, clear, isVisible: () => Boolean(figure) };
}
