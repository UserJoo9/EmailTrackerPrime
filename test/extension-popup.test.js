'use strict';
// بيشغّل popup.html + popup.js الحقيقيين في jsdom.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ext = (f) => fs.readFileSync(path.join(__dirname, '..', 'extension', f), 'utf-8');

async function bootPopup({ emails = [], storage = {} } = {}) {
  const html = ext('popup/popup.html').replace(/<script[^>]*><\/script>/g, '').replace(/<link[^>]*>/g, '');
  const dom = new JSDOM(html, { url: 'chrome-extension://abc/popup/popup.html', runScripts: 'outside-only' });
  const { window } = dom;
  const sent = [];
  const local = { serverUrl: 'https://email-tracker-prime.vercel.app', ...storage };
  window.chrome = {
    storage: { local: { get(k, cb) { cb(JSON.parse(JSON.stringify(local))); }, set(o, cb) { Object.assign(local, o); cb && cb(); } } },
    permissions: { contains: async () => true, request: async () => true },
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        sent.push(msg);
        const replies = {
          GET_EMAILS: { success: true, emails },
          GET_STATS: { success: true, stats: { totalSent: emails.length, totalRead: 0, totalUnread: emails.length, openRate: 0 } },
          CHECK_SERVER: { reachable: true, authorized: true },
          CLEAR_ALL: { success: true }
        };
        cb && cb(replies[msg.type] || { success: true });
      }
    }
  };
  window.eval(ext('shared/util.js'));
  window.eval(ext('popup/popup.js'));
  // DOMContentLoaded الحقيقي بيتطلّق من jsdom لما التحميل يخلص
  if (window.document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r));
  return { window, document: window.document, sent, local };
}

test('popup: الإيميلات بتتعرض كنص (XSS) والـ API key بيتحفظ', async () => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  const t = await bootPopup({ emails: [{ id: 'et_popup00001', recipient: evil, subject: evil, isFollowUp: true, sentAt: '2026-01-01T10:00:00Z', isRead: false, openCount: 0 }] });

  const list = t.document.getElementById('emails-list');
  assert.equal(list.querySelectorAll('img').length, 0);
  assert.ok(list.textContent.includes(evil));
  assert.equal(t.window.__pwned, undefined);

  t.document.getElementById('setting-api-key').value = '  my-secret  ';
  t.document.getElementById('btn-save-settings').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.local.apiKey, 'my-secret');
  assert.equal(t.local.serverUrl, 'https://email-tracker-prime.vercel.app');
});

test('popup: مسح الكل بيعدّي على الـ background (مفيش fetch مباشر)', async () => {
  const t = await bootPopup({ emails: [{ id: 'et_popup00002', recipient: 'a@b.com', subject: 'S', sentAt: '2026-01-01T10:00:00Z', isRead: true, openCount: 1, firstReadAt: '2026-01-01T11:00:00Z' }] });
  t.window.confirm = () => true;
  t.document.getElementById('btn-clear-all').click();
  assert.ok(t.sent.some((m) => m.type === 'CLEAR_ALL'));
  assert.match(t.document.getElementById('emails-list').textContent, /لا توجد إيميلات/);
});
