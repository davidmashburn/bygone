import { execFileSync } from 'child_process';
import { GitChangedPath, parseNameStatusZ, resolveBranchReviewRange, resolveReviewPathPair } from './gitComparison';
import {
    CHANGE_TOUR_MANIFEST_VERSION,
    ChangeTourChapter,
    ChangeTourDiffScene,
    ChangeTourFile,
    ChangeTourManifest,
    ChangeTourOmittedFile,
    ChangeTourResolvedAnchor,
    ChangeTourScene,
    ChangeTourStory,
    ChangeTourWalkthroughScene,
    parseChangeTourManifest
} from './changeTourManifest';
import { ChangeTourSource, parseChangeTourSource } from './changeTourSource';

export { parseChangeTourManifest, parseChangeTourStory } from './changeTourManifest';
export { parseChangeTourSource } from './changeTourSource';
export { buildChangeTourContext } from './changeTourContext';
export type { BuildChangeTourContextOptions, ChangeTourContext } from './changeTourContext';
export { buildChangeInventory, materializeChangeUnits } from './changeInventory';
export type { BuildChangeInventoryOptions, ChangeInventory, ChangeInventoryFile, ChangeUnit } from './changeInventory';

const DEFAULT_MAX_TOUR_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOUR_LINE_BYTES = 64 * 1024;
const DEFAULT_MAX_STACK_CONTENT_BYTES = 8 * 1024 * 1024;

export interface BuildChangeTourOptions {
    headRef?: string;
    baseRef?: string;
    title?: string;
    sourceUrl?: string;
    generatedAt?: string;
    maxFileBytes?: number;
    maxLineBytes?: number;
    story?: ChangeTourStory;
    source?: ChangeTourSource;
}

interface ChapterDefinition {
    id: string;
    title: string;
    priority: number;
}

const CHAPTERS = {
    context: { id: 'context', title: 'Context and architecture', priority: 0 },
    contracts: { id: 'contracts', title: 'Data model and contracts', priority: 1 },
    behavior: { id: 'behavior', title: 'Behavior and integration', priority: 2 },
    proof: { id: 'proof', title: 'Proof and coverage', priority: 3 },
    packaging: { id: 'packaging', title: 'Packaging and dependencies', priority: 4 }
} satisfies Record<string, ChapterDefinition>;

export function buildChangeTourManifest(
    startPath: string,
    options: BuildChangeTourOptions = {}
): ChangeTourManifest {
    const range = resolveBranchReviewRange(startPath, options.headRef, options.baseRef);
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_TOUR_FILE_BYTES;
    const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_TOUR_LINE_BYTES;
    const omittedFiles: string[] = [];
    const files: ChangeTourFile[] = [];
    const sceneRecords: Array<{ chapter: ChapterDefinition; scene: ChangeTourDiffScene }> = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const changedPath of range.changedPaths) {
        const { additions, deletions } = readGitLineStats(
            range.repoRoot,
            range.mergeBaseOid,
            range.headOid,
            changedPath.path,
            changedPath.previousPath
        );
        totalAdditions += additions;
        totalDeletions += deletions;
        const pair = resolveReviewPathPair(range.changedPaths, changedPath.path);
        if (!pair) {
            omittedFiles.push(changedPath.path);
            files.push(buildOmittedFile(changedPath, additions, deletions, 'Git endpoints could not be resolved.'));
            continue;
        }
        const left = readGitText(range.repoRoot, range.mergeBaseOid, pair.leftPath, maxFileBytes, maxLineBytes);
        const right = readGitText(range.repoRoot, range.headOid, pair.rightPath, maxFileBytes, maxLineBytes);
        if (left.kind !== 'text' || right.kind !== 'text') {
            omittedFiles.push(changedPath.path);
            files.push(buildOmittedFile(changedPath, additions, deletions, 'Binary, oversized, or contains an oversized line.'));
            continue;
        }
        const chapter = chapterForPath(changedPath.path);
        const scene: ChangeTourDiffScene = {
            id: `file-${files.length + 1}`,
            kind: 'text-diff',
            title: changedPath.path.split('/').pop() || changedPath.path,
            summary: `${formatChangeKind(changedPath.kind)} ${changedPath.path}.`,
            bullets: [],
            tags: [changedPath.kind, `+${additions}`, `−${deletions}`],
            takeaway: buildSceneNote(changedPath.kind, additions, deletions, changedPath.previousPath),
            path: changedPath.path,
            previousPath: changedPath.previousPath,
            changeKind: changedPath.kind,
            leftLabel: pair.leftPath
                ? `${pair.leftPath} @ ${range.mergeBaseOid.slice(0, 7)}`
                : `${changedPath.path} (absent)`,
            rightLabel: pair.rightPath
                ? `${pair.rightPath} @ ${range.headOid.slice(0, 7)}`
                : `${changedPath.path} (absent)`,
            leftContent: left.content,
            rightContent: right.content,
            additions,
            deletions
        };
        files.push(scene);
        sceneRecords.push({
            chapter,
            scene
        });
    }

    files.sort((left, right) => left.path.localeCompare(right.path));

    sceneRecords.sort((left, right) => (
        left.chapter.priority - right.chapter.priority
        || left.scene.path.localeCompare(right.scene.path)
    ));
    const defaultScenes = sceneRecords.map(({ scene }, index) => ({ ...scene, id: `file-${index + 1}` }));
    if (options.story && options.source) {
        throw new Error('A change tour can use either a legacy story or a source file, not both.');
    }
    const authored = options.source
        ? applySource(parseChangeTourSource(options.source), defaultScenes, range.repoRoot)
        : options.story
        ? applyStory(options.story, defaultScenes)
        : {
            scenes: defaultScenes as ChangeTourScene[],
            chapters: buildChapters(sceneRecords, new Map(defaultScenes.map((scene) => [scene.path, scene.id])))
        };
    const scenes = authored.scenes;
    const chapters = authored.chapters;
    const manifest: ChangeTourManifest = {
        version: CHANGE_TOUR_MANIFEST_VERSION,
        title: options.source?.title || options.story?.title || options.title || `${range.headRef} against ${range.baseRef}`,
        sourceUrl: options.source?.sourceUrl || options.story?.sourceUrl || options.sourceUrl,
        generatedAt: options.generatedAt || new Date().toISOString(),
        range: {
            baseRef: range.baseRef,
            headRef: range.headRef,
            mergeBaseOid: range.mergeBaseOid,
            headOid: range.headOid
        },
        summary: {
            changedFiles: range.changedPaths.length,
            includedScenes: scenes.length,
            additions: totalAdditions,
            deletions: totalDeletions,
            commitCount: range.commits.length,
            omittedFiles
        },
        commits: range.commits,
        files,
        chapters,
        scenes
    };
    return parseChangeTourManifest(manifest);
}

function applySource(
    source: ChangeTourSource,
    defaultScenes: ChangeTourDiffScene[],
    repoRoot: string
): { scenes: ChangeTourScene[]; chapters: ChangeTourChapter[] } {
    const available = new Map(defaultScenes.map((scene) => [scene.path, scene]));
    const resolvedAnchors = new Map<string, ChangeTourResolvedAnchor>();
    for (const [id, anchor] of Object.entries(source.anchors)) {
        const file = available.get(anchor.file);
        if (!file) {
            throw new Error(`Anchor ${id} references a file outside the text change range: ${anchor.file}`);
        }
        const content = anchor.revision === 'base' ? file.leftContent : file.rightContent;
        resolvedAnchors.set(id, resolveAnchor(id, anchor.file, anchor.revision, content, anchor.contains, anchor.occurrence));
    }
    const connections = new Map(source.connections.map((connection) => [connection.id, {
        id: connection.id,
        label: connection.label,
        from: requireResolvedAnchor(resolvedAnchors, connection.from),
        to: requireResolvedAnchor(resolvedAnchors, connection.to)
    }]));
    const scenes: ChangeTourScene[] = [];
    const chapters: ChangeTourChapter[] = [];

    for (const chapter of source.chapters) {
        const sceneIds: string[] = [];
        for (const authoredScene of chapter.scenes) {
            if (authoredScene.kind === 'stacked-diff') {
                const stackedScene = buildStackedScene(repoRoot, authoredScene);
                scenes.push(stackedScene);
                sceneIds.push(stackedScene.id);
                continue;
            }
            const scene: ChangeTourWalkthroughScene = {
                id: authoredScene.id,
                kind: 'walkthrough',
                title: authoredScene.title,
                summary: authoredScene.summary,
                bullets: authoredScene.bullets,
                tags: authoredScene.tags,
                takeaway: authoredScene.takeaway,
                steps: authoredScene.steps.map((step) => {
                    const focus = requireResolvedAnchor(resolvedAnchors, step.focus);
                    const diff = available.get(focus.path);
                    if (!diff) throw new Error(`Step ${step.id} has no text diff for ${focus.path}.`);
                    return {
                        id: step.id,
                        title: step.title,
                        body: step.body,
                        depth: step.depth,
                        focus,
                        connection: step.connection ? connections.get(step.connection) : undefined,
                        diff: { ...diff, id: `${authoredScene.id}-${step.id}` }
                    };
                })
            };
            scenes.push(scene);
            sceneIds.push(scene.id);
        }
        chapters.push({ id: chapter.id, title: chapter.title, sceneIds });
    }

    return { scenes, chapters };
}

function buildStackedScene(
    repoRoot: string,
    source: Extract<ChangeTourSource['chapters'][number]['scenes'][number], { kind: 'stacked-diff' }>
): ChangeTourScene {
    const stack = source.stack.map((entry) => ({
        id: entry.id,
        ref: entry.ref,
        oid: runGitText(repoRoot, ['rev-parse', '--verify', `${entry.ref}^{commit}`]),
        label: entry.label || entry.ref
    }));
    const adjacentChanges = stack.slice(0, -1).map((entry, index) => parseNameStatusZ(execFileSync('git', [
        'diff', '--name-status', '-z', '--find-renames=20%', entry.oid, stack[index + 1].oid
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
    })));
    const renamedPreviousPaths = new Set(adjacentChanges.flatMap((changes) => (
        changes.map((change) => change.previousPath).filter((candidate): candidate is string => Boolean(candidate))
    )));
    const changedFiles = [...new Set(adjacentChanges.flatMap((changes) => changes.map((change) => change.path)))]
        .filter((filePath) => !renamedPreviousPaths.has(filePath))
        .sort();
    const filePaths = source.files?.length ? [...new Set(source.files)] : changedFiles;
    for (const step of source.steps) {
        if (!filePaths.includes(step.file)) throw new Error(`Stacked step ${step.id} references undeclared file ${step.file}.`);
    }
    if (filePaths.length === 0) throw new Error(`Stacked scene ${source.id} has no changed files.`);

    let totalContentBytes = 0;
    const files = filePaths.map((filePath) => {
        const aliases = new Set([filePath]);
        for (const changes of adjacentChanges) {
            for (const change of changes) {
                if (aliases.has(change.path) || (change.previousPath && aliases.has(change.previousPath))) {
                    aliases.add(change.path);
                    if (change.previousPath) aliases.add(change.previousPath);
                }
            }
        }
        const panels = stack.map((entry) => {
            const resolvedPath = [...aliases].find((candidate) => gitBlobExists(repoRoot, entry.oid, candidate));
            if (!resolvedPath) {
                return { id: entry.id, label: `${entry.label} / ${filePath} (missing)`, content: '', exists: false };
            }
            const content = readGitText(repoRoot, entry.oid, resolvedPath, DEFAULT_MAX_TOUR_FILE_BYTES, DEFAULT_MAX_TOUR_LINE_BYTES);
            if (content.kind !== 'text') throw new Error(`Stacked tour file is binary or too large: ${resolvedPath}`);
            totalContentBytes += Buffer.byteLength(content.content);
            if (totalContentBytes > DEFAULT_MAX_STACK_CONTENT_BYTES) {
                throw new Error(`Stacked tour content exceeds ${DEFAULT_MAX_STACK_CONTENT_BYTES} bytes.`);
            }
            return {
                id: entry.id,
                label: `${entry.label} / ${resolvedPath}`,
                path: resolvedPath,
                content: content.content,
                exists: true
            };
        });
        return { path: filePath, panels };
    });
    const stackIds = stack.map((entry) => entry.id);
    return {
        id: source.id,
        kind: 'stacked-diff',
        title: source.title,
        summary: source.summary,
        bullets: source.bullets,
        tags: source.tags,
        takeaway: source.takeaway,
        stack,
        files,
        steps: source.steps.map((step) => ({
            id: step.id,
            title: step.title,
            body: step.body,
            file: step.file,
            pairIndex: stackIds.indexOf(step.pair[0]),
            side: step.side || 'right',
            startLine: step.lines?.[0],
            endLine: step.lines?.[1]
        }))
    };
}

function gitBlobExists(repoRoot: string, oid: string, relativePath: string): boolean {
    try {
        execFileSync('git', ['cat-file', '-e', `${oid}:${relativePath}`], {
            cwd: repoRoot,
            stdio: ['ignore', 'ignore', 'ignore']
        });
        return true;
    } catch {
        return false;
    }
}

function runGitText(repoRoot: string, args: string[]): string {
    return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function resolveAnchor(
    id: string,
    file: string,
    revision: 'base' | 'head',
    content: string,
    needle: string,
    occurrence?: number
): ChangeTourResolvedAnchor {
    const offsets: number[] = [];
    let offset = content.indexOf(needle);
    while (offset >= 0) {
        offsets.push(offset);
        offset = content.indexOf(needle, offset + Math.max(needle.length, 1));
    }
    if (offsets.length === 0) throw new Error(`Anchor ${id} did not match ${file} at ${revision}.`);
    if (occurrence === undefined && offsets.length > 1) {
        throw new Error(`Anchor ${id} matched ${offsets.length} places in ${file}; add occurrence to disambiguate it.`);
    }
    const selected = offsets[(occurrence || 1) - 1];
    if (selected === undefined) throw new Error(`Anchor ${id} occurrence ${occurrence} does not exist in ${file}.`);
    const startLine = content.slice(0, selected).split('\n').length;
    const endLine = startLine + needle.split('\n').length - 1;
    return { id, path: file, revision, startLine, endLine, excerpt: needle };
}

function requireResolvedAnchor(
    anchors: Map<string, ChangeTourResolvedAnchor>,
    id: string
): ChangeTourResolvedAnchor {
    const anchor = anchors.get(id);
    if (!anchor) throw new Error(`Unknown resolved anchor: ${id}`);
    return anchor;
}

function applyStory(
    story: ChangeTourStory,
    defaultScenes: ChangeTourDiffScene[]
): { scenes: ChangeTourScene[]; chapters: ChangeTourChapter[] } {
    const available = new Map(defaultScenes.map((scene) => [scene.path, scene]));
    const scenes: ChangeTourScene[] = [];
    const chapterRecords: Array<{ id: string; title: string; sceneIds: string[] }> = [];
    const chaptersById = new Map<string, { id: string; title: string; sceneIds: string[] }>();
    const addScene = (chapterId: string, chapterTitle: string, scene: ChangeTourScene) => {
        let chapter = chaptersById.get(chapterId);
        if (!chapter) {
            chapter = { id: chapterId, title: chapterTitle, sceneIds: [] };
            chaptersById.set(chapterId, chapter);
            chapterRecords.push(chapter);
        }
        scenes.push(scene);
        chapter.sceneIds.push(scene.id);
    };

    for (const storyScene of story.scenes) {
        const id = `scene-${scenes.length + 1}`;
        if (storyScene.kind === 'discussion') {
            addScene(storyScene.chapterId, storyScene.chapterTitle, {
                id,
                kind: 'discussion',
                title: storyScene.title,
                summary: storyScene.summary,
                bullets: storyScene.bullets,
                tags: storyScene.tags,
                takeaway: storyScene.takeaway
            });
            continue;
        }
        const baseScene = available.get(storyScene.path);
        if (!baseScene) {
            throw new Error(`Story references a file outside the change range: ${storyScene.path}`);
        }
        available.delete(storyScene.path);
        addScene(storyScene.chapterId, storyScene.chapterTitle, {
            ...baseScene,
            id,
            title: storyScene.title || baseScene.title,
            summary: storyScene.summary,
            bullets: storyScene.bullets,
            tags: storyScene.tags,
            takeaway: storyScene.takeaway,
            focusChangeIndex: storyScene.focusChangeIndex
        });
    }

    return { scenes, chapters: chapterRecords };
}

function buildChapters(
    records: Array<{ chapter: ChapterDefinition; scene: ChangeTourDiffScene }>,
    sceneIdByPath: Map<string, string>
): ChangeTourChapter[] {
    const definitions = [...new Map(records.map(({ chapter }) => [chapter.id, chapter])).values()]
        .sort((left, right) => left.priority - right.priority);
    return definitions.map((definition) => ({
        id: definition.id,
        title: definition.title,
        sceneIds: records
            .filter(({ chapter }) => chapter.id === definition.id)
            .map(({ scene }) => sceneIdByPath.get(scene.path))
            .filter((sceneId): sceneId is string => Boolean(sceneId))
    }));
}

function chapterForPath(filePath: string): ChapterDefinition {
    const lower = filePath.toLowerCase();
    const fileName = lower.split('/').pop() || lower;
    if (lower.startsWith('docs/') || fileName === 'readme.md' || fileName.includes('architecture')) {
        return CHAPTERS.context;
    }
    if (/(^|\/)(tests?|__tests__)(\/|$)/.test(lower) || /(^|\/)test_[^/]+$/.test(lower)) {
        return CHAPTERS.proof;
    }
    if (/(^|\/)(models?|schema|types?|contracts?)\.[^/]+$/.test(lower)) {
        return CHAPTERS.contracts;
    }
    if (/(^|\/)(package-lock\.json|.*\.lock|pyproject\.toml|package\.json)$/.test(lower)) {
        return CHAPTERS.packaging;
    }
    return CHAPTERS.behavior;
}

function buildSceneNote(kind: string, additions: number, deletions: number, previousPath?: string): string {
    const label = formatChangeKind(kind);
    const rename = previousPath ? ` from ${previousPath}` : '';
    return `${label}${rename} · +${additions} −${deletions}`;
}

function buildOmittedFile(
    changedPath: GitChangedPath,
    additions: number,
    deletions: number,
    reason: string
): ChangeTourOmittedFile {
    return {
        id: `file-${changedPath.path}`,
        kind: 'omitted',
        title: changedPath.path.split('/').pop() || changedPath.path,
        path: changedPath.path,
        previousPath: changedPath.previousPath,
        changeKind: changedPath.kind,
        additions,
        deletions,
        reason
    };
}

function formatChangeKind(kind: string): string {
    return kind.replace('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

type GitTextResult =
    | { kind: 'text'; content: string }
    | { kind: 'binary-or-large'; content: '' };

function readGitText(
    repoRoot: string,
    oid: string,
    relativePath: string | null,
    maxBytes: number,
    maxLineBytes: number
): GitTextResult {
    if (!relativePath) {
        return { kind: 'text', content: '' };
    }
    const content = execFileSync('git', ['show', `${oid}:${relativePath}`], {
        cwd: repoRoot,
        encoding: 'buffer',
        maxBuffer: Math.max(maxBytes + 1, DEFAULT_MAX_TOUR_FILE_BYTES + 1),
        stdio: ['ignore', 'pipe', 'pipe']
    });
    if (content.length > maxBytes || content.includes(0) || hasLineLongerThan(content, maxLineBytes)) {
        return { kind: 'binary-or-large', content: '' };
    }
    return { kind: 'text', content: content.toString('utf8') };
}

function hasLineLongerThan(content: Buffer, maxLineBytes: number): boolean {
    let lineStart = 0;
    for (let index = 0; index < content.length; index += 1) {
        if (content[index] !== 10) continue;
        if (index - lineStart > maxLineBytes) return true;
        lineStart = index + 1;
    }
    return content.length - lineStart > maxLineBytes;
}

function readGitLineStats(
    repoRoot: string,
    baseOid: string,
    headOid: string,
    filePath: string,
    previousPath?: string
): { additions: number; deletions: number } {
    const output = execFileSync('git', [
        'diff',
        '--numstat',
        '--find-renames',
        baseOid,
        headOid,
        '--',
        ...[previousPath, filePath].filter((candidate): candidate is string => Boolean(candidate))
    ], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const [additionsText = '0', deletionsText = '0'] = output.trim().split(/\s+/, 3);
    return {
        additions: Number.parseInt(additionsText, 10) || 0,
        deletions: Number.parseInt(deletionsText, 10) || 0
    };
}
