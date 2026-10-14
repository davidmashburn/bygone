// Retain original item indexes so sorting and filtering cannot change navigation targets.
export function buildFileTree(items, pathOf) {
    const root = { folders: new Map(), files: [] };
    items.forEach((item, index) => {
        const parts = pathOf(item).split('/');
        const name = parts.pop();
        let parent = root;
        let path = '';
        for (const part of parts) {
            path = path ? `${path}/${part}` : part;
            if (!parent.folders.has(part)) parent.folders.set(part, { name: part, path, folders: new Map(), files: [] });
            parent = parent.folders.get(part);
        }
        parent.files.push({ item, index, name });
    });
    const sort = (node) => {
        node.folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
        node.files.sort((a, b) => a.name.localeCompare(b.name));
        node.folders.forEach(sort);
    };
    sort(root);
    return root;
}
