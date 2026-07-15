import { writeFile } from 'fs/promises';

const outputPath = new URL('../standalone/assets/bygone-icon-polished.svg', import.meta.url);

// Same connector formula as generate-icon-curves.mjs:
//   y(halfLineIndex) = topRule + (halfLineIndex - 0.5) * ruleStep
const geometry = {
    left: 88,
    gutterLeft: 456,
    gutterRight: 568,
    right: 932,
    topRule: 192,
    ruleStep: 96,
    handle: 100
};

// Row pattern (g = gray, G = green, B = blue, null = empty):
//   gG / gg / Bg / BB / BB / gg / G-
const leftRows = ['g', 'g', 'B', 'B', 'B', 'g', 'G'];
const rightRows = ['G', 'g', 'g', 'B', 'B', 'g', null];

const sections = [
    { id: 'top-green', kind: 'green', topLeft: 0.5, topRight: 0.5, bottomRight: 1.5, bottomLeft: 0.5 },
    { id: 'blue', kind: 'blue', topLeft: 2.5, topRight: 3.5, bottomRight: 5.5, bottomLeft: 5.5 },
    { id: 'bottom-green', kind: 'green', topLeft: 6.5, topRight: 6.5, bottomRight: 6.5, bottomLeft: 7.5 }
];

const palette = {
    green: { band: 'url(#greenBand)', edge: '#7be98f', bar: 'url(#greenBar)' },
    blue: { band: 'url(#blueBand)', edge: '#8fb6ff', bar: 'url(#blueBar)' },
    gray: { bar: 'url(#grayBar)' }
};

const panel = {
    top: 144,
    bottom: 912,
    radius: 44,
    barInset: 38,
    barHeight: 52,
    barRadius: 26
};

function y(halfLineIndex) {
    return geometry.topRule + (halfLineIndex - 0.5) * geometry.ruleStep;
}

function topEdge(section, open = false) {
    const { left, gutterLeft, gutterRight, right, handle } = geometry;
    const topLeftY = y(section.topLeft);
    const topRightY = y(section.topRight);
    const gutter = topLeftY === topRightY
        ? `H${gutterRight}`
        : `C${gutterLeft + handle} ${topLeftY} ${gutterRight - handle} ${topRightY} ${gutterRight} ${topRightY}`;
    return `${open ? `M${left} ${topLeftY} ` : ''}H${gutterLeft} ${gutter} H${right}`;
}

function bottomEdge(section, open = false) {
    const { left, gutterLeft, gutterRight, right, handle } = geometry;
    const bottomRightY = y(section.bottomRight);
    const bottomLeftY = y(section.bottomLeft);
    const gutter = bottomRightY === bottomLeftY
        ? `H${gutterLeft}`
        : `C${gutterRight - handle} ${bottomRightY} ${gutterLeft + handle} ${bottomLeftY} ${gutterLeft} ${bottomLeftY}`;
    return `${open ? `M${right} ${bottomRightY} ` : ''}H${gutterRight} ${gutter} H${left}`;
}

function bandPath(section) {
    const { left } = geometry;
    return [
        `M${left} ${y(section.topLeft)}`,
        topEdge(section),
        `V${y(section.bottomRight)}`,
        bottomEdge(section),
        'Z'
    ].join(' ');
}

function bandSvg(section) {
    const colors = palette[section.kind];
    return `  <g id="${section.id}">
    <path d="${bandPath(section)}" fill="${colors.band}" filter="url(#bandGlow)" opacity="0.55"/>
    <path d="${bandPath(section)}" fill="${colors.band}"/>
    <path d="${topEdge(section, true)}" fill="none" stroke="${colors.edge}" stroke-width="7" stroke-linecap="round" opacity="0.9"/>
    <path d="${bottomEdge(section, true)}" fill="none" stroke="${colors.edge}" stroke-width="7" stroke-linecap="round" opacity="0.9"/>
  </g>`;
}

function barsSvg(rows, panelLeft, panelRight) {
    const x = panelLeft + panel.barInset;
    const width = panelRight - panelLeft - panel.barInset * 2;
    return rows
        .map((kind, i) => {
            if (!kind) return null;
            const rowTop = geometry.topRule + i * geometry.ruleStep;
            const barY = rowTop + (geometry.ruleStep - panel.barHeight) / 2;
            const fill = kind === 'G' ? palette.green.bar : kind === 'B' ? palette.blue.bar : palette.gray.bar;
            return `    <rect x="${x}" y="${barY}" width="${width}" height="${panel.barHeight}" rx="${panel.barRadius}" fill="${fill}"/>`;
        })
        .filter(Boolean)
        .join('\n');
}

function panelSvg(id, panelLeft, panelRight) {
    return `  <rect id="${id}" x="${panelLeft}" y="${panel.top}" width="${panelRight - panelLeft}" height="${panel.bottom - panel.top}" rx="${panel.radius}" fill="url(#panelFill)" stroke="#39465e" stroke-width="3"/>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-labelledby="title desc">
  <title id="title">Bygone</title>
  <desc id="desc">Side-by-side diff icon: two panels of text lines with green and blue change bands connected through the gutter.</desc>
  <defs>
    <linearGradient id="bgFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#202940"/>
      <stop offset="1" stop-color="#0c101b"/>
    </linearGradient>
    <linearGradient id="panelFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#222b3e"/>
      <stop offset="1" stop-color="#151b29"/>
    </linearGradient>
    <linearGradient id="grayBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4d586c"/>
      <stop offset="1" stop-color="#3a4354"/>
    </linearGradient>
    <linearGradient id="greenBand" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#36b14d"/>
      <stop offset="1" stop-color="#268c3c"/>
    </linearGradient>
    <linearGradient id="greenBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#63e97e"/>
      <stop offset="1" stop-color="#41d160"/>
    </linearGradient>
    <linearGradient id="blueBand" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2f6fed"/>
      <stop offset="1" stop-color="#1e55c2"/>
    </linearGradient>
    <linearGradient id="blueBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#85b5ff"/>
      <stop offset="1" stop-color="#5e90f7"/>
    </linearGradient>
    <filter id="bandGlow" x="-0.08" y="-0.4" width="1.16" height="1.8">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
  </defs>

  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#bgFill)"/>
  <rect x="5" y="5" width="1014" height="1014" rx="220" fill="none" stroke="#39465e" stroke-width="2" opacity="0.6"/>

${panelSvg('left-panel', geometry.left, geometry.gutterLeft)}
${panelSvg('right-panel', geometry.gutterRight, geometry.right)}

${sections.map(bandSvg).join('\n\n')}

  <g id="left-bars">
${barsSvg(leftRows, geometry.left, geometry.gutterLeft)}
  </g>
  <g id="right-bars">
${barsSvg(rightRows, geometry.gutterRight, geometry.right)}
  </g>
</svg>
`;

await writeFile(outputPath, svg);
console.log(`Wrote ${outputPath.pathname}`);
