'use strict';

// Go's grammar separates declaration wrappers (type/const/var) from their
// specs. This adapter inventories the named spec rather than manufacturing a
// wrapper span. It is syntax-only: it does not resolve aliases, packages,
// promoted fields, overloads, or interface implementation relationships.
//
// Only single-name const/var/field specs are inventoried. Local bindings and
// unknown receiver types are excluded so a short, repeated declaration cannot
// borrow identity from an unrelated scope. Receiver scopeIdentity deliberately
// collapses pointer/value syntax and clear generic arguments to the named
// receiver type; qualified, composite, or otherwise unclear receiver types
// are excluded rather than matched by a fabricated lexical span.

const field = (node, name) => node?.childForFieldName(name) || null;

function fieldChildren(node, name) {
    if (typeof node?.childrenForFieldName === 'function') return node.childrenForFieldName(name);
    const child = field(node, name);
    return child ? [child] : [];
}

function skip(reason) {
    return { skip: true, reason };
}

function callableParent(parent) {
    return parent?.kind === 'function' || parent?.kind === 'method';
}

function receiverTypeName(node) {
    if (!node) return null;
    if (node.type === 'pointer_type') {
        const children = node.namedChildren || [];
        return children.length === 1 && children[0].type !== 'pointer_type' ? receiverTypeName(children[0]) : null;
    }
    if (node.type === 'type_identifier') return node.text;
    if (node.type === 'generic_type') {
        const base = field(node, 'type');
        return base?.type === 'type_identifier' ? base.text : null;
    }
    return null;
}

function receiverIdentity(node) {
    const receiver = field(node, 'receiver');
    if (!receiver || receiver.type !== 'parameter_list') return null;
    const declarations = (receiver.namedChildren || []).filter(child => child.type === 'parameter_declaration');
    if (declarations.length !== 1) return null;
    const declaration = declarations[0];
    const names = fieldChildren(declaration, 'name');
    if (names.length > 1 || names.some(name => name.type !== 'identifier')) return null;
    return receiverTypeName(field(declaration, 'type'));
}

function specDescription(node, parent, kind, multipleReason, body) {
    if (callableParent(parent)) return skip('go-local-binding');
    const names = fieldChildren(node, 'name');
    if (names.length !== 1 || names[0].type !== 'identifier') return skip(multipleReason);
    return { nameNode: names[0], kind, body, children: [] };
}

function describe(node, { parent } = {}) {
    if (!node) return null;

    if (node.type === 'function_declaration') {
        const nameNode = field(node, 'name');
        return nameNode ? { nameNode, kind: 'function', callable: true, body: field(node, 'body') } : skip('go-malformed-function');
    }

    if (node.type === 'method_declaration') {
        const nameNode = field(node, 'name');
        const receiver = receiverIdentity(node);
        if (!nameNode) return skip('go-malformed-method');
        if (!receiver) return skip('go-unknown-receiver');
        return {
            nameNode,
            // The method has no reliable lexical owner in Go's top-level
            // syntax. Keep the receiver in the name and use scopeIdentity as
            // the strict discriminator between same-named methods.
            name: `${receiver}.${nameNode.text}`,
            kind: 'method',
            callable: true,
            body: field(node, 'body'),
            parent: null,
            scopeIdentity: receiver
        };
    }

    if (node.type === 'type_spec' || node.type === 'type_alias') {
        if (callableParent(parent)) return skip('go-local-type');
        const nameNode = field(node, 'name');
        return nameNode ? { nameNode, kind: 'type', body: field(node, 'type') } : skip('go-malformed-type');
    }

    if (node.type === 'const_spec') {
        return specDescription(node, parent, 'constant', 'go-multiple-constant-names', field(node, 'value') || field(node, 'type'));
    }

    if (node.type === 'var_spec') {
        return specDescription(node, parent, 'variable', 'go-multiple-variable-names', field(node, 'value') || field(node, 'type'));
    }

    if (node.type === 'field_declaration') {
        if (parent?.kind !== 'type') return null;
        const names = fieldChildren(node, 'name');
        if (!names.length) return skip('go-embedded-field');
        if (names.length !== 1) return skip('go-multiple-field-names');
        return { nameNode: names[0], kind: 'property', body: field(node, 'type'), children: [] };
    }

    if (node.type === 'method_elem') {
        if (parent?.kind !== 'type') return null;
        const nameNode = field(node, 'name');
        return nameNode ? { nameNode, kind: 'method', callable: true, children: [] } : skip('go-malformed-interface-method');
    }

    return null;
}

module.exports = { describe };
