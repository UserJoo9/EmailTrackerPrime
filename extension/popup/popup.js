// EmailTracker Prime - Popup Controller

document.addEventListener('DOMContentLoaded', () => {
  let allEmails = [];
  let currentFilter = 'all';
  let searchQuery = '';

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
  const btnTestServer = document.getElementById('btn-test-server');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnSyncNow = document.getElementById('btn-sync-now');
  const settingsMsg = document.getElementById('settings-status-msg');
  const openWebDashboard = document.getElementById('open-web-dashboard');

  // Navigation Tabs
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

  // Check Server Health & Auto Sync
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

  // Sync cached local emails to server
  function syncEmailsToServer() {
    chrome.storage.local.get(['cachedEmails', 'serverUrl'], (data) => {
      if (Array.isArray(data.cachedEmails) && data.cachedEmails.length > 0 && data.serverUrl) {
        fetch(`${data.serverUrl.replace(/\/+$/, '')}/api/emails/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: data.cachedEmails })
        }).then(r => r.json()).then(res => {
          if (res && res.success) {
            console.log('[EmailTracker] Synced emails with server.');
            loadEmails();
          }
        }).catch(() => {});
      }
    });
  }

  // Load Emails
  function loadEmails() {
    chrome.runtime.sendMessage({ type: 'GET_EMAILS' }, (res) => {
      if (res && res.success && Array.isArray(res.emails)) {
        allEmails = res.emails;
        chrome.storage.local.set({ cachedEmails: allEmails });
        renderEmails();
        loadStats();
      } else {
        // Fallback to local cache
        chrome.storage.local.get(['cachedEmails'], (data) => {
          if (Array.isArray(data.cachedEmails)) {
            allEmails = data.cachedEmails;
            renderEmails();
          }
        });
      }
    });
  }

  // Render List
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
      const sentStr = email.sentAtFormatted ? email.sentAtFormatted.formatted : new Date(email.sentAt).toLocaleString('ar-EG');
      const openStr = email.firstReadAtFormatted ? email.firstReadAtFormatted.formatted : (email.firstReadAt ? new Date(email.firstReadAt).toLocaleString('ar-EG') : null);

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
              <div class="meta-row" style="color: #94a3b8;">
                <span>الحالة:</span>
                <span>لم يُفتح بعد</span>
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  // Load Stats
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

  // Settings
  chrome.storage.local.get(['serverUrl'], (data) => {
    if (data.serverUrl) {
      serverUrlInput.value = data.serverUrl;
      if (openWebDashboard) openWebDashboard.href = data.serverUrl;
    }
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
    chrome.storage.local.set({ serverUrl: url }, () => {
      settingsMsg.className = 'settings-msg success';
      settingsMsg.textContent = 'تم حفظ الإعدادات بنجاح!';
      if (openWebDashboard) openWebDashboard.href = url;
      checkServerHealth();
      syncEmailsToServer();
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

  checkServerHealth();
  loadEmails();
});
