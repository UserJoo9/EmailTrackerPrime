'use strict';

const fs = require('fs');
const path = require('path');
const { toView, sortBySentDesc, normalizeRead } = require('./shape');

// تخزين في الذاكرة مع حفظ اختياري في ملف JSON (للتطوير المحلي والاختبارات).
// ملاحظة: على Vercel لازم Redis، الملفات هناك مؤقتة.
function createMemoryStore({ persistPath, maxReads = 50 } = {}) {
  let emails = {};
  const mutedUntil = new Map(); // id -> ms
  let writeChain = Promise.resolve();

  if (persistPath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(persistPath, 'utf-8') || '{}');
      for (const [id, rec] of Object.entries(parsed)) {
        if (rec && typeof rec === 'object') {
          emails[id] = {
            id,
            recipient: rec.recipient,
            subject: rec.subject,
            isFollowUp: rec.isFollowUp,
            sentAt: rec.sentAt,
            registeredAt: rec.registeredAt || rec.sentAt,
            openCount: Number(rec.openCount) || 0,
            firstReadAt: rec.firstReadAt || null,
            lastReadAt: rec.lastReadAt || null,
            reads: (rec.reads || []).map(normalizeRead).filter(Boolean).slice(0, maxReads)
          };
        }
      }
    } catch { /* ملف غير موجود أو تالف: نبدأ فاضي */ }
  }

  function persist() {
    if (!persistPath) return Promise.resolve();
    writeChain = writeChain
      .then(async () => {
        await fs.promises.mkdir(path.dirname(persistPath), { recursive: true });
        const tmp = `${persistPath}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(emails, null, 2), 'utf-8');
        await fs.promises.rename(tmp, persistPath);
      })
      .catch((err) => console.error('[store] persist failed:', err.message));
    return writeChain;
  }

  return {
    kind: 'memory',

    async saveEmail(rec) {
      const existing = emails[rec.id];
      if (existing) return { email: toView(existing), created: false };
      emails[rec.id] = { ...rec, openCount: 0, firstReadAt: null, lastReadAt: null, reads: [] };
      await persist();
      return { email: toView(emails[rec.id]), created: true };
    },

    async importRecord(rec) {
      emails[rec.id] = { ...rec, reads: (rec.reads || []).slice(0, maxReads) };
      await persist();
    },

    async recordOpen(id, hit, { graceMs = 0, now = new Date() } = {}) {
      const e = emails[id];
      if (!e) return { recorded: false, reason: 'unknown' };
      const base = Date.parse(e.registeredAt || e.sentAt);
      if (now.getTime() - base < graceMs) return { recorded: false, reason: 'self-open' };
      if ((mutedUntil.get(id) || 0) > now.getTime()) return { recorded: false, reason: 'self-view' };

      const ts = now.toISOString();
      e.openCount += 1;
      e.firstReadAt = e.firstReadAt || ts;
      e.lastReadAt = ts;
      e.reads.unshift({ timestamp: ts, clientType: hit.clientType });
      e.reads.length = Math.min(e.reads.length, maxReads);
      await persist();
      return { recorded: true };
    },

    // الراسل شاف رسالته: الغي الفتحات اللي في آخر windowMs، واتجاهل اللي هييجي في الـ windowMs الجاية
    async markSelfView(id, { windowMs = 30000, now = new Date() } = {}) {
      const e = emails[id];
      if (!e) return { found: false, discarded: 0 };
      mutedUntil.set(id, now.getTime() + windowMs);
      const since = now.getTime() - windowMs;
      const keep = e.reads.filter((r) => Date.parse(r.timestamp) < since);
      const discarded = Math.min(e.openCount, e.reads.length - keep.length);
      if (discarded > 0) {
        e.reads = keep;
        e.openCount -= discarded;
        if (e.openCount <= 0) {
          e.openCount = 0; e.firstReadAt = null; e.lastReadAt = null;
        } else {
          e.lastReadAt = keep.length ? keep[0].timestamp : e.lastReadAt;
          if (e.firstReadAt && Date.parse(e.firstReadAt) >= since) e.firstReadAt = keep.length ? keep[keep.length - 1].timestamp : null;
        }
        await persist();
      }
      return { found: true, discarded };
    },

    async getEmail(id) {
      const e = emails[id];
      return e ? toView(e, { reads: e.reads.slice() }) : null;
    },

    async listEmails(limit = 500) {
      return sortBySentDesc(Object.values(emails).map((e) => toView(e))).slice(0, limit);
    },

    async deleteEmail(id) {
      if (!emails[id]) return false;
      delete emails[id];
      await persist();
      return true;
    },

    async clearAll() {
      emails = {};
      await persist();
    },

    async getStats() {
      const all = Object.values(emails);
      return { totalSent: all.length, totalRead: all.filter((e) => e.openCount > 0).length };
    }
  };
}

module.exports = { createMemoryStore };
