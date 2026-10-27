'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrate, LEGACY_KEY } = require('../scripts/migrate-legacy');
const { createRedisStore } = require('../src/store/redisStore');
const { createFakeRedis } = require('./helpers');

test('ترحيل النسخة القديمة: يشيل الأشباح وقراءات البوتات والـ IP', async () => {
  const redis = createFakeRedis();
  const human = { timestamp: '2025-01-01T01:00:00.000Z', ip: '9.9.9.9', userAgent: 'Mozilla/5.0 GoogleImageProxy', clientType: 'Gmail (Google Proxy)' };
  const robot = { timestamp: '2025-01-01T00:59:00.000Z', ip: '8.8.8.8', userAgent: 'curl/8', clientType: 'Web / Email Client' };
  await redis.hset(LEGACY_KEY, {
    et_old000001: JSON.stringify({ id: 'et_old000001', recipient: 'a@b.com', subject: 'S', sentAt: '2025-01-01T00:00:00.000Z', isRead: true, openCount: 2, reads: [robot, human] }),
    et_ghost0001: JSON.stringify({ id: 'et_ghost0001', recipient: 'مستلم غير محدد', subject: 'x', sentAt: '2025-01-01T00:00:00.000Z' }),
    et_broken001: 'not-json{'
  });
  const store = createRedisStore(redis);

  const dry = await migrate(redis, store, { dryRun: true, log() {} });
  assert.equal(dry.imported, 1);
  assert.deepEqual(await store.listEmails(), []); // dry-run مبيكتبش

  const stats = await migrate(redis, store, { log() {} });
  assert.deepEqual(stats, { found: 3, imported: 1, ghosts: 1, invalid: 1, botReadsDropped: 1 });

  const e = await store.getEmail('et_old000001');
  assert.equal(e.openCount, 1);
  assert.equal(e.isRead, true);
  assert.equal(e.reads[0].ip, undefined);
  assert.ok(await redis.hget(LEGACY_KEY, 'et_old000001')); // القديم لسه موجود
});
