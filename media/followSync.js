/** One request in flight. Refreshes cannot erase keystrokes awaiting an acknowledgment. */
export function createFollowSync({ send, read }) {
    let binding, pending, latest, serial = 0, deferred, composing = false;
    const actions = [];
    function submit(content) {
        pending = { id: ++serial, token: binding.token, content, projection: binding.projection };
        send({ type: 'followDraft', token: pending.token, content });
        send({ type: 'followEdit', id: pending.id, token: pending.token, content });
    }
    function flushAction() {
        if (!pending && !composing) {
            for (const action of actions.splice(0)) send(action);
        }
    }
    return {
        active: () => !!binding,
        changed() {
            if (!binding) return false;
            latest = read();
            if (!pending && !composing) submit(latest);
            else send({ type: 'followDraft', token: binding.token, content: latest });
            return true;
        },
        compositionStart() { if (binding) composing = true; },
        compositionEnd() {
            composing = false;
            if (pending && deferred?.followAck?.id === pending.id) {
                const message = deferred; deferred = undefined; return message;
            }
            if (!pending && latest === undefined && deferred) {
                const message = deferred; deferred = undefined; return message;
            }
            if (!pending && latest !== undefined && binding) submit(latest);
            flushAction();
            return undefined;
        },
        action(value) {
            // Document commands belong to the projection visible when requested,
            // even if their edit acknowledgment arrives with a different view.
            actions.push({ type: 'followAction', action: value, token: binding?.token });
            flushAction();
        },
        receive(message) {
            if (message.type !== 'showDiff') return true;
            if (composing) {
                // An acknowledgment is more important than later unsolicited refreshes.
                if (!deferred?.followAck || message.followAck) deferred = message;
                return false;
            }
            if (pending) {
                if (message.followAck?.id !== pending.id) { deferred = message; return false; }
                const sent = pending;
                pending = undefined;
                if (latest !== sent.content) {
                    if (message.followAck.accepted && message.editBinding?.projection === sent.projection
                        && message.rightContent === sent.content) {
                        binding = message.editBinding;
                        submit(latest);
                        return false;
                    }
                    send({ type: 'followRecover', token: sent.token, content: latest });
                } else if (!message.followAck.accepted) {
                    send({ type: 'followRecover', token: sent.token, content: latest });
                }
                deferred = undefined;
            }
            binding = message.editBinding;
            latest = undefined;
            flushAction();
            return true;
        },
        // Exposed for deterministic protocol tests, not a second document store.
        state: () => ({ pending, binding, deferred })
    };
}
