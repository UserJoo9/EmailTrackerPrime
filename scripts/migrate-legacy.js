'use strict';

// ترحيل بيانات النسخة القديمة (hash واحد فيه JSON لكل إيميل) إلى النموذج الجديد.
// الاستخدام:  node scripts/migrate-legacy.js [--dry-run]
// بيقرأ UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN من البيئة أو من .env
// ومبيمسحش البيانات القديمة (تقدر تمسح المفتاح emailtracker:emails يدوياً بعد ما تتأكد).

const { isBotOrPrefetch } = require('../src/lib/userAgent');
const { safeParse } = require('../src/store/shape');

const LEGACY_KEY = 'emailtracker:emails';
const GHOST = (e) => e.recipient === 'مستلم غير محدد' || e.subject === 'إيميل مسجل تلقائياً';

async function migrate(redis, store, { dryRun = false, log = console.log } = {}) {
  const all = (await redis.hgetall(LEGACY_KEY)) || {};
  const stats = { found: 0, imported: 0, ghosts: 0, invalid: 0, botReadsDropped: 0 };

  for (const [id, raw] of Object.entries(all)) {
    stats.found += 1;
    const e = typeof raw === 'string' ? safeParse(raw) : raw;
    if (!e || typeof e !== 'object' || !e.sentAt) { stats.invalid += 1; continue; }
    if (GHOST(e)) { stats.ghosts += 1; continue; }

    const allReads = Array.isArray(e.reads) ? e.reads : [];
    const humanReads = allReads.filter((r) => !isBotOrPrefetch(r.userAgent || ''));
    stats.botReadsDropped += allReads.length - humanReads.length;

    const record = {
      id,
      recipient: e.recipient,
      subject: e.subject,
      isFollowUp: Boolean(e.isFollowUp),
      sentAt: e.sentAt,
      registeredAt: e.sentAt,
      openCount: humanReads.length,
      firstReadAt: humanReads.length ? humanReads[0].timestamp : null,
      lastReadAt: humanReads.length ? humanReads[humanReads.length - 1].timestamp : null,
      // الأحدث أولاً. الـ IP والـ User-Agent الخام مبيتنقلوش (خصوصية)
      reads: humanReads.slice().reverse().map((r) => ({ timestamp: r.timestamp, clientType: r.clientType }))
    };
    if (!dryRun) await store.importRecord(record);
    stats.imported += 1;
  }

  log(`${dryRun ? '[dry-run] ' : ''}found=${stats.found} imported=${stats.imported} ghosts=${stats.ghosts} invalid=${stats.invalid} botReadsDropped=${stats.botReadsDropped}`);
  return stats;
}

module.exports = { migrate, LEGACY_KEY };

if (require.main === module) {
  const { loadConfig } = require('../src/config');
  const { Redis } = require('@upstash/redis');
  const { createRedisStore } = require('../src/store/redisStore');
  const config = loadConfig();
  if (!config.redisUrl || !config.redisToken) {
    console.error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN first.');
    process.exit(1);
  }
  const redis = new Redis({ url: config.redisUrl, token: config.redisToken });
  migrate(redis, createRedisStore(redis, { maxReads: config.maxReadsPerEmail }), { dryRun: process.argv.includes('--dry-run') })
    .catch((err) => { console.error(err); process.exit(1); });
}
