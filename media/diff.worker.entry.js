import { buildTwoWayDiffModel } from '../src/diffEngine.ts';

self.addEventListener('message', (event) => {
    const { id, leftContent, rightContent } = event.data || {};
    if (typeof id !== 'number' || typeof leftContent !== 'string' || typeof rightContent !== 'string') {
        return;
    }

    try {
        const model = buildTwoWayDiffModel(leftContent, rightContent);
        self.postMessage({ id, model });
    } catch (error) {
        self.postMessage({ id, error: (error && error.message) || String(error) });
    }
});
