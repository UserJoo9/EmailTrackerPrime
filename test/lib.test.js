'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidId, parseEmailInput } = require('../src/lib/validate');
const { parseUserAgent, isBotOrPrefetch } = require('../src/lib/userAgent');

test('isValidId يقبل الـ IDs القديمة والجديدة ويرفض الغريب', () => {
  assert.ok(isValidId('et_1717000000000_abc123x'));
  assert.ok(isValidId('et_0f8fad5bd9cb469fa16570867728950e'));
  for (const bad of ['', 'short', 'has space here', 'a/b/c/d/e/f/g/h', '../../etc/passwd', 'x'.repeat(65), null, 42]) {
    assert.equal(isValidId(bad), false, String(bad));
  }
});

test('parseEmailInput ينضّف ويحدد القيم الافتراضية', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const r = parseEmailInput({ id: 'et_abcdefgh', recipient: '  a@b.com\n', subject: 'Re: hi', sentAt: 'garbage' }, now);
  assert.ok(r.ok);
  assert.equal(r.value.recipient, 'a@b.com');
  assert.equal(r.value.isFollowUp, true);
  assert.equal(r.value.sentAt, now.toISOString());
});

test('parseEmailInput يرفض body فاسد ويحدّ الأطوال ويرفض التاريخ المستقبلي البعيد', () => {
  assert.equal(parseEmailInput(null).ok, false);
  assert.equal(parseEmailInput({ id: '../x' }).ok, false);
  const now = new Date('2026-01-01T00:00:00Z');
  const r = parseEmailInput({ id: 'et_abcdefgh', subject: 'x'.repeat(2000), sentAt: '2030-01-01T00:00:00Z' }, now);
  assert.equal(r.value.subject.length, 500);
  assert.equal(r.value.sentAt, now.toISOString());
});

test('bot filter: بيمسك الماسحات وما بيمسكش Gmail proxy', () => {
  const gmail = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)';
  assert.equal(isBotOrPrefetch(gmail, {}), false);
  assert.equal(isBotOrPrefetch('Mozilla/5.0 (compatible; Googlebot/2.1)', {}), true);
  assert.equal(isBotOrPrefetch('curl/8.0', {}), true);
  assert.equal(isBotOrPrefetch('Mozilla/5.0 Chrome/42.0.2311.135 Safari/537.36 Edge/12.246', {}), true);
  assert.equal(isBotOrPrefetch(gmail, { purpose: 'prefetch' }), true);
});

test('parseUserAgent: Edge لا يتصنف Chrome', () => {
  assert.equal(parseUserAgent('Mozilla/5.0 Chrome/120 Safari/537 Edg/120'), 'Microsoft Edge');
  assert.equal(parseUserAgent('Mozilla/5.0 Chrome/120 Safari/537'), 'Google Chrome');
  assert.equal(parseUserAgent('x GoogleImageProxy'), 'Gmail (Google Proxy)');
});
