import type { ChangeTourManifest } from './changeTourManifest';
import type { TourReadingItem } from './tourReading';
import { resolveTourEvidenceContext, type TourEvidenceContext } from './tourOrientation';

export type TourFeedbackIntent = 'explain' | 'question';

/** A frozen, deliberately small handoff: focused evidence, never whole source files. */
export function captureTourFeedback(tour: ChangeTourManifest, item: TourReadingItem, view: {
    mode: string;
    location: string;
    displayedEvidence?: TourEvidenceContext | null;
    activePairIndex?: number;
    imageVisible?: boolean;
}) {
    const scene = item.kind === 'scene' || item.kind === 'step' ? tour.scenes[item.sceneIndex] : undefined;
    const step = item.kind === 'step' && scene && 'steps' in scene ? scene.steps[item.stepIndex] : undefined;
    const chapter = item.kind === 'chapter' ? tour.chapters.find(entry => entry.id === item.chapterId)
        : scene ? tour.chapters.find(entry => entry.sceneIds.includes(scene.id)) : undefined;
    const passage = item.kind === 'title' ? tour.opening : item.kind === 'conclusion' ? tour.conclusion
        : item.kind === 'chapter' ? chapter : step ?? scene;
    const stageExplanation = scene?.kind === 'deconstructed-diff' && step && 'pairIndex' in step && !step.body
        ? scene.steps.find(candidate => candidate.pairIndex === step.pairIndex && candidate.body) : undefined;
    const authoredEvidence = resolveTourEvidenceContext(tour, item, view.mode);
    const snapshot = {
        title: tour.title, sourceUrl: tour.sourceUrl, mode: view.mode, location: view.location,
        range: tour.range, audience: tour.details?.audience,
        opening: tour.opening,
        section: { kind: item.kind, chapter: chapter?.id, scene: scene?.id, step: step?.id },
        passage: passage && Object.fromEntries(Object.entries(passage).filter(([key]) =>
            ['title', 'summary', 'body', 'bullets', 'takeaway', 'requirement', 'overview'].includes(key))),
        sceneContext: step && scene ? { title: scene.title, summary: scene.summary, takeaway: scene.takeaway, overview: 'overview' in scene ? scene.overview : undefined } : undefined,
        sceneRange: scene?.kind === 'deconstructed-diff' ? scene.realRange : undefined,
        stageExplanation: stageExplanation && { id: stageExplanation.id, title: stageExplanation.title, body: stageExplanation.body },
        authoredEvidence,
        displayedEvidence: view.displayedEvidence === undefined
            ? resolveTourEvidenceContext(tour, item, view.mode, view.activePairIndex) : view.displayedEvidence,
        focus: step && ('focus' in step ? step.focus : {
            path: step.file, pairIndex: step.pairIndex, side: step.side,
            startLine: step.startLine, endLine: step.endLine
        }),
        connection: step && 'connection' in step ? step.connection : undefined,
        image: step && 'image' in step && step.image ? {
            path: step.image.path, revision: step.image.revision, alt: step.image.alt,
            displayed: view.imageVisible
        } : undefined
    };
    return JSON.stringify(snapshot, null, 2);
}

export function buildTourFeedbackRequest(intent: TourFeedbackIntent, concern: string, snapshot: string): string {
    return `${intent === 'explain' ? 'Help me understand this tour passage.' : 'Help me evaluate this change.'}

My concern:
${concern.trim() || '(No additional note; start with the captured passage.)'}

Investigate the concern against implementation code, relevant tests, and existing docs, requirements, or PR rationale. Distinguish intended behavior from the tour's claim and the evidence; label inferred intent and unresolved disagreement. Do not silently weaken an expectation to match the code.

Answer the concern, then identify any repair destination: implementation code, maintained documentation, PR explanation, the tour document, or the viewer. Missing evidence may need a check; disputed requirements may need a human decision. More tour prose is not always the remedy, and a clear answer may need no artifact change. Propose the smallest repair within the existing task authorization; this request does not itself authorize implementation edits or shared-system writes. Report what was checked, what remains unverified, and which artifacts actually changed. An agent reply does not update the saved tour document.

Captured tour context (a snapshot, not proof of current workspace state; synthetic panels are not commits):
${snapshot}

Verify the pinned and current implementation revisions before acting. If authorized implementation changes affect the tour, revisit its claims and refresh evidence for the intended committed range; do not present working-tree edits as committed evidence. Use the pr-tour-guide skill when authoring or repairing a Bygone tour, if available. The location may require the original repository/server or exported HTML file.
`;
}
