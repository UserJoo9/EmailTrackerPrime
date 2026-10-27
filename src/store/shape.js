'use strict';

// الشكل الموحد اللي بيرجع من أي store (بدون أي نصوص منسّقة - التنسيق مسؤولية العميل)
function toView(raw, { reads } = {}) {
  const openCount = Number(raw.openCount) || 0;
  const view = {
    id: raw.id,
    recipient: raw.recipient,
    subject: raw.subject,
    isFollowUp: Boolean(raw.isFollowUp),
    sentAt: raw.sentAt,
    isRead: openCount > 0,
    openCount,
    firstReadAt: raw.firstReadAt || null,
    lastReadAt: raw.lastReadAt || null
  };
  if (reads) view.reads = reads;
  return view;
}

function sortBySentDesc(list) {
  return list.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
}

function normalizeRead(r) {
  const parsed = typeof r === 'string' ? safeParse(r) : r;
  if (!parsed || typeof parsed !== 'object') return null;
  return {
    timestamp: parsed.timestamp,
    clientType: parsed.clientType || 'Email Client'
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = { toView, sortBySentDesc, normalizeRead, safeParse };
