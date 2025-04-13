export default {
  transform: {
    '^.+\\.js$': ['@swc/jest'],
  },
  testEnvironment: 'node',
  verbose: true,
  // setupFilesAfterEnv: ['<rootDir>/tests/setupTests.js'],
};
