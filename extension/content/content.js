// EmailTracker Prime - Content Script for Gmail (Synchronous Mousedown Capture & Instant Tracking)

(function () {
  'use strict';

  console.log('%c[EmailTracker Prime]%c Loaded & Active on Gmail.', 'color: #10b981; font-weight: bold;', 'color: auto;');

  let currentServerUrl = 'https://email-tracker-prime.vercel.app';
  let trackedEmails = [];
  let selectedTimezone = 'auto';

  // Initialize and maintain server URL & timezone in memory synchronously
  chrome.storage.local.get(['serverUrl', 'cachedEmails', 'timezone'], (data) => {
    if (data && data.serverUrl && data.serverUrl.trim()) {
      currentServerUrl = data.serverUrl.trim().replace(/\/+$/, '');
    }
    if (data && data.timezone) {
      selectedTimezone = data.timezone;
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
    if (changes.timezone && changes.timezone.newValue) {
      selectedTimezone = changes.timezone.newValue;
      decorateGmailRows();
      decorateThreadMessages();
    }
    if (changes.cachedEmails && changes.cachedEmails.newValue) {
      trackedEmails = changes.cachedEmails.newValue;
      decorateGmailRows();
      decorateThreadMessages();
    }
  });

  function formatTimeWithTz(isoString) {
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
    } catch (e) {
      return new Date(isoString).toLocaleString('ar-EG');
    }
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
  // 1. SYNCHRONOUS CAPTURE TRACKING (FIRES ON MOUSEDOWN BEFORE GMAIL SENDS)
  // --------------------------------------------------------------------------

  function getComposeContainer(triggerBtn, bodyEl) {
    const start = triggerBtn || bodyEl || document.activeElement;
    if (!start) return document.body;

    return start.closest(
      'div[role="dialog"], .AD, .M9, .inboxsdk__compose, .adn.ads, [role="listitem"], .ip, .aoI, form'
    ) || document.body;
  }

  function getActiveBodyElement(triggerBtn) {
    let bodyEl = null;

    // 1. Direct parent compose container from triggerBtn
    if (triggerBtn) {
      const container = getComposeContainer(triggerBtn);
      if (container) {
        bodyEl = container.querySelector('div[contenteditable="true"], div[role="textbox"], .Am.Al.editable');
        if (bodyEl) return { bodyEl, container };
      }
    }

    // 2. Focused element
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.getAttribute('role') === 'textbox')) {
      bodyEl = active;
      const container = getComposeContainer(null, bodyEl);
      return { bodyEl, container };
    }

    // 3. Fallback: Any visible editable
    const editables = document.querySelectorAll('div[contenteditable="true"], div[role="textbox"], .Am.Al.editable');
    for (const el of editables) {
      if (el.offsetParent !== null) {
        bodyEl = el;
        const container = getComposeContainer(null, bodyEl);
        return { bodyEl, container };
      }
    }

    return { bodyEl: editables[0] || null, container: document.body };
  }

  function extractRecipientFromPage(container) {
    const recipients = new Set();
    const searchScope = container || document.body;

    function addEmail(str) {
      if (!str || typeof str !== 'string') return;
      const matches = str.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (matches) {
        matches.forEach(m => {
          const em = m.trim().toLowerCase();
          if (!em.includes('yalkhodary')) {
            recipients.add(em);
          }
        });
      }
    }

    // 1. Check direct attributes in compose container
    searchScope.querySelectorAll('[email]').forEach(el => {
      addEmail(el.getAttribute('email'));
    });

    searchScope.querySelectorAll('[data-hovercard-id]').forEach(el => {
      addEmail(el.getAttribute('data-hovercard-id'));
    });

    searchScope.querySelectorAll('input[name="to"], input.vO, textarea[name="to"], input[name="toReal"]').forEach(inp => {
      addEmail(inp.value);
    });

    searchScope.querySelectorAll('.vR, .vN, .afV, .aoT, [peoplekit-id]').forEach(chip => {
      addEmail(chip.getAttribute('email'));
      addEmail(chip.getAttribute('data-hovercard-id'));
      addEmail(chip.innerText || chip.textContent);
    });

    // 2. Inline reply: check previous message sender in thread
    if (recipients.size === 0) {
      const parentMsg = searchScope.closest('.adn, .ads, [role="listitem"]');
      if (parentMsg) {
        parentMsg.querySelectorAll('.gD[email], span[email]').forEach(el => {
          addEmail(el.getAttribute('email'));
        });
      }
    }

    // 3. Global active compose search
    if (recipients.size === 0) {
      document.querySelectorAll('.AD [email], .M9 [email], div[role="dialog"] [email], .AD input.vO, .M9 input.vO').forEach(el => {
        addEmail(el.getAttribute('email') || el.value);
      });
    }

    const arr = Array.from(recipients);
    return arr.length > 0 ? arr.slice(0, 2).join(', ') : 'مستلم عبر Gmail';
  }

  function extractSubjectFromPage(container) {
    const searchScope = container || document.body;

    // 1. Look for subjectbox in the container or dialog
    const subjInput = searchScope.querySelector('input[name="subjectbox"]') || 
                      document.querySelector('.AD input[name="subjectbox"], .M9 input[name="subjectbox"]');
    if (subjInput && subjInput.value.trim()) {
      const val = subjInput.value.trim();
      return { subject: val, isFollowUp: /^(re:|fwd:|رد:|متابعة:)/i.test(val) };
    }

    // 2. In-thread reply title
    const threadTitleEl = document.querySelector('h2.hP, h2[data-thread-perm-id], .ha h2');
    if (threadTitleEl && threadTitleEl.textContent.trim()) {
      let subj = threadTitleEl.textContent.split('\n')[0].trim();
      subj = subj.replace(/\s+-\s+.*$/, '').trim();
      if (!/^(re:|fwd:|رد:|متابعة:)/i.test(subj)) {
        subj = 'رد: ' + subj;
      }
      return { subject: subj, isFollowUp: true };
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

      // 1. Thoroughly remove ALL previous tracking pixels (including any in quoted thread history from earlier replies)
      const oldPixels = bodyEl.querySelectorAll(
        'img[data-et-id], img[src*="/track/pixel/"], img[src*="/pixel/"], img[src*="email-tracker-prime"]'
      );
      oldPixels.forEach(p => {
        try { p.remove(); } catch(e) {}
      });

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

  function updateBadgeTooltip(badge, matched) {
    const dateStr = matched.firstReadAt 
      ? formatTimeWithTz(matched.firstReadAt) 
      : (matched.firstReadAtFormatted ? matched.firstReadAtFormatted.formatted : null);

    const sentStr = matched.sentAt 
      ? formatTimeWithTz(matched.sentAt) 
      : (matched.sentAtFormatted ? matched.sentAtFormatted.formatted : '');

    badge.title = matched.isRead 
      ? `EmailTracker Prime: تمت القراءة!\nتاريخ الفتح: ${dateStr}\nمرات الفتح: ${matched.openCount} مرة\n(انقر لعرض التفاصيل)` 
      : `EmailTracker Prime: تم الإرسال (لم يُقرأ بعد)\nوقت الإرسال: ${sentStr}`;
  }

  function createMailtrackBadge(matched) {
    const badge = document.createElement('span');
    badge.className = `et-mailtrack-checks ${matched.isRead ? 'et-is-read' : 'et-is-pending'}`;
    badge.dataset.emailId = matched.id;
    badge.dataset.isRead = String(matched.isRead);
    updateBadgeTooltip(badge, matched);

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

  let isDecorating = false;

  function decorateGmailRows() {
    if (isDecorating || !trackedEmails || trackedEmails.length === 0) return;
    isDecorating = true;

    try {
      const rows = document.querySelectorAll('tr.zA, tr[role="row"]');
      if (!rows || rows.length === 0) return;

      const usedEmailIds = new Set();

      rows.forEach((row) => {
        const subjectSpan = row.querySelector('.y6 span.bog, .bqe, .bog, span[data-thread-id]');
        const recipCell = row.querySelector('.yW, .yX.xY, td.yX');

        const rowSubject = cleanSubject(subjectSpan ? subjectSpan.textContent : '');
        const rowRecipText = (recipCell ? recipCell.textContent : '').toLowerCase().trim();

        const existing = row.querySelector('.et-mailtrack-checks');
        let matchedEmail = null;

        // 1. Sticky matching: If this row already has our badge, stick with that exact email ID if it still matches!
        if (existing && existing.dataset.emailId) {
          const currentId = existing.dataset.emailId;
          const found = trackedEmails.find(e => e.id === currentId);
          if (found && !usedEmailIds.has(currentId)) {
            const itemRecip = (found.recipient || '').toLowerCase().trim();
            const recipUser = itemRecip.split('@')[0];
            const recipMatch = recipUser && rowRecipText && (
              rowRecipText.includes(recipUser) || rowRecipText.includes(itemRecip)
            );
            if (recipMatch) {
              matchedEmail = found;
            }
          }
        }

        // 2. Strict matching (Recipient MUST match! We never match an email sent to a different recipient):
        if (!matchedEmail) {
          for (const item of trackedEmails) {
            if (usedEmailIds.has(item.id)) continue;
            const itemSubject = cleanSubject(item.subject);
            const itemRecip = (item.recipient || '').toLowerCase().trim();
            const recipUser = itemRecip.split('@')[0];

            // STRICT: Must match recipient!
            const recipMatch = recipUser && rowRecipText && (
              rowRecipText.includes(recipUser) || 
              rowRecipText.includes(itemRecip)
            );

            if (!recipMatch) continue;

            const subjMatch = itemSubject && rowSubject && (
              rowSubject === itemSubject || 
              rowSubject.includes(itemSubject) || 
              itemSubject.includes(rowSubject)
            );

            if (subjMatch) {
              matchedEmail = item;
              break;
            }
          }
        }

        // If this row does not match any tracked email, remove badge and exit
        if (!matchedEmail) {
          if (existing) existing.remove();
          return;
        }

        usedEmailIds.add(matchedEmail.id);

        const targetContainer = row.querySelector('.yW') || row.querySelector('.yX.xY') || recipCell;
        if (!targetContainer) return;

        if (existing) {
          // If badge already exists for this exact email, update status in-place without removing DOM node
          if (existing.dataset.emailId === matchedEmail.id) {
            const isReadStr = String(matchedEmail.isRead);
            if (existing.dataset.isRead !== isReadStr) {
              existing.dataset.isRead = isReadStr;
              existing.className = `et-mailtrack-checks ${matchedEmail.isRead ? 'et-is-read' : 'et-is-pending'}`;
              updateBadgeTooltip(existing, matchedEmail);
            }
            return;
          } else {
            existing.remove();
          }
        }

        const badge = createMailtrackBadge(matchedEmail);
        targetContainer.prepend(badge);
      });
    } finally {
      isDecorating = false;
    }
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

      const readDate = email.firstReadAt 
        ? formatTimeWithTz(email.firstReadAt) 
        : (email.firstReadAtFormatted ? email.firstReadAtFormatted.formatted : (email.isRead ? 'تمت القراءة' : 'لم يُقرأ بعد'));
      const sentDate = email.sentAt 
        ? formatTimeWithTz(email.sentAt) 
        : (email.sentAtFormatted ? email.sentAtFormatted.formatted : (email.sentAt ? new Date(email.sentAt).toLocaleString('ar-EG') : ''));

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
                      <div class="et-tl-time">المرة #${i + 1}: ${r.timestamp ? formatTimeWithTz(r.timestamp) : (r.formatted ? r.formatted.formatted : '')}</div>
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
    // ONLY neutralize if the user is in the Sent folder (#sent)
    // If the user is in Inbox (#inbox) reading as recipient, do NOT neutralize!
    const isSentFolder = window.location.hash.includes('#sent');
    if (!isSentFolder) {
      return;
    }

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
  const observer = new MutationObserver((mutations) => {
    // Prevent recursion: Ignore mutations directly originating from our badges, tooltips, or modals
    const isSelfMutation = mutations.every(m => {
      const t = m.target;
      return t && (
        (t.classList && (t.classList.contains('et-mailtrack-checks') || t.classList.contains('et-svg-icon') || t.classList.contains('et-toast') || t.classList.contains('et-modal-overlay'))) ||
        (t.closest && t.closest('.et-mailtrack-checks, .et-modal-overlay, .et-toast'))
      );
    });

    if (isSelfMutation) return;

    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      neutralizeSelfPixels();
      decorateGmailRows();
      decorateThreadMessages();
    }, 300);
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
