const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Parser, Language } = require('web-tree-sitter');
const { TREE_SITTER_LANGUAGES, languageFor } = require('./languages');
const { LIMITS, inputProblem } = require('./input');

const TOKEN_LIMIT = 20000;
const RECORD_LIMIT = 20000;
const operators = /^(?:[-+*/%=<>!&|^~?:]+|and|or|not|in|is)$/;
const ignored = node => /comment/.test(node.type);
const literal = node => /(?:string|character|char_literal|integer|float|number|boolean|true|false|null|nil)/.test(node.type);
function token(node) {
    const text = node.text;
    const category = literal(node) ? 'literal' : /identifier/.test(node.type) ? 'identifier'
        : operators.test(text) ? 'operator' : /^[\p{L}_][\p{L}\p{N}_]*$/u.test(text) ? 'keyword' : 'punctuation';
    return { text, category, key: `${category}:${text}` };
}
function features(node, nameNode, body) {
    const headerTokens = [], bodyTokens = [], ast = {};
    let visited = 0;
    const stack = [node];
    while (stack.length) {
        const current = stack.pop();
        if (++visited > TOKEN_LIMIT) throw new Error('tree-sitter-feature-budget');
        if (ignored(current)) continue;
        if (current.isNamed) ast[current.type] = (ast[current.type] || 0) + 1;
        if (!current.childCount || literal(current)) {
            if (nameNode && current.startIndex === nameNode.startIndex && current.endIndex === nameNode.endIndex) continue;
            const inBody = body && current.startIndex >= body.startIndex && current.endIndex <= body.endIndex;
            (inBody ? bodyTokens : headerTokens).push(token(current));
        } else stack.push(...current.children.reverse());
    }
    // Value/type declarations have no executable body. Their full shape is
    // still useful, as with the existing Python and TS feature producers.
    if (!bodyTokens.length) bodyTokens.push(...headerTokens);
    return { version: 1, headerTokens, bodyTokens, ast };
}

let initialized;
const languages = new Map();
async function loadLanguage(language) {
    const config = TREE_SITTER_LANGUAGES[language];
    if (!config) throw new Error('unsupported-tree-sitter-language');
    initialized ||= Parser.init();
    await initialized;
    if (!languages.has(language)) {
        const file = path.join(__dirname, 'grammars', config.file);
        const bytes = fs.readFileSync(file);
        if (createHash('sha256').update(bytes).digest('hex') !== config.sha256) throw new Error('grammar-digest-mismatch');
        languages.set(language, await Language.load(bytes));
    }
    return languages.get(language);
}

async function parseDocument(text, language, options = {}) {
    const config = TREE_SITTER_LANGUAGES[language];
    const parser = new Parser();
    let tree;
    try {
        parser.setLanguage(await loadLanguage(language));
        tree = parser.parse(text);
        if (!tree || tree.rootNode.hasError) return { status: 'invalid', diagnostics: [{ message: 'tree-sitter-syntax-error' }], entries: [], exclusions: [] };
        const { describe } = require('./adapters/' + config.adapter);
        const entries = [], exclusions = [];
        const stack = [{ node: tree.rootNode, parent: null }];
        let visited = 0;
        while (stack.length) {
            if (++visited > 500000) throw new Error('tree-sitter-node-budget');
            const { node, parent } = stack.pop();
            const description = describe(node, { text, parent });
            if (description?.skip) {
                exclusions.push({ start: node.startIndex, reason: description.reason || 'unsupported-syntax' });
                continue;
            }
            let owner = parent;
            if (description?.kind) {
                if (entries.length >= RECORD_LIMIT) throw new Error('tree-sitter-record-budget');
                const { nameNode, kind, callable = false, body, scopeIdentity } = description;
                const name = description.name || nameNode?.text;
                if (!name || !Number.isInteger(node.startIndex) || node.endIndex > text.length
                    || text.slice(node.startIndex, node.endIndex) !== node.text) throw new Error('tree-sitter-range-mismatch');
                const parentName = Object.hasOwn(description, 'parent') ? description.parent : parent?.qualifiedName || null;
                owner = { name, kind, parent: parentName, qualifiedName: parentName ? `${parentName}.${name}` : name,
                    callable, start: node.startIndex, end: node.endIndex,
                    startLine: node.startPosition.row, endLine: node.endPosition.row + (node.endPosition.column > 0 ? 1 : 0),
                    engineRanges: [], ...(scopeIdentity ? { scopeIdentity } : {}) };
                if (options.strandFeatures) owner.strandFeatures = features(node, nameNode, body);
                entries.push(owner);
            }
            const children = description?.children || node.namedChildren;
            stack.push(...[...children].reverse().map(child => ({ node: child, parent: owner })));
        }
        return { status: 'complete', diagnostics: [], entries, exclusions };
    } finally {
        tree?.delete();
        parser.delete();
    }
}

async function parseSnapshots(files, options = {}) {
    const problem = inputProblem(files, {}, LIMITS);
    if (problem) throw new Error(problem);
    // Initialize before constructing Parser objects, whose allocation needs WASM.
    initialized ||= Parser.init();
    await initialized;
    const documents = Object.create(null);
    for (const file of Object.keys(files).sort()) {
        try { documents[file] = await parseDocument(files[file], languageFor(file), options); }
        catch (error) { documents[file] = { status: 'invalid', diagnostics: [{ message: error.message }], entries: [], exclusions: [] }; }
    }
    const used = [...new Set(Object.keys(files).map(languageFor))].filter(language => TREE_SITTER_LANGUAGES[language]).sort();
    const identity = used.map(language => `${language}@${TREE_SITTER_LANGUAGES[language].sha256}`).join('; ');
    return { parser: 'web-tree-sitter@0.27.1' + (identity ? '; ' + identity : ''), documents };
}
module.exports = { parseSnapshots, loadLanguage, features };
