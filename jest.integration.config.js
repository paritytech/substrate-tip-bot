const commonConfig = require("./jest.config.js");

/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = { ...commonConfig, testMatch: ["**/?(*.)+(integration).[jt]s?(x)"], testTimeout: 2 * 60_000 };
