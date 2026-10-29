'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { createMemoryStore } = require('../src/store/memoryStore');
const { createRedisStore } = require('../src/store/redisStore');
const { createFakeRedis } = require('./helpers');

const rec = (id, extra = {}) => ({
  id, recipient: 'a@b.com', subject: 'Hello', isFollowUp: false,
  sentAt: '2026-01-01T00:00:00.000Z', registeredAt: '2026-01-01T00:00:00.000Z', ...extra
});
const hit = { clientType: 'Gmail (Google Proxy)' };
const later = (s) => new Date(Date.parse('2026-01-01T00:00:00.000Z') + s * 1000);

const factories = {
  memory: () => createMemoryStore(),
  redis: () => createRedisStore(createFakeRedis())
};

for (const [name, make] of Object.entries(factories)) {
  test(`[${name}] تسجيل + فتح + عدّاد`, async () => {
    const s = make();
    const { created } = await s.saveEmail(rec('et_00000001'));
    assert.equal(created, true);

    assert.deepEqual(await s.recordOpen('et_00000001', hit, { graceMs: 4000, now: later(60) }), { recorded: true });
    await s.recordOpen('et_00000001', hit, { graceMs: 4000, now: later(120) });

    const e = await s.getEmail('et_00000001');
    assert.equal(e.openCount, 2);
    assert.equal(e.isRead, true);
    assert.equal(e.firstReadAt, later(60).toISOString());
    assert.equal(e.lastReadAt, later(120).toISOString());
    assert.equal(e.reads.length, 2);
    assert.equal(e.reads[0].timestamp, later(120).toISOString()); // الأحدث أولاً
  });

  test(`[${name}] فتح الراسل خلال فترة السماح يتجاهل، وID مجهول يتجاهل`, async () => {
    const s = make();
    await s.saveEmail(rec('et_00000002'));
    assert.equal((await s.recordOpen('et_00000002', hit, { graceMs: 4000, now: later(2) })).reason, 'self-open');
    assert.equal((await s.recordOpen('et_nope0000', hit, { now: later(60) })).reason, 'unknown');
    assert.equal((await s.getEmail('et_00000002')).openCount, 0);
  });

  test(`[${name}] إعادة التسجيل لا تمسح بيانات الفتح`, async () => {
    const s = make();
    await s.saveEmail(rec('et_00000003'));
    await s.recordOpen('et_00000003', hit, { now: later(60) });
    const again = await s.saveEmail(rec('et_00000003', { subject: 'changed' }));
    assert.equal(again.created, false);
    assert.equal(again.email.openCount, 1);
    assert.equal(again.email.subject, 'Hello');
  });

  test(`[${name}] فتحات متزامنة لا تضيع (atomic)`, async () => {
    const s = make();
    await s.saveEmail(rec('et_00000004'));
    await Promise.all(Array.from({ length: 25 }, (_, i) => s.recordOpen('et_00000004', hit, { now: later(60 + i) })));
    assert.equal((await s.getEmail('et_00000004')).openCount, 25);
  });

  test(`[${name}] list/stats/delete/clear والحد الأقصى للـ reads`, async () => {
    const s = make();
    await s.saveEmail(rec('et_00000005', { sentAt: '2026-01-01T00:00:00.000Z' }));
    await s.saveEmail(rec('et_00000006', { sentAt: '2026-01-02T00:00:00.000Z' }));
    await s.recordOpen('et_00000005', hit, { now: later(60) });

    const list = await s.listEmails();
    assert.deepEqual(list.map((e) => e.id), ['et_00000006', 'et_00000005']); // الأحدث أولاً
    assert.equal(list[0].reads, undefined); // القائمة بدون reads
    assert.deepEqual(await s.getStats(), { totalSent: 2, totalRead: 1 });

    for (let i = 0; i < 60; i++) await s.recordOpen('et_00000005', hit, { now: later(100 + i) });
    assert.equal((await s.getEmail('et_00000005')).reads.length, 50);

    assert.equal(await s.deleteEmail('et_00000005'), true);
    assert.equal(await s.deleteEmail('et_00000005'), false);
    assert.equal(await s.getEmail('et_00000005'), null);

    await s.clearAll();
    assert.deepEqual(await s.getStats(), { totalSent: 0, totalRead: 0 });
    assert.deepEqual(await s.listEmails(), []);
  });

  test(`[${name}] self-view: بيلغي الفتح الوهمي الأخير ويتجاهل اللي بعده، ويسيب القديم`, async () => {
    const s = make();
    await s.saveEmail(rec('et_selfview1'));
    await s.recordOpen('et_selfview1', hit, { now: later(60) });   // فتح حقيقي قديم
    await s.recordOpen('et_selfview1', hit, { now: later(95) });   // الراسل شاف رسالته
    const r = await s.markSelfView('et_selfview1', { windowMs: 30000, now: later(100) });
    assert.deepEqual(r, { found: true, discarded: 1 });
    assert.equal((await s.recordOpen('et_selfview1', hit, { now: later(110) })).reason, 'self-view');
    const e = await s.getEmail('et_selfview1');
    assert.equal(e.openCount, 1);
    assert.equal(e.reads.length, 1);
    assert.equal(e.firstReadAt, later(60).toISOString());
    assert.equal(e.lastReadAt, later(60).toISOString());
    assert.equal((await s.markSelfView('et_missing01')).found, false);
  });

  test(`[${name}] self-view لإيميل فتحه الوحيد وهمي: يرجع "لم يُقرأ"`, async () => {
    const s = make();
    await s.saveEmail(rec('et_selfview2'));
    await s.recordOpen('et_selfview2', hit, { now: later(10) });
    await s.markSelfView('et_selfview2', { windowMs: 30000, now: later(12) });
    const e = await s.getEmail('et_selfview2');
    assert.equal(e.openCount, 0);
    assert.equal(e.isRead, false);
    assert.equal(e.firstReadAt, null);
    assert.equal((await s.getStats()).totalRead, 0);
  });
}

test('[memory] الحفظ في ملف والتحميل منه (بما فيه صيغة السجلات القديمة)', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'etp-')), 'emails.json');
  const a = createMemoryStore({ persistPath: file });
  await a.saveEmail(rec('et_00000007'));
  await a.recordOpen('et_00000007', hit, { now: later(60) });

  const b = createMemoryStore({ persistPath: file });
  assert.equal((await b.getEmail('et_00000007')).openCount, 1);

  // سجل بصيغة النسخة القديمة (فيه حقول منسّقة وـ ip)
  fs.writeFileSync(file, JSON.stringify({
    et_legacy001: {
      id: 'et_legacy001', recipient: 'x@y.z', subject: 'old', sentAt: '2025-01-01T00:00:00.000Z',
      sentAtFormatted: { formatted: 'x' }, isRead: true, openCount: 1,
      firstReadAt: '2025-01-01T01:00:00.000Z', lastReadAt: '2025-01-01T01:00:00.000Z',
      reads: [{ timestamp: '2025-01-01T01:00:00.000Z', ip: '1.2.3.4', userAgent: 'ua', clientType: 'Google Chrome' }]
    }
  }));
  const c = createMemoryStore({ persistPath: file });
  const old = await c.getEmail('et_legacy001');
  assert.equal(old.openCount, 1);
  assert.equal(old.reads[0].ip, undefined); // الـ IP مش بيتحمّل
  assert.equal(old.sentAtFormatted, undefined);
});
