'use strict';

// No Git access, UI dependencies, artifact validation, or Java runtime.
module.exports = {
    ...require('./src/symbol-inventory'),
    ...require('./src/js-correspondence'),
    ...require('./src/input'),
    ...require('./src/identity'),
    ...require('./source-references')
};
