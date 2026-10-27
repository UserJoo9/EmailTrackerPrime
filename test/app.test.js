'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryStore } = require('../src/store/memoryStore');
const { loadConfig } = require('../src/config');

async function withServer(envOverrides, fn) {
  const config = { ...loadConfig({}), apiKey: 'secret-key', selfOpenGraceMs: 0, ...envOverrides };
  const store = createMemoryStore();
  const server = createApp({ config, store }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ base, store, config }); } finally { server.close(); }
}

const auth = { Authorization: 'Bearer secret-key', 'Content-Type': 'application/json' };
const reg = (base, body) => fetch(`${base}/api/emails`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
const GMAIL_UA = 'Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)';

test('الـ API يرفض بدون مفتاح أو بمفتاح غلط', async () => {
  await withServer({}, async ({ base }) => {
    for (const [method, path] of [['GET', '/api/emails'], ['GET', '/api/stats'], ['DELETE', '/api/emails'], ['POST', '/api/emails']]) {
      assert.equal((await fetch(base + path, { method })).status, 401, `${method} ${path}`);
      assert.equal((await fetch(base + path, { method, headers: { Authorization: 'Bearer wrong' } })).status, 401);
    }
  });
});

test('في الإنتاج بدون API_KEY السيرفر يرفض (fail closed)، محلياً يسمح', async () => {
  await withServer({ apiKey: '', isProd: true }, async ({ base }) => {
    assert.equal((await fetch(`${base}/api/emails`)).status, 503);
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
  });
  await withServer({ apiKey: '', isProd: false }, async ({ base }) => {
    assert.equal((await fetch(`${base}/api/emails`)).status, 200);
  });
});

test('تسجيل إيميل ثم فتحه بالـ pixel (المسارين القدام والجديد) ويظهر في الإحصائيات', async () => {
  await withServer({}, async ({ base }) => {
    assert.equal((await reg(base, { id: 'et_testid0001', recipient: 'a@b.com', subject: 'Hi' })).status, 201);
    assert.equal((await reg(base, { id: 'et_testid0001', recipient: 'other', subject: 'x' })).status, 200); // idempotent

    for (const p of ['/track/pixel/et_testid0001?_t=1', '/pixel/et_testid0001', '/pixel/et_testid0001.gif']) {
      const res = await fetch(base + p, { headers: { 'User-Agent': GMAIL_UA } });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/gif');
      assert.match(res.headers.get('cache-control'), /no-store/);
    }
    // بوت: لازم يرد بالصورة لكن ما يتحسبش
    await fetch(`${base}/pixel/et_testid0001`, { headers: { 'User-Agent': 'curl/8' } });

    const one = await (await fetch(`${base}/api/emails/et_testid0001`, { headers: auth })).json();
    assert.equal(one.email.openCount, 3);
    assert.equal(one.email.recipient, 'a@b.com');

    const stats = await (await fetch(`${base}/api/stats`, { headers: auth })).json();
    assert.deepEqual(stats.stats, { totalSent: 1, totalRead: 1, totalUnread: 0, openRate: 100 });
  });
});

test('pixel لـ ID مجهول أو فاسد يرد بالصورة بدون ما يكسر', async () => {
  await withServer({}, async ({ base }) => {
    for (const p of ['/pixel/et_unknown001', '/pixel/..%2F..%2Fx', '/track/pixel/%00']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
    }
  });
});

test('تحقق من المدخلات: id فاسد، JSON فاسد، حد الـ sync', async () => {
  await withServer({ syncBatchLimit: 2 }, async ({ base }) => {
    assert.equal((await reg(base, { id: '../etc', recipient: 'x' })).status, 400);
    const bad = await fetch(`${base}/api/emails`, { method: 'POST', headers: auth, body: '{not json' });
    assert.equal(bad.status, 400);
    const many = await fetch(`${base}/api/emails/sync`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ emails: [1, 2, 3].map((i) => ({ id: `et_sync000${i}` })) })
    });
    assert.equal(many.status, 413);
  });
});

test('XSS: القيم بتتخزن كنص وبتترجع JSON فقط (والداشبورد ما بيعملش innerHTML)', async () => {
  await withServer({}, async ({ base }) => {
    await reg(base, { id: 'et_xss000001', recipient: '<img src=x onerror=alert(1)>', subject: '<script>alert(1)</script>' });
    const res = await fetch(`${base}/api/emails`, { headers: auth });
    assert.match(res.headers.get('content-type'), /application\/json/);
    const { emails } = await res.json();
    assert.equal(emails[0].subject, '<script>alert(1)</script>');
    const js = await (await fetch(`${base}/dashboard.js`)).text();
    assert.equal(/innerHTML|insertAdjacentHTML|document\.write/.test(js), false);
  });
});

test('الداشبورد ملف ثابت بدون بيانات، مع CSP، ومسح الكل محمي', async () => {
  await withServer({}, async ({ base }) => {
    await reg(base, { id: 'et_secret0001', recipient: 'victim@example.com', subject: 'confidential' });
    const page = await fetch(base + '/');
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.ok(page.headers.get('content-security-policy'));
    assert.equal(html.includes('victim@example.com'), false);
    assert.equal((await fetch(`${base}/api/emails`, { method: 'DELETE' })).status, 401);
    assert.equal((await fetch(`${base}/api/emails/clear`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/api/emails`, { method: 'DELETE', headers: auth })).status, 200);
  });
});
