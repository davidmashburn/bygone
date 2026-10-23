// Test-only entry: observe the real production instances without changing their behavior.
const { activate: activateProduction } = require('../../src/extension');
const { DiffViewProvider } = require('../../src/diffViewProvider');
const { FollowController } = require('../../src/followController');


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
    activateProduction(context);
    return observed;
}
