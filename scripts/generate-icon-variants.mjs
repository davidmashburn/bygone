import { writeFile } from 'fs/promises';

// Shared connector formula (same as generate-icon-polished.mjs):
//   y(halfLineIndex) = topRule + (halfLineIndex - 0.5) * ruleStep

function makeHelpers(geometry) {
    const y = (halfLineIndex) => geometry.topRule + (halfLineIndex - 0.5) * geometry.ruleStep;

    const topEdge = (section, open = false) => {
        const { left, gutterLeft, gutterRight, right, handle } = geometry;
        const topLeftY = y(section.topLeft);
        const topRightY = y(section.topRight);
        const gutter = topLeftY === topRightY
            ? `H${gutterRight}`
            : `C${gutterLeft + handle} ${topLeftY} ${gutterRight - handle} ${topRightY} ${gutterRight} ${topRightY}`;
        return `${open ? `M${left} ${topLeftY} ` : ''}H${gutterLeft} ${gutter} H${right}`;
    };

    const bottomEdge = (section, open = false) => {
        const { left, gutterLeft, gutterRight, right, handle } = geometry;
        const bottomRightY = y(section.bottomRight);
        const bottomLeftY = y(section.bottomLeft);
        const gutter = bottomRightY === bottomLeftY
            ? `H${gutterLeft}`
            : `C${gutterRight - handle} ${bottomRightY} ${gutterLeft + handle} ${bottomLeftY} ${gutterLeft} ${bottomLeftY}`;
        return `${open ? `M${geometry.right} ${bottomRightY} ` : ''}H${gutterRight} ${gutter} H${left}`;
    };

    const bandPath = (section) => [
        `M${geometry.left} ${y(section.topLeft)}`,
        topEdge(section),
        `V${y(section.bottomRight)}`,
        bottomEdge(section),
        'Z'
    ].join(' ');

    const bars = (rows, panelLeft, panelRight, { inset, height, radius }, fillFor) => rows
        .map((kind, i) => {
            if (!kind) return null;
            const rowTop = geometry.topRule + i * geometry.ruleStep;
            const barY = rowTop + (geometry.ruleStep - height) / 2;
            const x = panelLeft + inset;
            const width = panelRight - panelLeft - inset * 2;
            return `    <rect x="${x}" y="${barY}" width="${width}" height="${height}" rx="${radius}" fill="${fillFor(kind, i)}"/>`;
        })
        .filter(Boolean)
        .join('\n');

    return { y, topEdge, bottomEdge, bandPath, bars };
}

// 7-row pattern: gG / gg / Bg / BB / BB / gg / G-
const rows7 = {
    left: ['g', 'g', 'B', 'B', 'B', 'g', 'G'],
    right: ['G', 'g', 'g', 'B', 'B', 'g', null],
    sections: [
        { id: 'top-green', kind: 'green', topLeft: 0.5, topRight: 0.5, bottomRight: 1.5, bottomLeft: 0.5 },
        { id: 'blue', kind: 'blue', topLeft: 2.5, topRight: 3.5, bottomRight: 5.5, bottomLeft: 5.5 },
        { id: 'bottom-green', kind: 'green', topLeft: 6.5, topRight: 6.5, bottomRight: 6.5, bottomLeft: 7.5 }
    ]
};

// 5-row pattern for small-size boldness: gG / Bg / BB / gg / G-
const rows5 = {
    left: ['g', 'B', 'B', 'g', 'G'],
    right: ['G', 'g', 'B', 'g', null],
    sections: [
        { id: 'top-green', kind: 'green', topLeft: 0.5, topRight: 0.5, bottomRight: 1.5, bottomLeft: 0.5 },
        { id: 'blue', kind: 'blue', topLeft: 1.5, topRight: 2.5, bottomRight: 3.5, bottomLeft: 3.5 },
        { id: 'bottom-green', kind: 'green', topLeft: 4.5, topRight: 4.5, bottomRight: 4.5, bottomLeft: 5.5 }
    ]
};

const svgShell = (title, desc, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${desc}</desc>
  <defs>
${defs}
  </defs>

${body}
</svg>
`;

// ---------------------------------------------------------------------------
// Variant: aurora — glassy panels over an indigo-violet glow
// ---------------------------------------------------------------------------
function aurora() {
    const geometry = { left: 88, gutterLeft: 456, gutterRight: 568, right: 932, topRule: 192, ruleStep: 96, handle: 100 };
    const { bandPath, topEdge, bottomEdge, bars } = makeHelpers(geometry);
    const bar = { inset: 38, height: 52, radius: 26 };
    const pill = (kind) => kind === 'G' ? 'url(#greenBar)' : kind === 'B' ? 'url(#blueBar)' : 'rgba(255,255,255,0.30)';

    const band = (s) => {
        const fill = s.kind === 'green' ? 'url(#greenBand)' : 'url(#blueBand)';
        const edge = s.kind === 'green' ? '#9af5b4' : '#b3ccff';
        return `  <g id="${s.id}">
    <path d="${bandPath(s)}" fill="${fill}" filter="url(#glow)" opacity="0.75"/>
    <path d="${bandPath(s)}" fill="${fill}" opacity="0.92"/>
    <path d="${topEdge(s, true)}" fill="none" stroke="${edge}" stroke-width="6" stroke-linecap="round" opacity="0.95"/>
    <path d="${bottomEdge(s, true)}" fill="none" stroke="${edge}" stroke-width="6" stroke-linecap="round" opacity="0.95"/>
  </g>`;
    };

    const panel = (x1, x2) => `  <rect x="${x1}" y="144" width="${x2 - x1}" height="768" rx="44" fill="rgba(255,255,255,0.09)" stroke="rgba(255,255,255,0.22)" stroke-width="2.5"/>
  <rect x="${x1 + 10}" y="152" width="${x2 - x1 - 20}" height="3" rx="1.5" fill="rgba(255,255,255,0.28)"/>`;

    const defs = `    <linearGradient id="bgFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b2a7d"/>
      <stop offset="0.5" stop-color="#1c1b4e"/>
      <stop offset="1" stop-color="#0d1030"/>
    </linearGradient>
    <radialGradient id="bgHalo" cx="0.3" cy="0.18" r="0.9">
      <stop offset="0" stop-color="#7e5bef" stop-opacity="0.55"/>
      <stop offset="0.6" stop-color="#7e5bef" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#7e5bef" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="greenBand" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2fd573"/>
      <stop offset="1" stop-color="#13a456"/>
    </linearGradient>
    <linearGradient id="greenBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a7f9c0"/>
      <stop offset="1" stop-color="#5fe98a"/>
    </linearGradient>
    <linearGradient id="blueBand" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4f8dfd"/>
      <stop offset="1" stop-color="#2f5fe0"/>
    </linearGradient>
    <linearGradient id="blueBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c4d9ff"/>
      <stop offset="1" stop-color="#8db4ff"/>
    </linearGradient>
    <filter id="glow" x="-0.12" y="-0.6" width="1.24" height="2.2">
      <feGaussianBlur stdDeviation="20"/>
    </filter>`;

    const body = `  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#bgFill)"/>
  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#bgHalo)"/>
  <rect x="5" y="5" width="1014" height="1014" rx="220" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>

${panel(geometry.left, geometry.gutterLeft)}
${panel(geometry.gutterRight, geometry.right)}

${rows7.sections.map(band).join('\n\n')}

  <g id="left-bars">
${bars(rows7.left, geometry.left, geometry.gutterLeft, bar, pill)}
  </g>
  <g id="right-bars">
${bars(rows7.right, geometry.gutterRight, geometry.right, bar, pill)}
  </g>`;

    return svgShell('Bygone — aurora', 'Glassy diff panels over an indigo aurora background.', defs, body);
}

// ---------------------------------------------------------------------------
// Variant: bold — 5 rows, wider gutter, flat color, built for small sizes
// ---------------------------------------------------------------------------
function bold() {
    const geometry = { left: 96, gutterLeft: 436, gutterRight: 588, right: 928, topRule: 222, ruleStep: 116, handle: 130 };
    const { bandPath, bars } = makeHelpers(geometry);
    const bar = { inset: 40, height: 64, radius: 32 };
    const pill = (kind) => kind === 'G' ? '#7bf09a' : kind === 'B' ? '#9ec5ff' : '#4d5870';

    const band = (s) => {
        const fill = s.kind === 'green' ? '#23a951' : '#2e66e5';
        return `  <path id="${s.id}" d="${bandPath(s)}" fill="${fill}"/>`;
    };

    const panel = (x1, x2) => `  <rect x="${x1}" y="178" width="${x2 - x1}" height="668" rx="48" fill="#1d2435"/>`;

    const defs = `    <linearGradient id="bgFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a3245"/>
      <stop offset="1" stop-color="#11161f"/>
    </linearGradient>`;

    const body = `  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#bgFill)"/>

${panel(geometry.left, geometry.gutterLeft)}
${panel(geometry.gutterRight, geometry.right)}

${rows5.sections.map(band).join('\n\n')}

  <g id="left-bars">
${bars(rows5.left, geometry.left, geometry.gutterLeft, bar, pill)}
  </g>
  <g id="right-bars">
${bars(rows5.right, geometry.gutterRight, geometry.right, bar, pill)}
  </g>`;

    return svgShell('Bygone — bold', 'Simplified five-row diff icon tuned for small sizes.', defs, body);
}

// ---------------------------------------------------------------------------
// Variant: bygone — the past (left, faded sepia) flows into the present
// (right, vivid). Plays on the app name.
// ---------------------------------------------------------------------------
function bygone() {
    const geometry = { left: 88, gutterLeft: 456, gutterRight: 568, right: 932, topRule: 192, ruleStep: 96, handle: 100 };
    const { bandPath, topEdge, bottomEdge, bars } = makeHelpers(geometry);
    const bar = { inset: 38, height: 52, radius: 26 };
    const leftPill = (kind) => kind === 'G' ? 'url(#greenBarPast)' : kind === 'B' ? 'url(#blueBarPast)' : '#4a4a52';
    const rightPill = (kind) => kind === 'G' ? '#74f193' : kind === 'B' ? '#92bcff' : '#4d5870';

    const band = (s) => {
        const fill = s.kind === 'green' ? 'url(#greenFlow)' : 'url(#blueFlow)';
        const edge = s.kind === 'green' ? 'url(#greenEdgeFlow)' : 'url(#blueEdgeFlow)';
        return `  <g id="${s.id}">
    <path d="${bandPath(s)}" fill="${fill}" filter="url(#glow)" opacity="0.6"/>
    <path d="${bandPath(s)}" fill="${fill}"/>
    <path d="${topEdge(s, true)}" fill="none" stroke="${edge}" stroke-width="6" stroke-linecap="round"/>
    <path d="${bottomEdge(s, true)}" fill="none" stroke="${edge}" stroke-width="6" stroke-linecap="round"/>
  </g>`;
    };

    const defs = `    <linearGradient id="bgFill" x1="0" y1="0" x2="1" y2="0.25">
      <stop offset="0" stop-color="#26221f"/>
      <stop offset="0.5" stop-color="#16181f"/>
      <stop offset="1" stop-color="#0d1422"/>
    </linearGradient>
    <linearGradient id="leftPanelFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b2826" stop-opacity="0.85"/>
      <stop offset="1" stop-color="#1c1a18" stop-opacity="0.85"/>
    </linearGradient>
    <linearGradient id="rightPanelFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#222b3e"/>
      <stop offset="1" stop-color="#141b2a"/>
    </linearGradient>
    <linearGradient id="greenFlow" x1="88" y1="0" x2="932" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#6d7a66"/>
      <stop offset="0.42" stop-color="#48a35a"/>
      <stop offset="1" stop-color="#2fcf63"/>
    </linearGradient>
    <linearGradient id="greenEdgeFlow" x1="88" y1="0" x2="932" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9aa794" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#8df5a8"/>
    </linearGradient>
    <linearGradient id="blueFlow" x1="88" y1="0" x2="932" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#5a6273"/>
      <stop offset="0.42" stop-color="#3a62c4"/>
      <stop offset="1" stop-color="#2f74ff"/>
    </linearGradient>
    <linearGradient id="blueEdgeFlow" x1="88" y1="0" x2="932" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#979eac" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#a8c7ff"/>
    </linearGradient>
    <linearGradient id="greenBarPast" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#7d8a76"/>
      <stop offset="1" stop-color="#84b489"/>
    </linearGradient>
    <linearGradient id="blueBarPast" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6f7685"/>
      <stop offset="1" stop-color="#7d97c9"/>
    </linearGradient>
    <filter id="glow" x="-0.12" y="-0.6" width="1.24" height="2.2">
      <feGaussianBlur stdDeviation="16"/>
    </filter>`;

    const body = `  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#bgFill)"/>
  <rect x="5" y="5" width="1014" height="1014" rx="220" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="2"/>

  <rect x="${geometry.left}" y="144" width="${geometry.gutterLeft - geometry.left}" height="768" rx="44" fill="url(#leftPanelFill)" stroke="#3e3a35" stroke-width="3" stroke-dasharray="18 14"/>
  <rect x="${geometry.gutterRight}" y="144" width="${geometry.right - geometry.gutterRight}" height="768" rx="44" fill="url(#rightPanelFill)" stroke="#3f4d68" stroke-width="3"/>

${rows7.sections.map(band).join('\n\n')}

  <g id="left-bars" opacity="0.62">
${bars(rows7.left, geometry.left, geometry.gutterLeft, bar, leftPill)}
  </g>
  <g id="right-bars">
${bars(rows7.right, geometry.gutterRight, geometry.right, bar, rightPill)}
  </g>`;

    return svgShell('Bygone — past to present', 'The faded past on the left flows through the gutter into the vivid present on the right.', defs, body);
}

// ---------------------------------------------------------------------------
// Variant: neon — no panels, floating pills, glowing connector bands.
// `flickers` marks pills as partially lit, like a highlight sweep caught
// mid-stroke: [{ side: 'left'|'right', row: index, lit: fraction }]
// ---------------------------------------------------------------------------
function neon(flickers = [], label = 'neon') {
    const geometry = { left: 104, gutterLeft: 452, gutterRight: 572, right: 920, topRule: 200, ruleStep: 92, handle: 104 };
    const { bandPath, topEdge, bottomEdge } = makeHelpers(geometry);
    const bar = { inset: 16, height: 50, radius: 25 };
    const pillColor = (kind) => kind === 'G' ? '#52ff8d' : kind === 'B' ? '#6da4ff' : '#363e4e';

    const sideGeom = {
        left: [geometry.left, geometry.gutterLeft],
        right: [geometry.gutterRight, geometry.right]
    };
    const flickerFor = (side, i) => flickers.find((f) => f.side === side && f.row === i);
    const pillBox = (side, i) => {
        const [x1, x2] = sideGeom[side];
        const rowTop = geometry.topRule + i * geometry.ruleStep;
        return {
            x: x1 + bar.inset,
            y: rowTop + (geometry.ruleStep - bar.height) / 2,
            w: x2 - x1 - bar.inset * 2,
            h: bar.height
        };
    };

    const band = (s) => {
        const edge = s.kind === 'green' ? '#52ff8d' : '#6da4ff';
        const fill = s.kind === 'green' ? '#1d8f47' : '#1e54c0';
        return `  <g id="${s.id}">
    <path d="${bandPath(s)}" fill="${fill}" opacity="0.42" filter="url(#bigGlow)"/>
    <path d="${bandPath(s)}" fill="${fill}" opacity="0.5"/>
    <g filter="url(#edgeGlow)">
      <path d="${topEdge(s, true)}" fill="none" stroke="${edge}" stroke-width="9" stroke-linecap="round"/>
      <path d="${bottomEdge(s, true)}" fill="none" stroke="${edge}" stroke-width="9" stroke-linecap="round"/>
    </g>
    <path d="${topEdge(s, true)}" fill="none" stroke="#eafff1" stroke-width="3" stroke-linecap="round" opacity="0.85"/>
    <path d="${bottomEdge(s, true)}" fill="none" stroke="#eafff1" stroke-width="3" stroke-linecap="round" opacity="0.85"/>
  </g>`;
    };

    const defs = `    <radialGradient id="bgFill" cx="0.5" cy="0.42" r="0.85">
      <stop offset="0" stop-color="#121826"/>
      <stop offset="1" stop-color="#04060b"/>
    </radialGradient>
    <linearGradient id="litBlue" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5e97ff"/>
      <stop offset="0.8" stop-color="#85b4ff"/>
      <stop offset="1" stop-color="#a9ccff"/>
    </linearGradient>
    <linearGradient id="afterGlow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6da4ff" stop-opacity="0.4"/>
      <stop offset="0.45" stop-color="#6da4ff" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#6da4ff" stop-opacity="0"/>
    </linearGradient>
    <filter id="bigGlow" x="-0.15" y="-0.8" width="1.3" height="2.6">
      <feGaussianBlur stdDeviation="30"/>
    </filter>
    <filter id="edgeGlow" x="-0.1" y="-0.5" width="1.2" height="2">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
    <filter id="pillGlow" x="-0.2" y="-0.6" width="1.4" height="2.2">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
    <filter id="hotGlow" x="-1.5" y="-0.8" width="4" height="2.6">
      <feGaussianBlur stdDeviation="6"/>
    </filter>`;

    // Glow halos under colored pills; a flickering pill only glows over its lit span.
    const glowPills = (side, rows) => rows
        .map((kind, i) => {
            if (kind !== 'G' && kind !== 'B') return null;
            const { x, y, w, h } = pillBox(side, i);
            const f = flickerFor(side, i);
            const gw = f ? Math.round(w * f.lit) : w;
            return `    <rect x="${x}" y="${y}" width="${gw}" height="${h}" rx="${bar.radius}" fill="${pillColor(kind)}" opacity="${f ? 0.45 : 0.55}" filter="url(#pillGlow)"/>`;
        })
        .filter(Boolean)
        .join('\n');

    // A tube caught mid-flicker: lit span sweeping in from the left, a hot
    // edge at the front, and faint after-flicker stubs in the dark remainder.
    const flickerPill = (side, i) => {
        const { x, y, w, h } = pillBox(side, i);
        const f = flickerFor(side, i);
        const uid = `${side}-${i}`;
        const litW = Math.round(w * f.lit);
        const edgeX = x + litW;
        return `    <clipPath id="clip-${uid}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${bar.radius}"/></clipPath>
    <g id="flicker-${uid}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${bar.radius}" fill="#1c2536" stroke="#33415c" stroke-width="2"/>
      <g clip-path="url(#clip-${uid})">
        <rect x="${x}" y="${y}" width="${litW}" height="${h}" fill="url(#litBlue)"/>
        <rect x="${edgeX}" y="${y}" width="${x + w - edgeX}" height="${h}" fill="url(#afterGlow)"/>
      </g>
      <rect x="${edgeX - 7}" y="${y - 3}" width="14" height="${h + 6}" rx="7" fill="#9cc4ff" opacity="0.75" filter="url(#hotGlow)"/>
      <rect x="${edgeX - 3}" y="${y + 2}" width="6" height="${h - 4}" rx="3" fill="#e8f3ff" opacity="0.95"/>
    </g>`;
    };

    const pills = (side, rows) => rows
        .map((kind, i) => {
            if (!kind) return null;
            if (flickerFor(side, i)) return flickerPill(side, i);
            const { x, y, w, h } = pillBox(side, i);
            return `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${bar.radius}" fill="${pillColor(kind)}"/>`;
        })
        .filter(Boolean)
        .join('\n');

    const body = `  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#bgFill)"/>
  <rect x="5" y="5" width="1014" height="1014" rx="220" fill="none" stroke="#1d2738" stroke-width="2"/>

${rows7.sections.map(band).join('\n\n')}

  <g id="pill-glows">
${glowPills('left', rows7.left)}
${glowPills('right', rows7.right)}
  </g>
  <g id="left-bars">
${pills('left', rows7.left)}
  </g>
  <g id="right-bars">
${pills('right', rows7.right)}
  </g>`;

    return svgShell(`Bygone — ${label}`, 'Panel-less neon take: floating pills and glowing connector bands.', defs, body);
}

// ---------------------------------------------------------------------------
// Variant: neon5 — the neon treatment on the simplified 5-row pattern.
// `deco` adds texture to the blue bars:
//   'words'   — pills split into word-shaped segments, one word highlighted
//               mid-bar (reads as selection, not progress) with a caret
//   'shimmer' — one diagonal light sweep crossing all blue pills
// ---------------------------------------------------------------------------
function neonFive(deco = 'none', label = 'neon five') {
    const geometry = { left: 104, gutterLeft: 444, gutterRight: 580, right: 920, topRule: 212, ruleStep: 124, handle: 120 };
    const { bandPath, topEdge, bottomEdge } = makeHelpers(geometry);
    const bar = { inset: 18, height: 62, radius: 31 };
    const pillColor = (kind) => kind === 'G' ? '#52ff8d' : kind === 'B' ? '#6da4ff' : '#363e4e';

    const sideGeom = {
        left: [geometry.left, geometry.gutterLeft],
        right: [geometry.gutterRight, geometry.right]
    };
    const pillBox = (side, i) => {
        const [x1, x2] = sideGeom[side];
        const rowTop = geometry.topRule + i * geometry.ruleStep;
        return {
            x: x1 + bar.inset,
            y: rowTop + (geometry.ruleStep - bar.height) / 2,
            w: x2 - x1 - bar.inset * 2,
            h: bar.height
        };
    };

    const band = (s) => {
        const edge = s.kind === 'green' ? '#52ff8d' : '#6da4ff';
        const fill = s.kind === 'green' ? '#1d8f47' : '#1e54c0';
        return `  <g id="${s.id}">
    <path d="${bandPath(s)}" fill="${fill}" opacity="0.42" filter="url(#bigGlow)"/>
    <path d="${bandPath(s)}" fill="${fill}" opacity="0.5"/>
    <g filter="url(#edgeGlow)">
      <path d="${topEdge(s, true)}" fill="none" stroke="${edge}" stroke-width="10" stroke-linecap="round"/>
      <path d="${bottomEdge(s, true)}" fill="none" stroke="${edge}" stroke-width="10" stroke-linecap="round"/>
    </g>
    <path d="${topEdge(s, true)}" fill="none" stroke="#eafff1" stroke-width="3.5" stroke-linecap="round" opacity="0.85"/>
    <path d="${bottomEdge(s, true)}" fill="none" stroke="#eafff1" stroke-width="3.5" stroke-linecap="round" opacity="0.85"/>
  </g>`;
    };

    // Word-shaped segments (fractions of the pill width) for the blue rows.
    // The highlighted index on right row 2 sits mid-bar so it reads as a
    // selected word rather than a fill level.
    const wordLayouts = {
        'left-1': { words: [0.55, 0.45] },
        'left-2': { words: [0.36, 0.64] },
        'right-2': { words: [0.3, 0.42, 0.28], highlight: 1 }
    };

    const wordPill = (side, i, kind) => {
        const { x, y, w, h } = pillBox(side, i);
        const layout = wordLayouts[`${side}-${i}`];
        const gap = 18;
        const usable = w - gap * (layout.words.length - 1);
        let cx = x;
        const parts = [];
        layout.words.forEach((frac, wi) => {
            const ww = Math.round(usable * frac);
            if (layout.highlight === wi) {
                parts.push(`    <rect x="${cx}" y="${y}" width="${ww}" height="${h}" rx="${h / 2}" fill="#95c0ff" opacity="0.45" filter="url(#pillGlow)"/>`);
                parts.push(`    <rect x="${cx}" y="${y}" width="${ww}" height="${h}" rx="${h / 2}" fill="#95c0ff"/>`);
            } else {
                parts.push(`    <rect x="${cx}" y="${y}" width="${ww}" height="${h}" rx="${h / 2}" fill="${pillColor(kind)}"/>`);
            }
            cx += ww + gap;
        });
        return parts.join('\n');
    };

    const glowPills = (side, rows) => rows
        .map((kind, i) => {
            if (kind !== 'G' && kind !== 'B') return null;
            const worded = deco === 'words' && wordLayouts[`${side}-${i}`];
            const { x, y, w, h } = pillBox(side, i);
            return `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${bar.radius}" fill="${pillColor(kind)}" opacity="${worded ? 0.35 : 0.55}" filter="url(#pillGlow)"/>`;
        })
        .filter(Boolean)
        .join('\n');

    const pills = (side, rows) => rows
        .map((kind, i) => {
            if (!kind) return null;
            if (deco === 'words' && kind === 'B' && wordLayouts[`${side}-${i}`]) return wordPill(side, i, kind);
            const { x, y, w, h } = pillBox(side, i);
            return `    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${bar.radius}" fill="${pillColor(kind)}"/>`;
        })
        .filter(Boolean)
        .join('\n');

    const bluePillRects = () => {
        const out = [];
        for (const [side, rows] of [['left', rows5.left], ['right', rows5.right]]) {
            rows.forEach((kind, i) => {
                if (kind !== 'B') return;
                const { x, y, w, h } = pillBox(side, i);
                out.push(`      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${bar.radius}"/>`);
            });
        }
        return out.join('\n');
    };

    const shimmer = deco === 'shimmer'
        ? `  <clipPath id="blueClip">
${bluePillRects()}
  </clipPath>
  <g clip-path="url(#blueClip)">
    <rect x="0" y="0" width="1024" height="1024" fill="url(#sweep)"/>
  </g>`
        : '';

    const defs = `    <radialGradient id="bgFill" cx="0.5" cy="0.42" r="0.85">
      <stop offset="0" stop-color="#121826"/>
      <stop offset="1" stop-color="#04060b"/>
    </radialGradient>
    <linearGradient id="sweep" x1="0" y1="180" x2="0" y2="840" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.30" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="0.46" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="0.62" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="bigGlow" x="-0.15" y="-0.8" width="1.3" height="2.6">
      <feGaussianBlur stdDeviation="30"/>
    </filter>
    <filter id="edgeGlow" x="-0.1" y="-0.5" width="1.2" height="2">
      <feGaussianBlur stdDeviation="7"/>
    </filter>
    <filter id="pillGlow" x="-0.2" y="-0.6" width="1.4" height="2.2">
      <feGaussianBlur stdDeviation="9"/>
    </filter>`;

    const body = `  <rect x="0" y="0" width="1024" height="1024" rx="224" fill="url(#bgFill)"/>
  <rect x="5" y="5" width="1014" height="1014" rx="220" fill="none" stroke="#1d2738" stroke-width="2"/>

${rows5.sections.map(band).join('\n\n')}

  <g id="pill-glows">
${glowPills('left', rows5.left)}
${glowPills('right', rows5.right)}
  </g>
  <g id="left-bars">
${pills('left', rows5.left)}
  </g>
  <g id="right-bars">
${pills('right', rows5.right)}
  </g>
${shimmer}`;

    return svgShell(`Bygone — ${label}`, 'Neon treatment on the simplified five-row diff pattern.', defs, body);
}

const variants = {
    aurora,
    bold,
    bygone,
    neon: () => neon(),
    // Right panel's bottom blue line caught 62% through its highlight sweep.
    'neon-flicker': () => neon([{ side: 'right', row: 4, lit: 0.62 }], 'neon flicker'),
    // Same, plus the left panel's top blue line almost fully lit.
    'neon-flicker2': () => neon(
        [
            { side: 'right', row: 4, lit: 0.62 },
            { side: 'left', row: 2, lit: 0.85 }
        ],
        'neon flicker x2'
    ),
    neon5: () => neonFive('none', 'neon five'),
    'neon5-words': () => neonFive('words', 'neon five words'),
    'neon5-shimmer': () => neonFive('shimmer', 'neon five shimmer')
};

for (const [name, build] of Object.entries(variants)) {
    const path = new URL(`../standalone/assets/bygone-icon-v-${name}.svg`, import.meta.url);
    await writeFile(path, build());
    console.log(`Wrote ${path.pathname}`);
}
