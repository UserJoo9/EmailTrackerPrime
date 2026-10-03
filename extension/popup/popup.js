// EmailTracker Prime - Popup Controller

document.addEventListener('DOMContentLoaded', () => {
  let allEmails = [];
  let currentFilter = 'all';
  let searchQuery = '';

  // Elements
  const statusPill = document.getElementById('connection-status');
  const statusDot = statusPill.querySelector('.status-dot');
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
  const trackDefaultCheckbox = document.getElementById('setting-track-default');
  const showBadgesCheckbox = document.getElementById('setting-show-badges');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const settingsMsg = document.getElementById('settings-status-msg');
  const openWebDashboard = document.getElementById('open-web-dashboard');

  // 1. Navigation Tabs
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

  // 2. Filters & Search
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

  // 3. Check Server Connectivity
  function checkServerHealth() {
    chrome.runtime.sendMessage({ type: 'CHECK_SERVER' }, (res) => {
      if (res && res.reachable) {
        statusPill.className = 'status-pill status-connected';
        statusText.textContent = 'متصل بالخادم';
      } else {
        statusPill.className = 'status-pill status-disconnected';
        statusText.textContent = 'الخادم غير متصل';
      }
    });
  }

  // 4. Load Emails
  function loadEmails() {
    chrome.runtime.sendMessage({ type: 'GET_EMAILS' }, (res) => {
      if (res && res.success && Array.isArray(res.emails)) {
        allEmails = res.emails;
        renderEmails();
      } else {
        emailsList.innerHTML = `
          <div class="empty-state">
            <span class="empty-icon">⚠️</span>
            <p>تعذر الاتصال بخادم التتبع.<br>تأكد من تشغيل الخادم أولاً.</p>
          </div>
        `;
      }
    });
  }

  // Render Emails List
  function renderEmails() {
    let filtered = allEmails.filter(email => {
      // Filter tab
      if (currentFilter === 'read' && !email.isRead) return false;
      if (currentFilter === 'unread' && email.isRead) return false;

      // Search query
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
          <p>${allEmails.length === 0 ? 'لا توجد إيميلات متتبعة حتى الآن.<br>أرسل أول إيميل من Gmail!' : 'لا توجد نتائج تطابق بحثك.'}</p>
        </div>
      `;
      return;
    }

    emailsList.innerHTML = filtered.map(email => {
      const isRead = email.isRead;
      const sentTimeStr = email.sentAtFormatted ? email.sentAtFormatted.formatted : new Date(email.sentAt).toLocaleString('ar-EG');
      const openTimeStr = email.firstReadAtFormatted ? email.firstReadAtFormatted.formatted : (email.firstReadAt ? new Date(email.firstReadAt).toLocaleString('ar-EG') : null);

      return `
        <div class="email-card ${isRead ? 'is-read' : 'is-unread'}">
          <div class="card-top">
            <div class="card-recipient" title="${email.recipient}">${email.recipient}</div>
            <span class="card-badge ${isRead ? 'badge-read' : 'badge-unread'}">
              <span>${isRead ? '✓✓ مقروء' : '✓ مرسل'}</span>
            </span>
          </div>

          <div class="card-subject" title="${email.subject}">${email.subject || '(بدون عنوان)'}</div>

          <div class="card-details">
            <div class="detail-row">
              <span>وقت الإرسال:</span>
              <span>${sentTimeStr}</span>
            </div>

            ${isRead ? `
              <div class="detail-row">
                <span class="detail-highlight">🟢 تاريخ الفتح:</span>
                <span class="detail-highlight">${openTimeStr}</span>
              </div>
              <div class="detail-row">
                <span>مرات الفتح:</span>
                <span class="detail-open-count">${email.openCount} مرة</span>
              </div>
            ` : `
              <div class="detail-row" style="color: #9aa0a6;">
                <span>حالة القراءة:</span>
                <span>لم يُفتح بعد</span>
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');
  }

  // 5. Load Stats
  function loadStats() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (res) => {
      if (res && res.success && res.stats) {
        const s = res.stats;
        statSent.textContent = s.totalSent;
        statRead.textContent = s.totalRead;
        statUnread.textContent = s.totalUnread;
        statRate.textContent = `${s.openRate}%`;
      }
    });
  }

  // 6. Settings Handling
  chrome.storage.local.get(['serverUrl', 'trackByDefault', 'showBadgesInGmail'], (data) => {
    if (data.serverUrl) {
      serverUrlInput.value = data.serverUrl;
      if (openWebDashboard) openWebDashboard.href = data.serverUrl;
    }
    if (data.trackByDefault !== undefined) trackDefaultCheckbox.checked = data.trackByDefault;
    if (data.showBadgesInGmail !== undefined) showBadgesCheckbox.checked = data.showBadgesInGmail;
  });

  btnTestServer.addEventListener('click', () => {
    btnTestServer.textContent = '...';
    const testUrl = serverUrlInput.value.trim().replace(/\/+$/, '');

    fetch(`${testUrl}/api/stats`)
      .then(res => res.json())
      .then(data => {
        btnTestServer.textContent = 'ناجح ✓';
        btnTestServer.style.color = 'var(--success)';
        setTimeout(() => {
          btnTestServer.textContent = 'فحص';
          btnTestServer.style.color = '';
        }, 2000);
      })
      .catch(err => {
        btnTestServer.textContent = 'فشل ✗';
        btnTestServer.style.color = 'var(--danger)';
        setTimeout(() => {
          btnTestServer.textContent = 'فحص';
          btnTestServer.style.color = '';
        }, 2000);
      });
  });

  btnSaveSettings.addEventListener('click', () => {
    const url = serverUrlInput.value.trim().replace(/\/+$/, '');
    const trackDefault = trackDefaultCheckbox.checked;
    const showBadges = showBadgesCheckbox.checked;

    chrome.storage.local.set({
      serverUrl: url,
      trackByDefault: trackDefault,
      showBadgesInGmail: showBadges
    }, () => {
      settingsMsg.className = 'settings-msg success';
      settingsMsg.textContent = 'تم حفظ الإعدادات بنجاح!';
      if (openWebDashboard) openWebDashboard.href = url;
      checkServerHealth();
      loadEmails();
      setTimeout(() => { settingsMsg.textContent = ''; }, 3000);
    });
  });

  // Initial calls
  checkServerHealth();
  loadEmails();
});
