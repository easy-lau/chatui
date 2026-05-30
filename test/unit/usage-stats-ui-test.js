const assert = require('assert');
const { formatTokens } = require('../../client/ui/usage-stats');

assert.strictEqual(formatTokens(999999), '999,999');
assert.strictEqual(formatTokens(1000000), '1M');
assert.strictEqual(formatTokens(100000000), '100M');
assert.strictEqual(formatTokens(999999999), '1000M');
assert.strictEqual(formatTokens(1000000000), '1B');
assert.strictEqual(formatTokens(1250000000), '1.25B');
assert.strictEqual(formatTokens(-100000000), '-100M');

console.log('usage-stats-ui tests passed');
