// Speech synthesis does not acquire Chromium media-session audio focus. A
// silent media element supplies that lifecycle while the device voice speaks.
// It exists only for an engaged narration session; no global keys are captured.
export function createNarrationMediaSession({ play, pause, stop, skip }) {
    const session = navigator.mediaSession;
    let audio;
    let audioUrl;
    let engaged = false;
    let title;
    let generation = 0;
    const handlers = { play, pause, stop, previoustrack: () => skip(-1), nexttrack: () => skip(1) };

    function setHandler(action, handler) {
        try { session.setActionHandler(action, handler); }
        catch { /* Browsers may support only a subset of media actions. */ }
    }

    function release() {
        if (!session || !engaged) return;
        engaged = false;
        generation += 1;
        for (const action of Object.keys(handlers)) setHandler(action, null);
        session.playbackState = 'none';
        session.metadata = null;
        title = undefined;
        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            audio = undefined;
            URL.revokeObjectURL(audioUrl);
            audioUrl = undefined;
        }
    }

    return {
        update(state, nextTitle, availability) {
            if (!session) return;
            if (state.kind !== 'playing' && state.kind !== 'paused') {
                release();
                return;
            }
            engaged = true;
            if (title !== nextTitle) {
                title = nextTitle;
                if (typeof MediaMetadata !== 'undefined') session.metadata = new MediaMetadata({ title, artist: 'Bygone' });
            }
            for (const [action, handler] of Object.entries(handlers)) {
                const enabled = action === 'previoustrack' ? availability.previous
                    : action === 'nexttrack' ? availability.next : true;
                setHandler(action, enabled ? () => { if (engaged) handler(); } : null);
            }
            session.playbackState = state.kind;
            if (state.kind === 'paused') {
                generation += 1;
                audio?.pause();
            } else {
                if (!audio) {
                    audioUrl = URL.createObjectURL(silentNarrationAudio());
                    audio = new Audio(audioUrl);
                    audio.loop = true;
                    // An OS audio-focus interruption must pause speech too.
                    audio.addEventListener('pause', event => {
                        if (engaged && event.currentTarget === audio && audio.paused
                            && session.playbackState === 'playing') pause();
                    });
                }
                if (audio.paused) {
                    const request = ++generation;
                    // Losing media-key support must not prevent device narration.
                    void audio.play().catch(() => {
                        if (generation === request) release();
                    });
                }
            }
        },
        dispose: release
    };
}

function silentNarrationAudio() {
    // Ten seconds of unsigned 8-bit PCM silence, looped locally. Do not mute the
    // element: muted players cannot hold media-session audio focus in Chromium.
    const samples = 8000 * 10;
    const bytes = new Uint8Array(44 + samples);
    const view = new DataView(bytes.buffer);
    const text = (offset, value) => [...value].forEach((char, index) => { bytes[offset + index] = char.charCodeAt(0); });
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true);
    view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, 'data');
    view.setUint32(40, samples, true);
    bytes.fill(128, 44);
    return new Blob([bytes], { type: 'audio/wav' });
}
