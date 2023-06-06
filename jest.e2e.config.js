const commonConfig = require("./jest.config.js");

/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = { ...commonConfig, testMatch: ["**/?(*.)+(e2e).[jt]s?(x)"], testTimeout: 10 * 60_000 };
