import type { ChangeTourNarrative } from './changeTourManifest';

export const CHANGE_TOUR_SOURCE_VERSION = 1 as const;

export interface ChangeTourSourceAnchor {
    file: string;
    revision: 'base' | 'head';
    contains: string;
    occurrence?: number;
}

export interface ChangeTourSourceConnection {
    id: string;
    from: string;
    to: string;
    label: string;
}

export interface ChangeTourSourceStep {
    id: string;
    title: string;
    body: string;
    focus: string;
    connection?: string;
}

export interface ChangeTourSourceScene extends ChangeTourNarrative {
    id: string;
    title: string;
    steps: ChangeTourSourceStep[];
}

export interface ChangeTourSourceChapter {
    id: string;
    title: string;
    scenes: ChangeTourSourceScene[];
}

export interface ChangeTourSource {
    version: typeof CHANGE_TOUR_SOURCE_VERSION;
    title?: string;
    sourceUrl?: string;
    range?: {
        base: string;
        head: string;
    };
    anchors: Record<string, ChangeTourSourceAnchor>;
    connections: ChangeTourSourceConnection[];
    chapters: ChangeTourSourceChapter[];
}

export function parseChangeTourSource(value: unknown): ChangeTourSource {
    if (!isRecord(value) || value.version !== CHANGE_TOUR_SOURCE_VERSION) {
        throw new Error('Unsupported or missing change-tour source version.');
    }
    optionalString(value.title, 'title');
    optionalString(value.sourceUrl, 'sourceUrl');
    if (value.range !== undefined) {
        if (!isRecord(value.range)) throw new Error('range must be an object.');
        requireString(value.range.base, 'range.base');
        requireString(value.range.head, 'range.head');
    }
    if (!isRecord(value.anchors) || Object.keys(value.anchors).length === 0) {
        throw new Error('anchors must be a non-empty object.');
    }
    for (const [id, anchor] of Object.entries(value.anchors)) {
        if (!isRecord(anchor)) {
            throw new Error(`anchors.${id} must be an object.`);
        }
        requireString(anchor.file, `anchors.${id}.file`);
        if (anchor.revision !== 'base' && anchor.revision !== 'head') {
            throw new Error(`anchors.${id}.revision must be base or head.`);
        }
        requireString(anchor.contains, `anchors.${id}.contains`);
        if (anchor.occurrence !== undefined && (!Number.isInteger(anchor.occurrence) || Number(anchor.occurrence) < 1)) {
            throw new Error(`anchors.${id}.occurrence must be a positive integer.`);
        }
    }
    const rawConnections = Array.isArray(value.connections)
        ? value.connections
        : isRecord(value.connections)
            ? Object.entries(value.connections).map(([id, connection]) => isRecord(connection) ? { id, ...connection } : connection)
            : null;
    if (!rawConnections || !Array.isArray(value.chapters)) {
        throw new Error('connections must be an array or object, and chapters must be an array.');
    }
    const connectionIds = new Set<string>();
    for (const [index, connection] of rawConnections.entries()) {
        if (!isRecord(connection)) {
            throw new Error(`connections[${index}] must be an object.`);
        }
        requireString(connection.id, `connections[${index}].id`);
        requireString(connection.from, `connections[${index}].from`);
        requireString(connection.to, `connections[${index}].to`);
        requireString(connection.label, `connections[${index}].label`);
        const { id, from, to } = connection;
        if (!value.anchors[from] || !value.anchors[to]) {
            throw new Error(`Connection ${id} references an unknown anchor.`);
        }
        if (connectionIds.has(id)) {
            throw new Error(`Duplicate connection id: ${id}`);
        }
        connectionIds.add(id);
    }
    for (const [chapterIndex, chapter] of value.chapters.entries()) {
        if (!isRecord(chapter) || !Array.isArray(chapter.scenes)) {
            throw new Error(`chapters[${chapterIndex}] must contain a scenes array.`);
        }
        requireString(chapter.id, `chapters[${chapterIndex}].id`);
        requireString(chapter.title, `chapters[${chapterIndex}].title`);
        for (const [sceneIndex, scene] of chapter.scenes.entries()) {
            const path = `chapters[${chapterIndex}].scenes[${sceneIndex}]`;
            if (!isRecord(scene) || !Array.isArray(scene.steps) || scene.steps.length === 0) {
                throw new Error(`${path} must contain a non-empty steps array.`);
            }
            requireString(scene.id, `${path}.id`);
            requireString(scene.title, `${path}.title`);
            validateNarrative(scene, path);
            for (const [stepIndex, step] of scene.steps.entries()) {
                const stepPath = `${path}.steps[${stepIndex}]`;
                if (!isRecord(step)) {
                    throw new Error(`${stepPath} must be an object.`);
                }
                requireString(step.id, `${stepPath}.id`);
                requireString(step.title, `${stepPath}.title`);
                requireString(step.body, `${stepPath}.body`);
                requireString(step.focus, `${stepPath}.focus`);
                const focus = step.focus;
                if (!value.anchors[focus]) {
                    throw new Error(`${stepPath} references unknown anchor ${focus}.`);
                }
                optionalString(step.connection, `${stepPath}.connection`);
                const connection = step.connection;
                if (typeof connection === 'string' && !connectionIds.has(connection)) {
                    throw new Error(`${stepPath} references unknown connection ${connection}.`);
                }
            }
        }
    }
    return { ...value, connections: rawConnections } as unknown as ChangeTourSource;
}

function validateNarrative(value: Record<string, unknown>, path: string): void {
    requireString(value.summary, `${path}.summary`);
    requireStringArray(value.bullets, `${path}.bullets`);
    requireStringArray(value.tags, `${path}.tags`);
    requireString(value.takeaway, `${path}.takeaway`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${path} must be a non-empty string.`);
    }
}

function optionalString(value: unknown, path: string): void {
    if (value !== undefined) {
        requireString(value, path);
    }
}

function requireStringArray(value: unknown, path: string): asserts value is string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new Error(`${path} must be an array of strings.`);
    }
}
