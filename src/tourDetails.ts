/** Browser-safe secondary details shared by source and manifest validation. */

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

export enum ChangeTourCheckCategory {
    Provenance = 'provenance',
    Claims = 'claims',
    Behavior = 'behavior',
    Coverage = 'coverage',
    Uncertainty = 'uncertainty'
}

export enum ChangeTourCheckStatus {
    Verified = 'verified',
    Partial = 'partial',
    NotChecked = 'not-checked',
    NotApplicable = 'not-applicable'
}

/** Authored assertions about bounded checks, never inferred from successful compilation. */
export interface ChangeTourCheck {
    status: ChangeTourCheckStatus;
    summary: string;
    details?: string;
}

export type ChangeTourChecks = Partial<Record<ChangeTourCheckCategory, ChangeTourCheck>>;

export interface ChangeTourDetails {
    audience?: ChangeTourAudience;
    checks?: ChangeTourChecks;
}

/** Attribution supplied by the authoring runtime, not inferred by the compiler. */
export interface ChangeTourGenerator {
    model: string;
    harness?: string;
    effort?: string;
}

export function validateTourGenerator(value: unknown, version: number): asserts value is ChangeTourGenerator | undefined {
    if (value === undefined) return;
    if (version < 7) throw new Error('generatedBy requires tour version 7.');
    if (!isRecord(value)) throw new Error('generatedBy must be an object.');
    requireOnlyKeys(value, ['model', 'harness', 'effort'], 'generatedBy');
    requireString(value.model, 'generatedBy.model');
    for (const key of ['harness', 'effort']) {
        if (value[key] !== undefined) requireString(value[key], `generatedBy.${key}`);
    }
}

export function validateChangeTourDetails(
    value: unknown,
    path: string,
    version: number
): asserts value is ChangeTourDetails | undefined {
    if (value === undefined) return;
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    requireOnlyKeys(value, ['audience', 'checks'], path);
    validateAudience(value.audience, `${path}.audience`);
    if (value.checks !== undefined) {
        if (version < 7) throw new Error(`${path}.checks requires tour version 7.`);
        validateChecks(value.checks, `${path}.checks`);
    }
}

function validateChecks(value: unknown, path: string): asserts value is ChangeTourChecks {
    if (!isRecord(value)) throw new Error(`${path} must be an object.`);
    requireOnlyKeys(value, Object.values(ChangeTourCheckCategory), path);
    for (const category of Object.values(ChangeTourCheckCategory)) {
        const check = value[category];
        if (check === undefined) continue;
        const itemPath = `${path}.${category}`;
        if (!isRecord(check)) throw new Error(`${itemPath} must be an object.`);
        requireOnlyKeys(check, ['status', 'summary', 'details'], itemPath);
        if (!Object.values(ChangeTourCheckStatus).some(status => status === check.status)) {
            throw new Error(`${itemPath}.status must be ${Object.values(ChangeTourCheckStatus).join(', ')}.`);
        }
        requireString(check.summary, `${itemPath}.summary`);
        if (check.details !== undefined) requireString(check.details, `${itemPath}.details`);
    }
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
