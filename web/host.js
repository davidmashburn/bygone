import { buildTwoWayDiffModel, mergeText } from '../src/diffEngine.ts';
import { createJavaScriptSampleFilePair } from '../src/sampleFiles.ts';

(function initializeWebHost() {
    const state = {
        mode: 'empty',
        left: null,
        right: null
    };

    window.__BYGONE_HOST__ = {
        environment: 'web',
        editorWorkerUrl: '/media/editor.worker.js',
        postMessage(message) {
            void handleRendererMessage(message);
        }
    };

    window.addEventListener('DOMContentLoaded', () => {
        bindControls();
        setStatus('Browser host ready.');
    });

    function emit(message) {
        window.dispatchEvent(new window.CustomEvent('bygone:host-message', {
            detail: message
        }));
    }

    async function handleRendererMessage(message) {
        if (!message || typeof message !== 'object') {
            return;
        }

        if (message.type === 'ready') {
            if (new URLSearchParams(window.location.search).get('demo') === '1') {
                compareTestFiles();
            }
            return;
        }

        if (message.type === 'recomputeDiff' && state.mode === 'diff' && state.left && state.right) {
            state.left.content = message.leftContent;
            state.right.content = message.rightContent;

            emit({
                type: 'showDiff',
                file1: state.left.name,
                file2: state.right.name,
                leftContent: state.left.content,
                rightContent: state.right.content,
                diffModel: buildTwoWayDiffModel(state.left.content, state.right.content),
                history: null
            });
        }
    }

    function bindControls() {
        const compareTestButton = document.getElementById('web-compare-test');
        const openDiffButton = document.getElementById('web-open-diff');
        const openMergeButton = document.getElementById('web-open-merge');
        const diffInput = document.getElementById('web-diff-input');
        const mergeInput = document.getElementById('web-merge-input');

        compareTestButton?.addEventListener('click', () => {
            compareTestFiles();
        });

        openDiffButton?.addEventListener('click', () => {
            diffInput.value = '';
            diffInput.click();
        });

        openMergeButton?.addEventListener('click', () => {
            mergeInput.value = '';
            mergeInput.click();
        });

        diffInput?.addEventListener('change', async () => {
            const files = Array.from(diffInput.files || []);
            if (files.length !== 2) {
                setStatus('Select exactly 2 files for a diff.');
                return;
            }

            await openDiffFiles(files);
        });

        mergeInput?.addEventListener('change', async () => {
            const files = Array.from(mergeInput.files || []);
            if (files.length !== 3) {
                setStatus('Select exactly 3 files for a three-way merge.');
                return;
            }

            await openMergeFiles(files);
        });
    }

    function compareTestFiles() {
        const sample = createJavaScriptSampleFilePair();
        state.mode = 'diff';
        state.left = {
            name: sample.leftFileName,
            content: sample.leftContent
        };
        state.right = {
            name: sample.rightFileName,
            content: sample.rightContent
        };

        setStatus('Loaded sample diff.');
        emit({
            type: 'showDiff',
            file1: state.left.name,
            file2: state.right.name,
            leftContent: state.left.content,
            rightContent: state.right.content,
            diffModel: buildTwoWayDiffModel(state.left.content, state.right.content),
            history: null
        });
    }

    async function openDiffFiles(files) {
        const [leftFile, rightFile] = files;
        const [leftContent, rightContent] = await Promise.all([
            leftFile.text(),
            rightFile.text()
        ]);

        state.mode = 'diff';
        state.left = {
            name: leftFile.name,
            content: leftContent
        };
        state.right = {
            name: rightFile.name,
            content: rightContent
        };

        setStatus(`Loaded ${leftFile.name} and ${rightFile.name}.`);
        emit({
            type: 'showDiff',
            file1: leftFile.name,
            file2: rightFile.name,
            leftContent,
            rightContent,
            diffModel: buildTwoWayDiffModel(leftContent, rightContent),
            history: null
        });
    }

    async function openMergeFiles(files) {
        const [baseFile, leftFile, rightFile] = files;
        const [baseContent, leftContent, rightContent] = await Promise.all([
            baseFile.text(),
            leftFile.text(),
            rightFile.text()
        ]);
        const mergeModel = mergeText(baseContent, leftContent, rightContent);

        state.mode = 'merge';
        setStatus(`Loaded merge view for ${baseFile.name}, ${leftFile.name}, and ${rightFile.name}.`);
        emit({
            type: 'showThreeWayMerge',
            base: {
                name: baseFile.name,
                lines: mergeModel.baseLines
            },
            left: {
                name: leftFile.name,
                lines: mergeModel.leftLines
            },
            right: {
                name: rightFile.name,
                lines: mergeModel.rightLines
            },
            result: {
                name: mergeModel.conflictCount > 0 ? `Result (${mergeModel.conflictCount} conflicts)` : 'Result',
                lines: mergeModel.resultLines
            },
            meta: {
                isExperimental: mergeModel.isExperimental,
                conflictCount: mergeModel.conflictCount
            }
        });
    }

    function setStatus(message) {
        const status = document.getElementById('web-status');
        if (status) {
            status.textContent = message;
        }
    }
})();
