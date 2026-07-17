import { writeFile } from 'fs/promises';
import { execSync } from 'child_process';

// The Bygone app icon: two document panels with a diff flowing between them.
// Green regions are additions (collapsing to an insertion marker on the
// opposite panel); the blue block is changed content that moved.
//
// Emits:
//   standalone/assets/bygone-icon.svg        — main icon (64px and up)
//   standalone/assets/bygone-icon-small.svg  — simplified variant (16/32px)
//   standalone/assets/Bygone.iconset/*.png   — all iconset slots
//   media/icon.png                           — extension icon (128px)
//
// After running this, run scripts/generate-icons.mjs to rebuild the
// .icns/.ico containers. Requires rsvg-convert.

const mainSvgPath = new URL('../standalone/assets/bygone-icon.svg', import.meta.url);
const smallSvgPath = new URL('../standalone/assets/bygone-icon-small.svg', import.meta.url);

const geometry = { left: 110, gutterLeft: 402, gutterRight: 622, right: 914, handle: 120 };
const top = 120, bottom = 904, cornerRadius = 40;

// A band spans both panels: independent y-ranges per side, joined by
// Bezier edges through the gutter. A side with equal y-values is a taper —
// the region collapses to a line on that side (an insertion marker).
function band(leftTop, leftBottom, rightTop, rightBottom) {
    const { left, gutterLeft, gutterRight, right, handle } = geometry;
    const topEdge = `M${left} ${leftTop} H${gutterLeft} C${gutterLeft + handle} ${leftTop} ${gutterRight - handle} ${rightTop} ${gutterRight} ${rightTop} H${right}`;
    const bottomEdge = `M${left} ${leftBottom} H${gutterLeft} C${gutterLeft + handle} ${leftBottom} ${gutterRight - handle} ${rightBottom} ${gutterRight} ${rightBottom} H${right}`;
    const fill = `M${left} ${leftTop} H${gutterLeft} C${gutterLeft + handle} ${leftTop} ${gutterRight - handle} ${rightTop} ${gutterRight} ${rightTop} H${right} V${rightBottom} H${gutterRight} C${gutterRight - handle} ${rightBottom} ${gutterLeft + handle} ${leftBottom} ${gutterLeft} ${leftBottom} H${left} Z`;
    return { fill, top: topEdge, bot: bottomEdge };
}

const greenTop = band(top, 300, top, top);
const blue = band(440, 744, 288, 592);
const greenBot = band(bottom, bottom, 736, bottom);

// Stroke-only paths, inset a hair so nothing rides the panel clip boundary.
const { left, gutterLeft, gutterRight, right, handle } = geometry;
const gTopEdge = `M${left} ${top + 2.5} H${right}`;
const gBotEdge = `M${left} ${bottom - 2.5} H${right}`;
const gTopSeam = `M${left} 300 H${gutterLeft} C${gutterLeft + handle} 300 ${gutterRight - handle} ${top + 4.5} ${gutterRight} ${top + 4.5} H${right}`;
const gBotSeam = `M${left} ${bottom - 4.5} H${gutterLeft} C${gutterLeft + handle} ${bottom - 4.5} ${gutterRight - handle} 736 ${gutterRight} 736 H${right}`;

const r = cornerRadius;
const leftCol = `M${left + r} ${top} H${gutterLeft} V${bottom} H${left + r} Q${left} ${bottom} ${left} ${bottom - r} V${top + r} Q${left} ${top} ${left + r} ${top} Z`;
const rightCol = `M${gutterRight} ${top} H${right - r} Q${right} ${top} ${right} ${top + r} V${bottom - r} Q${right} ${bottom} ${right - r} ${bottom} H${gutterRight} Z`;

const colsClip = `<clipPath id="cols">
      <path d="${leftCol}"/>
      <rect x="${gutterLeft}" y="${top}" width="${gutterRight - gutterLeft}" height="${bottom - top}"/>
      <path d="${rightCol}"/>
    </clipPath>`;

const mainSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="82%">
      <stop offset="0" stop-color="#0d1420"/><stop offset="1" stop-color="#03050a"/>
    </radialGradient>
    <linearGradient id="pane" x1="0" y1="${top}" x2="0" y2="${bottom}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#283751"/><stop offset="1" stop-color="#1b273d"/>
    </linearGradient>
    <linearGradient id="grn" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2cbc6a"/><stop offset="1" stop-color="#1f9250"/>
    </linearGradient>
    <linearGradient id="blu" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#585eff"/><stop offset="1" stop-color="#050cff"/>
    </linearGradient>
    <filter id="shadow" x="-18%" y="-22%" width="136%" height="144%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.5"/>
    </filter>
    <filter id="bGlow" x="-25%" y="-65%" width="150%" height="230%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"/>
      <feFlood flood-color="#8787ff" flood-opacity="1" result="color"/>
      <feComposite in="color" in2="blur" operator="in" result="glow"/>
      <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <clipPath id="app"><rect width="1024" height="1024" rx="196"/></clipPath>
    ${colsClip}
  </defs>
  <g clip-path="url(#app)">
    <rect width="1024" height="1024" fill="url(#bg)"/>
    <g filter="url(#shadow)">
      <rect x="${left}" y="${top}" width="${gutterLeft - left}" height="${bottom - top}" rx="${r}" fill="url(#pane)"/>
      <rect x="${gutterRight}" y="${top}" width="${right - gutterRight}" height="${bottom - top}" rx="${r}" fill="url(#pane)"/>
    </g>
    <g clip-path="url(#cols)">
      <path d="${greenTop.fill}" fill="url(#grn)"/>
      <path d="${blue.fill}" fill="url(#blu)"/>
      <path d="${greenBot.fill}" fill="url(#grn)"/>
      <g fill="none" stroke-linecap="butt">
        <path d="${gTopEdge}" stroke="#3dff84" stroke-width="4.8" opacity="0.55"/>
        <path d="${gBotEdge}" stroke="#3dff84" stroke-width="4.8" opacity="0.55"/>
        <path d="${gTopSeam}" stroke="#3dff84" stroke-width="8"/>
        <path d="${gBotSeam}" stroke="#3dff84" stroke-width="8"/>
        <g filter="url(#bGlow)">
          <path d="${blue.top}" stroke="#8787ff" stroke-width="10"/>
          <path d="${blue.bot}" stroke="#8787ff" stroke-width="10"/>
        </g>
      </g>
    </g>
  </g>
</svg>
`;

// Small-size variant: flat fills, no glow, fat seams. Used for 16/32 slots.
const smallSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="app"><rect width="1024" height="1024" rx="196"/></clipPath>
    ${colsClip}
  </defs>
  <g clip-path="url(#app)">
    <rect width="1024" height="1024" fill="#070b12"/>
    <rect x="${left}" y="${top}" width="${gutterLeft - left}" height="${bottom - top}" rx="${r}" fill="#283751"/>
    <rect x="${gutterRight}" y="${top}" width="${right - gutterRight}" height="${bottom - top}" rx="${r}" fill="#283751"/>
    <g clip-path="url(#cols)">
      <path d="${greenTop.fill}" fill="#2cbc6a"/>
      <path d="${blue.fill}" fill="#252dff"/>
      <path d="${greenBot.fill}" fill="#2cbc6a"/>
      <g fill="none" stroke-linecap="butt">
        <path d="${gTopSeam}" stroke="#3dff84" stroke-width="12"/>
        <path d="${gBotSeam}" stroke="#3dff84" stroke-width="12"/>
        <path d="${blue.top}" stroke="#8787ff" stroke-width="14"/>
        <path d="${blue.bot}" stroke="#8787ff" stroke-width="14"/>
      </g>
    </g>
  </g>
</svg>
`;

await writeFile(mainSvgPath, mainSvg);
await writeFile(smallSvgPath, smallSvg);
console.log('Wrote bygone-icon.svg and bygone-icon-small.svg');

// Render the iconset: the small variant for 16/32px slots, main for the rest.
const iconset = new URL('../standalone/assets/Bygone.iconset/', import.meta.url).pathname;
const mainPath = mainSvgPath.pathname;
const smallPath = smallSvgPath.pathname;
const slots = [
    ['icon_16x16.png', 16, smallPath],
    ['icon_16x16@2x.png', 32, smallPath],
    ['icon_32x32.png', 32, smallPath],
    ['icon_32x32@2x.png', 64, mainPath],
    ['icon_128x128.png', 128, mainPath],
    ['icon_128x128@2x.png', 256, mainPath],
    ['icon_256x256.png', 256, mainPath],
    ['icon_256x256@2x.png', 512, mainPath],
    ['icon_512x512.png', 512, mainPath],
    ['icon_512x512@2x.png', 1024, mainPath]
];
for (const [file, size, source] of slots) {
    execSync(`rsvg-convert -w ${size} -h ${size} "${source}" -o "${iconset}${file}"`);
}
console.log(`Rendered ${slots.length} iconset PNGs`);

const mediaIcon = new URL('../media/icon.png', import.meta.url).pathname;
execSync(`rsvg-convert -w 128 -h 128 "${mainPath}" -o "${mediaIcon}"`);
console.log('Wrote media/icon.png');
