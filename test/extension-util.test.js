'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ETP = require('../extension/shared/util');
const { isValidId } = require('../src/lib/validate');

test('newTrackingId يطابق صيغة السيرفر وفريد', () => {
  const ids = new Set(Array.from({ length: 200 }, () => ETP.newTrackingId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.ok(isValidId(id), id);
});

test('PIXEL_SRC_RE يمسك الروابط الجديدة والقديمة ولا يمسك غيرها', () => {
  for (const ok of ['https://x.vercel.app/track/pixel/et_abc12345', 'https://h/pixel/et_1717_abc.gif', 'http://localhost:3000/track/pixel/et_a1b2c3d4?_t=1']) {
    assert.ok(ETP.PIXEL_SRC_RE.test(ok), ok);
  }
  assert.equal(ETP.PIXEL_SRC_RE.test('https://cdn.example.com/logo.png'), false);
});

test('normalizeUrl / cleanSubject / formatTime', () => {
  assert.equal(ETP.normalizeUrl(' https://a.b/// '), 'https://a.b');
  assert.equal(ETP.cleanSubject('Re:   Hello​  World '), 'hello world');
  assert.equal(ETP.cleanSubject('رد: موضوع'), 'موضوع');
  assert.equal(ETP.formatTime(null), '');
  assert.equal(ETP.formatTime('garbage'), '');
  assert.ok(ETP.formatTime('2026-01-01T12:00:00Z', 'Africa/Cairo').length > 5);
  assert.ok(ETP.formatTime('2026-01-01T12:00:00Z', 'Not/AZone').length > 5); // fallback
});
