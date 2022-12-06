const { getConfiguration } = require("opstooling-js-style/src/eslint/configuration");

module.exports = getConfiguration({ typescript: { rootDir: __dirname } });
