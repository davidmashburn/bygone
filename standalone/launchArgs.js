function getCliArgsFromArgv(argv, { defaultApp = Boolean(process.defaultApp) } = {}) {
    const args = defaultApp ? argv.slice(2) : argv.slice(1);
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

module.exports = {
    getCliArgsFromArgv,
    getForwardedLaunchArgs
};
