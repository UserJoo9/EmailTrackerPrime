// EmailTracker Prime - Popup Controller (with Dark Mode & Custom Timezone Support)

document.addEventListener('DOMContentLoaded', () => {
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
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      const tz = selectedTimezone === 'auto' 
        ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo') 
        : selectedTimezone;

      return date.toLocaleString('ar-EG', {
        timeZone: tz,
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch (err) {
      return new Date(isoString).toLocaleString('ar-EG');
    }
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

  function checkServerHealth() {
    chrome.runtime.sendMessage({ type: 'CHECK_SERVER' }, (res) => {
      if (res && res.reachable) {
        statusPill.className = 'status-pill status-connected';
        statusText.textContent = 'متصل بالسيرفر';
        syncEmailsToServer();
      } else {
        statusPill.className = 'status-pill status-disconnected';
        statusText.textContent = 'غير متصل';
      }
    });
  }

  function syncEmailsToServer() {
    chrome.storage.local.get(['cachedEmails', 'serverUrl'], (data) => {
      if (Array.isArray(data.cachedEmails) && data.cachedEmails.length > 0 && data.serverUrl) {
        fetch(`${data.serverUrl.replace(/\/+$/, '')}/api/emails/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: data.cachedEmails })
        }).then(r => r.json()).then(res => {
          if (res && res.success) {
            loadEmails();
          }
        }).catch(() => {});
      }
    });
  }

  // -------------------------------------------------------------
  // 5. LOAD & RENDER EMAILS
  // -------------------------------------------------------------

  function loadEmails() {
    chrome.runtime.sendMessage({ type: 'GET_EMAILS' }, (res) => {
      if (res && res.success && Array.isArray(res.emails)) {
        allEmails = res.emails;
        chrome.storage.local.set({ cachedEmails: allEmails });
        renderEmails();
        loadStats();
      } else {
        chrome.storage.local.get(['cachedEmails'], (data) => {
          if (Array.isArray(data.cachedEmails)) {
            allEmails = data.cachedEmails;
            renderEmails();
          }
        });
      }
    });
  }

  function renderEmails() {
    let filtered = allEmails.filter(email => {
      if (currentFilter === 'read' && !email.isRead) return false;
      if (currentFilter === 'unread' && email.isRead) return false;

      if (searchQuery) {
        const matchRecip = (email.recipient || '').toLowerCase().includes(searchQuery);
        const matchSubj = (email.subject || '').toLowerCase().includes(searchQuery);
        return matchRecip || matchSubj;
      }
      return true;
    });

    if (filtered.length === 0) {
      emailsList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📭</span>
          <p>${allEmails.length === 0 ? 'لا توجد إيميلات متتبعة بعد.<br>أرسل إيميلك من بريد Gmail وسيتم تتبعه فوراً!' : 'لا توجد نتائج تطابق بحثك.'}</p>
        </div>
      `;
      return;
    }

    emailsList.innerHTML = filtered.map(email => {
      const isRead = email.isRead;
      const sentStr = formatTimestampInTz(email.sentAt);
      const openStr = email.firstReadAt ? formatTimestampInTz(email.firstReadAt) : null;

      return `
        <div class="email-card ${isRead ? 'is-read' : 'is-unread'}">
          <div class="card-header">
            <div class="card-recip" title="${email.recipient}">
              ${email.recipient}
              ${email.isFollowUp ? '<span class="chip-followup">متابعة / رد</span>' : ''}
            </div>
            <span class="card-chip ${isRead ? 'chip-read' : 'chip-pending'}">
              <span>${isRead ? '✓✓ مقروء' : '✓ مرسل'}</span>
            </span>
          </div>

          <div class="card-subject" title="${email.subject}">${email.subject || '(بدون عنوان)'}</div>

          <div class="card-meta">
            <div class="meta-row">
              <span>الإرسال:</span>
              <span>${sentStr}</span>
            </div>

            ${isRead ? `
              <div class="meta-row">
                <span class="meta-open">🟢 فتح في:</span>
                <span class="meta-open">${openStr}</span>
              </div>
              <div class="meta-row">
                <span>مرات الفتح:</span>
                <span class="meta-count">${email.openCount} مرة</span>
              </div>
            ` : `
              <div class="meta-row" style="color: var(--text-muted);">
                <span>الحالة:</span>
                <span>لم يُفتح بعد</span>
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');
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

  chrome.storage.local.get(['serverUrl', 'timezone', 'theme'], (data) => {
    const defaultUrl = 'https://email-tracker-prime.vercel.app';
    const effectiveUrl = (data.serverUrl && !data.serverUrl.includes('localhost:3000')) ? data.serverUrl : defaultUrl;
    serverUrlInput.value = effectiveUrl;
    if (openWebDashboard) openWebDashboard.href = effectiveUrl;
    if (!data.serverUrl || data.serverUrl.includes('localhost:3000')) {
      chrome.storage.local.set({ serverUrl: defaultUrl });
    }
    if (data.timezone) {
      selectedTimezone = data.timezone;
      if (timezoneSelect) timezoneSelect.value = data.timezone;
    }
    applyTheme(data.theme || 'dark'); // Default to sleek dark mode
  });

  btnTestServer.addEventListener('click', () => {
    btnTestServer.textContent = '...';
    const testUrl = serverUrlInput.value.trim().replace(/\/+$/, '');

    fetch(`${testUrl}/api/stats`)
      .then(res => res.json())
      .then(() => {
        btnTestServer.textContent = 'ناجح ✓';
        btnTestServer.style.color = 'var(--emerald)';
        setTimeout(() => {
          btnTestServer.textContent = 'فحص';
          btnTestServer.style.color = '';
        }, 2000);
      })
      .catch(() => {
        btnTestServer.textContent = 'فشل ✗';
        btnTestServer.style.color = 'var(--rose)';
        setTimeout(() => {
          btnTestServer.textContent = 'فحص';
          btnTestServer.style.color = '';
        }, 2000);
      });
  });

  btnSaveSettings.addEventListener('click', () => {
    const url = serverUrlInput.value.trim().replace(/\/+$/, '');
    const tz = timezoneSelect.value;
    const th = themeSelect.value;

    selectedTimezone = tz;
    applyTheme(th);

    chrome.storage.local.set({
      serverUrl: url,
      timezone: tz,
      theme: th
    }, () => {
      settingsMsg.className = 'settings-msg success';
      settingsMsg.textContent = 'تم حفظ الإعدادات بنجاح!';
      if (openWebDashboard) openWebDashboard.href = url;
      checkServerHealth();
      renderEmails();
      setTimeout(() => { settingsMsg.textContent = ''; }, 2500);
    });
  });

  if (btnSyncNow) {
    btnSyncNow.addEventListener('click', () => {
      btnSyncNow.textContent = 'جاري المزامنة...';
      syncEmailsToServer();
      setTimeout(() => {
        btnSyncNow.textContent = 'تمت المزامنة بنجاح ✓';
        setTimeout(() => {
          btnSyncNow.textContent = '🔄 مزامنة البيانات مع السيرفر الآن';
        }, 2000);
      }, 1000);
    });
  }

  if (btnClearAll) {
    btnClearAll.addEventListener('click', () => {
      if (confirm('هل تريد مسح جميع الإيميلات المسجلة والبدء من جديد؟')) {
        chrome.storage.local.set({ cachedEmails: [] }, () => {
          chrome.storage.local.get(['serverUrl'], (data) => {
            if (data.serverUrl) {
              fetch(`${data.serverUrl.replace(/\/+$/, '')}/api/emails/clear`, { method: 'POST' }).catch(() => {});
            }
          });
          allEmails = [];
          renderEmails();
          loadStats();
          settingsMsg.className = 'settings-msg success';
          settingsMsg.textContent = 'تم مسح السجلات بنجاح!';
          setTimeout(() => { settingsMsg.textContent = ''; }, 2000);
        });
      }
    });
  }

  checkServerHealth();
  loadEmails();
});
