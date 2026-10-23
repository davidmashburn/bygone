// Source containment defines hierarchy; accepted relations only join revisions.
export function buildCorrespondenceTree(evidence, { all = false, query = '' } = {}) {
    const files = new Map(), before = new Map(), after = new Map();
    const sources = new Map(evidence.relations.map(r => [r.sourceId, r]));
    const destinations = new Map(evidence.relations.map(r => [r.destinationId, r]));
    const ambiguous = new Set(evidence.unresolved.flatMap(g => [...g.sourceIds, ...g.destinationIds]));
    const file = path => {
        if (!files.has(path)) files.set(path, { key: `file:${path}`, path, children: [], type: 'file' });
        return files.get(path);
    };
    const snapshot = (entries, relations, nodes, side) => {
        const byPath = new Map();
        for (const entry of entries) {
            const node = { key: `${side}:${entry.id}`, entry, relation: relations.get(entry.id),
                side, type: 'symbol', children: [], ambiguous: ambiguous.has(entry.id) };
            nodes.set(entry.id, node);
            if (!byPath.has(entry.path)) byPath.set(entry.path, []);
            byPath.get(entry.path).push(node);
        }
        for (const [path, items] of byPath) {
            items.sort((a, b) => a.entry.start - b.entry.start || b.entry.end - a.entry.end || a.entry.id.localeCompare(b.entry.id));
            const stack = [];
            for (let i = 0; i < items.length;) {
                const first = items[i], equal = [];
                while (i < items.length && items[i].entry.start === first.entry.start && items[i].entry.end === first.entry.end) equal.push(items[i++]);
                while (stack.length && (stack.at(-1)[0].entry.end < first.entry.end || stack.at(-1)[0].entry.end <= first.entry.start)) stack.pop();
                // Equal ranges do not establish an arbitrary parent between peers.
                let parent = file(path);
                for (let ancestor = stack.length - 1; ancestor >= 0; ancestor--) {
                    if (stack[ancestor].length === 1) { parent = stack[ancestor][0]; break; }
                }
                for (const node of equal) node.parent = parent;
                stack.push(equal);
            }
        }
    };
    snapshot(evidence.symbols.before, sources, before, 'before');
    snapshot(evidence.symbols.after, destinations, after, 'after');
    for (const node of after.values()) {
        node.after = node.entry;
        node.before = node.relation && before.get(node.relation.sourceId).entry;
        node.parent.children.push(node);
    }
    // Insert old locations into the destination hierarchy only when their
    // accepted destination has the same parent. Moves retain a source reference.
    const merged = new Map();
    for (const node of before.values()) {
        // Resolve ancestors first even if producer entries arrive out of order.
        const chain = [];
        for (let current = node; current?.type === 'symbol' && !merged.has(current.key); current = current.parent) chain.push(current);
        while (chain.length) {
            const old = chain.pop();
            const parent = old.parent.type === 'file' ? old.parent : merged.get(old.parent.key);
            const destination = old.relation && after.get(old.relation.destinationId);
            if (destination && destination.parent === parent) {
                merged.set(old.key, destination);
            } else {
                const reference = { ...old, before: old.entry, after: destination?.entry,
                    sourceReference: !!destination, parent, children: [] };
                parent.children.push(reference);
                merged.set(old.key, reference);
            }
        }
    }
    for (const node of [...after.values(), ...merged.values()]) {
        if (!node.relation) { node.changed = true; continue; }
        const a = before.get(node.relation.sourceId), b = after.get(node.relation.destinationId);
        const parentMatches = a.parent.type === 'file'
            ? b.parent.type === 'file' && a.parent.path === b.parent.path
            : a.parent.relation?.destinationId === b.parent.entry?.id;
        node.changed = node.relation.pathChanged || node.relation.nameChanged || !node.relation.rawEqual || !parentMatches;
    }
    const roots = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
    const ordered = [], pending = [...roots];
    while (pending.length) {
        const node = pending.pop();
        node.children.sort((a, b) => a.entry.start - b.entry.start || a.key.localeCompare(b.key));
        ordered.push(node); pending.push(...node.children);
    }
    const needle = query.trim().toLowerCase(), relationIds = new Set(), unmatchedIds = new Set();
    for (const node of ordered.reverse()) {
        node.children = node.children.filter(child => child.visible);
        const ownMatch = node.type === 'symbol' && (all || node.changed)
            && `${node.before?.name || ''} ${node.after?.name || ''} ${node.entry.path} ${node.before?.path || ''} ${node.after?.path || ''}`.toLowerCase().includes(needle);
        node.visible = ownMatch || node.children.length > 0;
        node.context = !ownMatch;
        if (ownMatch) {
            if (node.relation) relationIds.add(node.relation.id);
            else unmatchedIds.add(node.entry.id);
        }
    }
    return { files: roots.filter(root => root.visible), matchingRelations: relationIds.size, matchingUnmatched: unmatchedIds.size };
}
