import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const iconset = path.join('standalone', 'assets', 'Bygone.iconset');
const icnsPath = path.join('standalone', 'assets', 'Bygone.icns');
const icoPath = path.join('standalone', 'assets', 'Bygone.ico');

await writeIcns();
await writeIco();

async function writeIcns() {
    const entries = [
        ['icp4', 'icon_16x16.png'],
        ['icp5', 'icon_32x32.png'],
        ['icp6', 'icon_32x32@2x.png'],
        ['ic07', 'icon_128x128.png'],
        ['ic08', 'icon_256x256.png'],
        ['ic09', 'icon_512x512.png'],
        ['ic10', 'icon_512x512@2x.png']
    ];
    const chunks = [];

    for (const [type, file] of entries) {
        const data = await readFile(path.join(iconset, file));
        const header = Buffer.alloc(8);
        header.write(type, 0, 4, 'ascii');
        header.writeUInt32BE(data.length + 8, 4);
        chunks.push(Buffer.concat([header, data]));
    }

    const header = Buffer.alloc(8);
    header.write('icns', 0, 4, 'ascii');
    header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
    await writeFile(icnsPath, Buffer.concat([header, ...chunks]));
}

async function writeIco() {
    const entries = [
        [16, 'icon_16x16.png'],
        [32, 'icon_32x32.png'],
        [64, 'icon_32x32@2x.png'],
        [128, 'icon_128x128.png'],
        [256, 'icon_256x256.png']
    ];
    const payloads = [];

    for (const [size, file] of entries) {
        payloads.push({ size, data: await readFile(path.join(iconset, file)) });
    }

    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(payloads.length, 4);

    const directory = Buffer.alloc(payloads.length * 16);
    let offset = header.length + directory.length;

    payloads.forEach(({ size, data }, index) => {
        const entryOffset = index * 16;
        const icoSize = size === 256 ? 0 : size;
        directory.writeUInt8(icoSize, entryOffset);
        directory.writeUInt8(icoSize, entryOffset + 1);
        directory.writeUInt8(0, entryOffset + 2);
        directory.writeUInt8(0, entryOffset + 3);
        directory.writeUInt16LE(1, entryOffset + 4);
        directory.writeUInt16LE(32, entryOffset + 6);
        directory.writeUInt32LE(data.length, entryOffset + 8);
        directory.writeUInt32LE(offset, entryOffset + 12);
        offset += data.length;
    });

    await writeFile(icoPath, Buffer.concat([header, directory, ...payloads.map(({ data }) => data)]));
}
