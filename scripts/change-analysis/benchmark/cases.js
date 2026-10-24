// Gold labels describe authored intent/source inspection, never engine output.
const frozen = require('./frozen-js-ts.json');
const moduleSplit = require('../../../test/fixtures/correspondence-module-split.json');

const endpoint = (path, name, occurrence) => ({ path, name, ...(occurrence === undefined ? {} : { occurrence }) });
const pair = (source, destination = source) => ({ source, destination });
const names = (path, list) => list.map(name => endpoint(path, name));
function authored(id, group, before, after, evaluated, expected, expectedGroups = []) {
    return { id, group, before, after, evaluated, expected, expectedGroups };
}

function frozenCase(c) {
    const evaluated = { before: [], after: [] }, expected = [], expectedGroups = [];
    if (c.group === 'history') {
        for (const side of ['before', 'after']) evaluated[side] = c.expectedInventory[side].map(e => endpoint(e.path, e.name));
        for (const p of c.expectedPairs) expected.push(pair(endpoint(p.sourcePath, p.sourceName), endpoint(p.destinationPath, p.destinationName)));
    } else {
        // Each synthetic case has these explicitly authored marker declarations.
        const n = Number(c.id.slice(-2));
        const hasMarkers = c.group === 'mixed' || ![5, 8].includes(n);
        if (hasMarkers) {
            for (const side of ['before', 'after']) {
                evaluated[side].push(endpoint('src/cart.js', 'originMarker'));
                if (!(c.group === 'control' && [4, 6].includes(n) && side === 'before') && !(c.group === 'control' && n === 6)) {
                    evaluated[side].push(endpoint('src/billing.js', 'destinationMarker'));
                }
            }
            expected.push(pair(endpoint('src/cart.js', 'originMarker')));
            if (!(c.group === 'control' && [4, 6].includes(n))) expected.push(pair(endpoint('src/billing.js', 'destinationMarker')));
        }
        for (const p of c.expectedPairs) {
            const source = endpoint(p.sourcePath, p.sourceName), destination = endpoint(p.destinationPath, p.destinationName);
            evaluated.before.push(source); evaluated.after.push(destination);
            if (['extract', 'inline'].includes(p.operation)) expectedGroups.push({ kind: p.operation, ...pair(source, destination) });
            else expected.push(pair(source, destination));
        }
        if (c.group === 'control' && n === 4) {
            evaluated.before.push(endpoint('src/cart.js', 'invoiceTotal'));
            evaluated.after.push(...names('src/cart.js', ['invoiceTotal']), endpoint('src/billing.js', 'invoiceTotal'));
            expected.push(pair(endpoint('src/cart.js', 'invoiceTotal')));
        }
        if (c.group === 'control' && n === 5) {
            evaluated.before.push(endpoint('src/a.js', 'invoiceTotal'), endpoint('src/b.js', 'invoiceTotal'));
            evaluated.after.push(endpoint('src/c.js', 'invoiceTotal'));
        }
        if (c.group === 'control' && n === 6) {
            for (const side of ['before', 'after']) evaluated[side].push(endpoint('src/cart.js', 'invoiceTotal'));
            expected.push(pair(endpoint('src/cart.js', 'invoiceTotal')));
        }
        if (c.group === 'control' && [7, 10].includes(n)) {
            evaluated.before.push(endpoint('src/cart.js', 'invoiceTotal'));
            evaluated.after.push(endpoint('src/billing.js', 'invoiceTotal'));
        }
        if (c.group === 'mixed' && [1, 2].includes(n)) {
            for (const side of ['before', 'after']) evaluated[side].push(endpoint('src/cart.js', 'checkout'));
            expected.push(pair(endpoint('src/cart.js', 'checkout')));
        }
        if (c.group === 'mixed' && n === 3) for (const name of ['PriceBook.constructor', 'PriceBook.price']) {
            const source = endpoint('src/cart.js', name), destination = endpoint('src/billing.js', name);
            evaluated.before.push(source); evaluated.after.push(destination); expected.push(pair(source, destination));
        }
        if (c.group === 'mixed' && n === 10) {
            // The unchanged origin is deliberately outside supplied-file scope.
            evaluated.before = [endpoint('src/billing.js', 'destinationMarker')];
            evaluated.after = names('src/billing.js', ['destinationMarker', 'invoiceTotal']);
            expected.splice(0, expected.length, pair(endpoint('src/billing.js', 'destinationMarker')));
        }
    }
    for (const side of ['before', 'after']) evaluated[side] = [...new Map(evaluated[side].map(e => [JSON.stringify(e), e])).values()];
    for (const p of expected) p.focus = c.expectedPairs.some(original => original.sourcePath === p.source.path && original.sourceName === p.source.name
        && original.destinationPath === p.destination.path && original.destinationName === p.destination.name
        && (c.group !== 'history' || original.edited)) || (c.group === 'control' && [4, 6].includes(numericId(c)) && p.source.name === 'invoiceTotal');
    return { ...authored(c.id, c.group === 'history' ? 'js-ts-history' : 'js-ts-synthetic', c.before, c.after, evaluated, expected, expectedGroups),
        excludeUnchanged: c.excludeUnchanged, source: c.source, originalSplit: c.split, notes: c.notes };
}

function numericId(c) { return Number(c.id.slice(-2)); }

const cases = frozen.cases.map(frozenCase);
const a = 'a.js', b = 'b.js';
const constants = 'const START_AT = new Date(0);\nconst END_AT = new Date(1000);\n';
const constantNames = ['START_AT', 'END_AT'];
const bothConstants = [...names(a, constantNames), ...names(b, constantNames)];
cases.push(authored('repeated-constants', 'js-ts-regressions', { [a]: constants, [b]: constants },
    { [a]: 'const added = () => 1;\n' + constants, [b]: constants },
    { before: bothConstants, after: [...bothConstants, endpoint(a, 'added')] }, bothConstants.map(e => pair(e))));
const scopes = 'class A { run() { return 1; } }\nclass B { run() { return 1; } }';
const scopedNames = names(a, ['A', 'A.run', 'B', 'B.run']);
cases.push(authored('same-method-different-classes', 'js-ts-regressions', { [a]: scopes },
    { [a]: scopes.replaceAll('run() { return 1; }', 'run() { return 1; } extra() {}') },
    { before: scopedNames, after: [...scopedNames, ...names(a, ['A.extra', 'B.extra'])] }, scopedNames.map(e => pair(e))));
const duplicates = 'function outer() { function inner() { return 1; } }\nfunction outer() { function inner() { return 1; } }';
const duplicateNames = [0, 1].flatMap(i => ['outer', 'outer.inner'].map(name => endpoint(a, name, i)));
cases.push(authored('indistinguishable-nested-origins', 'js-ts-regressions', { [a]: duplicates }, { [a]: duplicates },
    { before: duplicateNames, after: duplicateNames }, []));
const constant = 'const START_AT = new Date(0);';
cases.push(authored('retained-constant-competing-origin', 'js-ts-regressions', { [a]: constant, [b]: constant }, { [a]: constant, 'c.js': constant },
    { before: [endpoint(a, 'START_AT'), endpoint(b, 'START_AT')], after: [endpoint(a, 'START_AT'), endpoint('c.js', 'START_AT')] }, [pair(endpoint(a, 'START_AT'))]));
cases.push(authored('const-to-let', 'js-ts-regressions', { [a]: constant }, { [a]: constant.replace('const ', 'let ') },
    { before: [endpoint(a, 'START_AT')], after: [endpoint(a, 'START_AT')] }, [pair(endpoint(a, 'START_AT'))]));
const price = 'export function price(n) { return n + 1; }', edited = price.replace('+ 1', '+ 2');
const fourPrices = ['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(p => endpoint(p, 'price'));
cases.push(authored('duplicate-bodies-crossing-edits', 'js-ts-regressions', { 'a.ts': price, 'b.ts': price, 'c.ts': edited, 'd.ts': edited },
    { 'a.ts': price, 'b.ts': edited, 'c.ts': price, 'd.ts': edited }, { before: fourPrices, after: fourPrices }, fourPrices.map(e => pair(e))));
const arrow = 'export const price = n => n + 1;';
cases.push(authored('edited-js-arrow', 'js-ts-regressions', { [a]: arrow }, { [a]: arrow.replace('+ 1', '+ 2') },
    { before: [endpoint(a, 'price')], after: [endpoint(a, 'price')] }, [pair(endpoint(a, 'price'))]));

function pythonCase(id, before, after, beforeNames, afterNames, expected) {
    cases.push(authored(id, 'python', before, after, { before: beforeNames, after: afterNames }, expected));
}
const py = 'def price(n):\n    return n + 1\n';
const decorated = '# 😀\r\n@(\r\n    register("π")\r\n)\r\nasync def price(n):\r\n    return n + 1  # final 😀\r\n    # suite comment\r\n';
pythonCase('python-decorated-unicode-crlf', { 'a.py': decorated }, { 'a.py': decorated.replace('+ 1', '+ 2') },
    names('a.py', ['price']), names('a.py', ['price']), [pair(endpoint('a.py', 'price'))]);
for (const renamed of [false, true]) pythonCase(renamed ? 'python-move-rename-edit' : 'python-move-edit',
    { 'a.py': py }, { 'b.py': py.replace('+ 1', '+ 2').replace('price', renamed ? 'cost' : 'price') + '\ndef added():\n    return 91\n' },
    names('a.py', ['price']), names('b.py', [renamed ? 'cost' : 'price', 'added']), [pair(endpoint('a.py', 'price'), endpoint('b.py', renamed ? 'cost' : 'price'))]);
const nested = '@register\nclass Box:\n    @staticmethod\n    def price(n):\n        def inner():\n            return 1\n        return n + 1\n    # class comment\n';
const nestedNames = names('a.py', ['Box', 'Box.price', 'Box.price.inner']);
pythonCase('python-nested-class-method', { 'a.py': nested }, { 'a.py': nested.replace('+ 1', '+ 2') }, nestedNames, nestedNames, nestedNames.map(e => pair(e)));
pythonCase('python-stub-partial-scope', { 'a.py': '@register\n' + py },
    { 'b.py': '@register\n' + py.replace('price', 'cost').replace('+ 1', '+ 2'), 'types.pyi': 'def cost(n: int) -> int: ...\n' },
    names('a.py', ['price']), [...names('b.py', ['cost']), ...names('types.pyi', ['cost'])], [pair(endpoint('a.py', 'price'), endpoint('b.py', 'cost'))]);
pythonCase('python-decorator-only-edit', { 'a.py': '@register("one")\n' + py }, { 'a.py': '@register("two")\n' + py },
    names('a.py', ['price']), names('a.py', ['price']), [pair(endpoint('a.py', 'price'))]);

// All top-level declarations in the public module-split fixture are labeled,
// including types/interfaces; the precomputed six-match fixture is not an oracle.
const retainedNames = ['ChangeTourAudienceCodebase', 'ChangeTourAudienceLanguage', 'ChangeTourAudienceReadingDemand',
    'ChangeTourAudiencePurpose', 'ChangeTourAudience', 'ChangeTourDetails', 'validateChangeTourDetails', 'validateAudience',
    'isRecord', 'requireString', 'requireStringArray', 'requireOnlyKeys'];
const removedNames = ['TOUR_ASSESSMENT_RATING_KEYS', 'TOUR_ASSESSMENT_RUBRIC_KEYS', 'TOUR_ASSESSMENT_RUBRIC',
    'TOUR_ASSESSMENT_SCORE_VALUES', 'TOUR_ASSESSMENT_METHODS', 'ChangeTourAssessmentRatingKey', 'ChangeTourAssessmentScore',
    'ChangeTourAssessmentMethod', 'ChangeTourAssessmentRating', 'ChangeTourAssessmentRatings', 'ChangeTourAssessment',
    'ChangeTourDetailsValidationContext', 'validateAssessment', 'validateIsoTimestamp', 'validateContentHash'];
cases.push(authored('bygone-module-split', 'public-module-split', moduleSplit.before, moduleSplit.after,
    { before: names('src/tourAssessment.ts', [...retainedNames, ...removedNames]), after: names('src/tourDetails.ts', retainedNames) },
    retainedNames.map(name => pair(endpoint('src/tourAssessment.ts', name), endpoint('src/tourDetails.ts', name)))));

module.exports = { cases, frozen };
