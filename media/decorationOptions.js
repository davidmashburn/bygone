/* global module */

function createAdjacentEdgeDecorationOptions(side, className) {
    return {
        isWholeLine: true,
        blockClassName: `${className}-${side}`
    };
}

module.exports = {
    createAdjacentEdgeDecorationOptions
};
