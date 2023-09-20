/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  transform: {
    "^.+\\.ts?$": ["esbuild-jest"],
  },
  testEnvironment: "node",
};
