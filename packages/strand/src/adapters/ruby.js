'use strict';

const field = (node, name) => node?.childForFieldName(name) || null;
const skip = reason => ({ skip: true, reason });

const CONTAINERS = new Map([
    ['class', 'class'],
    ['module', 'module']
]);

const callableOwner = parent => !!parent?.callable;
const containerOwner = parent => parent?.kind === 'class' || parent?.kind === 'module';

function staticConstant(node) {
    if (!node) return false;
    if (node.type === 'constant') return true;
    if (node.type !== 'scope_resolution') return false;
    const name = field(node, 'name');
    const scope = field(node, 'scope');
    return staticConstant(name) && (!scope || staticConstant(scope));
}

function singletonClassAncestor(node) {
    let current = node?.parent || null;
    while (current) {
        if (current.type === 'singleton_class') return current;
        current = current.parent || null;
    }
    return null;
}

function selfSingletonClass(node) {
    const ancestor = singletonClassAncestor(node);
    return ancestor && field(ancestor, 'value')?.type === 'self' ? ancestor : null;
}

function methodDescription(node, parent, singleton, objectMethod = false) {
    if (!objectMethod && !containerOwner(parent)) return skip('ruby-unowned-method');
    const nameNode = field(node, 'name');
    if (!nameNode?.text) return skip('ruby-malformed-method');
    return {
        nameNode,
        kind: 'method',
        callable: true,
        body: field(node, 'body'),
        scopeIdentity: objectMethod ? 'ruby-object-private-method'
            : singleton ? 'ruby-self-singleton-method' : 'ruby-instance-method'
    };
}

function describe(node, { parent } = {}) {
    if (!node) return null;

    if (['block', 'do_block', 'lambda'].includes(node.type)) return skip('ruby-anonymous-block');
    if (['begin_block', 'end_block'].includes(node.type)) return skip('ruby-special-block');

    if (node.type === 'singleton_class') {
        // Keep `class << self`'s regular method children visible. Their
        // structural ancestor supplies the singleton/instance distinction.
        return field(node, 'value')?.type === 'self'
            ? null : skip('ruby-dynamic-singleton-receiver');
    }

    const singleton = selfSingletonClass(node);

    if (CONTAINERS.has(node.type)) {
        if (callableOwner(parent)) return skip('ruby-local-declaration');
        if (singleton) return skip('ruby-singleton-class-body');
        const nameNode = field(node, 'name');
        if (!staticConstant(nameNode)) return skip('ruby-dynamic-declaration-name');
        return {
            nameNode,
            kind: CONTAINERS.get(node.type),
            body: field(node, 'body'),
            scopeIdentity: 'ruby-container'
        };
    }

    if (node.type === 'method') {
        if (callableOwner(parent)) return skip('ruby-local-declaration');
        if (!parent) {
            // Treat a direct top-level `def` as the private-Object method
            // category for matching. Keep it as a top-level syntax entry,
            // with a stable scope distinct from class instance methods.
            // Definitions nested in conditionals or other unowned syntax
            // stay excluded.
            if (node.parent?.type !== 'program') return skip('ruby-unowned-method');
            return methodDescription(node, parent, false, true);
        }
        return methodDescription(node, parent, !!singleton);
    }

    if (node.type === 'singleton_method') {
        if (callableOwner(parent) || singleton) return skip('ruby-local-declaration');
        const object = field(node, 'object');
        if (object?.type !== 'self') return skip('ruby-dynamic-singleton-receiver');
        return methodDescription(node, parent, true);
    }

    if (node.type === 'assignment') {
        if (callableOwner(parent)) return skip('ruby-local-binding');
        if (singleton) return skip('ruby-singleton-class-body');
        const left = field(node, 'left');
        if (left?.type !== 'constant') return skip('ruby-local-binding');
        return {
            nameNode: left,
            kind: 'constant',
            body: field(node, 'right'),
            children: [],
            scopeIdentity: 'ruby-constant'
        };
    }

    if (node.type === 'operator_assignment') return skip(callableOwner(parent)
        ? 'ruby-local-binding' : 'ruby-computed-binding');

    return null;
}

module.exports = { describe };
