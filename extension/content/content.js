// EmailTracker Prime - Content Script for Gmail (Bulletproof Automatic Tracking & Mailtrack Checkmarks)

(function () {
  'use strict';

  console.log('%c[EmailTracker Prime]%c Content script initialized on Gmail.', 'color: #10b981; font-weight: bold;', 'color: auto;');

  let currentServerUrl = '';
  let trackedEmails = [];

  // Helper to get active server URL from local storage or background
  async function resolveServerUrl() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['serverUrl'], (data) => {
        if (data && data.serverUrl && data.serverUrl.trim()) {
          currentServerUrl = data.serverUrl.trim().replace(/\/+$/, '');
          resolve(currentServerUrl);
        } else {
          chrome.runtime.sendMessage({ type: 'GET_SERVER_URL' }, (res) => {
            currentServerUrl = (res && res.serverUrl) ? res.serverUrl.trim().replace(/\/+$/, '') : 'http://localhost:3000';
            resolve(currentServerUrl);
          });
        }
      });
    });
  }

  function fetchTrackedEmails() {
    chrome.runtime.sendMessage({ type: 'GET_EMAILS' }, (response) => {
      if (response && response.success && Array.isArray(response.emails)) {
        trackedEmails = response.emails;
        chrome.storage.local.set({ cachedEmails: trackedEmails });
        decorateGmailRows();
        decorateThreadMessages();
      }
    });
  }

  function generateTrackingId() {
    return 'et_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }

  function showToast(message, duration = 3500) {
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
  // 1. BULLETPROOF SEND INTERCEPTION (CAPTURE PHASE AT DOCUMENT ROOT)
  // --------------------------------------------------------------------------

  // Find the contenteditable body starting from a send button
  function findBodyElement(sendBtn) {
    let parent = sendBtn.parentElement;
    while (parent && parent !== document.body) {
      const candidate = parent.querySelector('div[contenteditable="true"], div[role="textbox"], .Am.Al.editable');
      if (candidate) return { bodyEl: candidate, container: parent };
      parent = parent.parentElement;
    }
    // Fallback: activeElement or any visible editable body
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.getAttribute('role') === 'textbox')) {
      return { bodyEl: active, container: active.closest('form, table, div[role="region"], div[role="dialog"]') || active.parentElement };
    }
    const anyEditable = document.querySelector('div[contenteditable="true"], div[role="textbox"]');
    return { bodyEl: anyEditable, container: anyEditable ? anyEditable.parentElement : null };
  }

  // Extract Recipient reliably from container or thread
  function extractRecipient(container) {
    const recipientList = [];

    // 1. Check chips inside container
    if (container) {
      const chips = container.querySelectorAll('span[email], [peoplekit-id]');
      chips.forEach(chip => {
        const em = chip.getAttribute('email') || chip.innerText.trim();
        if (em && em.includes('@') && !recipientList.includes(em)) {
          recipientList.push(em);
        }
      });

      // 2. Check input fields
      const inputs = container.querySelectorAll('input[name="to"], textarea[name="to"], [aria-label*="To"], [aria-label*="إلى"]');
      inputs.forEach(inp => {
        if (inp.value && inp.value.includes('@')) {
          inp.value.split(',').forEach(part => {
            const clean = part.replace(/[<>]/g, '').trim();
            if (clean.includes('@') && !recipientList.includes(clean)) recipientList.push(clean);
          });
        }
      });
    }

    // 3. If empty (inline reply), extract from the thread header / previous messages
    if (recipientList.length === 0) {
      // Look for recipients in the open thread
      const threadToElements = document.querySelectorAll('.adn [email], .ads [email], span.gD[email], span.gI[email], span[data-hovercard-id]');
      threadToElements.forEach(el => {
        const em = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || el.innerText.trim();
        if (em && em.includes('@') && !recipientList.includes(em)) {
          recipientList.push(em);
        }
      });
    }

    return recipientList.length > 0 ? recipientList.join(', ') : 'مستلم عبر Gmail';
  }

  // Extract Subject reliably (including inline replies)
  function extractSubject(container) {
    if (container) {
      const subjInput = container.querySelector('input[name="subjectbox"]');
      if (subjInput && subjInput.value.trim()) {
        return { subject: subjInput.value.trim(), isFollowUp: /^(re:|fwd:|رد:|متابعة:)/i.test(subjInput.value.trim()) };
      }
    }

    // Inline reply: get subject from thread title
    const threadTitleEl = document.querySelector('h2.hP, h2[data-thread-perm-id], .ha h2');
    if (threadTitleEl && threadTitleEl.textContent.trim()) {
      return { subject: 'رد: ' + threadTitleEl.textContent.trim(), isFollowUp: true };
    }

    return { subject: 'متابعة / رد', isFollowUp: true };
  }

  // Core tracking injection handler
  async function handleSendEvent(sendBtn) {
    try {
      const { bodyEl, container } = findBodyElement(sendBtn);

      if (!bodyEl) {
        console.warn('[EmailTracker] Could not find body element to attach pixel.');
        return;
      }

      const serverUrl = await resolveServerUrl();
      const trackingId = generateTrackingId();
      const pixelUrl = `${serverUrl}/track/pixel/${trackingId}?_t=${Date.now()}`;

      // Remove any previously attached tracking pixels
      const oldPixels = bodyEl.querySelectorAll('img[data-et-id]');
      oldPixels.forEach(p => p.remove());

      // Create new pixel image
      const pixelImg = document.createElement('img');
      pixelImg.src = pixelUrl;
      pixelImg.alt = '';
      pixelImg.setAttribute('data-et-id', trackingId);
      pixelImg.width = 1;
      pixelImg.height = 1;
      pixelImg.style.cssText = 'display:none !important; width:1px !important; height:1px !important; border:0; padding:0; margin:0;';

      bodyEl.appendChild(pixelImg);

      // Trigger input event to ensure Gmail's rich text editor captures the image
      bodyEl.dispatchEvent(new Event('input', { bubbles: true }));

      // Extract metadata
      const recipient = extractRecipient(container);
      const { subject, isFollowUp } = extractSubject(container);

      console.log(`%c[EmailTracker Tracked]%c ID: ${trackingId} | To: ${recipient} | Subject: ${subject} | URL: ${pixelUrl}`, 'color: #10b981; font-weight: bold;', 'color: auto;');

      const payload = {
        id: trackingId,
        recipient: recipient,
        subject: subject,
        isFollowUp: isFollowUp,
        sentAt: new Date().toISOString()
      };

      // Register with background and server immediately
      chrome.runtime.sendMessage({
        type: 'REGISTER_EMAIL',
        payload: payload
      }, (res) => {
        console.log('[EmailTracker] Registration response:', res);
      });

      // Save to local cache immediately
      chrome.storage.local.get(['cachedEmails'], (data) => {
        const list = Array.isArray(data.cachedEmails) ? data.cachedEmails : [];
        list.unshift({
          ...payload,
          isRead: false,
          openCount: 0
        });
        chrome.storage.local.set({ cachedEmails: list });
        trackedEmails = list;
        decorateGmailRows();
        decorateThreadMessages();
      });

      showToast(`تم تتبع ${isFollowUp ? 'المتابعة' : 'الإيميل'} تلقائياً ✓✓ (${recipient})`);
    } catch (err) {
      console.error('[EmailTracker Error in handleSendEvent]', err);
    }
  }

  // Intercept click at document level in CAPTURE phase (runs before Gmail's listeners)
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;

    // Check if clicked element or its parents is a Send button
    const sendBtn = target.closest(
      '[role="button"][data-tooltip*="Send"], [role="button"][data-tooltip*="إرسال"], ' +
      '[role="button"][aria-label*="Send"], [role="button"][aria-label*="إرسال"], ' +
      '.T-I.aoO, .T-I-atl, .aoO'
    );

    if (sendBtn) {
      console.log('[EmailTracker] Send button clicked!');
      handleSendEvent(sendBtn);
    }
  }, true);

  // Intercept keyboard shortcuts (Ctrl+Enter / Cmd+Enter)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const active = document.activeElement;
      if (active && (active.isContentEditable || active.getAttribute('role') === 'textbox')) {
        console.log('[EmailTracker] Ctrl+Enter detected in editable body!');
        const { container } = findBodyElement(active);
        const sendBtn = container?.querySelector('[role="button"][data-tooltip*="Send"], .T-I.aoO') || active;
        handleSendEvent(sendBtn);
      }
    }
  }, true);

  // --------------------------------------------------------------------------
  // 2. GMAIL ROWS: MAILTRACK-STYLE DOUBLE CHECKMARKS (Between Star & Recipient)
  // --------------------------------------------------------------------------

  function cleanSubject(str) {
    if (!str) return '';
    return str
      .replace(/^(re:|fwd:|رد:|إعادة توجيه:|متابعة:)\s*/i, '')
      .replace(/[\s\u200B-\u200D\uFEFF]+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function createMailtrackBadge(matched) {
    const badge = document.createElement('span');
    badge.className = `et-mailtrack-checks ${matched.isRead ? 'et-is-read' : 'et-is-pending'}`;
    badge.dataset.emailId = matched.id;
    badge.dataset.isRead = String(matched.isRead);

    const dateStr = matched.firstReadAtFormatted 
      ? matched.firstReadAtFormatted.formatted 
      : (matched.firstReadAt ? new Date(matched.firstReadAt).toLocaleString('ar-EG') : null);

    badge.title = matched.isRead 
      ? `تمت القراءة!\nتاريخ الفتح: ${dateStr}\nمرات الفتح: ${matched.openCount} مرة\n(انقر لعرض التفاصيل)` 
      : `تم الإرسال (لم يُقرأ بعد)\nوقت الإرسال: ${matched.sentAtFormatted ? matched.sentAtFormatted.formatted : new Date(matched.sentAt).toLocaleString('ar-EG')}`;

    badge.innerHTML = `
      <svg class="et-svg-icon" viewBox="0 0 16 11" width="16" height="11" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path class="et-chk-left" d="M1 5.5L4 8.5L9.5 2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path class="et-chk-right" d="M6 5.5L9 8.5L14.5 2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;

    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEmailDetailsModal(matched.id);
    });

    return badge;
  }

  function decorateGmailRows() {
    if (!trackedEmails || trackedEmails.length === 0) return;

    const rows = document.querySelectorAll('tr.zA, tr[role="row"]');

    rows.forEach((row) => {
      const subjectSpan = row.querySelector('.y6 span.bog, .bqe, .bog, span[data-thread-id]');
      const recipCell = row.querySelector('.yW, .yX.xY, td.yX');

      const rowSubject = cleanSubject(subjectSpan ? subjectSpan.textContent : '');
      const rowRecipText = (recipCell ? recipCell.textContent : '').toLowerCase().trim();

      let matchedEmail = null;

      for (const item of trackedEmails) {
        const itemSubject = cleanSubject(item.subject);
        const itemRecip = (item.recipient || '').toLowerCase().trim();
        const recipUser = itemRecip.split('@')[0];

        if (itemSubject && rowSubject && (rowSubject === itemSubject || rowSubject.includes(itemSubject) || itemSubject.includes(rowSubject))) {
          matchedEmail = item;
          break;
        }

        if (recipUser && rowRecipText && (rowRecipText.includes(recipUser) || rowRecipText.includes(itemRecip))) {
          matchedEmail = item;
          break;
        }
      }

      if (!matchedEmail) return;

      const targetContainer = row.querySelector('.yW') || row.querySelector('.yX.xY') || recipCell;
      if (!targetContainer) return;

      let existing = targetContainer.querySelector('.et-mailtrack-checks');
      if (existing) {
        if (existing.dataset.emailId === matchedEmail.id && existing.dataset.isRead === String(matchedEmail.isRead)) {
          return;
        }
        existing.remove();
      }

      const badge = createMailtrackBadge(matchedEmail);
      targetContainer.prepend(badge);
    });
  }

  // --------------------------------------------------------------------------
  // 3. IN-THREAD MESSAGE HEADERS
  // --------------------------------------------------------------------------

  function decorateThreadMessages() {
    if (!trackedEmails || trackedEmails.length === 0) return;

    const threadTitleEl = document.querySelector('h2.hP, h2[data-thread-perm-id], .ha h2');
    if (!threadTitleEl) return;
    const threadSubject = cleanSubject(threadTitleEl.textContent);

    const messageHeaders = document.querySelectorAll('.gE.iv.gt, .adn.ads .gH');

    messageHeaders.forEach((header) => {
      if (header.querySelector('.et-thread-checks')) return;

      const matchedEmail = trackedEmails.find((item) => {
        const itemSubject = cleanSubject(item.subject);
        return itemSubject && (itemSubject === threadSubject || threadSubject.includes(itemSubject) || itemSubject.includes(threadSubject));
      });

      if (!matchedEmail) return;

      const dateContainer = header.querySelector('.gK, .gH span.g3, .xW') || header;

      const badge = createMailtrackBadge(matchedEmail);
      badge.classList.add('et-thread-checks');

      dateContainer.prepend(badge);
    });
  }

  // --------------------------------------------------------------------------
  // 4. DETAILED MODAL CARD
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
              <span>تفاصيل قراءة ${email.isFollowUp ? 'المتابعة' : 'الإيميل'}</span>
            </div>
            <button class="et-modal-close" id="et-modal-close-btn">&times;</button>
          </div>
          <div class="et-modal-body">
            <div class="et-field">
              <span class="et-label">المستلم:</span>
              <span class="et-value">${email.recipient}</span>
            </div>
            <div class="et-field">
              <span class="et-label">الموضوع:</span>
              <span class="et-value">${email.subject || '(بدون عنوان)'}</span>
            </div>
            ${email.isFollowUp ? `
              <div class="et-field">
                <span class="et-label">النوع:</span>
                <span class="et-value" style="color: #3b82f6;">متابعة / رد (Follow-up)</span>
              </div>
            ` : ''}
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
  // 5. OBSERVER & PERIODIC REFRESH
  // --------------------------------------------------------------------------

  let debounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      decorateGmailRows();
      decorateThreadMessages();
    }, 250);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    fetchTrackedEmails();
  }, 10000);

  // Initialize
  resolveServerUrl().then(() => {
    fetchTrackedEmails();
  });

  setTimeout(() => {
    decorateGmailRows();
    decorateThreadMessages();
  }, 1000);

})();
