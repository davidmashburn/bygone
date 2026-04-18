(function () {
    function createFoldSync(options) {
        const { leftEditor, rightEditor, directoryMap } = options;
        let isSyncing = false;
        let leftHidden = [];
        let rightHidden = [];
        const disposables = [];

        disposables.push(leftEditor.onDidChangeHiddenAreas(() => {
            syncFrom('left');
        }));

        disposables.push(rightEditor.onDidChangeHiddenAreas(() => {
            syncFrom('right');
        }));

        function syncFrom(side) {
            if (isSyncing) {
                return;
            }

            const fromEditor = side === 'left' ? leftEditor : rightEditor;
            const toEditor = side === 'left' ? rightEditor : leftEditor;
            const fromLineToPath = side === 'left'
                ? directoryMap.leftLineToPath
                : directoryMap.rightLineToPath;
            const toPathToLine = side === 'left'
                ? directoryMap.pathToRightLine
                : directoryMap.pathToLeftLine;

            const currentHidden = fromEditor.getHiddenAreas() ?? [];
            const prev = side === 'left' ? leftHidden : rightHidden;

            const newlyHidden = currentHidden.filter(r => !prev.some(p => rangesEqual(p, r)));
            const newlyShown = prev.filter(p => !currentHidden.some(r => rangesEqual(r, p)));

            if (newlyHidden.length === 0 && newlyShown.length === 0) {
                return;
            }

            isSyncing = true;

            for (const range of newlyHidden) {
                // range.startLineNumber is 1-based; lineToPath is 0-based indexed
                const path = fromLineToPath[range.startLineNumber - 1];
                if (path === undefined) {
                    continue;
                }

                const targetLine = toPathToLine[path];
                if (targetLine === undefined) {
                    continue;
                }

                // trigger expects 1-based line numbers
                toEditor.trigger('foldSync', 'editor.fold', { selectionLines: [targetLine + 1] });
            }

            for (const range of newlyShown) {
                const path = fromLineToPath[range.startLineNumber - 1];
                if (path === undefined) {
                    continue;
                }

                const targetLine = toPathToLine[path];
                if (targetLine === undefined) {
                    continue;
                }

                toEditor.trigger('foldSync', 'editor.unfold', { selectionLines: [targetLine + 1] });
            }

            isSyncing = false;

            if (side === 'left') {
                leftHidden = currentHidden;
            } else {
                rightHidden = currentHidden;
            }
        }

        function rangesEqual(a, b) {
            return a.startLineNumber === b.startLineNumber && a.endLineNumber === b.endLineNumber;
        }

        return {
            dispose() {
                disposables.forEach(d => d.dispose());
            }
        };
    }

    window.BygoneFoldSync = { createFoldSync };
}());
