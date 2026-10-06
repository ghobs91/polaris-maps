/**
 * Root Jest configuration for the default `pnpm test` run.
 *
 * Uses the jest-expo preset so Expo and React Native ESM packages inside
 * node_modules are transformed. babel-preset-expo alone is not enough because
 * the default transform ignores node_modules, which makes files like
 * `expo/virtual/env.js` fail with "Unexpected token 'export'".
 *
 * testMatch is scoped to `__tests__/` so Jest does not pick up vendored test
 * files checked into DerivedData under `build/` and `ios/build/`.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/build/',
    '/ios/build/',
    '/android/build/',
    '/backend/',
    '/nodejs-assets/',
  ],
};
