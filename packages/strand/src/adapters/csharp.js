'use strict';

// Syntax-only inventory for tree-sitter-c-sharp. The adapter deliberately
// records only declarations whose names and lexical owners are unambiguous in
// the syntax tree. It does not resolve overloads, partial types, aliases,
// accessibility, or any other compiler-level relationship.

const TYPE_KINDS = Object.freeze({
    class_declaration: 'class',
    struct_declaration: 'struct',
    interface_declaration: 'interface',
    record_declaration: 'record',
    enum_declaration: 'enum',
    delegate_declaration: 'delegate'
});

const UNSUPPORTED = new Map([
    ['event_declaration', 'csharp-unsupported-event'],
    ['event_field_declaration', 'csharp-unsupported-event-field'],
    ['indexer_declaration', 'csharp-unsupported-indexer'],
    ['operator_declaration', 'csharp-unsupported-operator'],
    ['conversion_operator_declaration', 'csharp-unsupported-conversion-operator'],
    ['destructor_declaration', 'csharp-unsupported-destructor'],
    ['preproc_if', 'csharp-unsupported-preprocessor-conditional'],
    ['global_statement', 'csharp-unsupported-global-statement'],
    ['local_declaration_statement', 'csharp-local-binding'],
    ['local_function_statement', 'csharp-local-function'],
    ['using_statement', 'csharp-local-using'],
    ['lambda_expression', 'csharp-anonymous-lambda'],
    ['anonymous_method_expression', 'csharp-anonymous-method'],
    ['anonymous_object_creation_expression', 'csharp-anonymous-class']
]);

// The file-scoped namespace production has no body. Its following compilation
// unit siblings are its members in valid C# syntax, so record that relationship
// on the parser nodes when the compilation unit is first visited. Weak maps
// keep this per-tree without retaining parser trees or leaking one document's
// namespace into another document.
const fileScopedParents = new WeakMap();
const ambiguousFileScopedNodes = new WeakSet();
const ambiguousFileScopedChildren = new WeakSet();

const field = (node, name) => node?.childForFieldName(name) || null;
const children = node => node?.namedChildren || [];
const skip = reason => ({ skip: true, reason });

function namespaceName(node) {
    return field(node, 'name')?.text || null;
}

function registerFileScopedContext(root) {
    const direct = children(root);
    const namespaces = direct.filter(node => node.type === 'file_scoped_namespace_declaration');
    if (namespaces.length === 0) return;

    // Multiple file-scoped namespace declarations are not a safe ownership
    // model for this adapter. Avoid treating their later siblings as global
    // declarations if a recovery parse reports no tree error.
    if (namespaces.length !== 1) {
        for (const namespace of namespaces) ambiguousFileScopedNodes.add(namespace);
        const first = Math.min(...namespaces.map(namespace => direct.indexOf(namespace)));
        for (let index = first + 1; index < direct.length; index++) {
            ambiguousFileScopedChildren.add(direct[index]);
        }
        return;
    }

    const namespace = namespaces[0];
    const name = namespaceName(namespace);
    const namespaceIndex = direct.indexOf(namespace);
    if (!name || namespaceIndex < 0) {
        ambiguousFileScopedNodes.add(namespace);
        for (let index = Math.max(0, namespaceIndex + 1); index < direct.length; index++) {
            ambiguousFileScopedChildren.add(direct[index]);
        }
        return;
    }
    for (let index = namespaceIndex + 1; index < direct.length; index++) {
        fileScopedParents.set(direct[index], name);
    }
}

function isTypeParent(parent) {
    return !!parent && ['class', 'struct', 'interface', 'record'].includes(parent.kind);
}

function lexicalScope(node, parent) {
    if (parent?.scopeIdentity) return parent.scopeIdentity;
    if (parent?.kind === 'namespace') return parent.qualifiedName;
    return fileScopedParents.get(node) || 'global';
}

function namespaceDescription(node, parent) {
    const nameNode = field(node, 'name');
    if (!nameNode) return skip('csharp-malformed-namespace');
    if (node.type === 'file_scoped_namespace_declaration') {
        return {
            nameNode,
            kind: 'namespace',
            children: [],
            scopeIdentity: nameNode.text
        };
    }
    if (parent && parent.kind !== 'namespace') return skip('csharp-unowned-namespace');
    const parentName = parent?.qualifiedName || fileScopedParents.get(node) || null;
    return {
        nameNode,
        kind: 'namespace',
        body: field(node, 'body'),
        scopeIdentity: parentName ? `${parentName}.${nameNode.text}` : nameNode.text
    };
}

function declarationDescription(node, parent) {
    const kind = TYPE_KINDS[node.type];
    if (!kind) return null;
    const nameNode = field(node, 'name');
    if (!nameNode) return skip(`csharp-malformed-${node.type}`);
    return {
        nameNode,
        kind,
        ...(node.type === 'delegate_declaration' ? { children: [] } : { body: field(node, 'body') }),
        scopeIdentity: lexicalScope(node, parent)
    };
}

function fieldDescription(node, parent) {
    if (!isTypeParent(parent)) return skip('csharp-unowned-field');
    const declaration = children(node).find(child => child.type === 'variable_declaration');
    const variables = children(declaration).filter(child => child.type === 'variable_declarator');
    if (variables.length !== 1) return skip('csharp-multiple-field-declarators');
    const variable = variables[0];
    const nameNode = field(variable, 'name');
    if (!nameNode || nameNode.type !== 'identifier') return skip('csharp-unsupported-field-pattern');
    if (children(variable).some(child => child.type === 'bracketed_argument_list')) {
        return skip('csharp-unsupported-field-pattern');
    }
    return {
        nameNode,
        kind: 'property',
        body: field(variable, 'value') || field(declaration, 'type'),
        children: children(node),
        scopeIdentity: lexicalScope(node, parent)
    };
}

function memberDescription(node, parent) {
    if (node.type === 'field_declaration') return fieldDescription(node, parent);
    if (node.type === 'enum_member_declaration') {
        if (parent?.kind !== 'enum') return skip('csharp-unowned-enum-member');
        const nameNode = field(node, 'name');
        return nameNode ? {
            nameNode,
            kind: 'property',
            children: [],
            scopeIdentity: lexicalScope(node, parent)
        } : skip('csharp-malformed-enum-member');
    }
    if (node.type === 'property_declaration') {
        if (!isTypeParent(parent)) return skip('csharp-unowned-property');
        const nameNode = field(node, 'name');
        return nameNode ? {
            nameNode,
            kind: 'property',
            body: field(node, 'accessors') || field(node, 'value'),
            children: children(node),
            scopeIdentity: lexicalScope(node, parent)
        } : skip('csharp-malformed-property');
    }
    if (node.type === 'method_declaration') {
        if (!isTypeParent(parent)) return skip('csharp-unowned-method');
        const nameNode = field(node, 'name');
        return nameNode ? {
            nameNode,
            kind: 'method',
            callable: true,
            body: field(node, 'body'),
            scopeIdentity: lexicalScope(node, parent)
        } : skip('csharp-malformed-method');
    }
    if (node.type === 'constructor_declaration') {
        if (!parent || !['class', 'struct', 'record'].includes(parent.kind)) return skip('csharp-unowned-constructor');
        const nameNode = field(node, 'name');
        return nameNode ? {
            nameNode,
            kind: 'constructor',
            callable: true,
            body: field(node, 'body'),
            scopeIdentity: lexicalScope(node, parent)
        } : skip('csharp-malformed-constructor');
    }
    return null;
}

function attachFileScopedParent(description, node, parent) {
    if (!description?.kind || parent) return description;
    const namespace = fileScopedParents.get(node);
    if (!namespace) return description;
    return { ...description, parent: namespace, scopeIdentity: namespace };
}

function describe(node, { parent } = {}) {
    if (!node) return null;
    if (node.type === 'compilation_unit') {
        registerFileScopedContext(node);
        return null;
    }
    if (ambiguousFileScopedNodes.has(node)) return skip('csharp-ambiguous-file-scoped-namespace');
    if (!parent && ambiguousFileScopedChildren.has(node)) return skip('csharp-ambiguous-file-scoped-namespace');

    const unsupported = UNSUPPORTED.get(node.type);
    if (unsupported) return skip(unsupported);

    let description;
    if (node.type === 'namespace_declaration' || node.type === 'file_scoped_namespace_declaration') {
        description = namespaceDescription(node, parent);
    } else {
        description = declarationDescription(node, parent) || memberDescription(node, parent);
    }
    return attachFileScopedParent(description, node, parent);
}

module.exports = { describe };
