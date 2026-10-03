// EmailTracker Prime - Content Script for Gmail (100% Automatic & Invisible Tracking)

(function () {
  'use strict';

  let serverUrl = 'http://localhost:3000';
  let trackedEmails = [];

  function initSettings() {
    chrome.storage.local.get(['serverUrl', 'cachedEmails'], (data) => {
      if (data.serverUrl) {
        serverUrl = data.serverUrl.trim().replace(/\/+$/, '');
      }
      if (Array.isArray(data.cachedEmails)) {
        trackedEmails = data.cachedEmails;
        decorateGmailRows();
      }
    });

    chrome.runtime.sendMessage({ type: 'GET_SERVER_URL' }, (res) => {
      if (res && res.serverUrl) {
        serverUrl = res.serverUrl.trim().replace(/\/+$/, '');
      }
    });

    fetchTrackedEmails();
  }

  function fetchTrackedEmails() {
    chrome.runtime.sendMessage({ type: 'GET_EMAILS' }, (response) => {
      if (response && response.success && Array.isArray(response.emails)) {
        trackedEmails = response.emails;
        chrome.storage.local.set({ cachedEmails: trackedEmails });
        decorateGmailRows();
      }
    });
  }

  function generateTrackingId() {
    return 'et_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  function showToast(message, duration = 3000) {
    const existing = document.querySelector('.et-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'et-toast';
    toast.innerHTML = `<span class="et-toast-check">✓✓</span> <span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 350);
    }, duration);
  }

  // --------------------------------------------------------------------------
  // 1. AUTOMATIC INVISIBLE TRACKING (No visible button in compose)
  // --------------------------------------------------------------------------

  function attachAutomaticTracking() {
    const composeDialogs = document.querySelectorAll('div[role="dialog"]');

    composeDialogs.forEach((dialog) => {
      const sendButton = dialog.querySelector('[role="button"][data-tooltip*="Send"]') ||
                         dialog.querySelector('.T-I.J-J5-Ji.aoO.v7.T-I-atl.L3') ||
                         dialog.querySelector('[aria-label*="Send"]');

      if (!sendButton) return;

      // Prevent duplicate event handlers on the same dialog
      if (dialog.dataset.etHooked === 'true') return;
      dialog.dataset.etHooked = 'true';

      const handleAutoSend = () => {
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

        if (recipientList.length === 0) {
          const toField = dialog.querySelector('input[name="to"]') || dialog.querySelector('textarea[name="to"]');
          if (toField && toField.value) {
            recipientList.push(toField.value.trim());
          }
        }

        const recipient = recipientList.join(', ') || 'مستلم عبر Gmail';

        if (bodyEl) {
          // Remove any stale or previous tracking pixels from draft
          const existingPixels = bodyEl.querySelectorAll('img[data-et-id]');
          existingPixels.forEach(p => p.remove());

          // Create a brand new unique tracking ID and cache-busting pixel
          const trackingId = generateTrackingId();
          const pixelUrl = `${serverUrl}/track/pixel/${trackingId}?_t=${Date.now()}`;

          const pixelImg = document.createElement('img');
          pixelImg.src = pixelUrl;
          pixelImg.alt = '';
          pixelImg.setAttribute('data-et-id', trackingId);
          pixelImg.width = 1;
          pixelImg.height = 1;
          pixelImg.style.cssText = 'display:none !important; width:1px; height:1px; border:0; padding:0; margin:0;';

          bodyEl.appendChild(pixelImg);

          // Register in backend & local cache
          const payload = {
            id: trackingId,
            recipient: recipient,
            subject: subject,
            sentAt: new Date().toISOString()
          };

          chrome.runtime.sendMessage({
            type: 'REGISTER_EMAIL',
            payload: payload
          }, () => {
            showToast(`تتبع تلقائي نشط ✓✓ (${recipient})`);
            setTimeout(fetchTrackedEmails, 2000);
          });
        }
      };

      sendButton.addEventListener('click', handleAutoSend, true);

      // Keyboard shortcut Ctrl+Enter / Cmd+Enter
      const bodyEl = dialog.querySelector('div[role="textbox"]');
      if (bodyEl) {
        bodyEl.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            handleAutoSend();
          }
        }, true);
      }
    });
  }

  // --------------------------------------------------------------------------
  // 2. SLEEK GMAIL ROW BADGES (✓✓ Compact Checkmarks)
  // --------------------------------------------------------------------------

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

    const rows = document.querySelectorAll('tr.zA, tr[role="row"]');

    rows.forEach((row) => {
      const subjectSpan = row.querySelector('.y6 span.bog, .bqe, .bog, span[data-thread-id]');
      if (!subjectSpan) return;

      const rowSubject = cleanSubject(subjectSpan.textContent);
      if (!rowSubject) return;

      const matchedEmail = trackedEmails.find((item) => {
        const itemSubject = cleanSubject(item.subject);
        return itemSubject && (itemSubject === rowSubject || rowSubject.includes(itemSubject) || itemSubject.includes(rowSubject));
      });

      if (!matchedEmail) return;

      let existingBadge = row.querySelector('.et-row-badge');
      if (existingBadge) {
        if (existingBadge.dataset.emailId === matchedEmail.id && existingBadge.dataset.isRead === String(matchedEmail.isRead)) {
          return;
        }
        existingBadge.remove();
      }

      // Compact Double-Check Badge
      const badge = document.createElement('span');
      badge.className = `et-row-badge ${matchedEmail.isRead ? 'et-is-read' : 'et-is-pending'}`;
      badge.dataset.emailId = matchedEmail.id;
      badge.dataset.isRead = String(matchedEmail.isRead);

      let tooltipText = '';
      if (matchedEmail.isRead) {
        const dateStr = matchedEmail.firstReadAtFormatted ? matchedEmail.firstReadAtFormatted.formatted : new Date(matchedEmail.firstReadAt).toLocaleString('ar-EG');
        tooltipText = `تمت القراءة!\nتاريخ الفتح: ${dateStr}\nمرات الفتح: ${matchedEmail.openCount} مرة\n(انقر لمشاهدة التفاصيل)`;
      } else {
        const sentStr = matchedEmail.sentAtFormatted ? matchedEmail.sentAtFormatted.formatted : new Date(matchedEmail.sentAt).toLocaleString('ar-EG');
        tooltipText = `تم الإرسال (لم يُقرأ بعد)\nوقت الإرسال: ${sentStr}`;
      }

      badge.title = tooltipText;

      badge.innerHTML = `
        <span class="et-checks">✓✓</span>
        ${matchedEmail.openCount > 1 ? `<span class="et-count">${matchedEmail.openCount}</span>` : ''}
      `;

      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openEmailDetailsModal(matchedEmail.id);
      });

      // Insert cleanly right before the subject text
      subjectSpan.parentElement.insertBefore(badge, subjectSpan);
    });
  }

  // --------------------------------------------------------------------------
  // 3. MODERN MODAL CARD ON CLICK
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
      const sentDate = email.sentAtFormatted ? email.sentAtFormatted.formatted : new Date(email.sentAt).toLocaleString('ar-EG');

      modal.innerHTML = `
        <div class="et-modal-card">
          <div class="et-modal-header">
            <div class="et-modal-title">
              <span class="et-modal-icon">${email.isRead ? '🟢' : '⚪'}</span>
              <span>تفاصيل قراءة الإيميل</span>
            </div>
            <button class="et-modal-close" id="et-modal-close-btn">&times;</button>
          </div>
          <div class="et-modal-body">
            <div class="et-field">
              <span class="et-label">المستلم:</span>
              <span class="et-value">${email.recipient}</span>
            </div>
            <div class="et-field">
              <span class="et-label">موضوع الإيميل:</span>
              <span class="et-value">${email.subject || '(بدون عنوان)'}</span>
            </div>
            <div class="et-field">
              <span class="et-label">توقيت الإرسال:</span>
              <span class="et-value">${sentDate}</span>
            </div>
            <div class="et-field">
              <span class="et-label">حالة القراءة:</span>
              <span class="et-value ${email.isRead ? 'et-green' : 'et-orange'}">
                ${email.isRead ? `✓✓ تم فتح الإيميل (${email.openCount} مرة)` : '⏳ لم يتم الفتح حتى الآن'}
              </span>
            </div>

            ${email.isRead ? `
              <div class="et-field">
                <span class="et-label">تاريخ ووقت الفتح:</span>
                <span class="et-value et-green">${readDate}</span>
              </div>

              ${(email.reads && email.reads.length > 0) ? `
                <div class="et-timeline-section">
                  <div class="et-timeline-title">سجل مرات الفتح بالتفصيل (${email.reads.length}):</div>
                  ${email.reads.map((r, i) => `
                    <div class="et-timeline-item">
                      <div class="et-tl-time">المرة #${i + 1}: ${r.formatted ? r.formatted.formatted : new Date(r.timestamp).toLocaleString('ar-EG')}</div>
                      <div class="et-tl-client">${r.clientType || 'Email Client'}</div>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            ` : ''}
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      modal.querySelector('#et-modal-close-btn').addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
      });
    });
  }

  // --------------------------------------------------------------------------
  // 4. OBSERVER & SYNC
  // --------------------------------------------------------------------------

  let debounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      attachAutomaticTracking();
      decorateGmailRows();
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    fetchTrackedEmails();
  }, 10000);

  initSettings();
  setTimeout(() => {
    attachAutomaticTracking();
    decorateGmailRows();
  }, 1000);

})();
