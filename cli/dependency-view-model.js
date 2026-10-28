/** Pure graph projection shared by HTML and Mermaid. No evidence is inferred here. */
function projectGraph(snapshot, options = {}) {
    const { mode = new Set(snapshot.nodes.map(n => n.source.file)).size > 30 ? 'folders' : 'files', query = '', language = '', relation = 'dependencies', phase = '', focus,
        maxNodes = 150, maxEdges = 300 } = options;
    const groups = new Map(), ownerGroup = new Map();
    const q = query.toLowerCase();
    for (const node of snapshot.nodes) {
        const folder = node.source.file.split('/').slice(0, -1).join('/') || '.';
        const id = mode === 'folders' ? JSON.stringify(['folder', folder]) : mode === 'files' ? JSON.stringify(['file', node.source.file]) : node.id;
        ownerGroup.set(node.id, id);
        let group = groups.get(id);
        if (!group) {
            group = { id, folder, name: mode === 'folders' ? folder : mode === 'files' ? node.source.file.split('/').pop() : node.name,
                source: node.source, language: node.language, members: 0, matches: false };
            groups.set(id, group);
        }
        group.members++;
        group.matches ||= (!language || node.language === language)
            && (!q || `${node.name} ${node.source.file}`.toLowerCase().includes(q));
    }
    const languageOwners = new Set(snapshot.nodes.filter(n => !language || n.language === language).map(n => n.id));
    let sites = snapshot.sites.filter(s => languageOwners.has(s.owner) && (!phase || s.phase === phase)
        && (relation === 'dependencies' ? s.relation !== 'reference' : !relation || s.relation === relation))
        .map(s => ({ ...s, owner: ownerGroup.get(s.owner), target: ownerGroup.get(s.target) }));
    const selected = groups.has(focus) ? focus : undefined;
    const seeds = new Set(selected ? [selected] : [...groups.values()].filter(n => n.matches).map(n => n.id));
    sites = sites.filter(s => selected ? s.owner === selected || s.target === selected : seeds.has(s.owner));
    const candidates = new Set(seeds);
    const degree = new Map();
    for (const s of sites) {
        if (s.owner) candidates.add(s.owner);
        if (s.target) candidates.add(s.target);
        if (s.owner !== s.target) for (const id of [s.owner, s.target].filter(Boolean)) degree.set(id, (degree.get(id) || 0) + 1);
    }
    // Keep the focal node even when it sorts after hundreds of neighbors. Prefer
    // connected matches before isolated inventory; all omission counts remain explicit.
    const ranked = [...candidates].map(id => groups.get(id)).filter(Boolean).sort((a, b) =>
        Number(b.id === selected) - Number(a.id === selected)
        || Number(seeds.has(b.id)) - Number(seeds.has(a.id))
        || (degree.get(b.id) || 0) - (degree.get(a.id) || 0)
        || a.id.localeCompare(b.id));
    const nodes = ranked.slice(0, maxNodes), kept = new Set(nodes.map(n => n.id));
    const grouped = new Map();
    for (const s of sites) {
        if (!s.target || s.owner === s.target && mode !== 'symbols') continue;
        const key = JSON.stringify([s.owner, s.target]);
        if (!grouped.has(key)) grouped.set(key, { id: key, owner: s.owner, target: s.target, count: 0, relations: [], phases: [] });
        const edge = grouped.get(key);
        edge.count++;
        if (!edge.relations.includes(s.relation)) edge.relations.push(s.relation);
        if (!edge.phases.includes(s.phase)) edge.phases.push(s.phase);
    }
    const edges = [...grouped.values()].filter(e => kept.has(e.owner) && kept.has(e.target))
        .sort((a, b) => Number(b.owner === selected || b.target === selected) - Number(a.owner === selected || a.target === selected)
            || b.count - a.count || a.id.localeCompare(b.id)).slice(0, maxEdges);
    return { nodes, edges, sites: sites.filter(s => kept.has(s.owner)),
        totalNodes: ranked.length, totalEdges: grouped.size, totalSites: sites.length,
        omittedNodes: ranked.length - nodes.length, omittedEdges: grouped.size - edges.length };
}

/** ELK ids are generated locally; repository-controlled labels never become layout syntax. */
function layoutInput(graph, direction = 'RIGHT') {
    const ids = new Map(graph.nodes.map((node, i) => [node.id, `n${i}`]));
    return { id: 'root', layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': direction, 'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': '32', 'elk.layered.spacing.nodeNodeBetweenLayers': '70',
        'elk.padding': '[top=30,left=30,bottom=30,right=30]', 'elk.randomSeed': '1'
    }, children: graph.nodes.map((node, i) => ({ id: `n${i}`, width: 250, height: 66 })),
    edges: graph.edges.map((edge, i) => ({ id: `e${i}`, sources: [ids.get(edge.owner)], targets: [ids.get(edge.target)] })) };
}
module.exports = { projectGraph, layoutInput };
