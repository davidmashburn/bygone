// Slice 0 corpus for plans/text-block-move-tracking.md. Expectations are
// authored from the plan's meaning of the labels; do not regenerate them from
// the implementation. `exact` is what the exact-only analyzer must report.
// `target` records the eventual interpretation when a later slice (edited or
// reindented matching) is required, so tuning cannot quietly redefine it.
// Ranges are zero-based, half-open line ranges: [start, end).
// The base diff's retained backbone decides what can move, so each fixture
// has enough anchors that its intended backbone is the unique longest one.

const A = [
    'function parseConfig(source) {',
    '    const values = readEntries(source);',
    '    return normalizeKeys(values);',
    '}'
];
const B = [
    'function renderSummary(report) {',
    '    const totals = countFindings(report);',
    '    return formatTotals(totals);',
    '}'
];
const X = [
    'function closeSession(session) {',
    '    session.flushPendingWrites();',
    '    session.releaseHandles();',
    '}'
];
const f = n => `const setting${n} = ${n};`;
const fill = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => f(from + i));
const move = (source, destination) => ({ kind: 'move', source, destination });
const copy = (source, destination) => ({ kind: 'copy', source, destination });

const HEAD = ['function alpha() {', '    return computeAlpha(input);', '}', ''];
const TAIL = ['function availableModes() {', '    return listAuthoredModes(state.tour);', '}', ''];
const DESCRIBE = ['function describeMode(mode) {', '    const known = modeDescriptions[mode];', '    return known ?? defaultDescription(mode);', '}'];
const SUPPORTS = ['function supportsHistory(tour) {', '    return Number(tour.version) >= 2;', '}'];
const DEV = ['dev = [', '  "pre-commit>=3.7.0",', '  "ruff==0.5.7",  # keep in sync with pre-commit', ']'];
const LINT = ['lint = [', '  "mypy>=1.10",', ']'];
const DOCS = ['docs = [', '  "furo",', '  "myst-nb",', ']', 'plot = ["matplotlib"]'];
const prop = (name, description) => [`        ${name}:`, `          description: ${description}`, '          default: false', '          type: boolean'];
const LINTER = prop('linter', 'Run the configured linter after each save');

const LONG_LINE = 'export const DEFAULT_RETRY_POLICY_DESCRIPTION = "Retry idempotent requests three times with exponential backoff and jitter";';
const PROSE = [
    '変更の履歴を読み解くには、移動と複製を区別する必要があります。',
    'レビュー担当者は元の位置と新しい位置の両方を確認できます。',
    '曖昧な対応関係は推測せずに未解決として表示します。'
];

module.exports = [
    {
        name: 'exact move down past retained context',
        left: [...A, ...fill(1, 3), ...B],
        right: [...fill(1, 3), ...B, ...A],
        exact: { relations: [move([0, 4], [7, 11])], unresolved: [] },
        accounting: { movedSource: 4, movedDestination: 4 }
    },
    {
        name: 'exact move up past retained context',
        left: [...fill(1, 3), ...B, ...A],
        right: [...A, ...fill(1, 3), ...B],
        exact: { relations: [move([7, 11], [0, 4])], unresolved: [] }
    },
    {
        name: 'two blocks swap; either block may be reported as the move',
        left: [...fill(1, 2), ...A, ...B, ...fill(3, 4)],
        right: [...fill(1, 2), ...B, ...A, ...fill(3, 4)],
        exact: {
            alternatives: [
                { relations: [move([2, 6], [6, 10])], unresolved: [] },
                { relations: [move([6, 10], [2, 6])], unresolved: [] },
                // Both blocks end in `}`; the base diff may retain that line instead.
                { relations: [move([2, 5], [6, 9])], unresolved: [] },
                { relations: [move([6, 9], [2, 5])], unresolved: [] }
            ]
        }
    },
    {
        name: 'earlier insertion shifts every line without relocating anything',
        left: [...fill(1, 5), ...A],
        right: [...X, ...fill(1, 5), ...A],
        exact: { relations: [], unresolved: [] },
        accounting: { added: 4 }
    },
    {
        name: 'copy from unchanged source',
        left: [f(1), ...A, f(2), f(3)],
        right: [f(1), ...A, f(2), f(3), ...A],
        exact: { relations: [copy([1, 5], [7, 11])], unresolved: [] },
        accounting: { copiedDestination: 4, removed: 0 }
    },
    {
        name: 'copy whose retained source is then edited in place',
        left: [f(1), ...A, f(2)],
        right: [f(1), A[0], '    const values = readEntries(source, { strict: true });', A[2], A[3], f(2), ...A],
        // The source splits into retained and removed lines, so no exact run
        // of either class meets the size gate.
        exact: { relations: [], unresolved: [] },
        target: 'copy of the original block; source continuation edited in place'
    },
    {
        name: 'move plus copy in one change',
        left: [f(1), ...A, ...fill(2, 8), ...B, f(9)],
        right: [f(1), ...fill(2, 8), ...B, f(9), ...A, ...B],
        exact: { relations: [move([1, 5], [13, 17]), copy([12, 16], [17, 21])], unresolved: [] }
    },
    {
        name: 'duplicates already present are not a new copy',
        left: [...A, f(1), ...A, f(2)],
        right: [...A, f(1), ...A, f(3)],
        exact: { relations: [], unresolved: [] }
    },
    {
        name: 'new occurrence with two equally plausible retained origins',
        left: [...A, f(1), ...A, f(2)],
        right: [...A, f(1), ...A, f(2), ...A],
        exact: { relations: [], unresolved: [{ reason: 'competing-origins', sources: [[0, 4], [5, 9]], destinations: [[10, 14]] }] }
    },
    {
        name: 'one of two identical occurrences disappears',
        left: [...A, f(1), ...A, f(2)],
        right: [...A, f(1), f(2)],
        exact: { relations: [], unresolved: [] },
        accounting: { removed: 4 }
    },
    {
        name: 'disappearing block appears twice',
        // Five anchors on each side keep both destinations off the retained backbone.
        left: [...fill(1, 5), ...A, ...fill(6, 10)],
        right: [...A, ...fill(1, 10), ...A],
        exact: { relations: [], unresolved: [{ reason: 'fan-out', sources: [[5, 9]], destinations: [[0, 4], [14, 18]] }] },
        accounting: { unresolvedRemoved: 4, unresolvedAdded: 8 }
    },
    {
        name: 'moved block also matches a retained copy',
        left: [...A, f(1), f(2), ...A, ...fill(3, 8)],
        right: [...A, f(1), f(2), ...fill(3, 8), ...A],
        // The removed occurrence and the retained one explain the destination equally.
        exact: { relations: [], unresolved: [{ reason: 'competing-origins', sources: [[0, 4], [6, 10]], destinations: [[12, 16]] }] }
    },
    {
        name: 'blank and brace runs cannot establish a move',
        left: [f(1), '', '    }', '}', '', ...fill(2, 6)],
        right: [f(1), ...fill(2, 6), '', '    }', '}', ''],
        exact: { relations: [], unresolved: [] }
    },
    {
        name: 'short one-line move stays unclassified',
        left: ['    return null;', ...fill(1, 4)],
        right: [...fill(1, 4), '    return null;'],
        exact: { relations: [], unresolved: [] }
    },
    {
        name: 'long distinctive single line moves',
        left: [LONG_LINE, ...fill(1, 4)],
        right: [...fill(1, 4), LONG_LINE],
        exact: { relations: [move([0, 1], [4, 5])], unresolved: [] }
    },
    {
        name: 'long single line that is not unique stays unclassified',
        left: [LONG_LINE, ...fill(1, 4), LONG_LINE],
        right: [...fill(1, 4), LONG_LINE, LONG_LINE],
        exact: { relations: [], unresolved: [] }
    },
    {
        name: 'non-Latin prose paragraph moves',
        left: [...PROSE, ...fill(1, 4)],
        right: [...fill(1, 4), ...PROSE],
        exact: { relations: [move([0, 3], [4, 7])], unresolved: [] }
    },
    {
        name: 'CRLF source and LF destination still match',
        leftText: [...A, ...fill(1, 5)].join('\r\n') + '\r\n',
        rightText: [...fill(1, 5), ...A].join('\n'),
        exact: { relations: [move([0, 4], [5, 9])], unresolved: [] }
    },
    {
        name: 'empty left side',
        leftText: '',
        right: [...A],
        exact: { relations: [], unresolved: [] },
        accounting: { added: 4 }
    },
    {
        name: 'moved block with an identifier edit',
        left: [...A, ...fill(1, 4)],
        right: [...fill(1, 4), A[0], '    const entries = readEntries(source);', '    return normalizeKeys(entries);', A[3]],
        exact: { relations: [], unresolved: [] },
        target: 'move with local edits (slice 2)'
    },
    {
        name: 'reindented move',
        left: [...A, ...fill(1, 4)],
        right: [...fill(1, 4), 'class Loader {', ...A.map(line => `    ${line}`), '}'],
        exact: { relations: [], unresolved: [] },
        target: 'reindented move (slice 2)'
    },
    {
        name: 'reflowed prose paragraph moves',
        left: [
            'Bygone keeps the ordinary diff authoritative for scrolling and copying,',
            'and records relocations as separate relationships between ranges.',
            ...fill(1, 4)
        ],
        right: [
            ...fill(1, 4),
            'Bygone keeps the ordinary diff authoritative for scrolling',
            'and copying, and records relocations as separate relationships',
            'between ranges.'
        ],
        exact: { relations: [], unresolved: [] },
        target: 'move of a reflowed paragraph (slice 2)'
    },
    // Known limitation: the base diff reuses a moved block's low-information
    // closing lines for a new neighbor at the old site. Freeing them would cost
    // a matched line, so this is not a tie. Patterns reduced from bygone
    // d43cf033 (web/host.js), hamilton 875555f7 (pyproject.toml), and marimo
    // 70a09115 (notifications.yaml); the fixtures are original text.
    {
        name: 'moved function loses its closing brace to a new neighbor',
        left: [...HEAD, ...DESCRIBE, '', ...TAIL, ...fill(1, 6)],
        right: [...HEAD, ...SUPPORTS, '', ...TAIL, ...fill(1, 6), '', ...DESCRIBE],
        exact: { relations: [move([4, 7], [19, 22])], unresolved: [] },
        target: 'move of the whole function, closing brace included (diff-quality follow-up)'
    },
    {
        name: 'moved TOML array loses its closing bracket to a new neighbor',
        left: ['[project.optional-dependencies]', 'cache = ["diskcache"]', ...DEV, ...DOCS, '', '[dependency-groups]', 'test = [', '  "pytest",', ']'],
        right: ['[project.optional-dependencies]', 'cache = ["diskcache"]', ...LINT, ...DOCS, '', '[dependency-groups]', 'test = [', '  "pytest",', ']', ...DEV],
        exact: { relations: [move([2, 5], [15, 18])], unresolved: [] },
        target: 'move of the whole array, closing bracket included (diff-quality follow-up)'
    },
    {
        name: 'moved YAML property loses repeated lines and falls below the gate',
        left: ['      properties:', ...prop('terminal', 'Allow terminal access'), ...LINTER, ...prop('profiler', 'Collect timing data'), '      required: []'],
        right: ['      properties:', ...prop('terminal', 'Allow terminal access'), ...prop('notebook', 'Open in notebook mode'),
            ...prop('profiler', 'Collect timing data'), ...LINTER, '      required: []'],
        exact: { relations: [], unresolved: [] },
        target: 'move of the whole linter property (diff-quality follow-up)'
    }
];

module.exports.textOf = (testCase, side) => testCase[`${side}Text`] ?? testCase[side].join('\n') + '\n';
