const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');

// Initialize Redis if Upstash or Vercel KV environment variables exist
let redis = null;
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (upstashUrl && upstashToken) {
  try {
    redis = new Redis({
      url: upstashUrl,
      token: upstashToken,
    });
    console.log('[Database] Connected to Cloud Redis (Upstash/Vercel KV).');
  } catch (err) {
    console.error('[Database] Redis connection failed, falling back to local file:', err);
    redis = null;
  }
} else {
  console.log('[Database] No Redis environment variables found. Using local file storage.');
}

// Local file storage fallback
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? '/tmp' : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'emails.json');

let emailsCache = {};

if (!IS_VERCEL && !fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {}
}

function loadLocalDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      emailsCache = JSON.parse(content || '{}');
    }
  } catch (err) {
    emailsCache = {};
  }
}

function saveLocalDatabase() {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(emailsCache, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('[Database] Local save error:', err);
  }
}

loadLocalDatabase();

// Parse user agent to friendly name
function parseUserAgent(ua) {
  if (!ua) return 'Email Client';
  if (ua.includes('GoogleImageProxy')) return 'Gmail (Google Proxy)';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'Apple iOS Mail';
  if (ua.includes('Macintosh')) return 'Apple Mac Mail / Browser';
  if (ua.includes('Android')) return 'Android Mail';
  if (ua.includes('Outlook') || ua.includes('Microsoft')) return 'Microsoft Outlook';
  if (ua.includes('Chrome')) return 'Google Chrome';
  if (ua.includes('Firefox')) return 'Mozilla Firefox';
  if (ua.includes('Edg')) return 'Microsoft Edge';
  return 'Web / Email Client';
}

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return {
    iso: isoString,
    formatted: date.toLocaleString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }),
    formattedEn: date.toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    })
  };
}

const REDIS_KEY = 'emailtracker:emails';

const db = {
  // Save newly registered email
  async saveEmail({ id, recipient, subject, sentAt, isFollowUp }) {
    const now = sentAt || new Date().toISOString();
    const isReplyOrFollowUp = Boolean(isFollowUp || (subject && /^(re:|fwd:|رد:|متابعة:)/i.test(subject)));
    const record = {
      id,
      recipient: recipient || 'مستلم عبر Gmail',
      subject: subject || 'بدون عنوان',
      isFollowUp: isReplyOrFollowUp,
      sentAt: now,
      sentAtFormatted: formatTimestamp(now),
      isRead: false,
      openCount: 0,
      firstReadAt: null,
      firstReadAtFormatted: null,
      lastReadAt: null,
      lastReadAtFormatted: null,
      reads: []
    };

    emailsCache[id] = record;

    if (redis) {
      try {
        await redis.hset(REDIS_KEY, { [id]: JSON.stringify(record) });
      } catch (err) {
        console.error('[Redis Save Error]', err);
      }
    } else {
      saveLocalDatabase();
    }

    return record;
  },

  // Record an open event when tracking pixel is fetched
  async recordOpen(id, clientInfo = {}) {
    let target = null;

    if (redis) {
      try {
        const val = await redis.hget(REDIS_KEY, id);
        if (val) {
          target = typeof val === 'string' ? JSON.parse(val) : val;
        }
      } catch (e) {
        console.error('[Redis Fetch in recordOpen]', e);
      }
    }

    if (!target) {
      target = emailsCache[id];
    }

    const now = new Date().toISOString();
    const formatted = formatTimestamp(now);
    const clientType = parseUserAgent(clientInfo.userAgent);

    if (!target) {
      target = {
        id,
        recipient: 'مستلم غير محدد',
        subject: 'إيميل مسجل تلقائياً',
        sentAt: now,
        sentAtFormatted: formatted,
        isRead: true,
        openCount: 1,
        firstReadAt: now,
        firstReadAtFormatted: formatted,
        lastReadAt: now,
        lastReadAtFormatted: formatted,
        reads: []
      };
    } else {
      // Ignore hits within 15 seconds of creation (Sender compose / send self-render)
      if (target.sentAt) {
        const diffMs = new Date(now).getTime() - new Date(target.sentAt).getTime();
        if (diffMs < 15000) {
          console.log(`[Self-Open Ignored] Hit occurred only ${Math.round(diffMs / 1000)}s after sending (Sender compose/send self-render).`);
          return target;
        }
      }

      target.openCount = (target.openCount || 0) + 1;
      target.isRead = true;
      if (!target.firstReadAt) {
        target.firstReadAt = now;
        target.firstReadAtFormatted = formatted;
      }
      target.lastReadAt = now;
      target.lastReadAtFormatted = formatted;
    }

    if (!Array.isArray(target.reads)) target.reads = [];

    target.reads.push({
      timestamp: now,
      formatted: formatted,
      ip: clientInfo.ip || 'Unknown IP',
      userAgent: clientInfo.userAgent || 'Unknown',
      clientType: clientType
    });

    emailsCache[id] = target;

    if (redis) {
      try {
        await redis.hset(REDIS_KEY, { [id]: JSON.stringify(target) });
      } catch (err) {
        console.error('[Redis RecordOpen Save Error]', err);
      }
    } else {
      saveLocalDatabase();
    }

    return target;
  },

  async getEmail(id) {
    if (redis) {
      try {
        const val = await redis.hget(REDIS_KEY, id);
        if (val) {
          return typeof val === 'string' ? JSON.parse(val) : val;
        }
      } catch (e) {}
    }
    return emailsCache[id] || null;
  },

  async getAllEmails() {
    if (redis) {
      try {
        const all = await redis.hgetall(REDIS_KEY);
        if (all && typeof all === 'object') {
          const list = [];
          for (const key in all) {
            try {
              const val = typeof all[key] === 'string' ? JSON.parse(all[key]) : all[key];
              list.push(val);
            } catch (e) {}
          }
          return list.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
        }
      } catch (err) {
        console.error('[Redis getAllEmails Error]', err);
      }
    }
    return Object.values(emailsCache).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  },

  async deleteEmail(id) {
    if (redis) {
      try {
        await redis.hdel(REDIS_KEY, id);
      } catch (e) {}
    }
    if (emailsCache[id]) {
      delete emailsCache[id];
      if (!redis) saveLocalDatabase();
      return true;
    }
    return false;
  },

  async getStats() {
    const list = await this.getAllEmails();
    const totalSent = list.length;
    const totalRead = list.filter(e => e.isRead).length;
    const totalUnread = totalSent - totalRead;
    const openRate = totalSent > 0 ? Math.round((totalRead / totalSent) * 100) : 0;

    return {
      totalSent,
      totalRead,
      totalUnread,
      openRate
    };
  }
};

module.exports = db;
