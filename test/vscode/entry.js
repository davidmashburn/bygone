// Test-only entry: observe the real production instances without changing their behavior.
const { activate: activateProduction } = require('../../src/extension');
const { DiffViewProvider } = require('../../src/diffViewProvider');
const { EvidenceController } = require('../../src/evidenceController');
const { FollowController } = require('../../src/followController');
const { DependencyController } = require('../../src/dependencyController');


exports.activate = function(context) {
    const observed = { provider: undefined, controller: undefined, renders: 0 };
    const create = DiffViewProvider.prototype.createFollowingView;
    DiffViewProvider.prototype.createFollowingView = function(...args) {
        observed.provider = this;
        const view = create.apply(this, args);
        this.panels.get('follow').panel.webview.onDidReceiveMessage(message => {
            if (message.type === 'renderComplete') ++observed.renders;
        });
        return view;
    };
    const start = FollowController.prototype.start;
    FollowController.prototype.start = function() {
        observed.controller = this;
        start.call(this);
    };
    const open = EvidenceController.prototype.open;
    const openDependencies = DependencyController.prototype.open;
    DependencyController.prototype.open = async function(...args) {
        observed.dependencies = this;
        return openDependencies.apply(this, args);
    };
    EvidenceController.prototype.open = async function(...args) {
        observed.evidence = this;
        return open.apply(this, args);
    };
    activateProduction(context);
    return observed;
}
