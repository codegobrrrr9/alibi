import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUser, listTeam, paginate, initials } from '../src/users.js';
import { handle, displayName } from '../src/api.js';

test('getUser finds by id', () => assert.equal(getUser(3).name, 'Linus'));
test('getUser returns null for unknown', () => assert.equal(getUser(99), null));
test('listTeam', () => assert.deepEqual(listTeam('kernel'), ['Linus', 'Dennis']));
test('paginate page 1 of size 2', () => assert.deepEqual(paginate(1, 2).map(u => u.id), [1, 2]));
test('initials', () => assert.equal(initials({ name: 'Ada Lovelace' }), 'AL'));
test('api routes', () => { assert.equal(handle('/user', { id: '2' }).name, 'Grace'); assert.equal(displayName(4), 'Margaret (flight)'); });
