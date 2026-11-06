const { buildTourReadingItems, getTourBranchOptions } = require('../out/tourReading');
const { buildReadingNarrationUnit } = require('../out/tourNarration');
const { tourReadingTitle } = require('../out/tourOrientation');
const { ChangeTourCheckCategory: Category, ChangeTourCheckStatus: Status } = require('../out/changeTour');

const PACKET_VERSION = 1;
const CHECKS_ID = 'checks';
const categoryLabels = {
    [Category.Provenance]: 'Provenance', [Category.Claims]: 'Claims', [Category.Behavior]: 'Behavior',
    [Category.Coverage]: 'Coverage', [Category.Uncertainty]: 'Uncertainty'
};
const statusLabels = {
    [Status.Verified]: 'Verified', [Status.Partial]: 'Partial',
    [Status.NotChecked]: 'Not checked', [Status.NotApplicable]: 'Not applicable'
};

/** Narration-backed text projection, not a screenshot or a simulation of code panes. */
function buildReaderPacket(tour) {
    const mainItems = buildTourReadingItems(tour);
    const branches = [];
    const checks = [{ id: CHECKS_ID, title: 'Checks & evidence',
        text: 'Author-supplied checks for the scope described below. Missing entries are not checked.',
        child_ids: Object.values(Category).map(category => `check:${category}`) }];
    for (const category of Object.values(Category)) {
        const check = tour.details?.checks?.[category];
        checks.push({ id: `check:${category}`,
            title: `${categoryLabels[category]} · ${statusLabels[check?.status ?? Status.NotChecked]}`,
            text: [check?.summary ?? 'No check supplied.', check?.details].filter(Boolean).join('\n'), child_ids: [] });
    }
    const narration = (item, items, title) => buildReadingNarrationUnit(tour, item,
        { entry: 'continuous' }, items).segments.filter(segment => segment.speechText !== title)
        .map(segment => segment.speechText).join('\n');
    const childBranches = item => {
        if (item.kind !== 'step') return [];
        const step = tour.scenes[item.sceneIndex].steps[item.stepIndex];
        return getTourBranchOptions(tour, item.sceneIndex, step.id).map(branch => {
            const id = `branch:${item.sceneIndex}:${branch.id}`;
            const items = buildTourReadingItems(tour, { sceneIndex: item.sceneIndex, branchId: branch.id });
            const node = { id, title: branch.title,
                text: items.map(child => narration(child, items)).join('\n\n'), child_ids: [] };
            branches.push(node);
            node.child_ids = items.flatMap(childBranches);
            return id;
        });
    };
    const main = mainItems.map(item => {
        const title = tourReadingTitle(tour, item);
        return { id: item.key, title, text: narration(item, mainItems, title),
            child_ids: [...childBranches(item), CHECKS_ID] };
    });
    return { schema_version: PACKET_VERSION, title: tour.title, main, branches, checks };
}

function buildReaderPacketReport(manifest) {
    return { title: manifest.title, modes: Object.fromEntries(
        Object.entries(manifest.tours || { tour: manifest }).map(([mode, content]) =>
            [mode, buildReaderPacket({ ...manifest, opening: undefined, conclusion: undefined,
                details: undefined, ...content })])) };
}

module.exports = { buildReaderPacket, buildReaderPacketReport };
