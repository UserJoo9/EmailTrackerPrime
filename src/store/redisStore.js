'use strict';

const { toView, sortBySentDesc, normalizeRead, safeParse } = require('./shape');

// نموذج البيانات (كل عملية كتابة ذرّية، مفيش read-modify-write):
//   et:v2:meta   hash  id -> JSON ثابت (المستلم/الموضوع/وقت الإرسال) بيتكتب مرة واحدة
//   et:v2:count  hash  id -> عدد مرات الفتح (HINCRBY)
//   et:v2:first  hash  id -> أول فتح (HSETNX)
//   et:v2:last   hash  id -> آخر فتح
//   et:v2:reads:<id> list آخر N فتحة (LPUSH + LTRIM)
const K = {
  meta: 'et:v2:meta',
  count: 'et:v2:count',
  first: 'et:v2:first',
  last: 'et:v2:last',
  reads: (id) => `et:v2:reads:${id}`
};

const asObject = (v) => (typeof v === 'string' ? safeParse(v) : v) || null;

function createRedisStore(redis, { maxReads = 50 } = {}) {
  function assemble(meta, count, first, last, reads) {
    return toView(
      { ...meta, openCount: Number(count) || 0, firstReadAt: first || null, lastReadAt: last || null },
      reads ? { reads } : undefined
    );
  }

  return {
    kind: 'redis',

    async saveEmail(rec) {
      const meta = { ...rec };
      const created = await redis.hsetnx(K.meta, rec.id, JSON.stringify(meta));
      if (created) return { email: assemble(meta, 0, null, null), created: true };
      const existing = await this.getEmail(rec.id);
      return { email: existing, created: false };
    },

    async importRecord(rec) {
      const p = redis.pipeline();
      const meta = {
        id: rec.id, recipient: rec.recipient, subject: rec.subject,
        isFollowUp: rec.isFollowUp, sentAt: rec.sentAt, registeredAt: rec.registeredAt || rec.sentAt
      };
      p.hset(K.meta, { [rec.id]: JSON.stringify(meta) });
      if (rec.openCount > 0) {
        p.hset(K.count, { [rec.id]: rec.openCount });
        if (rec.firstReadAt) p.hset(K.first, { [rec.id]: rec.firstReadAt });
        if (rec.lastReadAt) p.hset(K.last, { [rec.id]: rec.lastReadAt });
      }
      const reads = (rec.reads || []).slice(0, maxReads);
      p.del(K.reads(rec.id));
      for (const r of reads.slice().reverse()) {
        p.lpush(K.reads(rec.id), JSON.stringify({ timestamp: r.timestamp, clientType: r.clientType }));
      }
      await p.exec();
    },

    async recordOpen(id, hit, { graceMs = 0, now = new Date() } = {}) {
      const meta = asObject(await redis.hget(K.meta, id));
      if (!meta) return { recorded: false, reason: 'unknown' };
      const base = Date.parse(meta.registeredAt || meta.sentAt);
      if (now.getTime() - base < graceMs) return { recorded: false, reason: 'self-open' };

      const ts = now.toISOString();
      const p = redis.pipeline();
      p.hincrby(K.count, id, 1);
      p.hsetnx(K.first, id, ts);
      p.hset(K.last, { [id]: ts });
      p.lpush(K.reads(id), JSON.stringify({ timestamp: ts, clientType: hit.clientType }));
      p.ltrim(K.reads(id), 0, maxReads - 1);
      await p.exec();
      return { recorded: true };
    },

    async getEmail(id) {
      const p = redis.pipeline();
      p.hget(K.meta, id);
      p.hget(K.count, id);
      p.hget(K.first, id);
      p.hget(K.last, id);
      p.lrange(K.reads(id), 0, maxReads - 1);
      const [metaRaw, count, first, last, readsRaw] = await p.exec();
      const meta = asObject(metaRaw);
      if (!meta) return null;
      const reads = (readsRaw || []).map(normalizeRead).filter(Boolean);
      return assemble(meta, count, first, last, reads);
    },

    async listEmails(limit = 500) {
      const p = redis.pipeline();
      p.hgetall(K.meta);
      p.hgetall(K.count);
      p.hgetall(K.first);
      p.hgetall(K.last);
      const [metas, counts, firsts, lasts] = await p.exec();
      const list = [];
      for (const [id, raw] of Object.entries(metas || {})) {
        const meta = asObject(raw);
        if (!meta) continue;
        list.push(assemble(meta, (counts || {})[id], (firsts || {})[id], (lasts || {})[id]));
      }
      return sortBySentDesc(list).slice(0, limit);
    },

    async deleteEmail(id) {
      const p = redis.pipeline();
      p.hdel(K.meta, id);
      p.hdel(K.count, id);
      p.hdel(K.first, id);
      p.hdel(K.last, id);
      p.del(K.reads(id));
      const [removed] = await p.exec();
      return Number(removed) > 0;
    },

    async clearAll() {
      const ids = (await redis.hkeys(K.meta)) || [];
      for (let i = 0; i < ids.length; i += 200) {
        const p = redis.pipeline();
        ids.slice(i, i + 200).forEach((id) => p.del(K.reads(id)));
        await p.exec();
      }
      await redis.del(K.meta, K.count, K.first, K.last);
    },

    async getStats() {
      const p = redis.pipeline();
      p.hlen(K.meta);
      p.hlen(K.first);
      const [totalSent, totalRead] = await p.exec();
      return { totalSent: Number(totalSent) || 0, totalRead: Number(totalRead) || 0 };
    }
  };
}

module.exports = { createRedisStore, KEYS: K };
