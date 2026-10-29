const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const { test } = require('node:test');
const { resolve } = require('node:path');

const modulePromise = import('data:text/javascript;base64,' + Buffer.from(buildSync({
    entryPoints: [resolve(__dirname, '../media/workspaceControls.js')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    loader: { '.md': 'text' }
}).outputFiles[0].contents).toString('base64'));

class Element {
    constructor(document, tagName) {
        this.ownerDocument = document;
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.attributes = new Map();
        this.listeners = new Map();
        this.classList = { toggle() {} };
        this.dataset = {};
        this.isConnected = true;
        this.hidden = false;
        this.open = false;
        this.textContent = '';
        this.contentWindow = this.tagName === 'IFRAME' ? {} : undefined;
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    append(...children) {
        children.forEach(child => this.appendChild(child));
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    dispatchEvent(event) {
        event.target ||= this;
        for (const listener of this.listeners.get(event.type) || []) listener(event);
        return !event.defaultPrevented;
    }

    click() {
        this.dispatchEvent({ type: 'click', defaultPrevented: false });
    }

    focus() {
        this.focused = true;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
        if (name === 'open') this.open = true;
    }

    removeAttribute(name) {
        this.attributes.delete(name);
        if (name === 'open') this.open = false;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    showModal() {
        this.setAttribute('open', '');
    }

    close() {
        this.removeAttribute('open');
        this.dispatchEvent({ type: 'close', defaultPrevented: false });
    }

    remove() {
        this.isConnected = false;
        this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1);
    }
}

class Document {
    constructor() {
        this.defaultView = new Element(this, 'window');
    }

    createElement(tagName) {
        return new Element(this, tagName);
    }
}

function find(root, predicate) {
    if (predicate(root)) return root;
    for (const child of root.children || []) {
        const match = find(child, predicate);
        if (match) return match;
    }
    return undefined;
}

function state(status, html = '', url = '') {
    return {
        sessionId: 'native-session',
        mode: 'compare',
        dependencyGraph: { visible: true, enabled: true, status, html, url }
    };
}

test('dependency graph prefers the host-served URL and keeps srcdoc as a fallback', async () => {
    const { createWorkspaceControls } = await modulePromise;
    const document = new Document();
    const container = document.createElement('div');
    const controls = createWorkspaceControls({ container, send() {} });
    const root = find(container, node => node.className === 'workspace-controls');
    const dialog = find(root, node => node.className === 'workspace-dependency-dialog');
    const frame = find(dialog, node => node.tagName === 'IFRAME');
    const url = 'http://127.0.0.1:43123/dependency/test-token';

    controls.update(state('ready', '<p>fallback</p>', url));
    assert.equal(frame.src, url);
    assert.equal(frame.srcdoc, undefined);

    controls.update(state('idle'));
    assert.equal(frame.hidden, true);

    controls.update(state('ready', '<p>fallback</p>'));
    assert.equal(frame.srcdoc, '<p>fallback</p>');
});

test('dependency close button and Escape cancel the host without programmatic feedback', async () => {
    const { createWorkspaceControls } = await modulePromise;
    const document = new Document();
    const container = document.createElement('div');
    const messages = [];
    const controls = createWorkspaceControls({ container, send: message => messages.push(message) });
    const root = find(container, node => node.className === 'workspace-controls');
    const dependencyButton = find(root, node => node.className === 'workspace-dependency-button');
    const dialog = find(root, node => node.className === 'workspace-dependency-dialog');
    const closeButton = find(dialog, node => node.tagName === 'BUTTON' && node.textContent === 'Close');

    controls.update(state('ready', '<p>graph</p>'));
    closeButton.click();
    assert.deepEqual(messages.at(-1), { type: 'workspaceDependencyClose' });
    const afterButtonClose = messages.length;

    // Host-driven idle state must hide the dialog without sending another
    // close message back across the same channel.
    controls.update(state('idle', '<p>graph</p>'));
    assert.equal(messages.length, afterButtonClose);

    controls.update(state('ready', '<p>graph</p>'));
    dependencyButton.click();
    dialog.dispatchEvent({
        type: 'cancel',
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }
    });
    assert.deepEqual(messages.at(-1), { type: 'workspaceDependencyClose' });
    assert.equal(messages.filter(message => message.type === 'workspaceDependencyClose').length, 2);
});
