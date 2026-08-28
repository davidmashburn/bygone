/* global module */

function applyTwoWayRenderTransition({ updateModels, updateActiveIndex, applyDecorations }) {
    updateModels();
    updateActiveIndex();
    applyDecorations();
}

function selectMultiDiffPairsForRecompute(pairs, changedIndices = null) {
    return (pairs || [])
        .map((pair, index) => ({ pair, index }))
        .filter(({ pair }) => !changedIndices
            || changedIndices.has(pair.leftIndex)
            || changedIndices.has(pair.rightIndex));
}

function applyCompletedMultiDiffResults(pairs, results) {
    const modelsByIndex = new Map(
        (results || [])
            .filter(({ index, model }) => Number.isInteger(index) && model)
            .map(({ index, model }) => [index, model])
    );
    return (pairs || []).map((pair, index) => (
        modelsByIndex.has(index)
            ? { ...pair, diffModel: modelsByIndex.get(index) }
            : pair
    ));
}

module.exports = {
    applyCompletedMultiDiffResults,
    applyTwoWayRenderTransition,
    selectMultiDiffPairsForRecompute
};
