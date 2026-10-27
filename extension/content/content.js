// EmailTracker Prime - Content Script for Gmail
// بيعتمد على shared/util.js (ETP). مبيكتبش في الكاش ولا بيكلم السيرفر مباشرة: كل ده عن طريق الـ background.

(function () {
  'use strict';

  console.log('%c[EmailTracker Prime]%c Loaded & Active on Gmail.', 'color: #10b981; font-weight: bold;', 'color: auto;');

  const { DEFAULT_SERVER_URL, el, cleanSubject, normalizeUrl } = ETP;

  let currentServerUrl = DEFAULT_SERVER_URL;
  let trackedEmails = [];
  let selectedTimezone = 'auto';
  let isDecorating = false; // حالة الـ decorate (لازم تتعرّف قبل أي استدعاء)
  let cachedMe = '';

  chrome.storage.local.get(['serverUrl', 'cachedEmails', 'timezone'], (data) => {
    if (data && data.serverUrl && data.serverUrl.trim()) currentServerUrl = normalizeUrl(data.serverUrl);
    if (data && data.timezone) selectedTimezone = data.timezone;
    if (data && Array.isArray(data.cachedEmails)) {
      trackedEmails = data.cachedEmails;
      decorateAll();
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.serverUrl && changes.serverUrl.newValue) {
      currentServerUrl = normalizeUrl(changes.serverUrl.newValue);
    }
    if (changes.timezone) {
      selectedTimezone = changes.timezone.newValue || 'auto';
      decorateAll();
    }
    if (changes.cachedEmails) {
      trackedEmails = Array.isArray(changes.cachedEmails.newValue) ? changes.cachedEmails.newValue : [];
      decorateAll();
    }
  });

  function decorateAll() {
    decorateGmailRows();
    decorateThreadMessages();
  }

  function formatTimeWithTz(isoString) {
    return ETP.formatTime(isoString, selectedTimezone);
  }

  // الكاش بيتحدّث من الـ background (alarm كل دقيقة)؛ هنا بنطلب تحديث بس عند فتح/رجوع التبويب.
  let lastRefreshRequest = 0;
  function requestRefresh() {
    if (Date.now() - lastRefreshRequest < 15000) return;
    lastRefreshRequest = Date.now();
    try { chrome.runtime.sendMessage({ type: 'REFRESH' }, () => void chrome.runtime.lastError); } catch (e) { /* extension reloaded */ }
  }

  function showToast(message, duration = 3500) {
    const existing = document.querySelector('.et-toast');
    if (existing) existing.remove();

    const toast = el('div', { class: 'et-toast' },
      el('span', { class: 'et-toast-check', text: '✓✓' }),
      document.createTextNode(' '),
      el('span', { text: message })
    );
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

  function getMyEmail() {
    if (cachedMe) return cachedMe;
    let found = '';
    try {
      const userEl = document.querySelector(
        'header [aria-label*="@"], a[href*="SignOutOptions"], .gb_d[aria-label*="@"], [data-email]'
      );
      if (userEl) {
        const text = (userEl.getAttribute('aria-label') || userEl.getAttribute('data-email') || userEl.getAttribute('href') || '');
        const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (match) found = match[0].toLowerCase().trim();
      }
      if (!found) {
        // عنوان تبويب Gmail بيحتوي إيميل الحساب: "Inbox (3) - you@gmail.com - Gmail"
        const m = (document.title || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (m) found = m[0].toLowerCase().trim();
      }
    } catch (e) { /* ignore */ }
    cachedMe = found;
    return found;
  }

  // لو مش عارفين إيميل المستخدم مبنفلترش أي حاجة (قبل كده كان فيه اسم ثابت بيبوّظ الفلترة)
  function isMe(addr) {
    const me = getMyEmail();
    if (!me || !addr) return false;
    const a = String(addr).toLowerCase().trim();
    return a === me || a.includes(me);
  }

  function findSendButton(target) {
    if (!target || !target.closest) return null;
    return target.closest(
      '.aoO, ' +
      '[role="button"][data-tooltip^="Send" i], ' +
      '[role="button"][data-tooltip^="إرسال"], ' +
      '[role="button"][data-tooltip^="ارسال"], ' +
      '[role="button"][aria-label^="Send" i], ' +
      '[role="button"][aria-label^="إرسال"], ' +
      '[role="button"][aria-label^="ارسال"], ' +
      'div[data-tooltip*="(Ctrl-Enter)"]'
    );
  }

  function getActiveComposeContext(triggerEl) {
    let container = null;
    let bodyEl = null;

    // 1. Walk up from triggerEl to find a container with an editable message body
    if (triggerEl) {
      let curr = triggerEl;
      while (curr && curr !== document.body) {
        const ed = curr.querySelector('div[contenteditable="true"][role="textbox"], div[contenteditable="true"], .Am.Al.editable');
        if (ed) {
          bodyEl = ed;
          container = curr;
          break;
        }
        curr = curr.parentElement;
      }
    }

    // 2. Focused element in compose box
    if (!bodyEl) {
      const active = document.activeElement;
      if (active) {
        if (active.isContentEditable || active.getAttribute('role') === 'textbox') {
          bodyEl = active;
          container = active.closest('div[role="dialog"], .AD, .M9, .inboxsdk__compose, .adn.ads, [role="listitem"], .ip, .aoI, form') || document.body;
        } else {
          const parentBox = active.closest('div[role="dialog"], .AD, .M9, .adn.ads, .ip, .aoI, form');
          if (parentBox) {
            bodyEl = parentBox.querySelector('div[contenteditable="true"], div[role="textbox"], .Am.Al.editable');
            container = parentBox;
          }
        }
      }
    }

    // 3. Fallback: Any visible editable on the page
    if (!bodyEl) {
      const editables = document.querySelectorAll('div[contenteditable="true"], div[role="textbox"], .Am.Al.editable');
      for (const el of editables) {
        if (el.offsetParent !== null) {
          bodyEl = el;
          container = el.closest('div[role="dialog"], .AD, .M9, .adn.ads, .ip, .aoI, form') || document.body;
          break;
        }
      }
    }

    return { bodyEl, container: container || document.body };
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
          if (!isMe(em)) {
            recipients.add(em);
          }
        });
      }
    }

    // 1. Direct inputs in the compose box (modern Gmail combobox, PeopleKit, standard inputs)
    searchScope.querySelectorAll(
      'input.agP, input[role="combobox"], input[name="to"], input[name="toReal"], input.vO, textarea[name="to"], input[aria-label*="To" i], input[aria-label*="إلى"], input[aria-label*="المستلم"]'
    ).forEach(inp => {
      addEmail(inp.value);
    });

    // 2. Chips and elements with email attributes inside the compose box
    searchScope.querySelectorAll(
      '[email], [data-hovercard-id], [peoplekit-id], .vR, .vN, .afV, .aoT, .amq, .amr, [role="gridcell"]'
    ).forEach(el => {
      addEmail(el.getAttribute('email'));
      addEmail(el.getAttribute('data-hovercard-id'));
      addEmail(el.getAttribute('data-recipient'));
      addEmail(el.getAttribute('title'));
      addEmail(el.innerText || el.textContent);
    });

    // 3. Header areas inside the compose container
    searchScope.querySelectorAll('.aoD, .hl, .aH9, .a5X, .aDj, .a6C').forEach(el => {
      addEmail(el.innerText || el.textContent);
    });

    // 4. In inline reply: look at the thread, specifically the LAST message before the reply!
    if (recipients.size === 0) {
      const messageCards = document.querySelectorAll('.adn.ads, [role="listitem"]');
      if (messageCards.length > 0) {
        // Find the sender of the latest message in this thread
        for (let i = messageCards.length - 1; i >= 0; i--) {
          const card = messageCards[i];
          const senderEl = card.querySelector('.gD[email], span[email]');
          if (senderEl) {
            const senderEmail = (senderEl.getAttribute('email') || '').trim().toLowerCase();
            if (senderEmail && !isMe(senderEmail)) {
              recipients.add(senderEmail);
              break;
            }
          }
        }
      }
    }

    // 5. Fallback: contact display name in reply header (e.g. "To: Whacka")
    if (recipients.size === 0) {
      const headerChips = searchScope.querySelectorAll('.aoT, .vN, .vR');
      headerChips.forEach(chip => {
        const text = (chip.innerText || chip.textContent || '')
          .replace(/^(to|إلى):?\s*/i, '')
          .trim();
        if (text && text.length > 1 && !isMe(text)) {
          recipients.add(text);
        }
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
      const { bodyEl, container } = getActiveComposeContext(triggerBtn);
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

      // 1. شيل أي pixel قديم (بما فيها اللي في نص الرد المقتبس) عشان الرد يتتبع بـ ID جديد
      bodyEl.querySelectorAll('img').forEach((img) => {
        if (img.hasAttribute('data-et-id') || ETP.PIXEL_SRC_RE.test(img.getAttribute('src') || '')) {
          try { img.remove(); } catch (e) { /* ignore */ }
        }
      });

      // 2. ولّد ID وحط الـ pixel بشكل متزامن قبل ما Gmail يبعت
      const trackingId = ETP.newTrackingId();
      const pixelImg = el('img', {
        src: `${currentServerUrl}/track/pixel/${trackingId}`,
        alt: '',
        width: '1',
        height: '1',
        'data-et-id': trackingId
      });
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

      // 4. الـ background بيحفظ في الكاش ويسجل على السيرفر (ولو أوفلاين بيتبعت لاحقاً)
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

  // mousedown في مرحلة الـ capture: بيشتغل قبل ما Gmail يبعت ويقفل نافذة الكتابة.
  // click احتياطي للإرسال بالكيبورد على الزر (processTracking عنده debounce فمفيش تكرار).
  document.addEventListener('mousedown', (e) => {
    const sendBtn = findSendButton(e.target);
    if (sendBtn) processTracking(sendBtn);
  }, true);

  document.addEventListener('click', (e) => {
    const sendBtn = findSendButton(e.target);
    if (sendBtn) processTracking(sendBtn);
  }, true);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const active = document.activeElement;
      const isInCompose = active && (
        active.isContentEditable ||
        active.getAttribute('role') === 'textbox' ||
        active.closest('div[role="dialog"], .AD, .M9, .adn.ads, .ip, .aoI, form')
      );
      if (isInCompose) processTracking(null);
    }
  }, true);

  // --------------------------------------------------------------------------
  // 1.5 LIVE COMPOSE WINDOW BADGE
  // --------------------------------------------------------------------------

  function decorateComposeWindows() {
    const composeBoxes = document.querySelectorAll('div[role="dialog"], .AD, .M9, .inboxsdk__compose, .aoI, form');
    composeBoxes.forEach(box => {
      const sendBtn = findSendButton(box.querySelector('.aoO, [role="button"][data-tooltip^="Send" i], [role="button"][data-tooltip^="إرسال"], [role="button"][data-tooltip^="ارسال"]'));
      if (!sendBtn) return;

      const toolbar = box.querySelector('.btC, .gU.Up, .gU') || sendBtn.parentElement;
      if (!toolbar) return;

      let badge = box.querySelector('.et-compose-badge');
      const detectedRecip = extractRecipientFromPage(box);
      const hasRecip = detectedRecip && detectedRecip !== 'مستلم عبر Gmail';
      const labelText = hasRecip ? `تتبع نشط (${detectedRecip})` : 'EmailTracker نشط ✓✓';

      if (badge) {
        if (badge.dataset.recip !== detectedRecip) {
          badge.dataset.recip = detectedRecip;
          badge.replaceChildren(el('span', { class: 'et-dot' }), el('span', { text: labelText }));
          badge.title = `EmailTracker Prime نشط!\nالمستلم: ${detectedRecip}\nسيتم تتبع فتح هذا الإيميل تلقائياً.`;
        }
      } else {
        badge = document.createElement('div');
        badge.className = 'et-compose-badge';
        badge.dataset.recip = detectedRecip;
        badge.replaceChildren(el('span', { class: 'et-dot' }), el('span', { text: labelText }));
        badge.title = `EmailTracker Prime نشط!\nالمستلم: ${detectedRecip}\nسيتم تتبع فتح هذا الإيميل تلقائياً.`;
        if (sendBtn.nextSibling) {
          toolbar.insertBefore(badge, sendBtn.nextSibling);
        } else {
          toolbar.appendChild(badge);
        }
      }
    });
  }

  // --------------------------------------------------------------------------
  // 2. GMAIL ROWS: MAILTRACK-STYLE DOUBLE CHECKMARKS
  // --------------------------------------------------------------------------

  function updateBadgeTooltip(badge, matched) {
    const dateStr = formatTimeWithTz(matched.firstReadAt);
    const sentStr = formatTimeWithTz(matched.sentAt);

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

  function matchRecipient(recipCell, itemRecipient) {
    if (!recipCell || !itemRecipient) return false;

    const item = itemRecipient.toLowerCase().trim();
    const cellText = (recipCell.textContent || '').toLowerCase().trim();

    // 1. Direct match on row element attributes
    const cellEmails = [];
    recipCell.querySelectorAll('[email], [data-hovercard-id], span[title]').forEach(el => {
      const em = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || el.getAttribute('title');
      if (em) cellEmails.push(em.toLowerCase().trim());
    });

    for (const em of cellEmails) {
      if (em === item || item.includes(em) || em.includes(item)) return true;
      const u1 = em.split('@')[0];
      const u2 = item.split('@')[0];
      if (u1 && u2 && u1 === u2) return true;
    }

    // 2. Direct match with full email
    if (cellText.includes(item)) return true;

    // 3. Username match (e.g. "joodevo891" or "joodevo890")
    const recipUser = item.split('@')[0].trim();
    if (recipUser && recipUser.length >= 3 && cellText.includes(recipUser)) return true;

    // 4. Domain match (e.g. "whacka" for whacka.app)
    if (item.includes('@')) {
      const domain = item.split('@')[1].split('.')[0].toLowerCase();
      if (domain && domain.length >= 4 && !['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud'].includes(domain)) {
        if (cellText.includes(domain)) return true;
      }
    }

    // 5. Contact display name match (e.g. "Whacka")
    const displayName = item.split('<')[0].replace(/[^a-z0-9]/gi, ' ').trim();
    if (displayName && displayName.length >= 3 && cellText.includes(displayName)) return true;

    return false;
  }

  function decorateGmailRows() {
    if (isDecorating || !trackedEmails || trackedEmails.length === 0) return;
    isDecorating = true;

    try {
      const rows = document.querySelectorAll('tr.zA, tr[role="row"]');
      if (!rows || rows.length === 0) return;

      const usedEmailIds = new Set();

      rows.forEach((row) => {
        // Deduplicate: ensure at most ONE badge ever exists in this row
        const existingBadges = row.querySelectorAll('.et-mailtrack-checks');
        if (existingBadges.length > 1) {
          for (let i = 1; i < existingBadges.length; i++) {
            existingBadges[i].remove();
          }
        }

        const subjectSpan = row.querySelector('.y6 span.bog, .bqe, .bog, span[data-thread-id]');
        const recipCell = row.querySelector('.yW, .yX.xY, td.yX');

        const rowSubject = cleanSubject(subjectSpan ? subjectSpan.textContent : '');

        const existing = existingBadges[0] || null;
        let matchedEmail = null;

        // 1. Sticky matching: If this row already has our badge, stick with that exact email ID if it still matches!
        if (existing && existing.dataset.emailId) {
          const currentId = existing.dataset.emailId;
          const found = trackedEmails.find(e => e.id === currentId);
          if (found && !usedEmailIds.has(currentId)) {
            if (matchRecipient(recipCell, found.recipient)) {
              matchedEmail = found;
            }
          }
        }

        // 2. Strict matching (Recipient MUST match! We never match an email sent to a different recipient):
        if (!matchedEmail) {
          const candidates = trackedEmails.filter(item => {
            if (usedEmailIds.has(item.id)) return false;
            if (!matchRecipient(recipCell, item.recipient)) return false;
            const itemSubject = cleanSubject(item.subject);
            return itemSubject && rowSubject && (
              rowSubject === itemSubject || 
              rowSubject.includes(itemSubject) || 
              itemSubject.includes(rowSubject)
            );
          });

          if (candidates.length > 0) {
            // Prioritize exact subject match, otherwise newest
            const exact = candidates.find(item => cleanSubject(item.subject) === rowSubject);
            matchedEmail = exact || candidates[0];
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
  // 3. IN-THREAD MESSAGE HEADERS (STRICT SINGLE BADGE ON SENT MESSAGES ONLY)
  // --------------------------------------------------------------------------

  function decorateThreadMessages() {
    if (!trackedEmails || trackedEmails.length === 0) return;

    const threadTitleEl = document.querySelector('h2.hP, h2[data-thread-perm-id], .ha h2');
    if (!threadTitleEl) return;
    const threadSubject = cleanSubject(threadTitleEl.textContent);

    // Query each individual message card in the thread
    const messageCards = document.querySelectorAll('.adn.ads');
    if (!messageCards || messageCards.length === 0) return;

    messageCards.forEach((card) => {
      // 1. Remove duplicate badges inside this message card if any exist
      const existingBadges = card.querySelectorAll('.et-thread-checks');
      if (existingBadges.length > 1) {
        for (let i = 1; i < existingBadges.length; i++) {
          existingBadges[i].remove();
        }
      }

      // 2. Only show read receipts on messages SENT BY ME (the sender), never on incoming/received messages!
      const senderEl = card.querySelector('.gD[email], span[email]');
      if (senderEl) {
        const senderEmail = (senderEl.getAttribute('email') || '').trim().toLowerCase();
        if (senderEmail && !isMe(senderEmail)) {
          if (existingBadges[0]) existingBadges[0].remove();
          return;
        }
      }

      // 3. Match against tracked emails
      const cardRecipEl = card.querySelector('.hb [email], .hb [data-hovercard-id], span.g2');
      const matchedEmail = trackedEmails.find((item) => {
        const itemSubject = cleanSubject(item.subject);
        const subjMatch = itemSubject && (itemSubject === threadSubject || threadSubject.includes(itemSubject) || itemSubject.includes(threadSubject));
        if (!subjMatch) return false;
        if (cardRecipEl && item.recipient) {
          return matchRecipient(cardRecipEl, item.recipient);
        }
        return true;
      });

      if (!matchedEmail) {
        if (existingBadges[0]) existingBadges[0].remove();
        return;
      }

      // 4. In-place update if badge already exists
      if (existingBadges.length > 0) {
        const existing = existingBadges[0];
        if (existing.dataset.emailId === matchedEmail.id) {
          const isReadStr = String(matchedEmail.isRead);
          if (existing.dataset.isRead !== isReadStr) {
            existing.dataset.isRead = isReadStr;
            existing.className = `et-mailtrack-checks et-thread-checks ${matchedEmail.isRead ? 'et-is-read' : 'et-is-pending'}`;
            updateBadgeTooltip(existing, matchedEmail);
          }
          return;
        } else {
          existing.remove();
        }
      }

      // 5. Insert exactly ONE badge into the date container in the message header
      const header = card.querySelector('.gH');
      if (!header) return;

      const dateContainer = header.querySelector('.gK') || header.querySelector('.xW') || header.querySelector('.g3');
      if (!dateContainer) return;

      // Safety check: ensure dateContainer does not already contain a badge
      if (dateContainer.querySelector('.et-thread-checks')) return;

      const badge = createMailtrackBadge(matchedEmail);
      badge.classList.add('et-thread-checks');

      dateContainer.prepend(badge);
    });
  }

  // --------------------------------------------------------------------------
  // 4. DETAILED MODAL CARD
  // --------------------------------------------------------------------------

  function field(label, valueNode) {
    return el('div', { class: 'et-field' }, el('span', { class: 'et-label', text: label }), valueNode);
  }

  function openEmailDetailsModal(emailId) {
    chrome.runtime.sendMessage({ type: 'GET_EMAIL_STATUS', emailId }, (response) => {
      void chrome.runtime.lastError;
      const email = response && response.email ? response.email : trackedEmails.find((e) => e.id === emailId);
      if (!email) return;

      const existingModal = document.querySelector('.et-modal-overlay');
      if (existingModal) existingModal.remove();

      const readDate = email.firstReadAt ? formatTimeWithTz(email.firstReadAt) : (email.isRead ? 'تمت القراءة' : 'لم يُقرأ بعد');
      const kind = email.isFollowUp ? 'المتابعة' : 'الإيميل';

      const closeBtn = el('button', { class: 'et-modal-close', text: '×' });
      const body = el('div', { class: 'et-modal-body' },
        field('المستلم:', el('span', { class: 'et-value', text: email.recipient })),
        field('الموضوع:', el('span', { class: 'et-value', text: email.subject || '(بدون عنوان)' })),
        email.isFollowUp ? field('النوع:', el('span', { class: 'et-value', text: 'متابعة / رد (Follow-up)' })) : null,
        field('توقيت الإرسال:', el('span', { class: 'et-value', text: formatTimeWithTz(email.sentAt) })),
        field('حالة القراءة:', el('span', {
          class: `et-value ${email.isRead ? 'et-green' : 'et-orange'}`,
          text: email.isRead ? `✓✓ تم فتح الإيميل (${email.openCount} مرة)` : '⏳ لم يتم الفتح حتى الآن'
        }))
      );

      if (email.isRead) {
        body.appendChild(field('تاريخ ووقت الفتح:', el('span', { class: 'et-value et-green', text: readDate })));
        if (Array.isArray(email.reads) && email.reads.length > 0) {
          const section = el('div', { class: 'et-timeline-section' },
            el('div', { class: 'et-timeline-title', text: `سجل مرات الفتح بالتفصيل (${email.reads.length}):` })
          );
          email.reads.forEach((r, i) => {
            section.appendChild(el('div', { class: 'et-timeline-item' },
              el('div', { class: 'et-tl-time', text: `المرة #${i + 1}: ${formatTimeWithTz(r.timestamp)}` }),
              el('div', { class: 'et-tl-client', text: r.clientType || 'Email Client' })
            ));
          });
          body.appendChild(section);
        }
      }

      const modal = el('div', { class: 'et-modal-overlay' },
        el('div', { class: 'et-modal-card' },
          el('div', { class: 'et-modal-header' },
            el('div', { class: 'et-modal-title' },
              el('span', { class: 'et-modal-icon', text: email.isRead ? '🟢' : '⚪' }),
              el('span', { text: `تفاصيل قراءة ${kind}` })
            ),
            closeBtn
          ),
          body
        )
      );

      document.body.appendChild(modal);
      closeBtn.addEventListener('click', () => modal.remove());
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    });
  }

  // عطّل الـ pixels في عرض الراسل لرسائله (Sent فقط). في Inbox مبنلمسش حاجة.
  const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  function neutralizeSelfPixels() {
    if (!window.location.hash.includes('#sent')) return;
    document.querySelectorAll('img').forEach((p) => {
      if (p.src !== BLANK_GIF && ETP.PIXEL_SRC_RE.test(p.getAttribute('src') || '') && !p.closest('[contenteditable="true"]')) {
        p.src = BLANK_GIF;
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
        (t.classList && (t.classList.contains('et-mailtrack-checks') || t.classList.contains('et-compose-badge') || t.classList.contains('et-svg-icon') || t.classList.contains('et-toast') || t.classList.contains('et-modal-overlay'))) ||
        (t.closest && t.closest('.et-mailtrack-checks, .et-compose-badge, .et-modal-overlay, .et-toast'))
      );
    });

    if (isSelfMutation) return;

    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      decorateComposeWindows();
      neutralizeSelfPixels();
      decorateGmailRows();
      decorateThreadMessages();
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestRefresh();
  });

  requestRefresh();
  setTimeout(() => {
    decorateComposeWindows();
    decorateAll();
  }, 1000);

})();
