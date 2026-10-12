function text(tag, value) {
    const element = document.createElement(tag);
    element.textContent = value;
    return element;
}

export function renderTourDetails(host, tour) {
    host.replaceChildren();
    const audience = tour?.details?.audience;
    host.hidden = !audience;
    if (!audience) return;
    host.append(text('h2', 'Audience'));
    host.append(text('p', `${audience.purpose[0].toUpperCase() + audience.purpose.slice(1)}${audience.estimatedMinutes ? ` · about ${audience.estimatedMinutes} min` : ''}`));
    host.append(text('p', audience.scope));
    const detail = document.createElement('details');
    detail.append(text('summary', 'Assumed familiarity'));
    const list = document.createElement('dl');
    for (const [label, value] of [
        ['Codebase', { none: 'New to this codebase', some: 'Some familiarity', maintainer: 'Maintainer' }[audience.codebase]],
        ['Language', { none: 'No prior knowledge', basic: 'Basic', fluent: 'Fluent', advanced: 'Advanced' }[audience.language]],
        ['Reading demand', audience.readingDemand],
        ['Prerequisites', audience.domain?.join('; ') || 'None specified']
    ]) list.append(text('dt', label), text('dd', value));
    detail.append(list);
    host.append(detail);
}
