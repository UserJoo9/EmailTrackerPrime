const fs = require('fs');
const path = require('path');

// Determine storage mode:
// If Upstash / Vercel KV env vars are set, use Cloud Redis REST API.
// Otherwise, use local file persistence (or /tmp on Vercel serverless).
const UPSTASH_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const IS_CLOUD_KV = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

// Local file paths
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL ? '/tmp' : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'emails.json');

if (!IS_VERCEL && !fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {}
}

// In-memory cache
let emails = {};

// Helper: Upstash REST request
async function upstashRequest(command, ...args) {
  if (!IS_CLOUD_KV) return null;
  try {
    const res = await fetch(`${UPSTASH_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${UPSTASH_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([command, ...args])
    });
    const data = await res.json();
    return data.result;
  } catch (err) {
    console.error('[Upstash Cloud KV Error]', err);
    return null;
  }
}

// Load data from disk on startup
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      emails = JSON.parse(content || '{}');
      console.log(`[Database] Loaded ${Object.keys(emails).length} tracked emails from disk.`);
    } else {
      emails = {};
    }
  } catch (err) {
    console.error('[Database] Error loading database:', err);
    emails = {};
  }
}

// Save data to disk
function saveDatabase() {
  try {
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(emails, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('[Database] Error saving database:', err);
  }
}

// Parse user agent to friendly device/browser name
function parseUserAgent(ua) {
  if (!ua) return 'Unknown Client';
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

// Format friendly local date/time
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

const db = {
  // Create or register a newly tracked email
  async saveEmail({ id, recipient, subject, sentAt }) {
    const now = sentAt || new Date().toISOString();
    const record = {
      id,
      recipient: recipient || 'مستلم غير محدد',
      subject: subject || 'بدون عنوان',
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

    emails[id] = record;

    if (IS_CLOUD_KV) {
      await upstashRequest('HSET', 'emailtracker:emails', id, JSON.stringify(record));
    } else {
      saveDatabase();
    }

    return record;
  },

  // Record an open event when tracking pixel is fetched
  async recordOpen(id, clientInfo = {}) {
    let target = emails[id];

    // If cloud KV enabled, try to fetch from Redis
    if (IS_CLOUD_KV) {
      const remote = await upstashRequest('HGET', 'emailtracker:emails', id);
      if (remote) {
        try {
          target = typeof remote === 'string' ? JSON.parse(remote) : remote;
        } catch (e) {}
      }
    }

    if (!target) {
      target = {
        id,
        recipient: 'غير معروف',
        subject: 'إيميل مسجل تلقائياً',
        sentAt: new Date().toISOString(),
        sentAtFormatted: formatTimestamp(new Date().toISOString()),
        isRead: true,
        openCount: 0,
        firstReadAt: null,
        firstReadAtFormatted: null,
        lastReadAt: null,
        lastReadAtFormatted: null,
        reads: []
      };
    }

    const now = new Date().toISOString();
    const formatted = formatTimestamp(now);
    const clientType = parseUserAgent(clientInfo.userAgent);

    // Filter out rapid duplicate hits within 3 seconds
    const lastOpen = target.reads[target.reads.length - 1];
    const isRapidDuplicate = lastOpen && (new Date(now).getTime() - new Date(lastOpen.timestamp).getTime() < 3000);

    if (!isRapidDuplicate) {
      target.openCount = (target.openCount || 0) + 1;
    }

    target.isRead = true;
    if (!target.firstReadAt) {
      target.firstReadAt = now;
      target.firstReadAtFormatted = formatted;
    }
    target.lastReadAt = now;
    target.lastReadAtFormatted = formatted;

    target.reads.push({
      timestamp: now,
      formatted: formatted,
      ip: clientInfo.ip || 'Unknown IP',
      userAgent: clientInfo.userAgent || 'Unknown',
      clientType: clientType
    });

    emails[id] = target;

    if (IS_CLOUD_KV) {
      await upstashRequest('HSET', 'emailtracker:emails', id, JSON.stringify(target));
    } else {
      saveDatabase();
    }

    return target;
  },

  async getEmail(id) {
    if (IS_CLOUD_KV) {
      const remote = await upstashRequest('HGET', 'emailtracker:emails', id);
      if (remote) {
        try {
          return typeof remote === 'string' ? JSON.parse(remote) : remote;
        } catch (e) {}
      }
    }
    return emails[id] || null;
  },

  async getAllEmails() {
    if (IS_CLOUD_KV) {
      const all = await upstashRequest('HGETALL', 'emailtracker:emails');
      if (all) {
        // Upstash HGETALL returns either an object or key-value array
        const list = [];
        if (Array.isArray(all)) {
          for (let i = 1; i < all.length; i += 2) {
            try { list.push(JSON.parse(all[i])); } catch (e) {}
          }
        } else if (typeof all === 'object') {
          for (const key in all) {
            try {
              const val = typeof all[key] === 'string' ? JSON.parse(all[key]) : all[key];
              list.push(val);
            } catch (e) {}
          }
        }
        return list.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
      }
    }
    return Object.values(emails).sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  },

  async deleteEmail(id) {
    if (IS_CLOUD_KV) {
      await upstashRequest('HDEL', 'emailtracker:emails', id);
    }
    if (emails[id]) {
      delete emails[id];
      if (!IS_CLOUD_KV) saveDatabase();
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

loadDatabase();

module.exports = db;
