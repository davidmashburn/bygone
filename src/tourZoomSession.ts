/** The canonical views that keep an independent cursor in a tour session. */
export type TourZoomMode = 'history' | 'compare' | 'historical' | 'deconstructed';

export interface ZoomLocation {
    sceneIndex: number;
    stepIndex: number;
    path: string | null;
    line?: number;
    commit?: string;
    navigation?: unknown;
    focusId?: string;
    narrativeScroll?: number;
    view?: string;
    narrativeParent?: string | null;
    sceneIntroVisible?: boolean;
}

function defaultZoomLocation(): ZoomLocation {
    return { sceneIndex: 0, stepIndex: 0, path: null };
}

export class TourZoomSession {
    private cursors = new Map<TourZoomMode, ZoomLocation>();

    constructor(public mode: TourZoomMode) {}

    /** Kept as a no-op for callers that mark navigation before capturing a cursor. */
    navigate(): void {}

    /** Save the current mode's exact cursor, including its view and UI state. */
    depart(location: ZoomLocation): ZoomLocation {
        this.cursors.set(this.mode, location);
        return location;
    }

    /**
     * Enter a mode using only that mode's saved cursor.
     *
     * The optional second argument remains accepted for callers being migrated
     * from the old cross-mode mapping API, but it is deliberately ignored.
     */
    enter(mode: TourZoomMode, _mapped?: ZoomLocation | null): { location: ZoomLocation; restore: boolean } {
        this.mode = mode;
        const saved = this.cursors.get(mode);
        return saved
            ? { location: saved, restore: true }
            : { location: defaultZoomLocation(), restore: false };
    }
}
