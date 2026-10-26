import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHarnessBootstrap } from '../lib/bootstrap.js';

const token = 'test-bootstrap-token-123456789';
test('accepts only the official loopback bootstrap URL on the configured port', () => {
  const url = `http://127.0.0.1:3080/?token=${token}`;
  assert.equal(parseHarnessBootstrap(`dsh web: ${url}`, '3080'), url);
  assert.equal(parseHarnessBootstrap(`dsh web: ${url}`, '0'), url);
  assert.equal(parseHarnessBootstrap(`\u001b[32mdsh web: ${url}\u001b[0m`, '3080'), url);
  for (const bad of [
    `http://example.com:3080/?token=${token}`,
    `http://user:pass@127.0.0.1:3080/?token=${token}`,
    `http://127.0.0.1:3081/?token=${token}`,
    `http://127.0.0.1:3080/other?token=${token}`,
    `http://127.0.0.1:3080/?token=${token}&redirect=evil`,
    `http://127.0.0.1:3080/?token=${token}&token=${token}`,
    `http://127.0.0.1:3080/?token=${token}#fragment`,
    'http://127.0.0.1:3080/',
    `https://127.0.0.1:3080/?token=${token}`,
  ]) assert.equal(parseHarnessBootstrap(`dsh web: ${bad}`, '3080'), null);
  assert.equal(parseHarnessBootstrap(`untrusted message dsh web: ${url}`, '3080'), null);
  assert.equal(parseHarnessBootstrap(`dsh web: ${url}`, 'invalid'), null);
});
