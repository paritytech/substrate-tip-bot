const { getConfiguration } = require("opstooling-js-style/src/eslint/configuration");

const conf = getConfiguration({ typescript: { rootDir: __dirname } });

conf.overrides[0].rules["@typescript-eslint/no-misused-promises"] = "off";
conf.overrides[0].rules["no-async-promise-executor"] = "off";

module.exports = conf;
