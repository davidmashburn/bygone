const { readFileSync, statSync } = require('fs');
const path = require('path');
const { TextDecoder } = require('util');
const { loadAll: loadYamlDocuments, dump: dumpYaml } = require('js-yaml');
const { serializeDocumentFragment } = require('../out/deepLink.js');
const { buildChangeTourManifest, parseChangeTourSource } = require('../out/changeTour.js');

const DEFAULT_MAX_TOUR_SOURCE_BYTES = 1024 * 1024;

function loadTourSource(cwd, sourcePath) {
    const resolvedPath = path.resolve(cwd, sourcePath);
    const source = readTourSourceDocument(resolvedPath);
    return { resolvedPath, source };
}

function readTourSourceDocument(sourcePath, options = {}) {
    return parseTourSourceText(readTourSourceText(sourcePath, options), path.resolve(sourcePath), options);
}

function readTourSourceText(sourcePath, options = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_TOUR_SOURCE_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new Error('The Bygone source size limit must be a positive safe integer.');
    }

    const sourceLabel = path.resolve(sourcePath);
    let stats;
    let bytes;
    try {
        stats = statSync(sourceLabel);
        if (!stats.isFile()) {
            throw new Error('path is not a regular file');
        }
        if (stats.size > maxBytes) {
            throw new Error(`file is ${stats.size} bytes; limit is ${maxBytes} bytes`);
        }
        bytes = readFileSync(sourceLabel);
    } catch (error) {
        throw new Error(`Could not read Bygone source ${sourceLabel}: ${errorMessage(error)}`, { cause: error });
    }

    if (bytes.length > maxBytes) {
        throw new Error(`Could not read Bygone source ${sourceLabel}: file is ${bytes.length} bytes; limit is ${maxBytes} bytes`);
    }
    if (bytes.includes(0)) {
        throw new Error(`Could not decode Bygone source ${sourceLabel}: NUL bytes are not allowed.`);
    }

    let text;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
        throw new Error(`Could not decode Bygone source ${sourceLabel} as UTF-8: ${errorMessage(error)}`, { cause: error });
    }

    return text;
}

function readTourSourceValue(text, sourceLabel = 'uploaded tour', options = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_TOUR_SOURCE_BYTES;
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes || text.includes('\0')) {
        throw new Error('Invalid tour text or source size limit exceeded.');
    }
    let documents;
    try {
        documents = loadYamlDocuments(text);
    } catch (error) {
        throw new Error(`Could not parse Bygone source ${sourceLabel} as YAML: ${errorMessage(error)}`, { cause: error });
    }
    if (documents.length !== 1) {
        throw new Error(`Could not parse Bygone source ${sourceLabel}: expected one YAML document, found ${documents.length}.`);
    }

    return documents[0];
}

function parseTourSourceText(text, sourceLabel = 'uploaded tour', options = {}) {
    try {
        return parseChangeTourSource(readTourSourceValue(text, sourceLabel, options));
    } catch (error) {
        throw new Error(`Invalid Bygone source ${sourceLabel}: ${errorMessage(error)}`, { cause: error });
    }
}

// Inspect without accepting retired formats in the normal source parser.
function inspectTourConversion(text, sourceLabel) {
    const value = readTourSourceValue(text, sourceLabel);
    if (![1, 2, 3].includes(value?.version)) return null;
    return {
        fromVersion: value.version,
        preservesReview: Object.prototype.hasOwnProperty.call(value, 'review'),
        message: `Convert this version ${value.version} tour to v4?`,
        detail: 'Conversion preserves tour IDs and revision references. Review notes are preserved as a Legacy review notes appendix in the final authored step of each available tour. Their recorded revisions and evidence references are retained, without claiming they have been revalidated. The original file stays unchanged. YAML formatting and comments are not retained in the copy.'
    };
}

function convertTourSourceText(text, sourceLabel) {
    const conversion = inspectTourConversion(text, sourceLabel);
    if (!conversion) throw new Error('Only authored tour versions 1, 2, and 3 can be converted to v4.');
    const value = readTourSourceValue(text, sourceLabel);
    const converted = { ...value, version: 4 };
    delete converted.review;
    try {
        parseChangeTourSource(converted);
        if (Object.prototype.hasOwnProperty.call(value, 'review')) appendLegacyReview(converted, value.review);
        parseChangeTourSource(converted);
    } catch (error) {
        throw new Error(`This tour cannot be converted automatically to v4: ${errorMessage(error)} No evidence was changed; update the original tour manually.`, { cause: error });
    }
    const convertedText = dumpYaml(converted, { noRefs: true, lineWidth: -1 });
    // Apply the same size and document checks to the serialized output.
    const source = parseTourSourceText(convertedText, sourceLabel);
    return { source, text: convertedText };
}

function appendLegacyReview(source, review) {
    const modes = Object.entries(source.tours || {});
    const evidenceLink = (evidence) => {
        if (!evidence || typeof evidence.sceneId !== 'string' || typeof evidence.stepId !== 'string') return '';
        const candidates = [...modes];
        if (!source.tours?.historical) candidates.push(['historical', { chapters: source.chapters }]);
        for (const [mode, tour] of candidates) {
            const scene = tour.chapters.flatMap(chapter => chapter.scenes).find(scene => scene.id === evidence.sceneId);
            if (scene && (!scene.kind || scene.kind === 'walkthrough') && scene.steps.some(step => step.id === evidence.stepId)) {
                return ` [Open referenced step](${serializeDocumentFragment(mode, { part: 'step', scene: evidence.sceneId, step: evidence.stepId })})`;
            }
        }
        return '';
    };
    let notes = '\n\n## Legacy review notes\n\nImported from the older tour. These notes have not been revalidated against the current revisions.';
    // Render recognized review fields as ordinary prose. Keep unfamiliar or
    // incomplete blocks verbatim so no legacy data is silently discarded.
    if (review && typeof review === 'object' && Array.isArray(review.items)) {
        notes += `\n\nRecorded revisions: ${review.baseOid ?? '(unspecified)'} → ${review.headOid ?? '(unspecified)'}.`;
        for (const item of review.items) {
            if (!item || typeof item !== 'object') continue;
            notes += `\n\n### ${item.title ?? 'Review note'}\n\n${item.kind ?? 'Note'} (${item.id ?? 'no id'})\n\n${item.body ?? ''}`;
            for (const evidence of Array.isArray(item.evidence) ? item.evidence : []) {
                notes += `\n\nEvidence: ${evidence?.sceneId ?? '?'} / ${evidence?.stepId ?? '?'}.${evidenceLink(evidence)}`;
            }
            if (item.nextCheck !== undefined) notes += `\n\nNext check: ${item.nextCheck}`;
        }
    }
    const onlyKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).every(key => keys.includes(key));
    const recognized = onlyKeys(review, ['baseOid', 'headOid', 'items'])
        && typeof review.baseOid === 'string' && typeof review.headOid === 'string'
        && Array.isArray(review.items) && review.items.every(item =>
            onlyKeys(item, ['id', 'kind', 'title', 'body', 'evidence', 'nextCheck'])
            && ['id', 'kind', 'title', 'body'].every(key => typeof item[key] === 'string')
            && (item.nextCheck === undefined || typeof item.nextCheck === 'string')
            && Array.isArray(item.evidence) && item.evidence.every(evidence =>
                onlyKeys(evidence, ['sceneId', 'stepId']) && typeof evidence.sceneId === 'string' && typeof evidence.stepId === 'string'));
    if (!recognized) {
        const raw = dumpYaml(review, { noRefs: true, lineWidth: -1 }).trimEnd();
        const fence = '`'.repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map(match => match[0].length + 1)));
        notes += `\n\n### Original review data\n\n${fence}yaml\n${raw}\n${fence}`;
    }
    const appended = new Set();
    const append = (target, field) => {
        if (!target || appended.has(target)) return;
        target[field] += notes;
        appended.add(target);
    };
    for (const tour of [{ chapters: source.chapters }, ...modes.map(([, tour]) => tour)]) {
        const scene = tour.chapters.at(-1).scenes.at(-1);
        if (scene.kind === 'deconstructed-diff') {
            append(scene.stages.at(-1), 'narration');
            // Legacy deconstruction also exposes its real-evidence steps in the
            // Historical fallback. Preserve the notes there too.
            append(scene.steps?.at(-1), 'body');
        } else {
            append(scene.steps.at(-1), 'body');
        }
    }
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function buildManifestForTourSource(cwd, source, options = {}) {
    return buildChangeTourManifest(cwd, {
        headRef: options.headRef || source.range?.head,
        baseRef: options.baseRef || source.range?.base,
        title: options.title,
        sourceUrl: options.sourceUrl,
        generatedAt: options.generatedAt,
        source
    });
}

module.exports = {
    DEFAULT_MAX_TOUR_SOURCE_BYTES,
    buildManifestForTourSource,
    loadTourSource,
    readTourSourceText,
    inspectTourConversion,
    convertTourSourceText,
    parseTourSourceText,
    readTourSourceDocument
};
