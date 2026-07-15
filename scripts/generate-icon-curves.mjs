import { writeFile } from 'fs/promises';

const outputPath = new URL('../standalone/assets/bygone-icon-curves-clean.svg', import.meta.url);

const geometry = {
    left: 88,
    gutterLeft: 456,
    gutterRight: 568,
    right: 932,
    topRule: 192,
    ruleStep: 96,
    handle: 100
};

const sections = [
    {
        id: 'top-green',
        fill: 'url(#greenFill)',
        stroke: '#91ff9b',
        strokeWidth: 17,
        topLeft: 0.5,
        topRight: 0.5,
        bottomRight: 1.5,
        bottomLeft: 0.5
    },
    {
        id: 'blue',
        fill: 'url(#blueFill)',
        stroke: '#919cff',
        strokeWidth: 18,
        topLeft: 2.5,
        topRight: 3.5,
        bottomRight: 5.5,
        bottomLeft: 5.5
    },
    {
        id: 'bottom-green',
        fill: 'url(#greenFill)',
        stroke: '#91ff9b',
        strokeWidth: 17,
        topLeft: 6.5,
        topRight: 6.5,
        bottomRight: 6.5,
        bottomLeft: 7.5
    }
];

function y(halfLineIndex) {
    return geometry.topRule + (halfLineIndex - 0.5) * geometry.ruleStep;
}

function connectorPath(section) {
    const { left, gutterLeft, gutterRight, right, handle } = geometry;
    const topLeftY = y(section.topLeft);
    const topRightY = y(section.topRight);
    const bottomRightY = y(section.bottomRight);
    const bottomLeftY = y(section.bottomLeft);
    const topGutterEdge = topLeftY === topRightY
        ? `H${gutterRight}`
        : `C${gutterLeft + handle} ${topLeftY} ${gutterRight - handle} ${topRightY} ${gutterRight} ${topRightY}`;
    const bottomGutterEdge = bottomRightY === bottomLeftY
        ? `H${gutterLeft}`
        : `C${gutterRight - handle} ${bottomRightY} ${gutterLeft + handle} ${bottomLeftY} ${gutterLeft} ${bottomLeftY}`;

    return [
        `M${left} ${topLeftY}`,
        `H${gutterLeft}`,
        topGutterEdge,
        `H${right}`,
        `V${bottomRightY}`,
        `H${gutterRight}`,
        bottomGutterEdge,
        `H${left}`,
        'Z'
    ].join(' ');
}

function sectionSvg(section) {
    return `  <g id="${section.id}" fill="${section.fill}" stroke="${section.stroke}" stroke-width="${section.strokeWidth}" stroke-linejoin="round">
    <path d="${connectorPath(section)}"/>
  </g>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-labelledby="title desc">
  <title id="title">Bygone connector curves cleaned</title>
  <desc id="desc">Generated connector curve silhouettes for the Bygone icon.</desc>
  <defs>
    <linearGradient id="greenFill" x1="${geometry.left}" y1="0" x2="${geometry.right}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#47f100"/>
      <stop offset="0.55" stop-color="#38f000"/>
      <stop offset="1" stop-color="#47f100"/>
    </linearGradient>
    <linearGradient id="blueFill" x1="${geometry.left}" y1="0" x2="${geometry.right}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0029f1"/>
      <stop offset="0.55" stop-color="#0b32f6"/>
      <stop offset="1" stop-color="#0029f1"/>
    </linearGradient>
  </defs>

${sections.map(sectionSvg).join('\n\n')}
</svg>
`;

await writeFile(outputPath, svg);
