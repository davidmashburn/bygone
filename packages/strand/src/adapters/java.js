const containers = { class_declaration: 'class', interface_declaration: 'interface',
    enum_declaration: 'enum', record_declaration: 'class', annotation_type_declaration: 'interface' };
const field = (node, name) => node.childForFieldName(name);
function describe(node, { parent }) {
    if (containers[node.type]) return { nameNode: field(node, 'name'), kind: containers[node.type], body: field(node, 'body') };
    if (['method_declaration', 'constructor_declaration', 'compact_constructor_declaration', 'annotation_type_element_declaration'].includes(node.type)) {
        return { nameNode: field(node, 'name'), kind: node.type.includes('constructor') ? 'constructor' : 'method',
            callable: true, body: field(node, 'body') };
    }
    if (['field_declaration', 'constant_declaration'].includes(node.type)) {
        const declarations = node.namedChildren.filter(child => child.type === 'variable_declarator');
        if (declarations.length !== 1) return { skip: true, reason: 'java-multiple-field-declarators' };
        return { nameNode: field(declarations[0], 'name'), kind: 'property', body: field(declarations[0], 'value'), children: [] };
    }
    if (node.type === 'enum_constant') return { nameNode: field(node, 'name'), kind: 'property', children: [] };
    if (node.type === 'lambda_expression') return { skip: true, reason: 'java-anonymous-lambda' };
    if (node.type === 'object_creation_expression' && node.namedChildren.some(child => child.type === 'class_body')) {
        return { skip: true, reason: 'java-anonymous-class' };
    }
    if (node.type === 'module_declaration') return { skip: true, reason: 'java-module-directives' };
    if (node.type === 'local_variable_declaration' && parent) return { skip: true, reason: 'java-local-bindings' };
    if (node.type === 'static_initializer' || node.type === 'instance_initializer') return { skip: true, reason: 'java-initializer-block' };
    return null;
}
module.exports = { describe };
