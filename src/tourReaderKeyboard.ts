/** Reader actions are distinct from native widget navigation and visit history. */
export enum TourReaderAction {
    PreviousStep = 'previous-step',
    NextStep = 'next-step',
    PreviousSentence = 'previous-sentence',
    NextSentence = 'next-sentence',
    EnterDetail = 'enter-detail',
    ReturnToParent = 'return-to-parent'
}

export interface TourReaderKeyContext {
    key: string;
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    defaultPrevented: boolean;
    isComposing: boolean;
    readerActive: boolean;
    navigationFocused: boolean;
    nativeKeyOwner: boolean;
}

export function resolveTourReaderKey(context: TourReaderKeyContext): TourReaderAction | null {
    if (!context.readerActive || context.defaultPrevented || context.isComposing
        || context.altKey || context.ctrlKey || context.metaKey || context.nativeKeyOwner) return null;
    if (context.shiftKey) {
        if (context.key === 'ArrowUp') return TourReaderAction.PreviousSentence;
        if (context.key === 'ArrowDown') return TourReaderAction.NextSentence;
        return null;
    }
    if (!context.navigationFocused) return null;
    switch (context.key) {
        case 'ArrowUp': return TourReaderAction.PreviousStep;
        case 'ArrowDown': return TourReaderAction.NextStep;
        case 'ArrowRight':
        case 'Enter': return TourReaderAction.EnterDetail;
        case 'ArrowLeft':
        case 'Escape': return TourReaderAction.ReturnToParent;
        default: return null;
    }
}
