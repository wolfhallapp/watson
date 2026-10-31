// The Starlink dish reader's protobuf decoding (no dish needed) and the Oracle's no-proxy rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '../server/starlink.js';
import { ORACLE } from '../server/agent.js';
import { config } from '../server/config.js';

test('decodes varints, floats and nested messages like the dish sends', () => {
  const f = Buffer.alloc(4); f.writeFloatLE(39.5);
  // field 2 varint 222961, field 1009 float 39.5, field 1004 { field 1 varint 7 }
  const nested = Buffer.from([0x08, 0x07]);
  const msg = Buffer.concat([
    Buffer.from([0x10, 0xf1, 0xcd, 0x0d]),
    Buffer.from([0x8d, 0x3f]), f,
    Buffer.from([0xe2, 0x3e, nested.length]), nested,
  ]);
  const out = decode(msg);
  assert.equal(out[0].field, 2); assert.equal(out[0].value, 222961);
  assert.equal(out[1].field, 1009); assert.equal(out[1].value, 39.5);
  assert.equal(out[2].field, 1004); assert.deepEqual(decode(out[2].value), [{ field: 1, wire: 0, value: 7 }]);
});

test('the Oracle is told there is no proxy and to use network_check', () => {
  const p = ORACLE.prompt();
  assert.match(p, /no proxy/i);
  assert.match(p, /network_check/);
});

test('Claude gets more patience on a flaky connection', () => {
  assert.ok(Number(config.claudeMaxRetries) >= 10);
  assert.ok(Number(config.apiTimeoutMs) >= 600000);
});
