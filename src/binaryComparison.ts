import * as fs from 'fs';
import * as path from 'path';

const BINARY_SNIFF_BYTES = 8 * 1024;
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;

const IMAGE_MIME_BY_EXTENSION = new Map<string, string>([
    ['.avif', 'image/avif'],
    ['.bmp', 'image/bmp'],
    ['.gif', 'image/gif'],
    ['.ico', 'image/x-icon'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.webp', 'image/webp']
]);

const KNOWN_BINARY_EXTENSIONS = new Set([
    '.7z', '.a', '.avi', '.bin', '.bz2', '.class', '.db', '.dmg', '.doc', '.docx', '.eot',
    '.exe', '.gz', '.jar', '.mov', '.mp3', '.mp4', '.o', '.otf', '.pdf', '.ppt', '.pptx',
    '.so', '.sqlite', '.tar', '.ttf', '.wav', '.woff', '.woff2', '.xls', '.xlsx', '.zip'
]);

export type ComparedFileKind = 'text' | 'binary' | 'image';

export interface ComparedFileSide {
    label: string;
    path: string;
    exists: boolean;
    kind: ComparedFileKind;
    mimeType: string | null;
    byteLength: number;
    dataUrl?: string;
    previewUnavailableReason?: string;
}

export interface BinaryComparison {
    kind: 'binary' | 'image';
    identical: boolean;
    left: ComparedFileSide;
    right: ComparedFileSide;
}

export function classifyFile(filePath: string): ComparedFileKind {
    const extension = path.extname(filePath).toLowerCase();
    if (IMAGE_MIME_BY_EXTENSION.has(extension)) {
        return 'image';
    }
    if (KNOWN_BINARY_EXTENSIONS.has(extension)) {
        return 'binary';
    }

    let descriptor: number | undefined;
    try {
        descriptor = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(BINARY_SNIFF_BYTES);
        const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead).includes(0) ? 'binary' : 'text';
    } catch {
        return 'text';
    } finally {
        if (descriptor !== undefined) {
            fs.closeSync(descriptor);
        }
    }
}

export function buildBinaryComparison(
    leftPath: string,
    rightPath: string,
    leftLabel = path.basename(leftPath),
    rightLabel = path.basename(rightPath)
): BinaryComparison | null {
    const left = describeFile(leftPath, leftLabel);
    const right = describeFile(rightPath, rightLabel);
    const comparisonKind = left.kind === 'image' || right.kind === 'image'
        ? 'image'
        : left.kind === 'binary' || right.kind === 'binary'
            ? 'binary'
            : null;

    if (!comparisonKind) {
        return null;
    }

    return {
        kind: comparisonKind,
        identical: filesEqual(leftPath, rightPath, left.exists, right.exists),
        left,
        right
    };
}

function describeFile(filePath: string, label: string): ComparedFileSide {
    let stats: fs.Stats | undefined;
    try {
        stats = fs.statSync(filePath);
    } catch {
        // A missing side is expected for added and deleted files.
    }

    const exists = Boolean(stats?.isFile());
    const kind = exists ? classifyFile(filePath) : kindFromExtension(filePath);
    const mimeType = kind === 'image'
        ? IMAGE_MIME_BY_EXTENSION.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream'
        : kind === 'binary'
            ? 'application/octet-stream'
            : null;
    const result: ComparedFileSide = {
        label,
        path: filePath,
        exists,
        kind,
        mimeType,
        byteLength: stats?.size ?? 0
    };

    if (exists && kind === 'image' && mimeType) {
        if (result.byteLength <= MAX_INLINE_IMAGE_BYTES) {
            result.dataUrl = `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
        } else {
            result.previewUnavailableReason = 'Image is too large to preview inline.';
        }
    }

    return result;
}

function kindFromExtension(filePath: string): ComparedFileKind {
    const extension = path.extname(filePath).toLowerCase();
    if (IMAGE_MIME_BY_EXTENSION.has(extension)) {
        return 'image';
    }
    return KNOWN_BINARY_EXTENSIONS.has(extension) ? 'binary' : 'text';
}

function filesEqual(leftPath: string, rightPath: string, leftExists: boolean, rightExists: boolean): boolean {
    if (!leftExists || !rightExists) {
        return false;
    }
    const leftStats = fs.statSync(leftPath);
    const rightStats = fs.statSync(rightPath);
    if (leftStats.size !== rightStats.size) {
        return false;
    }

    const leftDescriptor = fs.openSync(leftPath, 'r');
    const rightDescriptor = fs.openSync(rightPath, 'r');
    const leftBuffer = Buffer.alloc(64 * 1024);
    const rightBuffer = Buffer.alloc(64 * 1024);
    try {
        let offset = 0;
        while (offset < leftStats.size) {
            const length = Math.min(leftBuffer.length, leftStats.size - offset);
            const leftRead = fs.readSync(leftDescriptor, leftBuffer, 0, length, offset);
            const rightRead = fs.readSync(rightDescriptor, rightBuffer, 0, length, offset);
            if (leftRead !== rightRead || !leftBuffer.subarray(0, leftRead).equals(rightBuffer.subarray(0, rightRead))) {
                return false;
            }
            offset += leftRead;
        }
        return true;
    } finally {
        fs.closeSync(leftDescriptor);
        fs.closeSync(rightDescriptor);
    }
}
