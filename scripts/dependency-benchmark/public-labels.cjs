// Hand-read complete edge lists for selected files at pinned public revisions.
// Expected endpoints express source intent, so Redux's unsupported config is a
// measured capability miss, not an expected successful resolution.
const edge = (file, specifier, relationship, phase, target) => ({ file, specifier, relationship, phase, loading: 'eager', resolution: target ? 'resolved' : 'unresolved', ...(target ? { target } : {}) });
module.exports = {
    express: {
        head: '1c6f1b0fe4000977b9a7b4f34097e4d527dd9824', files: ['index.js', 'lib/express.js'],
        expected: [edge('index.js', './lib/express', 'require', 'module-init', 'lib/express.js'),
            ...['body-parser', 'node:events', 'merge-descriptors', './application', 'router', './request', './response', 'serve-static'].map(s =>
                edge('lib/express.js', s, 'require', 'module-init', s.startsWith('./') ? `lib/${s.slice(2)}.js` : undefined))]
    },
    'p-limit': {
        head: 'a8a6fbec4e0e866d6d779b10889bb4f5567e70eb', files: ['index.js'],
        expected: [edge('index.js', 'yocto-queue', 'import', 'module-init')]
    },
    redux: {
        head: '61ebf8596654cf3c4b197e426e302fcb3c2bc13e', files: ['src/index.ts'],
        expected: [
            ...['createStore', 'combineReducers', 'bindActionCreators', 'applyMiddleware', 'compose', 'utils/isAction', 'utils/isPlainObject', 'utils/actionTypes'].map(s => edge('src/index.ts', `./${s}`, 'import', 'module-init', `src/${s}.ts`)),
            ...['store', 'reducers', 'actions', 'middleware', 'actions'].map(s => edge('src/index.ts', `./types/${s}`, 'reexport', 'type', `src/types/${s}.ts`))
        ]
    }
};
