const field = (node, name) => node.childForFieldName(name);
function describe(node, context) {
    if (node.type === 'decorated_definition') {
        const definition = field(node, 'definition');
        const description = definition && describe(definition, context);
        return description?.kind ? { ...description, children: definition.namedChildren } : description;
    }
    if (context.parent?.callable && ['class_definition', 'trait_definition', 'enum_definition',
        'type_alias_statement', 'parameterized_alias_statement'].includes(node.type)) {
        return { skip: true, reason: 'mojo-local-bindings' };
    }
    if (node.type === 'class_definition') {
        // This grammar also accepts Python-style class for error recovery.
        // Do not present that recovery production as a supported Mojo struct.
        if (node.children[0]?.text === 'class') return { skip: true, reason: 'mojo-class-recovery-syntax' };
        return { nameNode: field(node, 'name'), kind: 'class', body: field(node, 'body') };
    }
    if (node.type === 'trait_definition' || node.type === 'enum_definition') return {
        nameNode: field(node, 'name'), kind: node.type === 'trait_definition' ? 'interface' : 'enum', body: field(node, 'body')
    };
    if (node.type === 'function_definition') return {
        nameNode: field(node, 'name'), kind: ['class', 'interface', 'enum'].includes(context.parent?.kind) ? 'method' : 'function',
        callable: true, body: field(node, 'body')
    };
    if (node.type === 'enum_case') return { nameNode: field(node, 'name'), kind: 'property', children: [] };
    if (node.type === 'type_alias_statement' || node.type === 'parameterized_alias_statement') return {
        nameNode: field(node, 'name'), kind: 'type', body: field(node, 'value'), children: []
    };
    if (node.type === 'assignment') {
        if (context.parent?.callable) return { skip: true, reason: 'mojo-local-bindings' };
        const name = field(node, 'left');
        if (name?.type !== 'identifier') return { skip: true, reason: 'mojo-destructured-or-computed-binding' };
        return { nameNode: name, kind: context.parent ? 'property' : 'variable', body: field(node, 'right'), children: [] };
    }
    if (node.type === 'lambda' || node.type === 'lambda_within_for_in_clause') return { skip: true, reason: 'mojo-anonymous-lambda' };
    return null;
}
module.exports = { describe };
