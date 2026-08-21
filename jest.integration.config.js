/**
 * Jest configuration for integration tests.
 *
 * Usage: pnpm test:integration  (jest --config jest.integration.config.js)
 *
 * The jest-expo preset provides the react-native/expo transform setup
 * needed to render components (babel-preset-expo is not enough on its
 * own because node_modules are ignored by the default transform).
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/integration/**/*.test.[jt]s?(x)'],
};
