// EmailTracker Prime - Content Script for Gmail

(function () {
  'use strict';

  console.log('[EmailTracker Prime] Content script loaded on Gmail.');

  let serverUrl = 'http://localhost:3000';
  let trackedEmails = [];
  let isTrackingByDefault = true;

  // Retrieve initial server URL and settings
  function initSettings() {
    chrome.runtime.sendMessage({ type: 'GET_SERVER_URL' }, (res) => {
      if (res && res.serverUrl) {
        serverUrl = res.serverUrl;
      }
    });

    chrome.storage.local.get(['trackByDefault', 'serverUrl'], (data) => {
      if (data.trackByDefault !== undefined) isTrackingByDefault = data.trackByDefault;
      if (data.serverUrl) serverUrl = data.serverUrl;
    });

    fetchTrackedEmails();
  }

  // Fetch tracked emails from background worker
  function fetchTrackedEmails() {
    chrome.runtime.sendMessage({ type: 'GET_EMAILS' }, (response) => {
      if (response && response.success && Array.isArray(response.emails)) {
        trackedEmails = response.emails;
        decorateGmailRows();
      }
    });
  }

  // Generate unique tracking ID
  function generateTrackingId() {
    return 'et_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  // Toast notification
  function showToast(message, duration = 4000) {
    const existing = document.querySelector('.et-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'et-toast';
    toast.innerHTML = `<span>✓✓</span> <span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(15px)';
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }

  // --------------------------------------------------------------------------
  // 1. COMPOSE WINDOW INTEGRATION (Inject Toggle Button & Hook Send)
  // --------------------------------------------------------------------------

  function injectComposeFeatures() {
    // Gmail compose windows
    const composeDialogs = document.querySelectorAll('div[role="dialog"]');

    composeDialogs.forEach((dialog) => {
      // Find toolbar area (where the Send button is)
      const toolbar = dialog.querySelector('.btC') || dialog.querySelector('.aDh');
      const sendButton = dialog.querySelector('[role="button"][data-tooltip*="Send"]') ||
                         dialog.querySelector('.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3') ||
                         dialog.querySelector('[aria-label*="Send"]');

      if (!toolbar || !sendButton) return;

      // Check if button already injected
      if (dialog.querySelector('.et-track-btn')) return;

      // Create tracking toggle button
      const toggleBtn = document.createElement('div');
      toggleBtn.className = 'et-track-btn ' + (isTrackingByDefault ? 'et-active' : 'et-inactive');
      toggleBtn.dataset.tracking = isTrackingByDefault ? 'true' : 'false';
      toggleBtn.title = 'انقر لتبديل تتبع قراءة هذا الإيميل';
      toggleBtn.innerHTML = `
        <span class="et-track-icon">👁️</span>
        <span class="et-track-label">${isTrackingByDefault ? 'تتبع القراءة (نشط)' : 'تتبع القراءة (معطل)'}</span>
      `;

      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentlyActive = toggleBtn.dataset.tracking === 'true';
        const newState = !currentlyActive;
        toggleBtn.dataset.tracking = newState ? 'true' : 'false';
        toggleBtn.className = 'et-track-btn ' + (newState ? 'et-active' : 'et-inactive');
        toggleBtn.querySelector('.et-track-label').textContent = newState ? 'تتبع القراءة (نشط)' : 'تتبع القراءة (معطل)';
      });

      // Insert toggle button right next to Send button
      sendButton.parentElement.insertBefore(toggleBtn, sendButton.nextSibling);

      // Handle Send click
      const handleSend = () => {
        const isTracking = toggleBtn.dataset.tracking === 'true';
        if (!isTracking) return;

        // Extract email details
        const bodyEl = dialog.querySelector('div[aria-label="Message Body"]') ||
                       dialog.querySelector('div[role="textbox"]') ||
                       dialog.querySelector('.Am.Al.editable');

        const subjectInput = dialog.querySelector('input[name="subjectbox"]');
        const subject = subjectInput ? subjectInput.value.trim() : 'بدون عنوان';

        // Extract recipients
        const recipientChips = dialog.querySelectorAll('span[email], [peoplekit-id]');
        const recipientList = [];
        recipientChips.forEach(chip => {
          const email = chip.getAttribute('email') || chip.innerText.trim();
          if (email && email.includes('@') && !recipientList.includes(email)) {
            recipientList.push(email);
          }
        });

        // Fallback for recipient input
        if (recipientList.length === 0) {
          const toField = dialog.querySelector('input[name="to"]') || dialog.querySelector('textarea[name="to"]');
          if (toField && toField.value) {
            recipientList.push(toField.value.trim());
          }
        }

        const recipient = recipientList.join(', ') || 'مستلم عبر Gmail';

        if (bodyEl) {
          // Check if pixel already attached to avoid duplicates
          if (bodyEl.querySelector('img[data-et-id]')) return;

          const trackingId = generateTrackingId();
          const pixelUrl = `${serverUrl}/track/pixel/${trackingId}`;

          const pixelImg = document.createElement('img');
          pixelImg.src = pixelUrl;
          pixelImg.alt = '';
          pixelImg.setAttribute('data-et-id', trackingId);
          pixelImg.width = 1;
          pixelImg.height = 1;
          pixelImg.style.cssText = 'display:none !important; width:1px; height:1px; border:0; padding:0; margin:0;';

          bodyEl.appendChild(pixelImg);

          // Register in backend
          chrome.runtime.sendMessage({
            type: 'REGISTER_EMAIL',
            payload: {
              id: trackingId,
              recipient: recipient,
              subject: subject,
              sentAt: new Date().toISOString()
            }
          }, (res) => {
            console.log('[EmailTracker Prime] Email registered:', trackingId, res);
            showToast(`تم تفعيل تتبع الإيميل بنجاح (${recipient})`);
            // Refresh tracked list in a moment
            setTimeout(fetchTrackedEmails, 2000);
          });
        }
      };

      sendButton.addEventListener('click', handleSend, true);

      // Also listen to Ctrl+Enter / Cmd+Enter inside the compose body
      const bodyEl = dialog.querySelector('div[role="textbox"]');
      if (bodyEl) {
        bodyEl.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            handleSend();
          }
        }, true);
      }
    });
  }

  // --------------------------------------------------------------------------
  // 2. GMAIL ROWS INTEGRATION (Double Checkmarks & Read Receipts)
  // --------------------------------------------------------------------------

  // Clean strings for fuzzy matching
  function cleanSubject(str) {
    if (!str) return '';
    return str
      .replace(/^(re:|fwd:|رد:|إعادة توجيه:)\s*/i, '')
      .replace(/[\s\u200B-\u200D\uFEFF]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function decorateGmailRows() {
    if (!trackedEmails || trackedEmails.length === 0) return;

    // Find all email rows in Gmail list
    const rows = document.querySelectorAll('tr.zA, tr[role="row"]');

    rows.forEach((row) => {
      // Find subject element
      const subjectSpan = row.querySelector('.y6 span.bog, .bqe, .bog, span[data-thread-id]');
      if (!subjectSpan) return;

      const rowSubject = cleanSubject(subjectSpan.textContent);
      if (!rowSubject) return;

      // Find matching tracked email
      const matchedEmail = trackedEmails.find((item) => {
        const itemSubject = cleanSubject(item.subject);
        return itemSubject && (itemSubject === rowSubject || rowSubject.includes(itemSubject) || itemSubject.includes(rowSubject));
      });

      if (!matchedEmail) return;

      // Target container to place badge
      // Place badge right before the subject or in sender/date column
      let badgeContainer = row.querySelector('.yX.xY') || subjectSpan.parentElement;

      // Avoid duplicate badges
      let existingBadge = row.querySelector('.et-badge');
      if (existingBadge) {
        if (existingBadge.dataset.emailId === matchedEmail.id && existingBadge.dataset.isRead === String(matchedEmail.isRead)) {
          return; // Already up to date
        }
        existingBadge.remove();
      }

      // Create Badge Element
      const badge = document.createElement('span');
      badge.className = `et-badge ${matchedEmail.isRead ? 'et-read' : 'et-unread'}`;
      badge.dataset.emailId = matchedEmail.id;
      badge.dataset.isRead = String(matchedEmail.isRead);

      let tooltipText = '';
      if (matchedEmail.isRead) {
        const dateStr = matchedEmail.firstReadAtFormatted ? matchedEmail.firstReadAtFormatted.formatted : new Date(matchedEmail.firstReadAt).toLocaleString('ar-EG');
        tooltipText = `تمت القراءة!\nتاريخ الفتح: ${dateStr}\nمرات الفتح: ${matchedEmail.openCount} مرة\n(انقر لمشاهدة التفاصيل الكاملة)`;
      } else {
        const sentStr = matchedEmail.sentAtFormatted ? matchedEmail.sentAtFormatted.formatted : new Date(matchedEmail.sentAt).toLocaleString('ar-EG');
        tooltipText = `تم الإرسال (لم يُقرأ بعد)\nتاريخ الإرسال: ${sentStr}`;
      }

      badge.title = tooltipText;

      badge.innerHTML = `
        <span class="et-badge-check">✓✓</span>
        <span class="et-badge-label">${matchedEmail.isRead ? 'مقروء' : 'مرسل'}</span>
        ${matchedEmail.openCount > 1 ? `<span class="et-badge-count">${matchedEmail.openCount}</span>` : ''}
      `;

      // Open Modal Details on click
      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openEmailDetailsModal(matchedEmail.id);
      });

      // Insert at front of subject
      if (subjectSpan) {
        subjectSpan.parentElement.insertBefore(badge, subjectSpan);
      } else if (badgeContainer) {
        badgeContainer.prepend(badge);
      }
    });
  }

  // --------------------------------------------------------------------------
  // 3. DETAILED MODAL POPUP (Shows Full Open Timestamps & Log History)
  // --------------------------------------------------------------------------

  function openEmailDetailsModal(emailId) {
    chrome.runtime.sendMessage({ type: 'GET_EMAIL_STATUS', emailId }, (response) => {
      const email = response && response.email ? response.email : trackedEmails.find(e => e.id === emailId);
      if (!email) return;

      const existingModal = document.querySelector('.et-modal-overlay');
      if (existingModal) existingModal.remove();

      const modal = document.createElement('div');
      modal.className = 'et-modal-overlay';

      const readDate = email.firstReadAtFormatted ? email.firstReadAtFormatted.formatted : (email.firstReadAt ? new Date(email.firstReadAt).toLocaleString('ar-EG') : 'لم يُقرأ بعد');
      const lastReadDate = email.lastReadAtFormatted ? email.lastReadAtFormatted.formatted : (email.lastReadAt ? new Date(email.lastReadAt).toLocaleString('ar-EG') : '-');
      const sentDate = email.sentAtFormatted ? email.sentAtFormatted.formatted : new Date(email.sentAt).toLocaleString('ar-EG');

      modal.innerHTML = `
        <div class="et-modal-card">
          <div class="et-modal-header">
            <div class="et-modal-title">
              <span>${email.isRead ? '🟢' : '⚪'}</span>
              <span>تفاصيل قراءة الإيميل</span>
            </div>
            <button class="et-modal-close" id="et-modal-close-btn">&times;</button>
          </div>
          <div class="et-modal-body">
            <div class="et-info-row">
              <div class="et-info-label">المستلم:</div>
              <div class="et-info-val">${email.recipient}</div>
            </div>
            <div class="et-info-row">
              <div class="et-info-label">عنوان الإيميل (الموضوع):</div>
              <div class="et-info-val">${email.subject}</div>
            </div>
            <div class="et-info-row">
              <div class="et-info-label">وقت وتاريخ الإرسال:</div>
              <div class="et-info-val">${sentDate}</div>
            </div>
            <div class="et-info-row">
              <div class="et-info-label">حالة القراءة:</div>
              <div class="et-info-val" style="color: ${email.isRead ? '#137333' : '#b06000'}; font-weight: 700;">
                ${email.isRead ? `✓✓ تم فتح الإيميل (${email.openCount} مرة)` : '✓ لم يتم الفتح حتى الآن'}
              </div>
            </div>

            ${email.isRead ? `
              <div class="et-info-row">
                <div class="et-info-label">تاريخ ووقت أول فتح:</div>
                <div class="et-info-val" style="color: #137333; font-weight: 700;">${readDate}</div>
              </div>
              ${email.openCount > 1 ? `
                <div class="et-info-row">
                  <div class="et-info-label">تاريخ آخر فتح:</div>
                  <div class="et-info-val">${lastReadDate}</div>
                </div>
              ` : ''}

              <div class="et-reads-timeline">
                <div class="et-reads-title">سجل مرات الفتح بالتفصيل (${email.reads ? email.reads.length : 0}):</div>
                ${(email.reads || []).map((r, i) => `
                  <div class="et-read-entry">
                    <div>
                      <strong>المرة #${i + 1}:</strong> ${r.formatted ? r.formatted.formatted : new Date(r.timestamp).toLocaleString('ar-EG')}
                    </div>
                    <div class="et-read-client">${r.clientType || 'Email Client'}</div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // Close handlers
      modal.querySelector('#et-modal-close-btn').addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
      });
    });
  }

  // --------------------------------------------------------------------------
  // 4. OBSERVERS & PERIODIC REFRESH
  // --------------------------------------------------------------------------

  // Observe Gmail DOM mutations (new emails loading, navigating folders, opening compose)
  let debounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      injectComposeFeatures();
      decorateGmailRows();
    }, 300);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Sync tracked emails periodically (every 15 seconds)
  setInterval(() => {
    fetchTrackedEmails();
  }, 15000);

  // Initialize
  initSettings();
  setTimeout(() => {
    injectComposeFeatures();
    decorateGmailRows();
  }, 1500);

})();
