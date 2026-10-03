// EmailTracker Prime - Content Script for Gmail (Mailtrack-Style Checkmarks & Automatic Tracking)

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
        decorateThreadMessages();
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
        decorateThreadMessages();
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
  // 1. AUTOMATIC TRACKING ON SEND (COMPOSE + INLINE REPLY / FOLLOW-UP)
  // --------------------------------------------------------------------------

  function attachAutomaticTracking() {
    const sendButtons = document.querySelectorAll(
      '[role="button"][data-tooltip*="Send"], .T-I.J-J5-Ji.aoO.v7.T-I-atl.L3, [aria-label*="Send"], [aria-label*="إرسال"]'
    );

    sendButtons.forEach((btn) => {
      if (btn.dataset.etHooked === 'true') return;
      btn.dataset.etHooked = 'true';

      const handleSend = () => {
        const container = btn.closest('.M9, [role="dialog"], [role="region"], .AD, .aoP, form, table') || btn.parentElement.parentElement;

        const bodyEl = container?.querySelector('div[aria-label="Message Body"], div[role="textbox"], .Am.Al.editable') ||
                       document.querySelector('div[aria-label="Message Body"], div[role="textbox"], .Am.Al.editable');

        if (!bodyEl) return;

        // 1. Detect Subject
        let subject = '';
        let isFollowUp = false;

        const subjectInput = container?.querySelector('input[name="subjectbox"]') || document.querySelector('input[name="subjectbox"]');
        if (subjectInput && subjectInput.value.trim()) {
          subject = subjectInput.value.trim();
          if (/^(re:|fwd:|رد:|متابعة:)/i.test(subject)) {
            isFollowUp = true;
          }
        } else {
          const threadTitleEl = document.querySelector('h2.hP, h2[data-thread-perm-id], .ha h2');
          if (threadTitleEl && threadTitleEl.textContent.trim()) {
            subject = 'رد: ' + threadTitleEl.textContent.trim();
            isFollowUp = true;
          } else {
            subject = 'متابعة / رد';
            isFollowUp = true;
          }
        }

        // 2. Extract Recipient
        const recipientList = [];
        const chips = (container || document).querySelectorAll('span[email], [peoplekit-id]');
        chips.forEach(chip => {
          const email = chip.getAttribute('email') || chip.innerText.trim();
          if (email && email.includes('@') && !recipientList.includes(email)) {
            recipientList.push(email);
          }
        });

        if (recipientList.length === 0) {
          const toInputs = (container || document).querySelectorAll('input[name="to"], textarea[name="to"], [aria-label*="To"]');
          toInputs.forEach(inp => {
            if (inp.value && inp.value.includes('@')) {
              inp.value.split(',').forEach(part => {
                const clean = part.replace(/[<>]/g, '').trim();
                if (clean.includes('@') && !recipientList.includes(clean)) recipientList.push(clean);
              });
            }
          });
        }

        if (recipientList.length === 0) {
          const threadEmails = document.querySelectorAll('.adn [email], .ads [email], span.gD[email], span.gI[email]');
          threadEmails.forEach(el => {
            const email = el.getAttribute('email') || el.innerText.trim();
            if (email && email.includes('@') && !recipientList.includes(email)) {
              recipientList.push(email);
            }
          });
        }

        const recipient = recipientList.join(', ') || 'مستلم في Gmail';

        // 3. Remove old pixels and append fresh tracking pixel
        const existingPixels = bodyEl.querySelectorAll('img[data-et-id]');
        existingPixels.forEach(p => p.remove());

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

        // 4. Register in backend
        const payload = {
          id: trackingId,
          recipient: recipient,
          subject: subject,
          isFollowUp: isFollowUp,
          sentAt: new Date().toISOString()
        };

        chrome.runtime.sendMessage({
          type: 'REGISTER_EMAIL',
          payload: payload
        }, () => {
          showToast(`تم تتبع ${isFollowUp ? 'المتابعة' : 'الإيميل'} تلقائياً ✓✓ (${recipient})`);
          setTimeout(fetchTrackedEmails, 2000);
        });
      };

      btn.addEventListener('click', handleSend, true);

      const bodyEl = btn.closest('.M9, [role="dialog"], [role="region"], table')?.querySelector('div[role="textbox"]');
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
  // 2. GMAIL ROWS: MAILTRACK-STYLE DOUBLE CHECKMARKS (Between Star and Recipient)
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

    // Clean Mailtrack-style SVG double checkmark icon
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
      // Find subject & recipient
      const subjectSpan = row.querySelector('.y6 span.bog, .bqe, .bog, span[data-thread-id]');
      const recipCell = row.querySelector('.yW, .yX.xY, td.yX');

      const rowSubject = cleanSubject(subjectSpan ? subjectSpan.textContent : '');
      const rowRecipText = (recipCell ? recipCell.textContent : '').toLowerCase().trim();

      // Find matching tracked email
      let matchedEmail = null;

      for (const item of trackedEmails) {
        const itemSubject = cleanSubject(item.subject);
        const itemRecip = (item.recipient || '').toLowerCase().trim();
        const recipUser = itemRecip.split('@')[0];

        // 1. Direct subject match
        if (itemSubject && rowSubject && (rowSubject === itemSubject || rowSubject.includes(itemSubject) || itemSubject.includes(rowSubject))) {
          matchedEmail = item;
          break;
        }

        // 2. Recipient match in Sent folder (e.g. "To: joodevo890")
        if (recipUser && rowRecipText && (rowRecipText.includes(recipUser) || rowRecipText.includes(itemRecip))) {
          matchedEmail = item;
          break;
        }
      }

      if (!matchedEmail) return;

      // Target placement: In Gmail, the recipient column is .yW inside td.yX.xY
      // Prepending here places the checkmark EXACTLY between the Star and "To: ..."!
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
  // 5. OBSERVER & SYNC
  // --------------------------------------------------------------------------

  let debounceTimeout = null;
  const observer = new MutationObserver(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      attachAutomaticTracking();
      decorateGmailRows();
      decorateThreadMessages();
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
    decorateThreadMessages();
  }, 1000);

})();
