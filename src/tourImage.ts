/** PNG evidence is embedded, never fetched from an author-supplied URL. */
export const MAX_TOUR_IMAGE_BYTES = 8 * 1024 * 1024;
export interface TourImageSource {
    file: string;
    revision: 'base' | 'head';
    alt: string;
}
export interface TourImage {
    path: string;
    revision: string;
    alt: string;
    dataUrl: string;
}
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validPath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && !/[\\\x00-\x1f:]/.test(value)
        && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export function validateTourImageSource(value: unknown, label: string): asserts value is TourImageSource | undefined {
    if (value === undefined) return;
    if (!record(value) || Object.keys(value).some(key => !['file', 'revision', 'alt'].includes(key))
        || !validPath(value.file) || !['base', 'head'].includes(String(value.revision))
        || typeof value.alt !== 'string' || !value.alt.trim()) {
        throw new Error(`${label} must contain a repository-relative file, base/head revision, and non-empty alt text.`);
    }
}
export function validateTourImage(value: unknown, label: string): asserts value is TourImage | undefined {
    if (value === undefined) return;
    if (!record(value) || !validPath(value.path) || typeof value.alt !== 'string' || !value.alt.trim()
        || typeof value.revision !== 'string' || !/^[a-f0-9]{40,64}$/.test(value.revision)
        || typeof value.dataUrl !== 'string' || !value.dataUrl.startsWith('data:image/png;base64,')) {
        throw new Error(`${label} must contain pinned, embedded PNG evidence and alt text.`);
    }
    const base64 = value.dataUrl.slice(22);
    const decodedBytes = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (decodedBytes > MAX_TOUR_IMAGE_BYTES || base64.length % 4 !== 0
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error(`${label} must be a PNG of at most 8 MiB.`);
    const header = Uint8Array.from(atob(base64.slice(0, 44)), character => character.charCodeAt(0));
    validatePngHeader(header, label);
}
export function validatePngHeader(bytes: Uint8Array, label: string): void {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];
    if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) {
        throw new Error(`${label} must be a PNG with an IHDR header.`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width > 16384 || height > 16384 || width * height > 64 * 1024 * 1024) {
        throw new Error(`${label} exceeds the PNG dimension limit.`);
    }
}
