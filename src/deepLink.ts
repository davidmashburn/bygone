import type { ChangeTourManifest, ChangeTourModeTour } from './changeTourManifest';

export type DocumentFocus =
    | { part: 'title' }
    | { part: 'conclusion' }
    | { part: 'chapter'; chapter: string }
    | { part: 'scene'; scene: string }
    | { part: 'step'; scene: string; step: string };
export type TourLink = {
    // tour is a repository-relative path or a local file URL.
    kind: 'tour'; repo: string; tour: string;
    mode: 'historical' | 'deconstructed'; focus: DocumentFocus;
};
export type ComparisonLink = {
    kind: 'compare'; repo: string; revisions: [string, string];
    file?: string; revision?: string; line?: number;
};
export type DeepLink = TourLink | ComparisonLink;
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const focusFields = ['part', 'chapter', 'scene', 'step'];

function required(params: URLSearchParams, key: string): string {
    const value = params.get(key);
    if (!value || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid or missing ${key}.`);
    return value;
}
export function validateRelativePath(value: string): string {
    if (!value || value.startsWith('/') || value.includes('\\') || value.includes('\0')
        || value.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error('Expected a repository-relative path without traversal.');
    }
    return value;
}
function validateFields(params: URLSearchParams, allowed: string[], repeated: string[] = []): void {
    for (const key of params.keys()) {
        if (!allowed.includes(key)) throw new Error(`Unsupported link field: ${key}.`);
        if (!repeated.includes(key) && params.getAll(key).length !== 1) throw new Error(`Duplicate link field: ${key}.`);
    }
}
function validateLocalFileUrl(value: string): string {
    const local = new URL(value);
    if (local.protocol !== 'file:' || local.hostname || local.search || local.hash || local.username || local.password
        || !local.pathname.startsWith('/')) throw new Error('Links require a local file URL.');
    return value;
}
export function parseDocumentFocus(params: URLSearchParams): DocumentFocus {
    const part = required(params, 'part');
    const fields = (part === 'title' || part === 'conclusion') ? [] : part === 'chapter' ? ['chapter']
        : part === 'scene' ? ['scene'] : part === 'step' ? ['scene', 'step'] : null;
    if (!fields) throw new Error(`Unsupported document part: ${part}.`);
    for (const key of focusFields.filter(key => key !== 'part')) {
        if (params.has(key) && !fields.includes(key)) throw new Error(`${key} is incompatible with ${part}.`);
    }
    return Object.fromEntries([['part', part], ...fields.map(key => [key, required(params, key)])]) as DocumentFocus;
}
export function parseDeepLink(value: string): DeepLink {
    if (value.length > 16384 || /%(?![\da-f]{2})/i.test(value)) throw new Error('Invalid or oversized Bygone link.');
    const url = new URL(value);
    if (url.protocol !== 'bygone:' || url.hostname !== 'open' || url.pathname !== '/v1'
        || url.username || url.password || url.port || url.hash) throw new Error('Unsupported Bygone link address or version.');
    const p = url.searchParams;
    const kind = required(p, 'kind');
    const repo = validateLocalFileUrl(required(p, 'repo'));
    if (kind === 'tour') {
        validateFields(p, ['kind', 'repo', 'tour', 'mode', ...focusFields]);
        const mode = required(p, 'mode');
        if (mode !== 'historical' && mode !== 'deconstructed') throw new Error('Unsupported authored tour mode.');
        const tour = required(p, 'tour');
        if (/^[a-z][a-z\d+.-]*:/i.test(tour)) validateLocalFileUrl(tour);
        else validateRelativePath(tour);
        return { kind, repo, tour, mode, focus: parseDocumentFocus(p) };
    }
    if (kind !== 'compare') throw new Error('Unsupported Bygone link kind.');
    validateFields(p, ['kind', 'repo', 'rev', 'file', 'revision', 'line'], ['rev']);
    const revisions = p.getAll('rev');
    if (revisions.length !== 2 || revisions.some(oid => !oidPattern.test(oid)) || revisions[0] === revisions[1]) {
        throw new Error('Comparison links require two distinct full commit IDs in order.');
    }
    const file = p.has('file') ? validateRelativePath(required(p, 'file')) : undefined;
    const revision = p.has('revision') ? required(p, 'revision') : undefined;
    if (revision && (!file || !revisions.includes(revision))) throw new Error('Code focus requires a file and one of the comparison revisions.');
    const line = p.has('line') ? Number(required(p, 'line')) : undefined;
    if (line !== undefined && (!revision || !Number.isSafeInteger(line) || line < 1)) throw new Error('Line focus requires a revision and positive line number.');
    return { kind, repo, revisions: revisions as [string, string], ...(file ? { file } : {}), ...(revision ? { revision } : {}), ...(line !== undefined ? { line } : {}) };
}
export function serializeDeepLink(link: DeepLink): string {
    const url = new URL('bygone://open/v1');
    url.searchParams.set('kind', link.kind);
    url.searchParams.set('repo', link.repo);
    if (link.kind === 'tour') {
        url.searchParams.set('tour', link.tour);
        url.searchParams.set('mode', link.mode);
        for (const [key, value] of Object.entries(link.focus)) url.searchParams.set(key, value);
    } else {
        for (const revision of link.revisions) url.searchParams.append('rev', revision);
        for (const key of ['file', 'revision', 'line'] as const) if (link[key] !== undefined) url.searchParams.set(key, String(link[key]));
    }
    parseDeepLink(url.href);
    return url.href;
}
export function authoredModeTour(tour: ChangeTourManifest, mode: TourLink['mode']): ChangeTourModeTour {
    if (tour.tours) {
        const result = tour.tours[mode];
        if (!result) throw new Error(`This tour has no ${mode} mode.`);
        return result;
    }
    const deconstructed = tour.scenes.some(scene => scene.kind === 'deconstructed-diff');
    if (mode === 'deconstructed' && deconstructed) return tour;
    if (mode === 'historical' && !deconstructed) return tour;
    if (mode === 'historical' && tour.zoom?.final.scenes.some(scene => scene.kind === 'walkthrough')) return tour.zoom.final;
    throw new Error(`This tour has no ${mode} mode.`);
}
export function resolveDocumentFocus(tour: ChangeTourManifest, mode: TourLink['mode'], focus: DocumentFocus): { key: string; sceneIndex: number; stepIndex: number } {
    const selected = authoredModeTour(tour, mode);
    if (focus.part === 'title') return { key: 'title', sceneIndex: 0, stepIndex: 0 };
    if (focus.part === 'conclusion') {
        if (!selected.conclusion) throw new Error('Conclusion is unavailable in this tour mode.');
        return { key: 'conclusion', sceneIndex: -1, stepIndex: 0 };
    }
    if (focus.part === 'chapter') {
        const chapter = selected.chapters.find(item => item.id === focus.chapter);
        const sceneIndex = selected.scenes.findIndex(scene => scene.id === chapter?.sceneIds[0]);
        if (!chapter || sceneIndex < 0) throw new Error(`Chapter is unavailable: ${focus.chapter}.`);
        return { key: `chapter:${chapter.id}`, sceneIndex, stepIndex: 0 };
    }
    const sceneIndex = selected.scenes.findIndex(scene => scene.id === focus.scene);
    if (sceneIndex < 0) throw new Error(`Scene is unavailable: ${focus.scene}.`);
    const scene = selected.scenes[sceneIndex];
    if (focus.part === 'scene') return { key: `scene:${scene.id}`, sceneIndex, stepIndex: 0 };
    const stepIndex = 'steps' in scene ? scene.steps.findIndex(step => step.id === focus.step) : -1;
    if (stepIndex < 0) throw new Error(`Step is unavailable: ${focus.step}.`);
    return { key: `step:${scene.id}:${focus.step}`, sceneIndex, stepIndex };
}
export function serializeDocumentFragment(mode: TourLink['mode'], focus: DocumentFocus): string {
    return `#${new URLSearchParams({ location: '1', mode, ...focus })}`;
}
export function parseDocumentFragment(hash: string): Pick<TourLink, 'mode' | 'focus'> | null {
    if (!hash) return null;
    if (hash.length > 16384 || /%(?![\da-f]{2})/i.test(hash)) throw new Error('Oversized tour location.');
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    validateFields(p, ['location', 'mode', ...focusFields]);
    if (p.get('location') !== '1') throw new Error('Unsupported tour location version.');
    const mode = p.get('mode');
    if (mode !== 'historical' && mode !== 'deconstructed') throw new Error('Unsupported tour location mode.');
    return { mode, focus: parseDocumentFocus(p) };
}
