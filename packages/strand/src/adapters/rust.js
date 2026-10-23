'use strict';

const DECLARATIONS = new Map([
    ['struct_item', { kind: 'struct', name: 'name', body: 'body' }],
    ['enum_item', { kind: 'enum', name: 'name', body: 'body' }],
    ['trait_item', { kind: 'trait', name: 'name', body: 'body' }],
    ['mod_item', { kind: 'module', name: 'name', body: 'body' }],
    ['type_item', { kind: 'type', name: 'name', body: 'type' }],
    ['const_item', { kind: 'const', name: 'name', body: 'value' }],
    ['static_item', { kind: 'static', name: 'name', body: 'value' }]
]);

const EXCLUSIONS = new Map([
    ['closure_expression', 'rust-anonymous-closure'],
    ['macro_definition', 'rust-macro-definition-not-expanded'],
    ['macro_invocation', 'rust-macro-invocation-not-expanded']
]);

const field = (node, name) => node.childForFieldName(name);
const compact = node => node?.text?.replace(/\s+/gu, ' ').trim() || '';
const inheritedScope = parent => parent?.kind === 'impl' || parent?.kind === 'trait'
    ? parent.scopeIdentity || parent.name : 'rust';

function implName(typeNode, traitNode) {
    const type = compact(typeNode);
    const trait = compact(traitNode);
    if (trait && type) return `impl ${trait} for ${type}`;
    if (type) return `impl ${type}`;
    if (trait) return `impl ${trait}`;
    return 'impl';
}

function declaration(kind, nameNode, body, extra = {}) {
    if (!nameNode) return null;
    return { nameNode, kind, body, scopeIdentity: 'rust', ...extra };
}

function describeDeclaration(node, { parent } = {}) {
    if (!node) return null;
    const exclusion = EXCLUSIONS.get(node.type);
    if (exclusion) return { skip: true, reason: exclusion };

    if (node.type === 'function_item' || node.type === 'function_signature_item') {
        const nameNode = field(node, 'name');
        const method = parent?.kind === 'impl' || parent?.kind === 'trait';
        return declaration(method ? 'method' : 'function', nameNode, field(node, 'body'), {
            callable: true, scopeIdentity: inheritedScope(parent)
        });
    }

    if (node.type === 'impl_item') {
        const typeNode = field(node, 'type');
        const traitNode = field(node, 'trait');
        const identity = implName(typeNode, traitNode);
        return declaration('impl', typeNode || traitNode, field(node, 'body'), {
            name: identity, scopeIdentity: identity
        });
    }

    const spec = DECLARATIONS.get(node.type);
    if (!spec) {
        if (node.type === 'associated_type') {
            return declaration('type', field(node, 'name'), field(node, 'value') || field(node, 'type'), {
                scopeIdentity: inheritedScope(parent)
            });
        }
        return null;
    }

    const nameNode = field(node, spec.name);
    const body = field(node, spec.body) || (spec.body === 'value' ? field(node, 'type') : undefined);
    return declaration(spec.kind, nameNode, body, {
        scopeIdentity: spec.kind === 'trait' ? `trait ${nameNode?.text || ''}`.trim() : inheritedScope(parent)
    });
}

// Outer attributes are sibling nodes in Rust's grammar. Include them in the
// exact source span and header features; an attribute edit changes the symbol.
function describe(node, context) {
    const description = describeDeclaration(node, context);
    if (!description?.kind) return description;
    const prefixes = [];
    let previous = node.previousNamedSibling;
    while (previous && ['attribute_item', 'line_comment', 'block_comment'].includes(previous.type)) {
        if (previous.type === 'attribute_item') prefixes.unshift(previous);
        previous = previous.previousNamedSibling;
    }
    return { ...description, prefixes };
}
module.exports = { describe };
