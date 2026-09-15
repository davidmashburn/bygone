/** Session cursors are only replaced by deliberate navigation, never by a fallback landing. */
export type TourZoomMode = 'explanation' | 'revisions' | 'final' | 'history';
export interface ZoomLocation {
    sceneIndex: number;
    stepIndex: number;
    path: string | null;
    line?: number;
    commit?: string;
    navigation?: unknown;
    focusId?: string;
    narrativeScroll?: number;
}

interface ZoomStep {
    file?: string;
    startLine?: number;
    endLine?: number;
    diff?: { path?: string };
}

interface ZoomScene {
    path?: string;
    steps?: ZoomStep[];
}

interface ZoomFile {
    kind?: string;
    path?: string;
    previousPath?: string;
}

export class TourZoomSession {
    private cursors = new Map<TourZoomMode, { location: ZoomLocation; epoch: number }>();
    private epoch = 0;
    private dirty = false;
    private origin: ZoomLocation | null = null;
    constructor(public mode: TourZoomMode) {}

    navigate(): void { this.dirty = true; }

    depart(location: ZoomLocation): ZoomLocation {
        if (this.dirty || !this.origin) {
            if (this.dirty) this.epoch++;
            this.origin = location;
            this.cursors.set(this.mode, { location, epoch: this.epoch });
        } else if (!this.cursors.has(this.mode)) {
            this.cursors.set(this.mode, { location, epoch: this.epoch });
        }
        this.dirty = false;
        return this.origin;
    }

    enter(mode: TourZoomMode, mapped: ZoomLocation | null): { location: ZoomLocation; restore: boolean } {
        const saved = this.cursors.get(mode);
        this.mode = mode;
        this.dirty = false;
        if (saved && (saved.epoch === this.epoch || !mapped)) return { location: saved.location, restore: true };
        return { location: mapped || { sceneIndex: 0, stepIndex: 0, path: null }, restore: false };
    }
}

/** Prefer matching rename aliases and then the closest authored range in the file. */
export function mapZoomLocation(
    origin: ZoomLocation,
    scenes: ZoomScene[],
    files: ZoomFile[]
): ZoomLocation | null {
    const file = files.find((entry) => entry.path === origin.path || entry.previousPath === origin.path);
    const aliases = new Set([origin.path, file?.path, file?.previousPath].filter(Boolean));
    let best: ZoomLocation | null = null;
    let distance = Infinity;
    scenes.forEach((scene, sceneIndex) => {
        const candidates = scene.steps || [{ file: scene.path }];
        candidates.forEach((step: ZoomStep, stepIndex: number) => {
            const path = step.diff?.path || step.file || scene.path;
            if (!aliases.has(path)) return;
            const start = step.startLine || 1;
            const end = step.endLine || start;
            const line = origin.line || start;
            const delta = Math.max(start - line, line - end, 0);
            if (delta < distance) {
                distance = delta;
                best = { sceneIndex, stepIndex, path: path ?? null, line: origin.line, commit: origin.commit };
            }
        });
    });
    if (!best && file?.kind === 'text-diff') return { sceneIndex: 0, stepIndex: 0, path: file.path ?? null, line: origin.line, commit: origin.commit };
    return best;
}
