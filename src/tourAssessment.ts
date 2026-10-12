/**
 * Browser-safe authored-tour assessment contracts and rubric metadata.
 *
 * This module deliberately has no filesystem, Git, or Node dependencies so
 * the presentation host can share the same vocabulary as the compiler.
 */

export const TOUR_ASSESSMENT_RATING_KEYS = [
    'purpose',
    'orientation',
    'reasoning',
    'evidence',
    'clarity',
    'economy',
    'completeness'
] as const;

export const TOUR_ASSESSMENT_RUBRIC_KEYS = TOUR_ASSESSMENT_RATING_KEYS;

export const TOUR_ASSESSMENT_RUBRIC = Object.freeze([
    { key: 'purpose', label: 'Purpose & salience', criterion: 'Does the reader know what changes, why it matters, and what each scene contributes?' },
    { key: 'orientation', label: 'Orientation', criterion: 'Can the reader identify the comparison, their place, and changes of scope?' },
    { key: 'reasoning', label: 'Reasoning', criterion: 'Does the explanation connect the trigger, mechanism, outcome, and material tradeoffs?' },
    { key: 'evidence', label: 'Evidence fidelity', criterion: 'Does the displayed evidence support the claims, with uncertainty made explicit?' },
    { key: 'clarity', label: 'Clarity & audience fit', criterion: 'Can the intended reader follow without hidden prerequisites or unexplained terms?' },
    { key: 'economy', label: 'Economy', criterion: 'Does each passage add understanding without repetition or lost causal links?' },
    { key: 'completeness', label: 'Completeness for purpose', criterion: 'Are essential behavior, boundaries, risks, and omissions covered for this purpose?' }
] as const);

export const TOUR_ASSESSMENT_SCORE_VALUES = [0, 1, 2, 3] as const;

export const TOUR_ASSESSMENT_METHODS = [
    'self-review',
    'simulated-reader',
    'human-reader'
] as const;

export type ChangeTourAssessmentRatingKey = typeof TOUR_ASSESSMENT_RATING_KEYS[number];
export type ChangeTourAssessmentScore = typeof TOUR_ASSESSMENT_SCORE_VALUES[number];
export type ChangeTourAssessmentMethod = typeof TOUR_ASSESSMENT_METHODS[number];
export type ChangeTourAudienceCodebase = 'none' | 'some' | 'maintainer';
export type ChangeTourAudienceLanguage = 'none' | 'basic' | 'fluent' | 'advanced';
export type ChangeTourAudienceReadingDemand = 'general' | 'technical' | 'specialist';
export type ChangeTourAudiencePurpose = 'overview' | 'explanation' | 'review';

export interface ChangeTourAudience {
    codebase: ChangeTourAudienceCodebase;
    language: ChangeTourAudienceLanguage;
    domain?: string[];
    readingDemand: ChangeTourAudienceReadingDemand;
    purpose: ChangeTourAudiencePurpose;
    scope: string;
    estimatedMinutes?: number;
}

export interface ChangeTourAssessmentRating {
    score: ChangeTourAssessmentScore;
    reason: string;
    references: string[];
}

export type ChangeTourAssessmentRatings = Partial<
    Record<ChangeTourAssessmentRatingKey, ChangeTourAssessmentRating>
>;

export interface ChangeTourAssessment {
    reviewer: string;
    method: ChangeTourAssessmentMethod;
    assessedAt: string;
    contentHash: string;
    ratings: ChangeTourAssessmentRatings;
    blockers?: string[];
}

export interface ChangeTourDetails {
    audience?: ChangeTourAudience;
    assessment?: ChangeTourAssessment;
}

export interface ChangeTourDetailsValidationContext {
    /** Scene ids, step references, and any available framing references. */
    referenceIds: ReadonlySet<string>;
}

export function validateChangeTourDetails(
    value: unknown,
    path: string,
    context: ChangeTourDetailsValidationContext
): asserts value is ChangeTourDetails | undefined {
    if (value === undefined) return;
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    requireOnlyKeys(value, ['audience', 'assessment'], path);
    validateAudience(value.audience, `${path}.audience`);
    validateAssessment(value.assessment, `${path}.assessment`, context.referenceIds);
}

function validateAudience(value: unknown, path: string): void {
    if (value === undefined) return;
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    requireOnlyKeys(value, [
        'codebase', 'language', 'domain', 'readingDemand', 'purpose', 'scope', 'estimatedMinutes'
    ], path);
    if (typeof value.codebase !== 'string'
        || !['none', 'some', 'maintainer'].includes(value.codebase)) {
        throw new Error(`${path}.codebase must be none, some, or maintainer.`);
    }
    if (typeof value.language !== 'string'
        || !['none', 'basic', 'fluent', 'advanced'].includes(value.language)) {
        throw new Error(`${path}.language must be none, basic, fluent, or advanced.`);
    }
    if (value.domain !== undefined) requireStringArray(value.domain, `${path}.domain`);
    if (typeof value.readingDemand !== 'string'
        || !['general', 'technical', 'specialist'].includes(value.readingDemand)) {
        throw new Error(`${path}.readingDemand must be general, technical, or specialist.`);
    }
    if (typeof value.purpose !== 'string'
        || !['overview', 'explanation', 'review'].includes(value.purpose)) {
        throw new Error(`${path}.purpose must be overview, explanation, or review.`);
    }
    requireString(value.scope, `${path}.scope`);
    if (value.estimatedMinutes !== undefined
        && (typeof value.estimatedMinutes !== 'number'
            || !Number.isFinite(value.estimatedMinutes)
            || value.estimatedMinutes <= 0)) {
        throw new Error(`${path}.estimatedMinutes must be a finite positive number.`);
    }
}

function validateAssessment(value: unknown, path: string, referenceIds: ReadonlySet<string>): void {
    if (value === undefined) return;
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    requireOnlyKeys(value, ['reviewer', 'method', 'assessedAt', 'contentHash', 'ratings', 'blockers'], path);
    requireString(value.reviewer, `${path}.reviewer`);
    if (!TOUR_ASSESSMENT_METHODS.includes(value.method as ChangeTourAssessmentMethod)) {
        throw new Error(`${path}.method must be self-review, simulated-reader, or human-reader.`);
    }
    validateIsoTimestamp(value.assessedAt, `${path}.assessedAt`);
    validateContentHash(value.contentHash, `${path}.contentHash`);
    if (!isRecord(value.ratings)) throw new Error(`${path}.ratings must be an object.`);
    requireOnlyKeys(value.ratings, [...TOUR_ASSESSMENT_RATING_KEYS], `${path}.ratings`);
    for (const [key, rating] of Object.entries(value.ratings)) {
        const ratingPath = `${path}.ratings.${key}`;
        if (!isRecord(rating)) throw new Error(`${ratingPath} must be an object.`);
        requireOnlyKeys(rating, ['score', 'reason', 'references'], ratingPath);
        if (!TOUR_ASSESSMENT_SCORE_VALUES.includes(rating.score as ChangeTourAssessmentScore)) {
            throw new Error(`${ratingPath}.score must be one of 0, 1, 2, or 3.`);
        }
        requireString(rating.reason, `${ratingPath}.reason`);
        if (!Array.isArray(rating.references) || rating.references.length === 0 || rating.references.some((reference) => typeof reference !== 'string')) {
            throw new Error(`${ratingPath}.references must be a non-empty array of strings.`);
        }
        for (const reference of rating.references) {
            if (!referenceIds.has(reference)) {
                throw new Error(`${ratingPath}.references contains an unknown scene or step reference, or an ambiguous unqualified ID (use scene/step): ${reference}.`);
            }
        }
    }
    if (value.blockers !== undefined) requireStringArray(value.blockers, `${path}.blockers`);
}

function validateIsoTimestamp(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        || !Number.isFinite(Date.parse(value))
        // Check the authored calendar date independently of its timezone offset.
        || new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) {
        throw new Error(`${path} must be an ISO timestamp.`);
    }
}

function validateContentHash(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
        throw new Error(`${path} must be a lowercase SHA-256 hash.`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${path} must be a non-empty string.`);
    }
}

function requireStringArray(value: unknown, path: string): asserts value is string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
        throw new Error(`${path} must be an array of strings.`);
    }
}

function requireOnlyKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
    const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unexpected.length > 0) {
        throw new Error(`${path} contains unknown field${unexpected.length === 1 ? '' : 's'}: ${unexpected.join(', ')}`);
    }
}
