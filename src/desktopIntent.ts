export const desktopIntentVersion = 1;

export type DesktopIntent =
    | { kind: 'explore-branch' }
    | { kind: 'present-branch' }
    | { kind: 'open-tour'; tourPath: string }
    | { kind: 'compare-paths'; paths: readonly string[] };

export function serializeDesktopIntent(intent: DesktopIntent): string[] {
    const prefix = ['--launch-intent-version', String(desktopIntentVersion)];
    if (intent.kind === 'explore-branch') return [...prefix, 'review'];
    if (intent.kind === 'present-branch') return [...prefix, 'present'];
    if (intent.kind === 'open-tour') return [...prefix, 'present', '--tour', intent.tourPath];
    return [...prefix, ...intent.paths];
}
