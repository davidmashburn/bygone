const field = (node, name) => node.childForFieldName(name);
const skip = reason => ({ skip: true, reason });
function simpleName(node) {
    if (!node) return null;
    if (['identifier', 'field_identifier', 'type_identifier'].includes(node.type)) return node;
    if (['pointer_declarator', 'array_declarator', 'init_declarator'].includes(node.type)) return simpleName(field(node, 'declarator'));
    return null;
}
function functionName(node) {
    while (node?.type === 'pointer_declarator') node = field(node, 'declarator');
    if (node?.type !== 'function_declarator') return null;
    const name = field(node, 'declarator');
    return name?.type === 'identifier' ? name : null;
}
function describe(node, { parent }) {
    if (node.type.startsWith('preproc_')) return skip('c-preprocessor-not-expanded');
    if (node.type === 'function_definition') {
        const nameNode = functionName(field(node, 'declarator'));
        return nameNode ? { nameNode, kind: 'function', callable: true, body: field(node, 'body'), children: [field(node, 'body')] }
            : skip('c-complex-function-declarator');
    }
    if (['declaration', 'type_definition', 'field_declaration'].includes(node.type)) {
        if (parent?.callable) return skip('c-local-bindings');
        const declarators = node.childrenForFieldName('declarator');
        if (declarators.length !== 1) return skip('c-multiple-or-anonymous-declarators');
        const declarator = declarators[0];
        const prototype = node.type === 'declaration' && functionName(declarator);
        const nameNode = prototype || simpleName(declarator);
        if (!nameNode) return skip('c-complex-declarator');
        return { nameNode, kind: prototype ? 'function' : node.type === 'type_definition' ? 'type'
            : node.type === 'field_declaration' ? 'property' : 'variable', callable: !!prototype,
        ...(node.type === 'field_declaration' ? { scopeIdentity: `c-owner:${parent?.qualifiedName || ''}` } : {}),
        body: field(declarator, 'value') || (node.type === 'type_definition' ? field(node, 'type') : null), children: [] };
    }
    if (['struct_specifier', 'union_specifier', 'enum_specifier'].includes(node.type)) {
        if (parent?.callable) return skip('c-local-types');
        if (!field(node, 'body')) return { children: [] };
        const nameNode = field(node, 'name');
        return nameNode ? { nameNode, kind: node.type === 'enum_specifier' ? 'enum' : 'class', body: field(node, 'body'), children: [field(node, 'body')] }
            : skip('c-anonymous-type');
    }
    if (node.type === 'enumerator') return { nameNode: field(node, 'name'), kind: 'property',
        scopeIdentity: `c-owner:${parent?.qualifiedName || ''}`, body: field(node, 'value'), children: [] };
    return null;
}
module.exports = { describe };
