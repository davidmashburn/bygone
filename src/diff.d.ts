declare module 'diff' {
    export interface Change<T> {
        value: T;
        added?: boolean;
        removed?: boolean;
    }

    export interface DiffOptions {
        maxEditLength?: number;
        timeout?: number;
    }

    export function diffArrays<T>(oldArr: T[], newArr: T[], options?: DiffOptions): Change<T[]>[] | undefined;
    export function diffChars(oldStr: string, newStr: string): Change<string>[];
    export function diffWordsWithSpace(oldStr: string, newStr: string): Change<string>[];
}
