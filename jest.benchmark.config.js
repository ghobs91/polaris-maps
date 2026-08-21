/**
 * Jest configuration for performance benchmarks.
 *
 * Usage: pnpm test:benchmark  (jest --config jest.benchmark.config.js)
 *
 * Benchmarks live in __tests__/benchmark/*.bench.ts and are excluded
 * from the default `pnpm test` run via this config's testMatch.
 */
module.exports = {
  testMatch: ['**/__tests__/benchmark/**/*.bench.[jt]s?(x)'],
};
