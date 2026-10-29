function getCliArgsFromArgv(argv, { defaultApp = Boolean(process.defaultApp) } = {}) {
    // AppImage's launcher may prepend this Electron switch when user namespaces
    // are unavailable. Electron consumes it, but also leaves it in process.argv.
    const args = (defaultApp ? argv.slice(2) : argv.slice(1))
        .filter(arg => arg !== '--no-sandbox');
    return args[0]?.endsWith('standalone-main.js') ? args.slice(1) : args;
}

function getForwardedLaunchArgs(argv, additionalData, options) {
    if (additionalData
        && typeof additionalData === 'object'
        && Array.isArray(additionalData.launchArgs)
        && additionalData.launchArgs.every((arg) => typeof arg === 'string')) {
        return additionalData.launchArgs;
    }
    return getCliArgsFromArgv(argv, options);
}

function extractReadOnlyLaunchOption(args) {
    const filteredArgs = args.filter((arg) => arg !== '--read-only');
    return {
        args: filteredArgs,
        readOnly: filteredArgs.length !== args.length
    };
}

module.exports = {
    extractReadOnlyLaunchOption,
    getCliArgsFromArgv,
    getForwardedLaunchArgs
};
