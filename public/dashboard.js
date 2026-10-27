(function () {
  'use strict';

  const KEY_STORAGE = 'etp_api_key';
  const $ = (id) => document.getElementById(id);

  function getKey() {
    try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
  }
  function setKey(v) {
    try { v ? localStorage.setItem(KEY_STORAGE, v) : localStorage.removeItem(KEY_STORAGE); } catch { /* ignore */ }
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${getKey()}` }
    });
    if (res.status === 401) throw Object.assign(new Error('Unauthorized'), { code: 401 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const fmt = (iso) => iso
    ? new Date(iso).toLocaleString('ar-EG', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : '';

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    children.forEach((c) => c && node.appendChild(c));
    return node;
  }

  function renderRow(e) {
    const status = el('span', { class: `status-chip ${e.isRead ? 'is-read' : 'is-pending'}`, text: e.isRead ? '✓✓ تم الفتح' : '⏳ لم يُقرأ بعد' });
    const statusCell = el('td', {}, status, e.isFollowUp ? el('span', { class: 'chip-followup', text: 'متابعة / رد' }) : null);

    const del = el('button', { class: 'row-del', title: 'حذف', text: '✕' });
    del.addEventListener('click', async () => {
      if (!confirm('حذف هذا السجل؟')) return;
      try { await api(`/api/emails/${encodeURIComponent(e.id)}`, { method: 'DELETE' }); load(); } catch (err) { handleError(err); }
    });

    return el('tr', {},
      statusCell,
      el('td', { class: 'cell-recipient', text: e.recipient }),
      el('td', { class: 'cell-subject', title: e.subject, text: e.subject || '(بدون عنوان)' }),
      el('td', { class: 'time-badge', text: fmt(e.sentAt) }),
      e.isRead ? el('td', {}, el('span', { class: 'highlight-time', text: fmt(e.firstReadAt) })) : el('td', { class: 'dim', text: '-' }),
      e.openCount > 0 ? el('td', {}, el('span', { class: 'open-count-badge', text: `${e.openCount} مرة` })) : el('td', { class: 'dim', text: '-' }),
      el('td', {}, del)
    );
  }

  function show(which) {
    $('login').classList.toggle('hidden', which !== 'login');
    $('app').classList.toggle('hidden', which !== 'app');
  }

  function handleError(err) {
    if (err.code === 401) {
      setKey('');
      show('login');
      $('login-error').textContent = 'المفتاح غير صحيح';
    } else {
      console.error(err);
    }
  }

  async function load() {
    try {
      const [{ stats }, { emails }] = await Promise.all([api('/api/stats'), api('/api/emails')]);
      show('app');
      $('m-sent').textContent = stats.totalSent;
      $('m-read').textContent = stats.totalRead;
      $('m-unread').textContent = stats.totalUnread;
      $('m-rate').textContent = `${stats.openRate}%`;
      const rows = $('rows');
      rows.replaceChildren(...emails.map(renderRow));
      $('empty').classList.toggle('hidden', emails.length > 0);
    } catch (err) {
      handleError(err);
    }
  }

  $('login-btn').addEventListener('click', () => {
    setKey($('key-input').value.trim());
    $('login-error').textContent = '';
    load();
  });
  $('key-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-btn').click(); });
  $('refresh-btn').addEventListener('click', load);
  $('logout-btn').addEventListener('click', () => { setKey(''); show('login'); });
  $('clear-btn').addEventListener('click', async () => {
    if (!confirm('هل أنت متأكد من مسح كل السجلات؟ لا يمكن التراجع.')) return;
    try { await api('/api/emails', { method: 'DELETE' }); load(); } catch (err) { handleError(err); }
  });

  setInterval(() => { if (!document.hidden && getKey()) load(); }, 30000);

  if (getKey()) load(); else show('login');
})();
