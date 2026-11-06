const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const Ajv = require('ajv/dist/2020');
const {
    ChangeTourCheckCategory: Category, ChangeTourCheckStatus: Status,
    parseChangeTourSource, parseChangeTourManifest, buildChangeTourManifest
} = require('../out/changeTour');
const { buildAllTourReadingItems } = require('../out/tourReading');
const { getTourNarrationCost, buildReadingNarrationUnit } = require('../out/tourNarration');
const { materializeTour } = require('../cli/tourExport');
const { exportFixture } = require('./exportFixture');
const validateSchema = new Ajv({ strict: false, allErrors: true }).compile(require('../schemas/change-tour-source.schema.json'));
const clone = value => JSON.parse(JSON.stringify(value));
const checks = {
    [Category.Provenance]: { status: Status.Verified, summary: 'The cited endpoint revisions were inspected.' },
    [Category.Claims]: { status: Status.Partial, summary: 'One claim remains uncertain.', details: 'See [the evidence](https://example.test/evidence).' },
    [Category.Behavior]: { status: Status.NotChecked, summary: 'Runtime behavior was not exercised.' },
    [Category.Coverage]: { status: Status.NotApplicable, summary: 'This explanation makes no completeness claim.' }
};
const placements = [
    ['root', value => value],
    ['historical', value => value.tours.historical],
    ['deconstructed', value => value.tours.deconstructed]
];

test('checks validate strictly in schema, source, and compiled manifests at every scope', () => {
    const f = exportFixture();
    try {
        f.source.version = 7;
        const compiled = buildChangeTourManifest(f.root, { source: parseChangeTourSource(f.source) });
        for (const [name, scope] of placements) {
            const source = clone(f.source);
            scope(source).details = { checks: clone(checks) };
            const manifest = clone(compiled);
            scope(manifest).details = { checks: clone(checks) };
            assert.equal(validateSchema(source), true, `${name}: ${JSON.stringify(validateSchema.errors)}`);
            assert.deepEqual(scope(parseChangeTourSource(source)).details.checks, checks);
            assert.deepEqual(scope(parseChangeTourManifest(manifest)).details.checks, checks);
            for (const invalid of [null, [], { other: checks[Category.Claims] },
                { [Category.Claims]: null }, { [Category.Claims]: [] }, { [Category.Claims]: {} },
                { [Category.Claims]: { status: 'passed', summary: 'Claim' } },
                { [Category.Claims]: { status: Status.Verified, summary: ' ' } },
                { [Category.Claims]: { status: Status.Verified, summary: 'Claim', details: 2 } },
                { [Category.Claims]: { status: Status.Verified, summary: 'Claim', details: ' ' } },
                { [Category.Claims]: { status: Status.Verified, summary: 'Claim', approved: true } }
            ]) {
                scope(source).details.checks = invalid;
                scope(manifest).details.checks = invalid;
                assert.equal(validateSchema(source), false, `${name}: ${JSON.stringify(invalid)}`);
                assert.throws(() => parseChangeTourSource(source), /checks/);
                assert.throws(() => parseChangeTourManifest(manifest), /checks/);
            }
            scope(source).details.checks = {};
            scope(manifest).details.checks = {};
            assert.equal(validateSchema(source), true);
            assert.ok(parseChangeTourSource(source));
            assert.ok(parseChangeTourManifest(manifest));
            for (const version of [5, 6]) {
                source.version = version; manifest.version = version;
                assert.equal(validateSchema(source), false);
                assert.throws(() => parseChangeTourSource(source), /checks requires tour version 7/);
                assert.throws(() => parseChangeTourManifest(manifest), /checks requires tour version 7/);
                delete scope(source).details.checks;
                delete scope(manifest).details.checks;
                assert.equal(validateSchema(source), true);
                assert.ok(parseChangeTourSource(source));
                assert.ok(parseChangeTourManifest(manifest));
                scope(source).details.checks = {}; scope(manifest).details.checks = {};
            }
        }
        // Independent wire literals verify compatibility with the named domain choices.
        assert.deepEqual(Object.values(Category), ['provenance', 'claims', 'behavior', 'coverage', 'uncertainty']);
        assert.deepEqual(Object.values(Status), ['verified', 'partial', 'not-checked', 'not-applicable']);
    } finally { f.dispose(); }
});

test('checks survive compile and both export profiles without entering reading or narration', () => {
    const f = exportFixture();
    try {
        f.source.version = 7;
        const baseline = buildChangeTourManifest(f.root, { source: parseChangeTourSource(f.source) });
        f.source.details = { checks: { [Category.Provenance]: checks[Category.Provenance] } };
        f.source.tours.historical.details = { checks };
        f.source.tours.deconstructed.details = { checks: { [Category.Uncertainty]: {
            status: Status.Partial, summary: 'Synthetic stages illustrate one path only.'
        } } };
        const compiled = buildChangeTourManifest(f.root, { source: parseChangeTourSource(f.source) });
        for (const [, scope] of placements) {
            assert.deepEqual(scope(compiled).details, scope(f.source).details);
            const before = { ...baseline, ...scope(baseline) };
            const after = { ...compiled, ...scope(compiled) };
            const items = buildAllTourReadingItems(after);
            assert.deepEqual(items, buildAllTourReadingItems(before));
            assert.deepEqual(getTourNarrationCost(after), getTourNarrationCost(before));
            for (const item of items) {
                assert.deepEqual(buildReadingNarrationUnit(after, item, { entry: 'continuous' }), buildReadingNarrationUnit(before, item, { entry: 'continuous' }));
            }
        }
        assert.equal(compiled.details.checks[Category.Uncertainty], undefined, 'Compiler never invents category statuses');
        fs.writeFileSync(f.sourcePath, JSON.stringify(f.source));
        for (const profile of ['minimal', 'full']) {
            const exported = materializeTour(f.sourcePath, profile);
            for (const [, scope] of placements) assert.deepEqual(scope(exported.manifest).details, scope(f.source).details);
        }
    } finally { f.dispose(); }
});

const modulePromise = import('data:text/javascript;base64,' + Buffer.from(buildSync({
    entryPoints: [path.resolve(__dirname, '../web/tourDetails.js')], bundle: true, write: false, format: 'esm'
}).outputFiles[0].contents).toString('base64'));
function element(tag) {
    return { tag, dataset: {}, children: [], textContent: '', open: false,
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; }
    };
}
const visibleText = node => node.textContent + (node.children || []).map(visibleText).join('');
const descendants = node => [node, ...(node.children || []).flatMap(descendants)];

test('details render collapsed category disclosures, honest omissions, and safe source links', async () => {
    const { renderTourDetails } = await modulePromise;
    const previous = global.document;
    global.document = { createElement: element, createTextNode: value => ({ textContent: value }) };
    try {
        const host = element('section');
        renderTourDetails(host, { details: { checks } });
        assert.equal(host.hidden, false);
        const disclosure = host.children[0];
        assert.equal(disclosure.tag, 'details');
        assert.equal(disclosure.open, false);
        assert.equal(disclosure.children[0].textContent, 'Checks & evidence');
        const categories = disclosure.children.filter(child => child.tag === 'details');
        assert.equal(categories.length, 5);
        assert.ok(categories.every(category => !category.open && category.children[0].tag === 'summary'));
        assert.deepEqual(categories.map(category => category.children[0].textContent), [
            'Provenance · Verified', 'Claims · Partial', 'Behavior · Not checked',
            'Coverage · Not applicable', 'Uncertainty · Not checked'
        ]);
        assert.match(visibleText(categories[4]), /No check supplied/);
        const link = descendants(host).find(node => node.tag === 'a');
        assert.equal(link.href, 'https://example.test/evidence');
        assert.equal(link.rel, 'noopener noreferrer');
        const unsafe = '<img src=x onerror=alert(1)> [bad](javascript:alert(1))';
        renderTourDetails(host, { details: { checks: { [Category.Claims]: { status: Status.Partial, summary: unsafe } } } });
        assert.match(visibleText(host), /<img src=x onerror=alert/);
        assert.equal(descendants(host).some(node => node.tag === 'a' || node.tag === 'img'), false);
        renderTourDetails(host, {});
        assert.equal(host.hidden, false, 'Legacy tours expose omitted checks honestly');
        assert.equal((visibleText(host).match(/· Not checked/g) || []).length, 5);
        assert.doesNotMatch(visibleText(host), /Verified|Partial|Not applicable/);
        renderTourDetails(host, null);
        assert.equal(host.hidden, true);
        assert.equal(host.children.length, 0);
    } finally { global.document = previous; }
});
