// EmailTracker Prime - Popup Controller
// كل الاتصال بالسيرفر والكاش عن طريق الـ background (مفيش fetch ولا كتابة كاش من هنا).

document.addEventListener('DOMContentLoaded', () => {
  const { DEFAULT_SERVER_URL, el, normalizeUrl } = ETP;
  let allEmails = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let selectedTimezone = 'auto';
  let currentTheme = 'dark';

  const statusPill = document.getElementById('connection-status');
  const statusText = statusPill.querySelector('.status-text');

  const emailsList = document.getElementById('emails-list');
  const searchInput = document.getElementById('search-input');
  const filterPills = document.querySelectorAll('.filter-pill');
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');

  const statSent = document.getElementById('stat-total-sent');
  const statRead = document.getElementById('stat-total-read');
  const statUnread = document.getElementById('stat-total-unread');
  const statRate = document.getElementById('stat-open-rate');

  const serverUrlInput = document.getElementById('setting-server-url');
  const apiKeyInput = document.getElementById('setting-api-key');
  const timezoneSelect = document.getElementById('setting-timezone');
  const themeSelect = document.getElementById('setting-theme');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const btnTestServer = document.getElementById('btn-test-server');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnSyncNow = document.getElementById('btn-sync-now');
  const btnClearAll = document.getElementById('btn-clear-all');
  const settingsMsg = document.getElementById('settings-status-msg');
  const openWebDashboard = document.getElementById('open-web-dashboard');

  // -------------------------------------------------------------
  // 1. THEME HANDLING (DARK MODE)
  // -------------------------------------------------------------

  function applyTheme(theme) {
    currentTheme = theme;
    let isDark = false;

    if (theme === 'dark') {
      isDark = true;
    } else if (theme === 'light') {
      isDark = false;
    } else {
      // Auto system
      isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    if (isDark) {
      document.body.classList.add('dark-theme');
      if (themeToggleBtn) themeToggleBtn.textContent = '☀️';
    } else {
      document.body.classList.remove('dark-theme');
      if (themeToggleBtn) themeToggleBtn.textContent = '🌙';
    }

    if (themeSelect) themeSelect.value = theme;
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const newTheme = document.body.classList.contains('dark-theme') ? 'light' : 'dark';
      applyTheme(newTheme);
      chrome.storage.local.set({ theme: newTheme });
    });
  }

  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      applyTheme(e.target.value);
      chrome.storage.local.set({ theme: e.target.value });
    });
  }

  // -------------------------------------------------------------
  // 2. TIMEZONE FORMATTING
  // -------------------------------------------------------------

  function formatTimestampInTz(isoString) {
    return ETP.formatTime(isoString, selectedTimezone);
  }

  if (timezoneSelect) {
    timezoneSelect.addEventListener('change', (e) => {
      selectedTimezone = e.target.value;
      chrome.storage.local.set({ timezone: selectedTimezone });
      renderEmails();
    });
  }

  // -------------------------------------------------------------
  // 3. NAVIGATION TABS
  // -------------------------------------------------------------

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(tab.dataset.tab);
      if (targetPane) targetPane.classList.add('active');

      if (tab.dataset.tab === 'tab-stats') {
        loadStats();
      }
    });
  });

  // Filters & Search
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.filter;
      renderEmails();
    });
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderEmails();
  });

  // -------------------------------------------------------------
  // 4. SERVER HEALTH & AUTO SYNC
  // -------------------------------------------------------------

  function setStatus(cls, text) {
    statusPill.className = `status-pill ${cls}`;
    statusText.textContent = text;
  }

  function checkServerHealth() {
    chrome.runtime.sendMessage({ type: 'CHECK_SERVER' }, (res) => {
      void chrome.runtime.lastError;
      if (res && res.reachable && res.authorized) {
        setStatus('status-connected', 'متصل بالسيرفر');
        loadEmails({ force: true }); // بيزامن الناقص ويحدّث
      } else if (res && res.reachable) {
        setStatus('status-disconnected', 'مفتاح API غير صحيح');
      } else {
        setStatus('status-disconnected', 'غير متصل');
      }
    });
  }

  // -------------------------------------------------------------
  // 5. LOAD & RENDER EMAILS
  // -------------------------------------------------------------

  function loadEmails({ force = false } = {}) {
    chrome.runtime.sendMessage({ type: 'GET_EMAILS', force }, (res) => {
      void chrome.runtime.lastError;
      if (res && res.success && Array.isArray(res.emails)) {
        allEmails = res.emails;
        renderEmails();
        loadStats();
      }
    });
  }

  function emptyState(icon, html) {
    const p = el('p');
    html.forEach((part, i) => {
      if (i > 0) p.appendChild(document.createElement('br'));
      p.appendChild(document.createTextNode(part));
    });
    return el('div', { class: 'empty-state' }, el('span', { class: 'empty-icon', text: icon }), p);
  }

  function renderCard(email) {
    const isRead = email.isRead;
    const meta = el('div', { class: 'card-meta' },
      el('div', { class: 'meta-row' }, el('span', { text: 'الإرسال:' }), el('span', { text: formatTimestampInTz(email.sentAt) }))
    );
    if (isRead) {
      meta.appendChild(el('div', { class: 'meta-row' },
        el('span', { class: 'meta-open', text: '🟢 فتح في:' }),
        el('span', { class: 'meta-open', text: formatTimestampInTz(email.firstReadAt) })));
      meta.appendChild(el('div', { class: 'meta-row' },
        el('span', { text: 'مرات الفتح:' }),
        el('span', { class: 'meta-count', text: `${email.openCount} مرة` })));
    } else {
      const row = el('div', { class: 'meta-row' }, el('span', { text: 'الحالة:' }), el('span', { text: 'لم يُفتح بعد' }));
      row.style.color = 'var(--text-muted)';
      meta.appendChild(row);
    }

    return el('div', { class: `email-card ${isRead ? 'is-read' : 'is-unread'}` },
      el('div', { class: 'card-header' },
        el('div', { class: 'card-recip', title: email.recipient },
          document.createTextNode(email.recipient),
          email.isFollowUp ? el('span', { class: 'chip-followup', text: 'متابعة / رد' }) : null),
        el('span', { class: `card-chip ${isRead ? 'chip-read' : 'chip-pending'}` },
          el('span', { text: isRead ? '✓✓ مقروء' : '✓ مرسل' }))),
      el('div', { class: 'card-subject', title: email.subject }, document.createTextNode(email.subject || '(بدون عنوان)')),
      meta
    );
  }

  function renderEmails() {
    const filtered = allEmails.filter((email) => {
      if (currentFilter === 'read' && !email.isRead) return false;
      if (currentFilter === 'unread' && email.isRead) return false;
      if (searchQuery) {
        return (email.recipient || '').toLowerCase().includes(searchQuery) ||
               (email.subject || '').toLowerCase().includes(searchQuery);
      }
      return true;
    });

    if (filtered.length === 0) {
      emailsList.replaceChildren(allEmails.length === 0
        ? emptyState('📭', ['لا توجد إيميلات متتبعة بعد.', 'أرسل إيميلك من بريد Gmail وسيتم تتبعه فوراً!'])
        : emptyState('📭', ['لا توجد نتائج تطابق بحثك.']));
      return;
    }
    emailsList.replaceChildren(...filtered.map(renderCard));
  }

  // -------------------------------------------------------------
  // 6. LOAD STATS
  // -------------------------------------------------------------

  function loadStats() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (res) => {
      if (res && res.success && res.stats) {
        const s = res.stats;
        statSent.textContent = s.totalSent;
        statRead.textContent = s.totalRead;
        statUnread.textContent = s.totalUnread;
        statRate.textContent = `${s.openRate}%`;
      } else {
        const total = allEmails.length;
        const read = allEmails.filter(e => e.isRead).length;
        statSent.textContent = total;
        statRead.textContent = read;
        statUnread.textContent = total - read;
        statRate.textContent = total > 0 ? `${Math.round((read/total)*100)}%` : '0%';
      }
    });
  }

  // -------------------------------------------------------------
  // 7. SETTINGS & ACTIONS
  // -------------------------------------------------------------

  chrome.storage.local.get(['serverUrl', 'apiKey', 'timezone', 'theme'], (data) => {
    const effectiveUrl = normalizeUrl(data.serverUrl || DEFAULT_SERVER_URL);
    serverUrlInput.value = effectiveUrl;
    if (apiKeyInput) apiKeyInput.value = data.apiKey || '';
    if (openWebDashboard) openWebDashboard.href = effectiveUrl;
    if (data.timezone) {
      selectedTimezone = data.timezone;
      if (timezoneSelect) timezoneSelect.value = data.timezone;
    }
    applyTheme(data.theme || 'dark');
  });

  function flashButton(btn, text, color) {
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = text;
    btn.style.color = color || '';
    setTimeout(() => { btn.textContent = original; btn.style.color = ''; }, 2000);
  }

  function showSettingsMessage(kind, text) {
    settingsMsg.className = `settings-msg ${kind}`;
    settingsMsg.textContent = text;
    setTimeout(() => { settingsMsg.textContent = ''; }, 3000);
  }

  // لو السيرفر مش الافتراضي لازم نطلب صلاحية الوصول له (optional_host_permissions)
  async function ensureHostPermission(url) {
    let origin;
    try { origin = new URL(url).origin + '/*'; } catch { return false; }
    if (origin === new URL(DEFAULT_SERVER_URL).origin + '/*') return true;
    const has = await chrome.permissions.contains({ origins: [origin] });
    return has || chrome.permissions.request({ origins: [origin] });
  }

  btnTestServer.addEventListener('click', async () => {
    btnTestServer.textContent = '...';
    const url = normalizeUrl(serverUrlInput.value);
    if (!(await ensureHostPermission(url))) {
      flashButton(btnTestServer, 'مرفوض ✗', 'var(--rose)');
      return;
    }
    chrome.runtime.sendMessage({
      type: 'CHECK_SERVER',
      settings: { serverUrl: url, apiKey: apiKeyInput ? apiKeyInput.value : '' }
    }, (res) => {
      void chrome.runtime.lastError;
      if (res && res.reachable && res.authorized) flashButton(btnTestServer, 'ناجح ✓', 'var(--emerald)');
      else if (res && res.reachable) flashButton(btnTestServer, 'مفتاح خطأ ✗', 'var(--rose)');
      else flashButton(btnTestServer, 'فشل ✗', 'var(--rose)');
    });
  });

  btnSaveSettings.addEventListener('click', async () => {
    const url = normalizeUrl(serverUrlInput.value) || DEFAULT_SERVER_URL;
    if (!(await ensureHostPermission(url))) {
      showSettingsMessage('error', 'لازم توافق على صلاحية الوصول للسيرفر عشان نحفظ الرابط.');
      return;
    }
    selectedTimezone = timezoneSelect.value;
    applyTheme(themeSelect.value);

    chrome.storage.local.set({
      serverUrl: url,
      apiKey: apiKeyInput ? apiKeyInput.value.trim() : '',
      timezone: selectedTimezone,
      theme: themeSelect.value
    }, () => {
      showSettingsMessage('success', 'تم حفظ الإعدادات بنجاح!');
      if (openWebDashboard) openWebDashboard.href = url;
      checkServerHealth();
      renderEmails();
    });
  });

  if (btnSyncNow) {
    btnSyncNow.addEventListener('click', () => {
      btnSyncNow.textContent = 'جاري المزامنة...';
      chrome.runtime.sendMessage({ type: 'GET_EMAILS', force: true }, (res) => {
        void chrome.runtime.lastError;
        if (res && res.success) {
          allEmails = res.emails;
          renderEmails();
          loadStats();
        }
        flashButton(btnSyncNow, 'تمت المزامنة ✓');
        btnSyncNow.dataset.label = '🔄 مزامنة البيانات مع السيرفر الآن';
      });
    });
  }

  if (btnClearAll) {
    btnClearAll.addEventListener('click', () => {
      if (!confirm('هل تريد مسح جميع الإيميلات المسجلة (من السيرفر ومن الإضافة)؟ لا يمكن التراجع.')) return;
      chrome.runtime.sendMessage({ type: 'CLEAR_ALL' }, (res) => {
        void chrome.runtime.lastError;
        if (res && res.success) {
          allEmails = [];
          renderEmails();
          loadStats();
          showSettingsMessage('success', 'تم مسح السجلات بنجاح!');
        } else {
          showSettingsMessage('error', res && res.error === 'unauthorized' ? 'مفتاح API غير صحيح: لم يتم المسح.' : 'تعذّر الاتصال بالسيرفر: لم يتم المسح.');
        }
      });
    });
  }

  checkServerHealth();
  loadEmails();
});
