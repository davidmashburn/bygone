const path = require('path');

function resolveWorkingDirectory(args, initialCwd) {
    const remainingArgs = [...args];
    let cwd = path.resolve(initialCwd);

    while (remainingArgs[0] === '-C') {
        const directory = remainingArgs[1];
        if (!directory) {
            throw new Error('-C requires a directory.');
        }
        cwd = path.resolve(cwd, directory);
        remainingArgs.splice(0, 2);
    }

    return { args: remainingArgs, cwd };
}

module.exports = { resolveWorkingDirectory };
