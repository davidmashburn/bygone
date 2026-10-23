'use strict';

const field = (node, name) => node?.childForFieldName(name) || null;
const skip = reason => ({ skip: true, reason });

const CONTAINERS = new Map([
    ['class_declaration', 'class'],
    ['interface_declaration', 'interface'],
    ['trait_declaration', 'trait'],
    ['enum_declaration', 'enum']
]);
const CONTAINER_KINDS = new Set(CONTAINERS.values());

function namespaceName(node) {
    if (!node || node.type !== 'namespace_name') return null;
    const parts = node.namedChildren || [];
    return parts.length && parts.every(part => part.type === 'name' && part.text)
        ? node.text : null;
}

function enclosingNamespace(node) {
    let current = node?.parent || null;
    while (current) {
        if (current.type === 'namespace_definition') return current;
        current = current.parent || null;
    }

    // Unbracketed namespaces do not own their following declarations in the
    // syntax tree. Find the nearest root-level namespace region instead.
    let root = node || null;
    while (root?.parent && root.parent.type !== 'program') root = root.parent;
    if (!root?.parent || root.parent.type !== 'program') return null;
    let previous = root.previousNamedSibling || null;
    while (previous) {
        if (previous.type === 'namespace_definition') {
            // A bracketed namespace ends at its closing brace; declarations
            // after it are global (or in a later namespace), not its children.
            return field(previous, 'body') ? null : previous;
        }
        previous = previous.previousNamedSibling || null;
    }
    return null;
}

function namespaceParent(node, parent) {
    if (parent?.kind === 'namespace') return parent.qualifiedName;
    if (parent) return null;
    return namespaceName(field(enclosingNamespace(node), 'name'));
}

function namespaceScope(node, parent) {
    if (parent?.scopeIdentity?.startsWith('php-namespace:')) return parent.scopeIdentity;
    const namespace = node?.type === 'namespace_definition' ? node : enclosingNamespace(node);
    const name = namespaceName(field(namespace, 'name'));
    return name ? `php-namespace:${name}` : 'php-global';
}

function withNamespace(description, node, parent) {
    const owner = namespaceParent(node, parent);
    return owner && !parent ? { ...description, parent: owner } : description;
}

function allowedNamespaceLevel(parent) {
    return !parent || parent.kind === 'namespace';
}

function constElement(node) {
    const elements = (node.namedChildren || []).filter(child => child.type === 'const_element');
    if (elements.length !== 1) return { skip: 'php-multiple-constants' };
    const children = elements[0].namedChildren || [];
    if (children.length !== 2 || children[0].type !== 'name') return { skip: 'php-unsupported-constant' };
    return { nameNode: children[0], body: children[1] };
}

function describe(node, { parent } = {}) {
    if (!node) return null;

    if (node.type === 'anonymous_class') return skip('php-anonymous-class');
    if (['anonymous_function', 'arrow_function'].includes(node.type)) return skip('php-anonymous-closure');
    if (node.type === 'property_promotion_parameter') return skip('php-promoted-property');

    if (node.type === 'namespace_definition') {
        const nameNode = field(node, 'name');
        if (!namespaceName(nameNode)) return skip('php-anonymous-namespace');
        return { nameNode, kind: 'namespace', body: field(node, 'body'), scopeIdentity: namespaceScope(node, parent) };
    }

    if (CONTAINERS.has(node.type)) {
        if (parent?.callable) return skip('php-local-declaration');
        if (parent && parent.kind !== 'namespace') return skip('php-local-declaration');
        const nameNode = field(node, 'name');
        if (!nameNode?.text || nameNode.type !== 'name') return skip('php-malformed-declaration');
        return withNamespace({
            nameNode,
            kind: CONTAINERS.get(node.type),
            body: field(node, 'body'),
            scopeIdentity: namespaceScope(node, parent)
        }, node, parent);
    }

    if (node.type === 'function_definition') {
        if (parent?.callable) return skip('php-local-declaration');
        if (parent && parent.kind !== 'namespace') return skip('php-nested-function');
        const nameNode = field(node, 'name');
        if (!nameNode?.text || nameNode.type !== 'name') return skip('php-malformed-function');
        return withNamespace({
            nameNode,
            kind: 'function',
            callable: true,
            body: field(node, 'body'),
            scopeIdentity: namespaceScope(node, parent)
        }, node, parent);
    }

    if (node.type === 'method_declaration') {
        if (!CONTAINER_KINDS.has(parent?.kind)) return skip(parent?.callable
            ? 'php-local-declaration' : 'php-unowned-method');
        const nameNode = field(node, 'name');
        if (!nameNode?.text || nameNode.type !== 'name') return skip('php-malformed-method');
        return {
            nameNode,
            kind: 'method',
            callable: true,
            body: field(node, 'body'),
            scopeIdentity: namespaceScope(node, parent)
        };
    }

    if (node.type === 'property_declaration') {
        if (parent?.callable) return skip('php-local-binding');
        if (!CONTAINER_KINDS.has(parent?.kind)) return skip('php-unowned-property');
        if ((node.namedChildren || []).some(child => child.type === 'property_hook_list')) {
            return skip('php-property-hook');
        }
        const elements = (node.namedChildren || []).filter(child => child.type === 'property_element');
        if (elements.length !== 1) return skip('php-multiple-properties');
        const nameNode = field(elements[0], 'name');
        if (!nameNode?.text || nameNode.type !== 'variable_name') return skip('php-dynamic-property');
        return {
            nameNode,
            kind: 'property',
            body: field(elements[0], 'default_value'),
            children: [],
            scopeIdentity: namespaceScope(node, parent)
        };
    }

    if (node.type === 'const_declaration') {
        if (parent?.callable) return skip('php-local-binding');
        if (!allowedNamespaceLevel(parent) && !CONTAINER_KINDS.has(parent?.kind)) {
            return skip('php-unowned-constant');
        }
        const element = constElement(node);
        if (element.skip) return skip(element.skip);
        const description = {
            nameNode: element.nameNode,
            kind: 'constant',
            body: element.body,
            children: [],
            scopeIdentity: namespaceScope(node, parent)
        };
        return withNamespace(description, node, parent);
    }

    if (node.type === 'enum_case') {
        if (parent?.kind !== 'enum') return skip(parent?.callable
            ? 'php-local-binding' : 'php-unowned-constant');
        const nameNode = field(node, 'name');
        if (!nameNode?.text || nameNode.type !== 'name') return skip('php-malformed-enum-case');
        return {
            nameNode,
            kind: 'constant',
            body: field(node, 'value'),
            children: [],
            scopeIdentity: namespaceScope(node, parent)
        };
    }

    return null;
}

module.exports = { describe };
