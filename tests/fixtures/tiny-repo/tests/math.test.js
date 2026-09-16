import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, clamp } from '../src/math.js';
test('add', () => assert.equal(add(2, 3), 5));
test('clamp low', () => assert.equal(clamp(-1, 0, 10), 0));
test('clamp high', () => assert.equal(clamp(99, 0, 10), 10));
