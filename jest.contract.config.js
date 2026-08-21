/**
 * Jest configuration for contract tests (P2P protocol boundaries,
 * per .specify/memory/constitution.md Testing Standards).
 *
 * Usage: pnpm test:contract  (jest --config jest.contract.config.js)
 *
 * passWithNoTests keeps the script green until the first contract
 * suites land in __tests__/contract/.
 */
module.exports = {
  testMatch: ['**/__tests__/contract/**/*.test.[jt]s?(x)'],
  passWithNoTests: true,
};
