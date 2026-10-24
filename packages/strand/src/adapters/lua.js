const field = (node, name) => node.childForFieldName(name);
const skip = reason => ({ skip: true, reason });
function staticName(node) {
    if (node?.type === 'identifier') return node.text;
    if (node?.type === 'dot_index_expression' || node?.type === 'method_index_expression') {
        const owner = staticName(field(node, 'table'));
        const member = field(node, 'field') || field(node, 'method');
        return owner && member ? `${owner}${node.type === 'method_index_expression' ? ':' : '.'}${member.text}` : null;
    }
    return null;
}
function describe(node, { parent }) {
    if (node.type === 'function_declaration') {
        const nameNode = field(node, 'name'), name = staticName(nameNode);
        if (!name) return skip('lua-dynamic-function-owner');
        const local = node.children[0]?.text === 'local';
        const member = nameNode.type !== 'identifier';
        const owner = member ? name.slice(0, Math.max(name.lastIndexOf('.'), name.lastIndexOf(':'))) : null;
        return { nameNode, name, kind: member ? 'method' : 'function', callable: true,
            body: field(node, 'body'), children: field(node, 'body') ? [field(node, 'body')] : [],
            scopeIdentity: member ? `lua-member:${owner}:${name.includes(':') ? 'colon' : 'dot'}` : local ? 'lua-local' : 'lua-global' };
    }
    if (node.type === 'function_definition') return skip('lua-anonymous-function');
    if (node.type === 'variable_declaration' || node.type === 'assignment_statement') {
        return skip(parent?.callable ? 'lua-local-bindings' : 'lua-assignment-bindings');
    }
    return null;
}
module.exports = { describe };
