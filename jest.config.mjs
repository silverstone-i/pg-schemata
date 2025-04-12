export default {
  transform: {
    "^.+\\.js$": ["@swc/jest"],
  },
  testEnvironment: "node",
  verbose: true,
};