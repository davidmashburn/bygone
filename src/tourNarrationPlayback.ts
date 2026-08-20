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
    | { kind: 'playing'; unit: NarrationUnit; segmentIndex: number }
    | { kind: 'paused'; unit: NarrationUnit; segmentIndex: number; pendingStart: boolean }
    | { kind: 'completed' }
    | { kind: 'error'; message: string };

export interface NarrationPlaybackCallbacks {
    claimAudio(): void;
    onStateChange(state: NarrationPlaybackState): void;
    onSegmentChange(segment: NarrationSegment | null, paused: boolean): void;
    nextUnit(completedUnit: NarrationUnit): NarrationUnit | null;
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

    start(unit: NarrationUnit, continuous = true): void {
        this.resetEngine();
        this.continuous = continuous;
        if (unit.segments.length === 0) {
            this.finishUnit(unit);
            return;
        }
        this.callbacks.claimAudio();
        this.setState({ kind: 'playing', unit, segmentIndex: 0 });
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

    followLinearNavigation(unit: NarrationUnit): void {
        if (this.currentState.kind === 'playing') {
            this.start(unit, this.continuous);
        } else if (this.currentState.kind === 'paused') {
            this.preparePaused(unit);
        }
    }

    followDirectNavigation(unit: NarrationUnit): void {
        if (!this.engaged) return;
        this.preparePaused(unit);
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
            const next = this.callbacks.nextUnit(unit);
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
