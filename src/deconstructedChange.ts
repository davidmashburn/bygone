import { ChangeInventory, ChangeInventoryFile, buildChangeInventory, materializeChangeUnits } from './changeInventory';
import { ChangeTourSourceDeconstructedScene } from './changeTourSource';
import { GitChangeKind } from './gitComparison';

export interface DeconstructedFileState {
    path: string;
    previousPath?: string;
    changeKind: GitChangeKind;
    exists: boolean;
    content: string;
    appliedHunks: string[];
}

export interface DeconstructedStageState {
    id: string;
    title: string;
    narration: string;
    introducedHunks: string[];
    introducedFiles: string[];
    cumulativeHunks: string[];
    files: DeconstructedFileState[];
}

export interface CompiledDeconstructedScene {
    id: string;
    title: string;
    baseOid: string;
    targetOid: string;
    baselineFiles: DeconstructedFileState[];
    excludedHunks: string[];
    excludedFiles: Array<{ path: string; reason: string }>;
    stages: DeconstructedStageState[];
}

export interface BuildDeconstructedSceneOptions {
    headRef?: string;
    baseRef?: string;
}

export function buildDeconstructedScene(
    startPath: string,
    scene: ChangeTourSourceDeconstructedScene,
    options: BuildDeconstructedSceneOptions = {}
): CompiledDeconstructedScene {
    return compileDeconstructedScene(buildChangeInventory(startPath, {
        headRef: options.headRef || scene.target,
        baseRef: options.baseRef || scene.base
    }), scene);
}

export function compileDeconstructedScene(
    inventory: ChangeInventory,
    scene: ChangeTourSourceDeconstructedScene
): CompiledDeconstructedScene {
    const ownership = new Map<string, string>();
    const excludedByFile = new Map<ChangeInventoryFile, Set<string>>();
    const cumulativeByFile = new Map<ChangeInventoryFile, Set<string>>();
    const wholeFileExclusions = new Map<ChangeInventoryFile, string>();
    const excludedFiles: Array<{ path: string; reason: string }> = [];

    for (const exclusion of scene.exclusions || []) {
        const file = requireInventoryFile(inventory, exclusion.file, 'Exclusion');
        if (!exclusion.hunks) {
            if (wholeFileExclusions.has(file)) {
                throw new Error(`File is excluded more than once: ${exclusion.file}`);
            }
            wholeFileExclusions.set(file, exclusion.reason);
            excludedFiles.push({ path: file.path, reason: exclusion.reason });
        }
        const ids = exclusion.hunks || file.units.map((unit) => unit.id);
        if (file.material !== 'text' && exclusion.hunks) {
            throw new Error(`Unsupported file ${exclusion.file} must be excluded as a whole file.`);
        }
        claimHunks(file, ids, `exclusion for ${exclusion.file}`, ownership);
        const excluded = excludedByFile.get(file) || new Set<string>();
        ids.forEach((id) => excluded.add(id));
        excludedByFile.set(file, excluded);
    }

    const stageClaims = scene.stages.map((stage) => {
        const claims: Array<{ file: ChangeInventoryFile; ids: string[] }> = [];
        for (const change of stage.changes) {
            const file = requireInventoryFile(inventory, change.file, `Stage ${stage.id}`);
            if (file.material !== 'text') {
                throw new Error(`Stage ${stage.id} cannot assign unsupported file: ${change.file}`);
            }
            if (file.changeKind === 'renamed') {
                throw new Error(`Stage ${stage.id} cannot assign renamed file ${change.file} until path-transition units are supported.`);
            }
            claimHunks(file, change.hunks, `stage ${stage.id}`, ownership);
            claims.push({ file, ids: [...change.hunks] });
        }
        return { stage, claims };
    });

    for (const file of inventory.files) {
        const wholeFileExcluded = wholeFileExclusions.has(file);
        if (file.material !== 'text' || file.changeKind === 'renamed' || file.units.length === 0) {
            if (!wholeFileExcluded) {
                const reason = file.changeKind === 'renamed'
                    ? 'rename path transitions are not supported yet'
                    : file.material !== 'text'
                        ? `${file.material} content cannot be materialized`
                        : 'the change has no textual hunks';
                throw new Error(`Deconstructed scene ${scene.id} must exclude ${file.path} as a whole file because ${reason}.`);
            }
            continue;
        }
        for (const unit of file.units) {
            if (!ownership.has(unitKey(file, unit.id))) {
                throw new Error(`Unassigned change unit in ${file.path}: ${unit.id}`);
            }
        }
    }

    for (const file of inventory.files) {
        cumulativeByFile.set(file, new Set(excludedByFile.get(file) || []));
    }
    const materializableFiles = inventory.files.filter((file) => (
        file.material === 'text'
        && file.changeKind !== 'renamed'
        && file.baseContent !== undefined
        && file.headContent !== undefined
    ));
    const baselineFiles = materializableFiles.map((file) => buildFileState(
        file,
        cumulativeByFile.get(file) || new Set<string>(),
        wholeFileExclusions.has(file)
    ));
    const stages: DeconstructedStageState[] = [];

    for (const { stage, claims } of stageClaims) {
        const introducedHunks: string[] = [];
        const introducedFiles: string[] = [];
        for (const claim of claims) {
            const cumulative = cumulativeByFile.get(claim.file) || new Set<string>();
            claim.ids.forEach((id) => {
                cumulative.add(id);
                introducedHunks.push(id);
            });
            cumulativeByFile.set(claim.file, cumulative);
            if (!introducedFiles.includes(claim.file.path)) introducedFiles.push(claim.file.path);
        }
        stages.push({
            id: stage.id,
            title: stage.title,
            narration: stage.narration,
            introducedHunks,
            introducedFiles,
            cumulativeHunks: [...cumulativeByFile.values()].flatMap((ids) => [...ids]),
            files: materializableFiles.map((file) => buildFileState(
                file,
                cumulativeByFile.get(file) || new Set<string>(),
                wholeFileExclusions.has(file)
            ))
        });
    }

    for (const file of materializableFiles) {
        const finalState = buildFileState(
            file,
            cumulativeByFile.get(file) || new Set<string>(),
            wholeFileExclusions.has(file)
        );
        const expectedExists = file.changeKind !== 'deleted';
        if (finalState.exists !== expectedExists || finalState.content !== file.headContent) {
            throw new Error(`Final deconstructed state does not match the target for ${file.path}.`);
        }
    }

    return {
        id: scene.id,
        title: scene.title,
        baseOid: inventory.range.baseOid,
        targetOid: inventory.range.headOid,
        baselineFiles,
        excludedHunks: [...excludedByFile.values()].flatMap((ids) => [...ids]),
        excludedFiles,
        stages
    };
}

function requireInventoryFile(inventory: ChangeInventory, path: string, owner: string): ChangeInventoryFile {
    const matches = inventory.files.filter((file) => file.path === path || file.previousPath === path);
    if (matches.length === 0) throw new Error(`${owner} references a file outside the change inventory: ${path}`);
    if (matches.length > 1) throw new Error(`${owner} references an ambiguous changed path: ${path}`);
    return matches[0];
}

function claimHunks(
    file: ChangeInventoryFile,
    ids: readonly string[],
    owner: string,
    ownership: Map<string, string>
): void {
    const known = new Set(file.units.map((unit) => unit.id));
    for (const id of ids) {
        if (!known.has(id)) throw new Error(`${owner} references an unknown hunk in ${file.path}: ${id}`);
        const key = unitKey(file, id);
        const previousOwner = ownership.get(key);
        if (previousOwner) throw new Error(`Change unit ${id} in ${file.path} is assigned to both ${previousOwner} and ${owner}.`);
        ownership.set(key, owner);
    }
}

function unitKey(file: ChangeInventoryFile, id: string): string {
    return `${file.previousPath || ''}\0${file.path}\0${id}`;
}

function buildFileState(
    file: ChangeInventoryFile,
    selected: ReadonlySet<string>,
    wholeFileExcluded: boolean
): DeconstructedFileState {
    if (file.baseContent === undefined) throw new Error(`Missing base content for ${file.path}.`);
    const content = materializeChangeUnits(file.baseContent, file.units, selected);
    let exists = true;
    if (file.changeKind === 'added') exists = wholeFileExcluded || selected.size > 0;
    if (file.changeKind === 'deleted') exists = !(wholeFileExcluded || selected.size === file.units.length);
    return {
        path: file.path,
        previousPath: file.previousPath,
        changeKind: file.changeKind,
        exists,
        content: exists ? content : '',
        appliedHunks: [...selected]
    };
}
