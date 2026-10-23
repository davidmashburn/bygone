'use strict';

// Bygone Strand v1: original, bounded JS/TS/Python declaration correspondence.

const ts = require('typescript');
const { performance } = require('node:perf_hooks');
const { digest } = require('./symbol-inventory');

const JAVASCRIPT_PATH = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const DEFAULT_LIMITS = Object.freeze({
    maxRecords: 20000,
    timeoutMs: 30000,
    maxCandidates: 250000,
    maxTokensPerSymbol: 20000
});
// These are deliberately finite even when callers provide a larger value. The
// matcher is an evidence producer, not an invitation to search an entire
// repository with an unbounded quadratic comparison.
const HARD_LIMITS = Object.freeze({
    maxRecords: 100000,
    timeoutMs: 120000,
    maxCandidates: 1000000,
    maxTokensPerSymbol: 100000
});

const TRIVIA_KINDS = new Set([
    ts.SyntaxKind.WhitespaceTrivia,
    ts.SyntaxKind.NewLineTrivia,
    ts.SyntaxKind.SingleLineCommentTrivia,
    ts.SyntaxKind.MultiLineCommentTrivia,
    ts.SyntaxKind.ShebangTrivia,
    ts.SyntaxKind.ConflictMarkerTrivia
].filter(kind => kind !== undefined));

const LITERAL_KINDS = new Set([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NumericLiteral,
    ts.SyntaxKind.BigIntLiteral,
    ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
    ts.SyntaxKind.TrueKeyword,
    ts.SyntaxKind.FalseKeyword,
    ts.SyntaxKind.NullKeyword
].filter(kind => kind !== undefined));

const IDENTIFIER_KINDS = new Set([
    ts.SyntaxKind.Identifier,
    ts.SyntaxKind.PrivateIdentifier
].filter(kind => kind !== undefined));

const HEADER_MODIFIERS = new Set([
    'export', 'default', 'declare', 'async', 'abstract', 'public', 'private',
    'protected', 'static', 'readonly', 'override', 'const', 'let', 'var'
]);

const OPERATOR_TEXT = new Set([
    '+', '-', '*', '/', '%', '**', '++', '--', '=', '+=', '-=', '*=', '/=',
    '%=', '**=', '&=', '|=', '^=', '&&=', '||=', '??=', '==', '===', '!=',
    '!==', '<', '<=', '>', '>=', '&&', '||', '??', '!', '~', '&', '|', '^',
    '<<', '>>', '>>>', '<<=', '>>=', '>>>=', '=>', '?', '?.', 'in', 'instanceof'
]);

const EXPECTED_NODE_KINDS = new Map([
    ['function', [ts.SyntaxKind.FunctionDeclaration]],
    ['class', [ts.SyntaxKind.ClassDeclaration]],
    ['method', [ts.SyntaxKind.MethodDeclaration]],
    ['constructor', [ts.SyntaxKind.Constructor]],
    ['getter', [ts.SyntaxKind.GetAccessor]],
    ['setter', [ts.SyntaxKind.SetAccessor]],
    ['property', [ts.SyntaxKind.PropertyDeclaration]],
    ['function-variable', [ts.SyntaxKind.VariableDeclaration]],
    ['variable', [ts.SyntaxKind.VariableDeclaration]],
    ['interface', [ts.SyntaxKind.InterfaceDeclaration]],
    ['type', [ts.SyntaxKind.TypeAliasDeclaration]],
    ['enum', [ts.SyntaxKind.EnumDeclaration]],
    ['registration', [ts.SyntaxKind.ExpressionStatement]]
]);

const MIN_SCORE = 0.68;
const MIN_MARGIN = 0.08;
const SCORE_EPSILON = 1e-6;

class BudgetExceeded extends Error {
    constructor(reason) {
        super(reason);
        this.name = 'BudgetExceeded';
        this.reason = reason;
    }
}

class Budget {
    constructor(limits) {
        this.limits = limits;
        this.started = performance.now();
        this.comparisons = 0;
        this.records = 0;
    }

    check() {
        if (performance.now() - this.started >= this.limits.timeoutMs) throw new BudgetExceeded('timeout');
    }

    record() {
        this.check();
        if (++this.records > this.limits.maxRecords) throw new BudgetExceeded('max-records');
    }

    comparison() {
        this.check();
        if (++this.comparisons > this.limits.maxCandidates) throw new BudgetExceeded('max-candidates');
    }
}

function result(status, processedPaths, details = {}) {
    return {
        version: 1,
        status,
        ...(details.reason ? { reason: details.reason } : {}),
        truncated: !!details.truncated,
        processedPaths: {
            before: [...(processedPaths.before || [])].sort(),
            after: [...(processedPaths.after || [])].sort()
        },
        mappers: details.mappers || [],
        unresolved: details.unresolved || [],
        rejectedCandidates: details.rejectedCandidates || []
    };
}

function normalizeLimits(input) {
    const merged = { ...DEFAULT_LIMITS, ...(input && typeof input === 'object' ? input : {}) };
    for (const key of Object.keys(DEFAULT_LIMITS)) {
        if (!Number.isSafeInteger(merged[key]) || merged[key] < 1) return null;
        merged[key] = Math.min(merged[key], HARD_LIMITS[key]);
    }
    return merged;
}

function isJavaScriptPath(filePath) {
    return typeof filePath === 'string' && JAVASCRIPT_PATH.test(filePath);
}

function languageFor(filePath) {
    return /\.py$/.test(filePath) ? 'python' : 'javascript';
}

function scriptKindFor(filePath) {
    if (/\.tsx$/i.test(filePath)) return ts.ScriptKind.TSX;
    if (/\.jsx$/i.test(filePath)) return ts.ScriptKind.JSX;
    if (/\.(?:mts|cts|ts)$/i.test(filePath)) return ts.ScriptKind.TS;
    return ts.ScriptKind.JS;
}

function languageVariantFor(filePath) {
    return /\.(?:jsx|tsx)$/i.test(filePath) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
}

function tokenCategory(kind, text) {
    if (IDENTIFIER_KINDS.has(kind)) return 'identifier';
    if (LITERAL_KINDS.has(kind)) return 'literal';
    if (OPERATOR_TEXT.has(text)) return 'operator';
    const keyword = ts.tokenToString(kind);
    if (keyword && /^[A-Za-z_$]/.test(keyword)) return 'keyword';
    return 'punctuation';
}

function scanTokens(text, start, end, filePath, limits, budget) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariantFor(filePath), text,
        undefined, start, Math.max(0, end - start));
    const tokens = [];
    while (true) {
        budget.check();
        const kind = scanner.scan();
        if (kind === ts.SyntaxKind.EndOfFileToken) break;
        const tokenStart = scanner.getTokenPos();
        const tokenEnd = scanner.getTextPos();
        if (TRIVIA_KINDS.has(kind)) continue;
        if (tokens.length >= limits.maxTokensPerSymbol) throw new BudgetExceeded('max-tokens-per-symbol');
        const tokenText = scanner.getTokenText();
        const category = tokenCategory(kind, tokenText);
        tokens.push({ start: tokenStart, end: tokenEnd, kind, text: tokenText, category,
            key: `${category}:${tokenText}` });
    }
    return tokens;
}

function rangeKey(start, end) {
    return `${start}:${end}`;
}

function buildNodeIndex(sourceFile, budget) {
    const index = new Map();
    function visit(node) {
        budget.check();
        const start = node.getStart(sourceFile);
        const key = rangeKey(start, node.end);
        const bucket = index.get(key);
        if (bucket) bucket.push(node);
        else index.set(key, [node]);
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return index;
}

function nodeForEntry(entry, nodeIndex) {
    const nodes = nodeIndex.get(rangeKey(entry.start, entry.end)) || [];
    const expected = new Set(EXPECTED_NODE_KINDS.get(entry.kind) || []);
    return nodes.find(node => expected.has(node.kind)) || nodes[0] || null;
}

function registrationOptions(node) {
    if (!node || !ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return null;
    const call = node.expression;
    if (!ts.isIdentifier(call.expression) || call.expression.text !== 'registerType' || call.arguments.length !== 2) return null;
    return call.arguments[1];
}

function nodeName(node, entry) {
    if (!node) return null;
    const options = registrationOptions(node);
    if (options) return node.expression.arguments[0] || null;
    if (node.name && !ts.isComputedPropertyName(node.name)) return node.name;
    if (entry.kind === 'constructor') return null;
    return null;
}

function braceBodyRange(tokens, start, end) {
    const open = tokens.find(token => token.text === '{' && token.start >= start && token.end <= end);
    if (!open) return { start, end };
    let close = null;
    for (let index = tokens.length - 1; index >= 0; index--) {
        const token = tokens[index];
        if (token.text === '}' && token.start >= open.end && token.end <= end) {
            close = token;
            break;
        }
    }
    return close ? { start: open.end, end: close.start } : { start: open.end, end };
}

function bodyRangeFor(node, entry, tokens) {
    if (!node) return braceBodyRange(tokens, entry.start, entry.end);
    if (typeof ts.isFunctionLike === 'function' && ts.isFunctionLike(node) && node.body) {
        return { start: node.body.getStart(), end: node.body.end };
    }
    if (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
        if (node.initializer) return { start: node.initializer.getStart(), end: node.initializer.end };
    }
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) {
        const members = node.members;
        if (members && Number.isInteger(members.pos) && Number.isInteger(members.end)) {
            return { start: members.pos, end: members.end };
        }
        return braceBodyRange(tokens, entry.start, entry.end);
    }
    if (ts.isTypeAliasDeclaration(node) && node.type) {
        return { start: node.type.getStart(), end: node.type.end };
    }
    const options = registrationOptions(node);
    if (options) return { start: options.getStart(), end: options.end };
    return braceBodyRange(tokens, entry.start, entry.end);
}

function astHistogram(node, budget, maxFeatures) {
    const counts = new Map();
    let features = 0;
    if (!node) return counts;
    function visit(current) {
        budget.check();
        if (++features > maxFeatures) throw new BudgetExceeded('max-features-per-symbol');
        const kind = current.kind;
        if (!IDENTIFIER_KINDS.has(kind) && !LITERAL_KINDS.has(kind)) {
            const name = ts.SyntaxKind[kind] || String(kind);
            counts.set(name, (counts.get(name) || 0) + 1);
        }
        ts.forEachChild(current, visit);
    }
    visit(node);
    return counts;
}

function countTokens(tokens) {
    const counts = new Map();
    for (const token of tokens) counts.set(token.key, (counts.get(token.key) || 0) + 1);
    return counts;
}

function meaningfulTokens(tokens) {
    return tokens.filter(token => !(token.category === 'punctuation'
        && ['{', '}', '(', ')', '[', ']', ';', ',', '.'].includes(token.text)));
}

function filterHeaderTokens(tokens, nameStart, nameEnd) {
    return tokens.filter(token => !(nameStart !== null && token.start >= nameStart && token.end <= nameEnd)
        && !(token.category === 'keyword' && HEADER_MODIFIERS.has(token.text)));
}

function makeFeature(entry, sourceFile, nodeIndex, text, filePath, limits, budget) {
    budget.check();
    const node = nodeForEntry(entry, nodeIndex);
    const tokens = scanTokens(text, entry.start, entry.end, filePath, limits, budget);
    const contextTokens = entry.declarationContext ? scanTokens(entry.declarationContext, 0,
        entry.declarationContext.length, filePath, limits, budget) : [];
    if (tokens.length + contextTokens.length > limits.maxTokensPerSymbol) {
        throw new BudgetExceeded('max-tokens-per-symbol');
    }
    const name = nodeName(node, entry);
    const nameStart = name ? name.getStart(sourceFile) : null;
    const nameEnd = name ? name.end : null;
    const body = bodyRangeFor(node, entry, tokens);
    const headerTokens = filterHeaderTokens([
        ...contextTokens,
        ...tokens.filter(token => token.start < body.start)
    ], nameStart, nameEnd);
    let bodyTokens = tokens.filter(token => token.start >= body.start && token.end <= body.end);
    if (!bodyTokens.length) bodyTokens = filterHeaderTokens(tokens, nameStart, nameEnd);
    const ast = astHistogram(node, budget, limits.maxTokensPerSymbol);
    const allTokens = [...contextTokens, ...tokens];
    return {
        entry,
        node,
        tokens: allTokens,
        headerTokens,
        bodyTokens,
        headerKeys: headerTokens.map(token => token.key),
        bodyKeys: bodyTokens.map(token => token.key),
        fullCounts: countTokens(allTokens),
        headerCounts: countTokens(headerTokens),
        bodyCounts: countTokens(bodyTokens),
        ast,
        meaningfulBodyCount: meaningfulTokens(bodyTokens).length,
        meaningfulFullCount: meaningfulTokens(allTokens).length,
        bodyTokenCount: bodyTokens.length,
        literalOrOperatorCount: bodyTokens.filter(token => token.category === 'literal' || token.category === 'operator').length
    };
}

function pythonFeature(entry, limits, budget) {
    budget.check();
    const data = entry.strandFeatures;
    if (data?.version !== 1 || !Array.isArray(data.headerTokens) || !Array.isArray(data.bodyTokens)
        || !data.ast || typeof data.ast !== 'object' || Array.isArray(data.ast)) throw new Error('invalid-python-features');
    const headerTokens = data.headerTokens, bodyTokens = data.bodyTokens;
    if (headerTokens.length + bodyTokens.length > limits.maxTokensPerSymbol) throw new BudgetExceeded('max-tokens-per-symbol');
    const tokens = [...headerTokens, ...bodyTokens];
    for (const token of tokens) {
        budget.check();
        if (!token || typeof token.key !== 'string' || typeof token.text !== 'string'
            || !['identifier', 'keyword', 'literal', 'operator', 'punctuation'].includes(token.category)
            || token.key !== `${token.category}:${token.text}`) throw new Error('invalid-python-features');
    }
    const ast = new Map(Object.entries(data.ast));
    let astSize = 0;
    for (const count of ast.values()) {
        if (!Number.isSafeInteger(count) || count < 1) throw new Error('invalid-python-features');
        astSize += count;
    }
    if (astSize > limits.maxTokensPerSymbol) throw new BudgetExceeded('max-features-per-symbol');
    return { entry, tokens, headerTokens, bodyTokens,
        headerKeys: headerTokens.map(t => t.key), bodyKeys: bodyTokens.map(t => t.key),
        fullCounts: countTokens(tokens), headerCounts: countTokens(headerTokens), bodyCounts: countTokens(bodyTokens), ast,
        meaningfulBodyCount: meaningfulTokens(bodyTokens).length, meaningfulFullCount: meaningfulTokens(tokens).length };
}

function multisetDice(left, right) {
    const leftTotal = [...left.values()].reduce((sum, value) => sum + value, 0);
    const rightTotal = [...right.values()].reduce((sum, value) => sum + value, 0);
    if (!leftTotal && !rightTotal) return 1;
    if (!leftTotal || !rightTotal) return 0;
    let common = 0;
    for (const [key, count] of left) common += Math.min(count, right.get(key) || 0);
    return (2 * common) / (leftTotal + rightTotal);
}

function lcsLength(left, right) {
    let previous = new Uint16Array(right.length + 1);
    for (let i = 1; i <= left.length; i++) {
        const current = new Uint16Array(right.length + 1);
        for (let j = 1; j <= right.length; j++) {
            current[j] = left[i - 1] === right[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
        }
        previous = current;
    }
    return previous[right.length];
}

function sequenceSimilarity(left, right) {
    if (!left.length && !right.length) return 1;
    if (!left.length || !right.length) return 0;
    if (left.length === right.length && left.every((token, index) => token === right[index])) return 1;
    const lcs = left.length * right.length <= 65536
        ? lcsLength(left, right)
        : left.reduce((count, token, index) => count + (token === right[index] ? 1 : 0), 0);
    return (2 * lcs) / (left.length + right.length);
}

function symmetricTokenDifference(left, right, category) {
    const counts = new Map();
    for (const token of left) if (token.category === category) counts.set(token.key, (counts.get(token.key) || 0) + 1);
    for (const token of right) if (token.category === category) counts.set(token.key, (counts.get(token.key) || 0) - 1);
    return [...counts.values()].reduce((sum, value) => sum + Math.abs(value), 0);
}

function compareFeatures(left, right) {
    const bodyDice = multisetDice(left.bodyCounts, right.bodyCounts);
    const bodyOrder = sequenceSimilarity(left.bodyKeys, right.bodyKeys);
    const astDice = multisetDice(left.ast, right.ast);
    const headerDice = multisetDice(left.headerCounts, right.headerCounts);
    const headerOrder = sequenceSimilarity(left.headerKeys, right.headerKeys);
    const bodySimilarity = 0.62 * bodyDice + 0.23 * bodyOrder + 0.15 * astDice;
    const headerSimilarity = 0.65 * headerDice + 0.35 * headerOrder;
    const literalOrOperatorChanges = symmetricTokenDifference(left.bodyTokens, right.bodyTokens, 'literal')
        + symmetricTokenDifference(left.bodyTokens, right.bodyTokens, 'operator');
    return { bodySimilarity, headerSimilarity, astSimilarity: astDice, literalOrOperatorChanges };
}

function roundScore(value) {
    return Math.round(Math.max(0, Math.min(1, value)) * 10000) / 10000;
}

function ancestryData(entries) {
    const byQualified = new Map();
    for (const entry of entries) {
        const key = `${entry.path}\u0000${entry.qualifiedName}`;
        byQualified.set(key, [...(byQualified.get(key) || []), entry]);
    }
    const info = new Map();
    function get(entry) {
        if (info.has(entry.id)) return info.get(entry.id);
        const chain = [];
        let current = entry;
        const seen = new Set();
        let local = true;
        let parentEntry = null;
        while (current) {
            if (seen.has(current.id)) { local = false; break; }
            seen.add(current.id);
            const currentKey = `${current.path}\u0000${current.qualifiedName}`;
            const currentMatches = byQualified.get(currentKey) || [];
            if (currentMatches.length !== 1) local = false;
            chain.push([current.kind, current.name]);
            if (!current.parent) break;
            const parents = byQualified.get(`${current.path}\u0000${current.parent}`) || [];
            if (parents.length !== 1) { local = false; break; }
            if (!parentEntry) parentEntry = parents[0];
            current = parents[0];
        }
        const depth = Math.max(0, chain.length - 1);
        const value = { entry, depth, parentEntry, localKey: local ? JSON.stringify([entry.path, chain]) : null };
        info.set(entry.id, value);
        return value;
    }
    for (const entry of entries) get(entry);
    for (const value of info.values()) {
        value.parentUnique = !value.entry.parent || !!(value.parentEntry && info.get(value.parentEntry.id)?.localKey);
    }
    return info;
}

function kindCompatible(source, destination) {
    return source.kind === destination.kind && languageFor(source.path) === languageFor(destination.path);
}

function sameFileIdentity(sourceInfo, destinationInfo) {
    return !!sourceInfo.localKey && sourceInfo.localKey === destinationInfo.localKey;
}

function parentPair(sourceInfo, destinationInfo, acceptedPairs) {
    if (!sourceInfo.parentUnique || !destinationInfo.parentUnique) return false;
    if (!sourceInfo.parentEntry && !destinationInfo.parentEntry) return true;
    if (!sourceInfo.parentEntry || !destinationInfo.parentEntry) return false;
    return acceptedPairs.has(`${sourceInfo.parentEntry.id}\u0000${destinationInfo.parentEntry.id}`);
}

function candidateScore(sourceFeature, destinationFeature, sourceInfo, destinationInfo, localIdentity, parentSupported) {
    const compared = compareFeatures(sourceFeature, destinationFeature);
    const sameName = sourceFeature.entry.name === destinationFeature.entry.name;
    const samePath = sourceFeature.entry.path === destinationFeature.entry.path;
    const sameParentName = (sourceFeature.entry.parent || null) === (destinationFeature.entry.parent || null);
    let score = 0.55 * compared.bodySimilarity + 0.18 * compared.headerSimilarity
        + 0.10 * compared.astSimilarity + 0.06 * (sameName ? 1 : 0)
        + 0.04 * (samePath ? 1 : 0) + 0.07 * (sameParentName || parentSupported ? 1 : 0);
    if (localIdentity) score = Math.max(score, 0.96 + 0.04 * compared.bodySimilarity);
    return {
        source: sourceFeature.entry,
        destination: destinationFeature.entry,
        sourceInfo,
        destinationInfo,
        score: Math.max(0, Math.min(1, score)),
        ...compared,
        localIdentity,
        parentSupported,
        sameName,
        samePath,
        viable: false,
        id: `${sourceFeature.entry.id}\u0000${destinationFeature.entry.id}`
    };
}

function candidateIsSubstantive(candidate, sourceFeature, destinationFeature) {
    if (candidate.localIdentity) return true;
    if (sourceFeature.meaningfulBodyCount >= 4 && destinationFeature.meaningfulBodyCount >= 4) return true;
    const complexKind = ['class', 'registration', 'interface', 'type', 'enum'].includes(candidate.source.kind);
    if (complexKind && sourceFeature.meaningfulFullCount >= 5 && destinationFeature.meaningfulFullCount >= 5) return true;
    // A method/accessor can be short while its parent correspondence supplies
    // the missing scope evidence. Top-level tiny functions do not get this
    // exception.
    return candidate.parentSupported && candidate.source.parent && candidate.destination.parent
        && candidate.sameName && sourceFeature.meaningfulBodyCount >= 2 && destinationFeature.meaningfulBodyCount >= 2;
}

function sortEntries(entries, info) {
    return [...entries].sort((left, right) => {
        const leftInfo = info.get(left.id), rightInfo = info.get(right.id);
        return (leftInfo.depth - rightInfo.depth) || left.path.localeCompare(right.path)
            || left.start - right.start || left.end - right.end || left.id.localeCompare(right.id);
    });
}

function byIdOrder(entries) {
    return new Map(entries.map((entry, index) => [entry.id, index]));
}

function bestRankings(candidates) {
    const bySource = new Map(), byDestination = new Map();
    for (const candidate of candidates) {
        if (!candidate.viable) continue;
        if (!bySource.has(candidate.source.id)) bySource.set(candidate.source.id, []);
        if (!byDestination.has(candidate.destination.id)) byDestination.set(candidate.destination.id, []);
        bySource.get(candidate.source.id).push(candidate);
        byDestination.get(candidate.destination.id).push(candidate);
    }
    const sort = list => list.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
    for (const list of bySource.values()) sort(list);
    for (const list of byDestination.values()) sort(list);
    return { bySource, byDestination };
}

function marginFor(list) {
    if (!list || !list.length) return 0;
    return list.length > 1 ? list[0].score - list[1].score : list[0].score;
}

function tiedBest(list, candidate) {
    return !!list?.length && Math.abs(list[0].score - candidate.score) <= SCORE_EPSILON;
}

function ambiguousEdges(candidates, rankings) {
    const out = new Set();
    for (const candidate of candidates) {
        if (!candidate.viable) continue;
        const sourceRank = rankings.bySource.get(candidate.source.id) || [];
        const destinationRank = rankings.byDestination.get(candidate.destination.id) || [];
        const sourceAmbiguous = (sourceRank.length > 1 && sourceRank[0].score - sourceRank[1].score <= SCORE_EPSILON)
            || marginFor(sourceRank) < MIN_MARGIN;
        const destinationAmbiguous = (destinationRank.length > 1 && destinationRank[0].score - destinationRank[1].score <= SCORE_EPSILON)
            || marginFor(destinationRank) < MIN_MARGIN;
        if (sourceAmbiguous || destinationAmbiguous) out.add(candidate.id);
    }
    return out;
}

function ambiguityGroups(candidates, ambiguous, entryOrder, budget, rankings) {
    const bySource = new Map(), byDestination = new Map();
    for (const candidate of candidates) {
        if (!ambiguous.has(candidate.id)) continue;
        if (!bySource.has(candidate.source.id)) bySource.set(candidate.source.id, []);
        if (!byDestination.has(candidate.destination.id)) byDestination.set(candidate.destination.id, []);
        bySource.get(candidate.source.id).push(candidate);
        byDestination.get(candidate.destination.id).push(candidate);
    }
    const visited = new Set(), groups = [];
    const ordered = [...candidates].filter(candidate => ambiguous.has(candidate.id))
        .sort((left, right) => left.id.localeCompare(right.id));
    for (const first of ordered) {
        if (visited.has(first.id)) continue;
        const queue = [first], component = [], sourceIds = new Set(), destinationIds = new Set();
        visited.add(first.id);
        for (let index = 0; index < queue.length; index++) {
            budget.check();
            const current = queue[index];
            component.push(current);
            const neighbors = [
                ...(sourceIds.has(current.source.id) ? [] : bySource.get(current.source.id) || []),
                ...(destinationIds.has(current.destination.id) ? [] : byDestination.get(current.destination.id) || [])
            ];
            sourceIds.add(current.source.id);
            destinationIds.add(current.destination.id);
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor.id)) { visited.add(neighbor.id); queue.push(neighbor); }
            }
        }
        const bestScore = component.reduce((best, candidate) => Math.max(best, candidate.score), 0);
        const margins = component.map(candidate => Math.min(
            marginFor(rankings.bySource.get(candidate.source.id)),
            marginFor(rankings.byDestination.get(candidate.destination.id))));
        const componentSources = [...sourceIds].sort((left, right) => (entryOrder.before.get(left) ?? 0) - (entryOrder.before.get(right) ?? 0));
        const componentDestinations = [...destinationIds].sort((left, right) => (entryOrder.after.get(left) ?? 0) - (entryOrder.after.get(right) ?? 0));
        budget.record();
        groups.push({
            reason: languageFor(component[0].source.path) === 'python' ? 'ambiguous-python-candidates' : 'ambiguous-js-candidates',
            sources: componentSources,
            destinations: componentDestinations,
            evidence: {
                candidateCount: component.length,
                bestScore: roundScore(bestScore),
                minimumMargin: roundScore(margins.reduce((smallest, margin) => Math.min(smallest, margin), 1)),
                depth: component[0].sourceInfo.depth,
                crossFile: component.some(candidate => candidate.source.path !== candidate.destination.path)
            }
        });
    }
    return groups;
}

function spanFor(entry, files) {
    const text = files[entry.path].slice(entry.start, entry.end);
    return {
        path: entry.path,
        name: entry.name,
        kind: entry.kind,
        start: entry.start,
        end: entry.end,
        text,
        sha256: digest(text),
        valid: true
    };
}

function mapperFor(candidate, files, sourceRunnerUp, destinationRunnerUp) {
    const id = digest(JSON.stringify(['bygone-strand-v1', candidate.source.id, candidate.destination.id]));
    const runnerUp = Math.max(sourceRunnerUp || 0, destinationRunnerUp || 0);
    const strategy = candidate.localIdentity ? 'same-file-ancestry'
        : 'token-body-mutual-best';
    return {
        id,
        category: 'inventory',
        source: spanFor(candidate.source, files.before),
        destination: spanFor(candidate.destination, files.after),
        origins: ['continuation'],
        mappings: [],
        match: {
            strategy,
            score: roundScore(candidate.score),
            runnerUp: roundScore(runnerUp),
            bodySimilarity: roundScore(candidate.bodySimilarity),
            headerSimilarity: roundScore(candidate.headerSimilarity),
            astSimilarity: roundScore(candidate.astSimilarity),
            literalOrOperatorChanges: Math.min(100, candidate.literalOrOperatorChanges),
            sameFile: candidate.samePath,
            sameName: candidate.sameName,
            parentScoped: !!candidate.parentSupported && !!candidate.sourceInfo.parentEntry
        }
    };
}

function rejectedFor(candidate, reason, sourceRunnerUp, destinationRunnerUp) {
    const runnerUp = Math.max(sourceRunnerUp || 0, destinationRunnerUp || 0);
    return {
        sourceId: candidate.source.id,
        destinationId: candidate.destination.id,
        reason,
        score: roundScore(candidate.score),
        runnerUp: roundScore(runnerUp)
    };
}

function sourceDocuments(files, inventory, python) {
    const documents = Array.isArray(inventory?.documents) ? inventory.documents : [];
    const byPath = new Map(documents.map(document => [document.path, document]));
    return Object.keys(files).filter(path => isJavaScriptPath(path) || (python && /\.py$/.test(path))).sort().map(path => ({
        path,
        status: byPath.get(path)?.status || 'unknown'
    }));
}

function prepareSide(files, inventory, side, limits, budget, python) {
    const documents = sourceDocuments(files, inventory, python);
    const complete = documents.filter(document => document.status === 'complete').map(document => document.path);
    const invalid = documents.filter(document => document.status === 'invalid').map(document => document.path);
    const unknown = documents.filter(document => document.status !== 'complete' && document.status !== 'invalid');
    if (unknown.length) throw new Error(`invalid-${side}-inventory`);
    const entries = (inventory.entries || []).filter(entry => complete.includes(entry.path)
        && Number.isInteger(entry.start) && Number.isInteger(entry.end)
        && entry.start >= 0 && entry.end > entry.start && entry.end <= files[entry.path].length);
    const info = ancestryData(entries);
    const features = new Map();
    const parsedPaths = [];
    for (const path of complete) {
        budget.check();
        if (languageFor(path) === 'python') {
            for (const entry of entries.filter(candidate => candidate.path === path)) {
                features.set(entry.id, pythonFeature(entry, limits, budget));
            }
            parsedPaths.push(path);
            continue;
        }
        const text = files[path];
        const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindFor(path));
        if (sourceFile.parseDiagnostics.length) {
            invalid.push(path);
            continue;
        }
        const nodeIndex = buildNodeIndex(sourceFile, budget);
        for (const entry of entries.filter(candidate => candidate.path === path)
            .sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id))) {
            features.set(entry.id, makeFeature(entry, sourceFile, nodeIndex, text, path, limits, budget));
        }
        parsedPaths.push(path);
    }
    return { entries, info, features, parsedPaths, invalid: [...new Set(invalid)].sort() };
}

function matchDeclarations(before, after, inventories, limits = {}, python = false) {
    const normalizedLimits = normalizeLimits(limits);
    if (!normalizedLimits) return result('unavailable', { before: [], after: [] }, { reason: 'invalid-limits' });
    if (!before || !after || typeof before !== 'object' || typeof after !== 'object'
        || Array.isArray(before) || Array.isArray(after)
        || Object.values(before).some(value => typeof value !== 'string')
        || Object.values(after).some(value => typeof value !== 'string')) {
        return result('unavailable', { before: [], after: [] }, { reason: 'invalid-input' });
    }
    if (!inventories?.before || !inventories?.after || !Array.isArray(inventories.before.entries)
        || !Array.isArray(inventories.after.entries)) {
        return result('unavailable', { before: [], after: [] }, { reason: 'invalid-inventories' });
    }

    const budget = new Budget(normalizedLimits);
    let left, right;
    try {
        left = prepareSide(before, inventories.before, 'before', normalizedLimits, budget, python);
        right = prepareSide(after, inventories.after, 'after', normalizedLimits, budget, python);
    } catch (error) {
        if (error instanceof BudgetExceeded) {
            return result('partial', { before: left?.parsedPaths || [], after: right?.parsedPaths || [] }, {
                reason: `budget-${error.reason}`, truncated: true
            });
        }
        return result('unavailable', { before: left?.parsedPaths || [], after: right?.parsedPaths || [] }, {
            reason: error.message === 'invalid-before-inventory' || error.message === 'invalid-after-inventory'
                ? error.message : error.message === 'invalid-python-features' ? 'invalid-python-features' : 'strand-parse-failed'
        });
    }

    const processedPaths = { before: left.parsedPaths, after: right.parsedPaths };
    const hasSupportedDocument = processedPaths.before.length || processedPaths.after.length;
    if (!hasSupportedDocument) {
        const invalid = [...left.invalid, ...right.invalid];
        return result(invalid.length ? 'partial' : 'unavailable', processedPaths, {
            reason: invalid.length ? 'parse-failed' : 'no-supported-documents'
        });
    }

    const allDepths = [...new Set([...left.entries, ...right.entries].map(entry =>
        (left.info.get(entry.id) || right.info.get(entry.id)).depth))].sort((a, b) => a - b);
    const acceptedPairs = new Set();
    const acceptedSourceIds = new Set();
    const acceptedDestinationIds = new Set();
    const mappers = [];
    const unresolved = [];
    const rejectedCandidates = [];
    const entryOrder = { before: byIdOrder(sortEntries(left.entries, left.info)), after: byIdOrder(sortEntries(right.entries, right.info)) };
    const files = { before, after };
    try {
        for (const depth of allDepths) {
            budget.check();
            const sources = sortEntries(left.entries.filter(entry => left.info.get(entry.id).depth === depth), left.info);
            const destinations = sortEntries(right.entries.filter(entry => right.info.get(entry.id).depth === depth), right.info);
            const candidates = [];
            for (const source of sources) {
                const sourceFeature = left.features.get(source.id);
                if (!sourceFeature) continue;
                for (const destination of destinations) {
                    budget.comparison();
                    if (!kindCompatible(source, destination)) continue;
                    const sourceInfo = left.info.get(source.id), destinationInfo = right.info.get(destination.id);
                    const parentSupported = parentPair(sourceInfo, destinationInfo, acceptedPairs);
                    if (source.parent || destination.parent) {
                        if (!parentSupported) continue;
                    }
                    const destinationFeature = right.features.get(destination.id);
                    if (!destinationFeature) continue;
                    const localIdentity = sameFileIdentity(sourceInfo, destinationInfo);
                    const candidate = candidateScore(sourceFeature, destinationFeature, sourceInfo, destinationInfo,
                        localIdentity, parentSupported);
                    candidate.viable = candidate.score >= MIN_SCORE
                        && candidateIsSubstantive(candidate, sourceFeature, destinationFeature);
                    candidates.push(candidate);
                }
            }
            const rankings = bestRankings(candidates);
            const ambiguous = ambiguousEdges(candidates, rankings);
            const groups = ambiguityGroups(candidates, ambiguous, entryOrder, budget, rankings);
            unresolved.push(...groups);

            const acceptedAtDepth = [];
            for (const candidate of candidates.filter(candidate => candidate.viable)
                .sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score
                    || leftCandidate.id.localeCompare(rightCandidate.id))) {
                const sourceRank = rankings.bySource.get(candidate.source.id) || [];
                const destinationRank = rankings.byDestination.get(candidate.destination.id) || [];
                const sourceBest = tiedBest(sourceRank, candidate);
                const destinationBest = tiedBest(destinationRank, candidate);
                const sourceMargin = marginFor(sourceRank), destinationMargin = marginFor(destinationRank);
                const canAccept = candidate.localIdentity
                    || (sourceBest && destinationBest && sourceMargin >= MIN_MARGIN && destinationMargin >= MIN_MARGIN);
                if (!canAccept || acceptedSourceIds.has(candidate.source.id) || acceptedDestinationIds.has(candidate.destination.id)) continue;
                acceptedAtDepth.push({ candidate, sourceMargin, destinationMargin });
                acceptedSourceIds.add(candidate.source.id);
                acceptedDestinationIds.add(candidate.destination.id);
                acceptedPairs.add(candidate.id);
            }
            for (const accepted of acceptedAtDepth) {
                budget.record();
                mappers.push(mapperFor(accepted.candidate, files, accepted.sourceMargin ? accepted.candidate.score - accepted.sourceMargin : 0,
                    accepted.destinationMargin ? accepted.candidate.score - accepted.destinationMargin : 0));
            }

            const ambiguousIds = new Set(ambiguous);
            for (const candidate of candidates) {
                if (acceptedPairs.has(candidate.id)) continue;
                let reason;
                const sourceRank = rankings.bySource.get(candidate.source.id) || [];
                const destinationRank = rankings.byDestination.get(candidate.destination.id) || [];
                if (!candidate.viable) {
                    if (candidate.score >= MIN_SCORE * 0.8 || candidate.sameName) reason = 'weak-coincidence';
                } else if (ambiguousIds.has(candidate.id)) reason = 'ambiguous-candidates';
                else if (!tiedBest(sourceRank, candidate) || !tiedBest(destinationRank, candidate)) reason = 'not-mutual-best';
                else if (marginFor(sourceRank) < MIN_MARGIN || marginFor(destinationRank) < MIN_MARGIN) reason = 'insufficient-competitor-margin';
                if (!reason) continue;
                budget.record();
                rejectedCandidates.push(rejectedFor(candidate, reason,
                    sourceRank.length > 1 ? sourceRank[1].score : 0,
                    destinationRank.length > 1 ? destinationRank[1].score : 0));
            }
        }
    } catch (error) {
        if (error instanceof BudgetExceeded) {
            return result('partial', processedPaths, { reason: `budget-${error.reason}`, truncated: true });
        }
        return result('unavailable', processedPaths, { reason: 'javascript-matcher-failed' });
    }

    const invalid = [...left.invalid, ...right.invalid];
    const status = invalid.length ? 'partial' : 'complete';
    const reason = invalid.length ? 'parse-failed' : undefined;
    mappers.sort((leftMapper, rightMapper) => leftMapper.source.path.localeCompare(rightMapper.source.path)
        || leftMapper.source.start - rightMapper.source.start || leftMapper.id.localeCompare(rightMapper.id));
    unresolved.sort((leftGroup, rightGroup) => JSON.stringify(leftGroup.sources).localeCompare(JSON.stringify(rightGroup.sources))
        || JSON.stringify(leftGroup.destinations).localeCompare(JSON.stringify(rightGroup.destinations)));
    rejectedCandidates.sort((leftCandidate, rightCandidate) => leftCandidate.sourceId.localeCompare(rightCandidate.sourceId)
        || leftCandidate.destinationId.localeCompare(rightCandidate.destinationId)
        || leftCandidate.reason.localeCompare(rightCandidate.reason));
    return result(status, processedPaths, { reason, mappers, unresolved, rejectedCandidates });
}

function matchJavaScript(before, after, inventories, limits) {
    return matchDeclarations(before, after, inventories, limits);
}

function matchStrand(before, after, inventories, limits) {
    return matchDeclarations(before, after, inventories, limits, true);
}

module.exports = { matchJavaScript, matchStrand, DEFAULT_LIMITS };
