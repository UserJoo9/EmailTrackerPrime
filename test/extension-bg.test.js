'use strict';
// بيشغّل background.js الحقيقي داخل vm بـ chrome وهمي، ويكلم سيرفر حقيقي (in-process).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createApp } = require('../src/create-app');
const { createMemoryStore } = require('../src/store/memoryStore');
const { loadConfig } = require('../src/config');

function bootBackground({ serverUrl, apiKey, initial = {} }) {
  const storage = { serverUrl, apiKey, ...initial };
  const listeners = {};
  const chrome = {
    storage: { local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(ks.filter((k) => k in storage).map((k) => [k, JSON.parse(JSON.stringify(storage[k]))]));
      },
      async set(obj) { Object.assign(storage, JSON.parse(JSON.stringify(obj))); }
    } },
    alarms: { get(name, cb) { cb(undefined); }, create() {}, onAlarm: { addListener(f) { listeners.alarm = f; } } },
    runtime: {
      onMessage: { addListener(f) { listeners.message = f; } },
      onInstalled: { addListener(f) { listeners.installed = f; } },
      onStartup: { addListener() {} }
    }
  };
  const ctx = vm.createContext({
    chrome, fetch, AbortController, setTimeout, clearTimeout, console, URL,
    importScripts: (file) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf-8'), ctx)
  });
  ctx.self = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf-8'), ctx, { filename: 'background.js' });
  // نطبّع النتيجة عشان الكائنات القادمة من vm لها prototype مختلف
  const send = (msg) => new Promise((resolve) => { listeners.message(msg, {}, (r) => resolve(JSON.parse(JSON.stringify(r)))); });
  return { storage, send };
}

async function withServer(fn) {
  const config = { ...loadConfig({}), apiKey: 'k3y', selfOpenGraceMs: 0 };
  const store = createMemoryStore();
  const server = createApp({ config, store }).listen(0);
  try { await fn({ url: `http://127.0.0.1:${server.address().port}`, store }); } finally { server.close(); }
}

const payload = (id) => ({ id, recipient: 'a@b.com', subject: 'Hello', isFollowUp: false, sentAt: new Date().toISOString() });

test('تسجيل إيميل: يتحفظ في الكاش ويتسجل على السيرفر ويتعلّم synced', async () => {
  await withServer(async ({ url, store }) => {
    const bg = bootBackground({ serverUrl: url, apiKey: 'k3y' });
    const res = await bg.send({ type: 'REGISTER_EMAIL', payload: payload('et_bgtest0001') });
    assert.deepEqual(res, { success: true });
    assert.equal((await store.getEmail('et_bgtest0001')).recipient, 'a@b.com');
    assert.equal(bg.storage.cachedEmails[0].synced, true);
    assert.equal(bg.storage.connection.state, 'ok');
  });
});

test('مفتاح غلط: يتحفظ محلياً فقط والحالة unauthorized', async () => {
  await withServer(async ({ url, store }) => {
    const bg = bootBackground({ serverUrl: url, apiKey: 'wrong' });
    const res = await bg.send({ type: 'REGISTER_EMAIL', payload: payload('et_bgtest0002') });
    assert.equal(res.localOnly, true);
    assert.equal(res.reason, 'unauthorized');
    assert.equal(bg.storage.connection.state, 'unauthorized');
    assert.equal(await store.getEmail('et_bgtest0002'), null);
    assert.equal(bg.storage.cachedEmails[0].synced, false); // لسه مستني
  });
});

test('السيرفر واقف: محفوظ محلياً، وبعد ما يرجع الـ refresh بيزامنه', async () => {
  await withServer(async ({ url, store }) => {
    const bg = bootBackground({ serverUrl: 'http://127.0.0.1:1', apiKey: 'k3y' });
    const res = await bg.send({ type: 'REGISTER_EMAIL', payload: payload('et_bgtest0003') });
    assert.equal(res.reason, 'offline');
    assert.equal(bg.storage.connection.state, 'offline');

    bg.storage.serverUrl = url; // السيرفر رجع
    const list = (await bg.send({ type: 'GET_EMAILS', force: true })).emails;
    assert.equal(list.length, 1);
    assert.equal(list[0].synced, true);
    assert.ok(await store.getEmail('et_bgtest0003'));
  });
});

test('تسجيلات متزامنة كتير مفيهاش lost update في الكاش', async () => {
  await withServer(async ({ url }) => {
    const bg = bootBackground({ serverUrl: url, apiKey: 'k3y' });
    await Promise.all(Array.from({ length: 20 }, (_, i) => bg.send({ type: 'REGISTER_EMAIL', payload: payload(`et_conc${String(i).padStart(4, '0')}`) })));
    assert.equal(bg.storage.cachedEmails.length, 20);
  });
});

test('الكاش القديم (من نسخة قبل التحديث) بيتزامن مع السيرفر الجديد', async () => {
  await withServer(async ({ url, store }) => {
    const legacy = [{ id: 'et_oldcache01', recipient: 'x@y.z', subject: 'Old', sentAt: '2025-05-05T00:00:00.000Z', isRead: false, openCount: 0 }];
    const bg = bootBackground({ serverUrl: url, apiKey: 'k3y', initial: { cachedEmails: legacy } });
    const emails = (await bg.send({ type: 'GET_EMAILS', force: true })).emails;
    assert.equal(emails[0].synced, true);
    assert.ok(await store.getEmail('et_oldcache01'));
  });
});

test('أوامر الـ popup: فحص السيرفر، الإحصائيات، تفاصيل، ومسح الكل', async () => {
  await withServer(async ({ url, store }) => {
    const bg = bootBackground({ serverUrl: url, apiKey: 'k3y' });
    await bg.send({ type: 'REGISTER_EMAIL', payload: payload('et_popup00001') });
    await store.recordOpen('et_popup00001', { clientType: 'Gmail (Google Proxy)' }, { now: new Date(Date.now() + 60000) });

    assert.deepEqual(await bg.send({ type: 'CHECK_SERVER' }), { reachable: true, authorized: true });
    assert.deepEqual(await bg.send({ type: 'CHECK_SERVER', settings: { serverUrl: url, apiKey: 'bad' } }), { reachable: true, authorized: false, status: 401 });
    assert.equal((await bg.send({ type: 'CHECK_SERVER', settings: { serverUrl: 'http://127.0.0.1:1' } })).reachable, false);

    assert.equal((await bg.send({ type: 'GET_STATS' })).stats.totalRead, 1);
    assert.equal((await bg.send({ type: 'GET_EMAIL_STATUS', emailId: 'et_popup00001' })).email.reads.length, 1);

    assert.equal((await bg.send({ type: 'CLEAR_ALL' })).success, true);
    assert.deepEqual(bg.storage.cachedEmails, []);
    assert.deepEqual(await store.listEmails(), []);

    const wrong = bootBackground({ serverUrl: url, apiKey: 'bad', initial: { cachedEmails: [{ id: 'keep' }] } });
    assert.deepEqual(await wrong.send({ type: 'CLEAR_ALL' }), { success: false, error: 'unauthorized' });
    assert.equal(wrong.storage.cachedEmails.length, 1); // مفيش مسح محلي لو السيرفر رفض
  });
});
