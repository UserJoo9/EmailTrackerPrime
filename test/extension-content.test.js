'use strict';
// بيشغّل content.js الحقيقي على DOM شبيه بـ Gmail (jsdom) بـ chrome وهمي.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { isValidId } = require('../src/lib/validate');

const ext = (f) => fs.readFileSync(path.join(__dirname, '..', 'extension', f), 'utf-8');

const GMAIL_HTML = `
<header><a aria-label="Google Account: Me (me@gmail.com)">me</a></header>
<div class="AD" role="dialog">
  <input name="subjectbox" value="Project update">
  <div class="aoD hl"><span email="client@acme.com" class="vN">Client</span><span email="me@gmail.com" class="vN">Me</span></div>
  <div contenteditable="true" role="textbox" id="body">Hi there</div>
  <div class="btC"><div role="button" class="T-I aoO" data-tooltip="Send (Ctrl-Enter)"><span id="send-label">Send</span></div>
  <div role="button" class="T-I" data-tooltip="More send options" id="more-send">v</div></div>
</div>
<table><tr class="zA" id="row"><td class="yX xY"><div class="yW"><span class="bA4" email="client@acme.com">Client</span></div></td>
<td class="y6"><span class="bog">Project update</span></td></tr></table>`;

function boot({ cachedEmails = [], hash = '#inbox', html = GMAIL_HTML } = {}) {
  const dom = new JSDOM(`<!doctype html><title>Inbox - me@gmail.com - Gmail</title><body>${html}</body>`,
    { url: `https://mail.google.com/mail/u/0/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const sent = [];
  const storageListeners = [];
  const storage = { serverUrl: 'https://tracker.example.com', cachedEmails, timezone: 'UTC' };
  window.chrome = {
    storage: {
      local: { get(keys, cb) { cb(JSON.parse(JSON.stringify(storage))); } },
      onChanged: { addListener(f) { storageListeners.push(f); } }
    },
    runtime: {
      lastError: undefined,
      sendMessage(msg, cb) {
        sent.push(msg);
        if (msg.type === 'GET_EMAIL_STATUS') { const e = storage.cachedEmails.find((x) => x.id === msg.emailId); return cb && cb({ success: true, email: e }); }
        cb && cb({ success: true });
      }
    }
  };
  window.eval(ext('shared/util.js'));
  window.eval(ext('content/content.js'));
  return { window, document: window.document, sent, setCache(list) { storage.cachedEmails = list; storageListeners.forEach((f) => f({ cachedEmails: { newValue: list } })); } };
}

const fire = (win, el, type, init = {}) => el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
const registrations = (sent) => sent.filter((m) => m.type === 'REGISTER_EMAIL');

test('الضغط على Send: pixel بـ ID صالح + تسجيل واحد بالمستلم والموضوع الصح (من غير إيميلي)', () => {
  const t = boot();
  fire(t.window, t.document.getElementById('send-label'), 'mousedown');

  const pixel = t.document.querySelector('#body img[data-et-id]');
  assert.ok(pixel, 'pixel injected in body');
  const m = pixel.getAttribute('src').match(/^https:\/\/tracker\.example\.com\/track\/pixel\/(et_[A-Za-z0-9_-]+)$/);
  assert.ok(m, pixel.getAttribute('src'));
  assert.ok(isValidId(m[1]));

  const regs = registrations(t.sent);
  assert.equal(regs.length, 1);
  assert.equal(regs[0].payload.id, m[1]);
  assert.equal(regs[0].payload.recipient, 'client@acme.com');
  assert.equal(regs[0].payload.subject, 'Project update');

  // mousedown ثم click (نفس الضغطة): مفيش تسجيل تاني ولا pixel تاني
  fire(t.window, t.document.getElementById('send-label'), 'click');
  assert.equal(registrations(t.sent).length, 1);
  assert.equal(t.document.querySelectorAll('#body img[data-et-id]').length, 1);
});

test('زر خيارات الإرسال (More send options) مبيسجلش ولا يحقن pixel', () => {
  const t = boot();
  fire(t.window, t.document.getElementById('more-send'), 'mousedown');
  fire(t.window, t.document.getElementById('more-send'), 'click');
  assert.equal(registrations(t.sent).length, 0);
  assert.equal(t.document.querySelectorAll('img').length, 0);
});

test('Ctrl+Enter في نافذة الكتابة بيتتبع', () => {
  const t = boot();
  const body = t.document.getElementById('body');
  body.focus();
  body.dispatchEvent(new t.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  assert.equal(registrations(t.sent).length, 1);
});

test('الرد على رسالة فيها pixel قديم: القديم يتشال ويتحط ID جديد', () => {
  const t = boot();
  const body = t.document.getElementById('body');
  body.insertAdjacentHTML('beforeend', '<blockquote><img src="https://old.example.com/pixel/et_oldoldold1.gif" data-et-id="et_oldoldold1"><img id="logo" src="https://cdn.example.com/logo.png"></blockquote>');
  fire(t.window, t.document.getElementById('send-label'), 'mousedown');
  const pixels = [...body.querySelectorAll('img')].filter((i) => /\/(pixel|i)\/et_/.test(i.getAttribute('src')));
  assert.equal(pixels.length, 1);
  assert.notEqual(pixels[0].getAttribute('data-et-id'), 'et_oldoldold1');
  assert.ok(body.querySelector('#logo'), 'الصور العادية ما بتتشالش');
});

test('لو إيميل المستخدم مش معروف: مفيش فلترة غلط للمستلمين (كان فيه اسم ثابت)', () => {
  const html = GMAIL_HTML.replace(' aria-label="Google Account: Me (me@gmail.com)"', '').replace(/me@gmail\.com/g, 'x@y.com');
  const t = boot({ html });
  t.document.title = 'Gmail'; // مفيش إيميل في العنوان كمان
  fire(t.window, t.document.getElementById('send-label'), 'mousedown');
  assert.match(registrations(t.sent)[0].payload.recipient, /client@acme\.com/);
});

test('علامة ✓✓ في قائمة Gmail بتظهر للإيميل المتتبع (مرسل/مقروء) ومرة واحدة فقط', () => {
  const email = { id: 'et_listtest01', recipient: 'client@acme.com', subject: 'Project update', sentAt: '2026-01-01T10:00:00Z', isRead: false, openCount: 0 };
  const t = boot({ cachedEmails: [email] });
  t.setCache([email]);
  t.setCache([email]); // تحديث متكرر
  const row = t.document.getElementById('row');
  assert.equal(row.querySelectorAll('.et-mailtrack-checks').length, 1);
  assert.ok(row.querySelector('.et-is-pending'));

  t.setCache([{ ...email, isRead: true, openCount: 2, firstReadAt: '2026-01-01T11:00:00Z' }]);
  assert.equal(row.querySelectorAll('.et-mailtrack-checks').length, 1);
  assert.ok(row.querySelector('.et-is-read'));
});

test('الـ modal: بيانات فيها HTML تتعرض كنص بس (XSS)', () => {
  const evil = '<img src=x onerror="window.__pwned=1">';
  const email = { id: 'et_xsstest001', recipient: 'client@acme.com', subject: 'Project update', sentAt: '2026-01-01T10:00:00Z', isRead: true, openCount: 1,
    firstReadAt: '2026-01-01T11:00:00Z' };
  const t = boot({ cachedEmails: [email] });
  t.setCache([email]);
  const badge = t.document.querySelector('#row .et-mailtrack-checks');
  assert.ok(badge, 'badge created by script');

  // السيرفر يرجّع بيانات خبيثة للتفاصيل
  const evilEmail = { ...email, recipient: evil, subject: evil, reads: [{ timestamp: '2026-01-01T11:00:00Z', clientType: evil }] };
  t.window.chrome.runtime.sendMessage = (msg, cb) => cb({ success: true, email: evilEmail });
  fire(t.window, badge, 'click');

  const modal = t.document.querySelector('.et-modal-overlay');
  assert.ok(modal);
  assert.equal(modal.querySelectorAll('img').length, 0, 'no injected <img>');
  assert.ok(modal.textContent.includes(evil), 'shown as text');
  assert.equal(t.window.__pwned, undefined);
});

test('neutralize: pixels في عرض Sent بتتعطل، وفي Inbox لأ', async () => {
  const pixelHtml = '<div id="msg"><img id="px" src="https://tracker.example.com/track/pixel/et_neutral001"></div>';
  const sentView = boot({ hash: '#sent', html: GMAIL_HTML + pixelHtml });
  sentView.document.body.appendChild(sentView.document.createElement('i')); // يطلّع الـ MutationObserver
  await new Promise((r) => setTimeout(r, 450));
  assert.match(sentView.document.getElementById('px').src, /^data:image\/gif/);

  const inbox = boot({ hash: '#inbox', html: GMAIL_HTML + pixelHtml });
  inbox.document.body.appendChild(inbox.document.createElement('i'));
  await new Promise((r) => setTimeout(r, 450));
  assert.match(inbox.document.getElementById('px').src, /tracker\.example\.com/);
});

test('متابعة جوه محادثة كل رسائلها مني: المستلم بيتاخد من "إلى" في آخر رسالة', () => {
  const html = `
  <header><a aria-label="Google Account: Me (me@gmail.com)">me</a></header>
  <h2 class="hP">Read Test</h2>
  <div class="adn ads"><div class="gH"><span class="gD" email="me@gmail.com">Me</span>
    <div class="hb"><span class="g2" email="joodevo890@gmail.com">joodevo890@gmail.com</span></div><div class="gK"></div></div></div>
  <div class="aoI"><div contenteditable="true" role="textbox" id="body">Retest</div>
    <div role="button" class="T-I aoO" data-tooltip="Send (Ctrl-Enter)"><span id="send-label">Send</span></div></div>`;
  const t = boot({ html });
  fire(t.window, t.document.getElementById('send-label'), 'mousedown');
  const payload = registrations(t.sent)[0].payload;
  assert.equal(payload.recipient, 'joodevo890@gmail.com');
  assert.equal(payload.isFollowUp, true);
});

test('الـ pixel بيتحقن عند pointerdown (قبل mousedown/click) ومفيش تسجيل مكرر بعده', () => {
  const t = boot();
  const label = t.document.getElementById('send-label');
  label.dispatchEvent(new t.window.Event('pointerdown', { bubbles: true, cancelable: true }));
  assert.equal(t.document.querySelectorAll('#body img[data-et-id]').length, 1, 'pixel موجود بعد pointerdown لوحده');
  assert.equal(registrations(t.sent).length, 1);

  fire(t.window, label, 'mousedown');
  fire(t.window, label, 'click');
  assert.equal(registrations(t.sent).length, 1);
  assert.equal(t.document.querySelectorAll('#body img[data-et-id]').length, 1);
});

test('تحديد إيميلي: من عنوان التبويب، ومش من [data-email] بتاع مستلم في القائمة', () => {
  const html = `<span data-email="client@acme.com" email="client@acme.com">Client</span>` + GMAIL_HTML.replace(' aria-label="Google Account: Me (me@gmail.com)"', '');
  const t = boot({ html });
  fire(t.window, t.document.getElementById('send-label'), 'mousedown');
  assert.match(registrations(t.sent)[0].payload.recipient, /client@acme\.com/);
});

test('لو إضافة تانية شالت الـ pixel من جسم الرسالة: بيتحط تاني', async () => {
  const t = boot();
  const body = t.document.getElementById('body');
  fire(t.window, t.document.getElementById('send-label'), 'mousedown');
  const id = body.querySelector('img[data-et-id]').getAttribute('data-et-id');
  body.innerHTML = 'Hi there (rewritten by another extension)'; // الـ pixel اتشال
  assert.equal(body.querySelector('img'), null);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(body.querySelectorAll(`img[data-et-id="${id}"]`).length, 1);
});

test('نافذة كتابة جديدة فيها مربع contenteditable تاني جنب زر Send: الـ pixel يروح لجسم الرسالة والمستلم/الموضوع صح', () => {
  const html = `
<header><a aria-label="Google Account: Me (me@gmail.com)">me</a></header>
<div class="nH fullpage">
  <div class="recips"><div class="afV" data-hovercard-id="client@acme.com">Client</div><div class="afV" data-hovercard-id="me@gmail.com">Me</div></div>
  <input name="subjectbox" value="Launch plan">
  <div class="Am Al editable" g_editable="true" contenteditable="true" role="textbox" aria-label="Message Body" id="realbody"><div dir="ltr">Hello</div></div>
  <div class="toolbar">
    <div contenteditable="true" id="decoy" aria-label="Help me write"></div>
    <div role="button" class="T-I aoO" data-tooltip="Send (Ctrl-Enter)" id="send2">Send</div>
  </div>
</div>`;
  const t = boot({ html });
  fire(t.window, t.document.getElementById('send2'), 'pointerdown');
  assert.equal(t.document.querySelectorAll('#decoy img').length, 0, 'مفيش pixel في المربع الغلط');
  const px = t.document.querySelector('#realbody img[data-et-id]');
  assert.ok(px, 'pixel جوه جسم الرسالة');
  const regs = registrations(t.sent);
  assert.equal(regs.length, 1);
  assert.equal(regs[0].payload.recipient, 'client@acme.com');
  assert.equal(regs[0].payload.subject, 'Launch plan');
});

test('الراسل بيشوف رده في المحادثة (Inbox) بعد الإرسال: الـ pixel بتاعه يتعطل ويتبلّغ السيرفر مرة واحدة', async () => {
  const proxied = 'https://ci3.googleusercontent.com/meips/ADKq_abc=s0-d-e1-ft#https://tracker.example.com/track/pixel/et_selfview001';
  const html = GMAIL_HTML + `<div class="adn ads" id="mine"><img id="px" src="${proxied}"></div>`
    + '<div class="adn ads"><img id="other" src="https://tracker.example.com/track/pixel/et_someone001"></div>';
  const t = boot({ hash: '#inbox', html, cachedEmails: [{ id: 'et_selfview001', recipient: 'client@acme.com', subject: 'x', sentAt: new Date().toISOString() }] });
  t.document.body.appendChild(t.document.createElement('i'));
  await new Promise((r) => setTimeout(r, 450));
  t.document.body.appendChild(t.document.createElement('i'));
  await new Promise((r) => setTimeout(r, 450));

  assert.match(t.document.getElementById('px').src, /^data:image\/gif/, 'الـ pixel بتاعي اتعطل');
  assert.match(t.document.getElementById('other').src, /tracker\.example\.com/, 'pixel حد تانا ماتلمسش (في Inbox)');
  const reports = t.sent.filter((m) => m.type === 'SELF_VIEW');
  assert.deepEqual(reports.map((m) => m.emailId), ['et_selfview001']);
});

test('إيميل لسه متبعت (قبل ما الكاش يتحدث) برضه بيتعرف إنه بتاعي', async () => {
  const t = boot();
  fire(t.window, t.document.getElementById('send-label'), 'pointerdown');
  const id = registrations(t.sent)[0].payload.id;
  const view = t.document.createElement('div');
  view.innerHTML = `<img id="echo" src="https://ci3.googleusercontent.com/meips/x#https://tracker.example.com/track/pixel/${id}">`;
  t.document.body.appendChild(view);
  await new Promise((r) => setTimeout(r, 450));
  assert.deepEqual(t.sent.filter((m) => m.type === 'SELF_VIEW').map((m) => m.emailId), [id]);
});
