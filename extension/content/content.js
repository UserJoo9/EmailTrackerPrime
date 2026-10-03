// EmailTracker Prime - Content Script for Gmail (Synchronous Mousedown Capture & Instant Tracking)

(function () {
  'use strict';

  console.log('%c[EmailTracker Prime]%c Loaded & Active on Gmail.', 'color: #10b981; font-weight: bold;', 'color: auto;');

  let currentServerUrl = 'https://email-tracker-prime.vercel.app';
  let trackedEmails = [];

  // Initialize and maintain server URL in memory synchronously
  chrome.storage.local.get(['serverUrl', 'cachedEmails'], (data) => {
    if (data && data.serverUrl && data.serverUrl.trim()) {
      currentServerUrl = data.serverUrl.trim().replace(/\/+$/, '');
    }
    if (Array.isArray(data.cachedEmails)) {
      trackedEmails = data.cachedEmails;
      decorateGmailRows();
      decorateThreadMessages();
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.serverUrl && changes.serverUrl.newValue) {
      currentServerUrl = changes.serverUrl.newValue.trim().replace(/\/+$/, '');
    }
    if (changes.cachedEmails && changes.cachedEmails.newValue) {
      trackedEmails = changes.cachedEmails.newValue;
      decorateGmailRows();
      decorateThreadMessages();
    }
  });

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
  // 1. SYNCHRONOUS CAPTURE TRACKING (FIRES ON MOUSEDOWN BEFORE GMAIL SENDS)
  // --------------------------------------------------------------------------

  function getActiveBodyElement(triggerBtn) {
    // 1. Walk up from the button
    let parent = triggerBtn ? triggerBtn.parentElement : null;
    while (parent && parent !== document.body) {
      const el = parent.querySelector('div[contenteditable="true"], div[role="textbox"], .Am.Al.editable');
      if (el) return { bodyEl: el, container: parent };
      parent = parent.parentElement;
    }

    // 2. Currently focused element
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.getAttribute('role') === 'textbox')) {
      const cont = active.closest('form, table, div[role="region"], div[role="dialog"], .M9, .ip') || active.parentElement;
      return { bodyEl: active, container: cont };
    }

    // 3. Any visible contenteditable on the page
    const editables = document.querySelectorAll('div[contenteditable="true"], div[role="textbox"]');
    for (const el of editables) {
      if (el.offsetParent !== null) {
        const cont = el.closest('form, table, div[role="region"], div[role="dialog"], .M9, .ip') || el.parentElement;
        return { bodyEl: el, container: cont };
      }
    }

    return { bodyEl: editables[0] || null, container: null };
  }

  function extractRecipientFromPage(container) {
    if (!container) return 'مستلم عبر Gmail';

    const recipients = new Set();

    // 1. Direct recipient chips inside the compose/reply box
    const chips = container.querySelectorAll('span[email], [peoplekit-id], .vR span[email]');
    chips.forEach(chip => {
      const em = chip.getAttribute('email') || chip.innerText.trim();
      if (em && em.includes('@') && !em.toLowerCase().includes('yalkhodary')) {
        recipients.add(em.trim());
      }
    });

    // 2. Direct input fields in compose/reply box
    const toInputs = container.querySelectorAll('input[name="to"], textarea[name="to"]');
    toInputs.forEach(inp => {
      if (inp.value && inp.value.includes('@')) {
        inp.value.split(',').forEach(part => {
          const em = part.replace(/[<>]/g, '').trim();
          if (em.includes('@') && !em.toLowerCase().includes('yalkhodary')) {
            recipients.add(em);
          }
        });
      }
    });

    // 3. In Inline Reply: the chip in the header of the reply box (e.g. .aoT)
    if (recipients.size === 0) {
      const replyHeaderChip = container.querySelector('.aoT, .vN, span[data-hovercard-id]');
      if (replyHeaderChip) {
        const em = replyHeaderChip.getAttribute('data-hovercard-id') || replyHeaderChip.getAttribute('email') || replyHeaderChip.textContent.trim();
        const match = em.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (match && !match[0].toLowerCase().includes('yalkhodary')) {
          recipients.add(match[0]);
        }
      }
    }

    // 4. Fallback for inline reply: check ONLY the immediate message container above the reply
    if (recipients.size === 0) {
      const parentMsg = container.closest('.adn, .ads, [role="listitem"]');
      if (parentMsg) {
        const prevSender = parentMsg.querySelector('.gD[email], span[email]');
        if (prevSender) {
          const em = prevSender.getAttribute('email');
          if (em && em.includes('@') && !em.toLowerCase().includes('yalkhodary')) {
            recipients.add(em.trim());
          }
        }
      }
    }

    const arr = Array.from(recipients);
    return arr.length > 0 ? arr.slice(0, 2).join(', ') : 'joodevo890@gmail.com';
  }

  function extractSubjectFromPage(container) {
    if (container) {
      const subjInput = container.querySelector('input[name="subjectbox"]');
      if (subjInput && subjInput.value.trim()) {
        const val = subjInput.value.trim();
        return { subject: val, isFollowUp: /^(re:|fwd:|رد:|متابعة:)/i.test(val) };
      }
    }

    const threadTitleEl = document.querySelector('h2.hP, h2[data-thread-perm-id], .ha h2');
    if (threadTitleEl && threadTitleEl.textContent.trim()) {
      return { subject: 'رد: ' + threadTitleEl.textContent.trim(), isFollowUp: true };
    }

    return { subject: 'متابعة / رد', isFollowUp: true };
  }

  // Core tracking function executed SYNCHRONOUSLY
  function processTracking(triggerBtn) {
    try {
      const { bodyEl, container } = getActiveBodyElement(triggerBtn);
      if (!bodyEl) {
        console.warn('[EmailTracker] No editable body found.');
        return;
      }

      // Debounce: prevent running twice within 2 seconds on the same body
      const lastInjected = bodyEl.getAttribute('data-et-time');
      if (lastInjected && (Date.now() - Number(lastInjected) < 2000)) {
        return;
      }
      bodyEl.setAttribute('data-et-time', String(Date.now()));

      // 1. Remove previous pixels
      bodyEl.querySelectorAll('img[data-et-id]').forEach(p => p.remove());

      // 2. Generate ID & inject pixel SYNCHRONOUSLY into body
      const trackingId = generateTrackingId();
      const pixelUrl = `${currentServerUrl}/track/pixel/${trackingId}?_t=${Date.now()}`;

      const pixelImg = document.createElement('img');
      pixelImg.src = pixelUrl;
      pixelImg.alt = '';
      pixelImg.setAttribute('data-et-id', trackingId);
      pixelImg.width = 1;
      pixelImg.height = 1;
      pixelImg.style.cssText = 'display:none!important;width:1px!important;height:1px!important;border:0;padding:0;margin:0;';

      bodyEl.appendChild(pixelImg);
      bodyEl.dispatchEvent(new Event('input', { bubbles: true }));

      // 3. Extract metadata
      const recipient = extractRecipientFromPage(container);
      const { subject, isFollowUp } = extractSubjectFromPage(container);

      console.log(`%c[EmailTracker INJECTED]%c ID: ${trackingId} | To: ${recipient} | Subject: ${subject}`, 'color: #10b981; font-weight: bold;', 'color: auto;');

      const payload = {
        id: trackingId,
        recipient: recipient,
        subject: subject,
        isFollowUp: isFollowUp,
        sentAt: new Date().toISOString()
      };

      // 4. Save to local cache immediately
      chrome.storage.local.get(['cachedEmails'], (data) => {
        const list = Array.isArray(data.cachedEmails) ? data.cachedEmails : [];
        list.unshift({ ...payload, isRead: false, openCount: 0 });
        chrome.storage.local.set({ cachedEmails: list });
        trackedEmails = list;
        decorateGmailRows();
        decorateThreadMessages();
      });

      // 5. Send to background & server
      chrome.runtime.sendMessage({
        type: 'REGISTER_EMAIL',
        payload: payload
      }, (res) => {
        console.log('[EmailTracker] Backend register result:', res);
      });

      showToast(`تم تتبع ${isFollowUp ? 'المتابعة' : 'الإيميل'} تلقائياً ✓✓ (${recipient})`);
    } catch (err) {
      console.error('[EmailTracker processTracking error]', err);
    }
  }

  // Hook mousedown in CAPTURE phase (fires BEFORE Gmail's click handler)
  document.addEventListener('mousedown', (e) => {
    const target = e.target;
    if (!target) return;

    const sendBtn = target.closest(
      '[role="button"][data-tooltip*="Send"], [role="button"][data-tooltip*="إرسال"], ' +
      '[role="button"][aria-label*="Send"], [role="button"][aria-label*="إرسال"], ' +
      '.T-I.aoO, .T-I-atl, .aoO'
    );

    if (sendBtn) {
      console.log('[EmailTracker] Mousedown on Send detected!');
      processTracking(sendBtn);
    }
  }, true);

  // Hook click in CAPTURE phase as well
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;

    const sendBtn = target.closest(
      '[role="button"][data-tooltip*="Send"], [role="button"][data-tooltip*="إرسال"], ' +
      '[role="button"][aria-label*="Send"], [role="button"][aria-label*="إرسال"], ' +
      '.T-I.aoO, .T-I-atl, .aoO'
    );

    if (sendBtn) {
      processTracking(sendBtn);
    }
  }, true);

  // Hook Ctrl+Enter / Cmd+Enter
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const active = document.activeElement;
      if (active && (active.isContentEditable || active.getAttribute('role') === 'textbox')) {
        console.log('[EmailTracker] Ctrl+Enter detected in active editable!');
        processTracking(null);
      }
    }
  }, true);

  // --------------------------------------------------------------------------
  // 2. GMAIL ROWS: MAILTRACK-STYLE DOUBLE CHECKMARKS
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

  // Neutralize any tracking pixels rendered in the sender's own view (Sent messages view)
  function neutralizeSelfPixels() {
    const pixels = document.querySelectorAll('img[src*="/track/pixel/"]');
    pixels.forEach(p => {
      // Only neutralize if it is rendered in an existing message, not while actively composing
      if (!p.closest('[contenteditable="true"]')) {
        p.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      }
    });
  }

  // --------------------------------------------------------------------------
  // 5. OBSERVER & PERIODIC REFRESH
  // --------------------------------------------------------------------------

  let debounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      neutralizeSelfPixels();
      decorateGmailRows();
      decorateThreadMessages();
    }, 250);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => {
    fetchTrackedEmails();
  }, 10000);

  fetchTrackedEmails();
  setTimeout(() => {
    decorateGmailRows();
    decorateThreadMessages();
  }, 1000);

})();
