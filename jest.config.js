/** @type {import("ts-jest/dist/types").InitialOptionsTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["./src"],
  testTimeout: 30_000,
  // Couldn't fix an issue with moduleNameMapper and subpath imports both locally
  // and in node_modules. Ended up with a custom resolver.
  // https://github.com/jestjs/jest/issues/14032
  // https://github.com/jestjs/jest/issues/12270
  resolver: "<rootDir>/jest.resolver.js",
};
