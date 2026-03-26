declare module 'diff' {
    export interface Change<T> {
        value: T;
        added?: boolean;
        removed?: boolean;
    }

    export function diffArrays<T>(oldArr: T[], newArr: T[]): Change<T>[];
    export function diffWordsWithSpace(oldStr: string, newStr: string): Change<string>[];
}
