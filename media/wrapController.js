/* global module */

const WORD_WRAP_STORAGE_KEY = 'bygone.wordWrapEnabled';

function readWordWrapPreference(storage) {
    try {
        return storage?.getItem(WORD_WRAP_STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
}

function writeWordWrapPreference(storage, enabled) {
    try {
        storage?.setItem(WORD_WRAP_STORAGE_KEY, enabled ? 'true' : 'false');
        return true;
    } catch {
        return false;
    }
}

function applyWordWrap(editors, enabled) {
    let applied = 0;
    for (const editor of editors || []) {
        if (!editor || typeof editor.updateOptions !== 'function') {
            continue;
        }
        try {
            editor.updateOptions({ wordWrap: enabled ? 'on' : 'off' });
            applied += 1;
        } catch {
            // Disposed editors are ignored while views transition.
        }
    }
    return applied;
}

module.exports = {
    WORD_WRAP_STORAGE_KEY,
    applyWordWrap,
    readWordWrapPreference,
    writeWordWrapPreference
};
