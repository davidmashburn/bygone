import { TOUR_ASSESSMENT_RUBRIC } from '../src/tourAssessment.ts';
const dimensions = TOUR_ASSESSMENT_RUBRIC.map(({ key, label, criterion }) => [key, label, criterion]);
const scores = ['Fails', 'Weak', 'Adequate', 'Strong'];
const methods = { 'self-review': 'Self-review', 'simulated-reader': 'Simulated reader', 'human-reader': 'Human reader' };

function text(tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
}

export function renderTourAssessment(host, tour) {
    host.replaceChildren();
    host.hidden = !tour;
    if (!tour) return;
    const { audience, assessment } = tour.details || {};
    host.append(text('h2', 'Audience'));
    if (audience) {
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
    } else host.append(text('p', 'Audience not specified.'));
    host.append(text('h2', 'Explanation quality'));
    const stale = assessment && (!tour.contentHash || assessment.contentHash !== tour.contentHash);
    const rated = Object.keys(assessment?.ratings || {}).length;
    host.append(text('p', assessment
        ? `${stale ? 'Needs reassessment' : 'Assessment recorded'} · ${rated} of 7 dimensions rated`
        : 'Not assessed. Open a dimension to see its criteria.', 'tour-assessment-status'));
    if (assessment) {
        host.append(text('p', `${methods[assessment.method]} · ${assessment.reviewer} · ${assessment.assessedAt}`));
        if (stale) host.append(text('p', 'These ratings refer to different or unverified tour content.'));
        if (assessment.blockers?.length) {
            host.append(text('strong', 'Unresolved blockers'));
            const blockers = document.createElement('ul');
            for (const blocker of assessment.blockers) blockers.append(text('li', blocker));
            host.append(blockers);
        }
    }
    host.append(text('p', '0 Fails · 1 Weak · 2 Adequate · 3 Strong. Explanation quality does not certify code correctness.', 'tour-assessment-legend'));
    const sorted = [...dimensions].sort((a, b) => (assessment?.ratings[a[0]]?.score ?? 4) - (assessment?.ratings[b[0]]?.score ?? 4));
    for (const [key, label, criterion] of sorted) {
        const rating = assessment?.ratings[key];
        const row = document.createElement('details');
        row.className = 'tour-assessment-rating';
        row.dataset.dimension = key;
        row.append(text('summary', `${label} · ${rating ? `${rating.score} ${scores[rating.score]}${stale ? ' (stale)' : ''}` : 'Unassessed'}`));
        row.append(text('p', criterion));
        if (rating) {
            row.append(text('p', rating.reason));
            row.append(text('p', `References: ${rating.references.join(', ')}`, 'tour-assessment-references'));
        }
        host.append(row);
    }
}
