import type { NarrationSegment, NarrationUnit } from './tourNarration';

export interface NarrationSpeechCallbacks {
    onEnd(): void;
    onError(message: string): void;
}

export interface NarrationSpeechEngine {
    speak(segment: NarrationSegment, callbacks: NarrationSpeechCallbacks): void;
    pause(): void;
    resume(): void;
    cancel(): void;
}

export type NarrationPlaybackState =
    | { kind: 'idle' }
    | { kind: 'selected'; unit: NarrationUnit; segmentIndex: number }
    | { kind: 'playing'; unit: NarrationUnit; segmentIndex: number }
    | { kind: 'paused'; unit: NarrationUnit; segmentIndex: number; pendingStart: boolean }
    | { kind: 'completed' }
    | { kind: 'error'; message: string };

export interface NarrationPlaybackCallbacks {
    claimAudio(): void;
    onStateChange(state: NarrationPlaybackState): void;
    onSegmentChange(segment: NarrationSegment | null, paused: boolean): void;
    canNavigateUnit(unit: NarrationUnit, direction: -1 | 1): boolean;
    navigateUnit(unit: NarrationUnit, direction: -1 | 1): NarrationUnit | null;
}

export class TourNarrationController {
    private generation = 0;
    private continuous = true;
    private currentState: NarrationPlaybackState = { kind: 'idle' };

    constructor(
        private readonly engine: NarrationSpeechEngine,
        private readonly callbacks: NarrationPlaybackCallbacks
    ) {}

    get state(): NarrationPlaybackState {
        return this.currentState;
    }

    get engaged(): boolean {
        return this.currentState.kind === 'playing' || this.currentState.kind === 'paused';
    }

    get position(): { unit: NarrationUnit; segmentIndex: number } | null {
        const state = this.currentState;
        return state.kind === 'selected' || state.kind === 'playing' || state.kind === 'paused' ? state : null;
    }

    /** Select text without claiming audio, including in browsers without speech. */
    select(unit: NarrationUnit, segmentIndex = 0, paused = false): void {
        this.resetEngine();
        if (!unit.segments.length) {
            this.setState({ kind: 'idle' });
            this.callbacks.onSegmentChange(null, false);
            return;
        }
        segmentIndex = Math.max(0, Math.min(segmentIndex, unit.segments.length - 1));
        this.setState(paused
            ? { kind: 'paused', unit, segmentIndex, pendingStart: true }
            : { kind: 'selected', unit, segmentIndex });
        this.callbacks.onSegmentChange(unit.segments[segmentIndex], true);
    }

    start(unit: NarrationUnit, continuous = true, segmentIndex = 0): void {
        this.resetEngine();
        this.continuous = continuous;
        if (unit.segments.length === 0) {
            this.finishUnit(unit);
            return;
        }
        this.callbacks.claimAudio();
        this.setState({ kind: 'playing', unit, segmentIndex: Math.max(0, Math.min(segmentIndex, unit.segments.length - 1)) });
        this.speakCurrent();
    }

    togglePause(): void {
        if (this.currentState.kind === 'playing') {
            this.engine.pause();
            const pausedState: NarrationPlaybackState = {
                kind: 'paused',
                unit: this.currentState.unit,
                segmentIndex: this.currentState.segmentIndex,
                pendingStart: false
            };
            this.setState(pausedState);
            this.callbacks.onSegmentChange(pausedState.unit.segments[pausedState.segmentIndex] || null, true);
            return;
        }
        if (this.currentState.kind !== 'paused') return;
        this.callbacks.claimAudio();
        const pausedState = this.currentState;
        this.setState({
            kind: 'playing',
            unit: pausedState.unit,
            segmentIndex: pausedState.segmentIndex
        });
        if (pausedState.pendingStart) {
            this.speakCurrent();
        } else {
            this.engine.resume();
            this.callbacks.onSegmentChange(pausedState.unit.segments[pausedState.segmentIndex] || null, false);
        }
    }

    stop(): void {
        this.resetEngine();
        this.setState({ kind: 'idle' });
        this.callbacks.onSegmentChange(null, false);
    }

    pauseForExternalOwner(): void {
        if (this.currentState.kind === 'playing') this.togglePause();
    }

    canSkipSegment(direction: -1 | 1): boolean {
        const position = this.position;
        if (!position) return false;
        const targetIndex = position.segmentIndex + direction;
        return targetIndex >= 0 && targetIndex < position.unit.segments.length
            ? true
            : this.callbacks.canNavigateUnit(position.unit, direction);
    }

    skipSegment(direction: -1 | 1): boolean {
        if (!this.canSkipSegment(direction)) return false;
        const current = this.currentState as Extract<NarrationPlaybackState, { kind: 'playing' | 'paused' | 'selected' }>;
        const wasPaused = current.kind !== 'playing';
        let targetUnit = current.unit;
        let targetIndex = current.segmentIndex + direction;
        if (targetIndex < 0 || targetIndex >= targetUnit.segments.length) {
            const adjacentUnit = this.callbacks.navigateUnit(targetUnit, direction);
            if (!adjacentUnit || adjacentUnit.segments.length === 0) return false;
            targetUnit = adjacentUnit;
            targetIndex = direction < 0 ? targetUnit.segments.length - 1 : 0;
        }
        this.resetEngine();
        if (wasPaused) {
            this.setState(current.kind === 'selected'
                ? { kind: 'selected', unit: targetUnit, segmentIndex: targetIndex }
                : { kind: 'paused', unit: targetUnit, segmentIndex: targetIndex, pendingStart: true });
            this.callbacks.onSegmentChange(targetUnit.segments[targetIndex] || null, true);
        } else {
            this.setState({ kind: 'playing', unit: targetUnit, segmentIndex: targetIndex });
            this.speakCurrent();
        }
        return true;
    }

    followLinearNavigation(unit: NarrationUnit): void {
        if (this.currentState.kind === 'playing') {
            this.start(unit, this.continuous);
        } else if (this.currentState.kind === 'paused') {
            this.preparePaused(unit);
        } else {
            this.select(unit);
        }
    }

    followDirectNavigation(unit: NarrationUnit): void {
        if (this.engaged) this.preparePaused(unit);
        else this.select(unit);
    }

    interruptForExploration(): void {
        if (this.currentState.kind !== 'playing' && this.currentState.kind !== 'paused') return;
        const interrupted = this.currentState;
        this.resetEngine();
        this.setState({
            kind: 'paused',
            unit: interrupted.unit,
            segmentIndex: interrupted.segmentIndex,
            pendingStart: true
        });
        this.callbacks.onSegmentChange(interrupted.unit.segments[interrupted.segmentIndex] || null, true);
    }

    dispose(): void {
        this.stop();
    }

    private preparePaused(unit: NarrationUnit): void {
        this.resetEngine();
        this.setState({ kind: 'paused', unit, segmentIndex: 0, pendingStart: true });
        this.callbacks.onSegmentChange(unit.segments[0] || null, true);
    }

    private speakCurrent(): void {
        if (this.currentState.kind !== 'playing') return;
        const generation = this.generation;
        const segment = this.currentState.unit.segments[this.currentState.segmentIndex];
        if (!segment) {
            this.finishUnit(this.currentState.unit);
            return;
        }
        this.callbacks.onSegmentChange(segment, false);
        this.engine.speak(segment, {
            onEnd: () => {
                if (generation !== this.generation || this.currentState.kind !== 'playing') return;
                const nextIndex = this.currentState.segmentIndex + 1;
                if (nextIndex < this.currentState.unit.segments.length) {
                    this.setState({
                        kind: 'playing',
                        unit: this.currentState.unit,
                        segmentIndex: nextIndex
                    });
                    this.speakCurrent();
                } else {
                    this.finishUnit(this.currentState.unit);
                }
            },
            onError: (message) => {
                if (generation !== this.generation) return;
                this.setState({ kind: 'error', message });
                this.callbacks.onSegmentChange(null, false);
            }
        });
    }

    private finishUnit(unit: NarrationUnit): void {
        if (this.continuous) {
            const next = this.callbacks.navigateUnit(unit, 1);
            if (next) {
                this.generation += 1;
                if (next.segments.length === 0) {
                    this.finishUnit(next);
                    return;
                }
                this.setState({ kind: 'playing', unit: next, segmentIndex: 0 });
                this.speakCurrent();
                return;
            }
        }
        this.setState({ kind: 'completed' });
        this.callbacks.onSegmentChange(null, false);
    }

    private resetEngine(): void {
        this.generation += 1;
        this.engine.cancel();
    }

    private setState(state: NarrationPlaybackState): void {
        this.currentState = state;
        this.callbacks.onStateChange(state);
    }
}
