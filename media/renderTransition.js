/* global module */

function applyTwoWayRenderTransition({ updateModels, updateActiveIndex, applyDecorations }) {
    updateModels();
    updateActiveIndex();
    applyDecorations();
}

module.exports = {
    applyTwoWayRenderTransition
};
