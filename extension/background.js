// EmailTracker Prime - Service Worker (Manifest V3)
// المسؤول الوحيد عن: الاتصال بالسيرفر + كاش الإيميلات (chrome.storage.local.cachedEmails).
// الـ content والـ popup بيبعتوا رسائل بس، ومبيكتبوش في الكاش مباشرة (عشان مفيش race).

importScripts('shared/util.js');

const { DEFAULT_SERVER_URL, MAX_CACHED, normalizeUrl } = ETP;
const REFRESH_ALARM = 'etp-refresh';
const MIN_REFRESH_GAP_MS = 15 * 1000;

// ---------------------------------------------------------------- settings / API

async function getSettings() {
  const d = await chrome.storage.local.get(['serverUrl', 'apiKey']);
  return { serverUrl: normalizeUrl(d.serverUrl || DEFAULT_SERVER_URL), apiKey: (d.apiKey || '').trim() };
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = 'GET', body, settings, timeoutMs = 8000 } = {}) {
  const { serverUrl, apiKey } = settings || (await getSettings());
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(serverUrl + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function setConnection(state) {
  // state: 'ok' | 'unauthorized' | 'offline'
  await chrome.storage.local.set({ connection: { state, at: Date.now() } });
}

const stateFromError = (err) => (err && err.status === 401 ? 'unauthorized' : 'offline');

// ---------------------------------------------------------------- cache (single writer)

let cacheChain = Promise.resolve();

// بيشغّل fn على نسخة الكاش بشكل متسلسل. fn بترجّع { list, value } (list اختياري للكتابة).
function withCache(fn) {
  const run = cacheChain.then(async () => {
    const { cachedEmails } = await chrome.storage.local.get('cachedEmails');
    const current = Array.isArray(cachedEmails) ? cachedEmails : [];
    const out = (await fn(current)) || {};
    if (Array.isArray(out.list)) {
      await chrome.storage.local.set({ cachedEmails: out.list.slice(0, MAX_CACHED) });
    }
    return out.value;
  });
  cacheChain = run.catch(() => {});
  return run;
}

const readCache = () => withCache(async (list) => ({ value: list }));
const bySentDesc = (a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt);
const toSyncPayload = ({ id, recipient, subject, isFollowUp, sentAt }) => ({ id, recipient, subject, isFollowUp, sentAt });

// ---------------------------------------------------------------- refresh / sync

let lastRefresh = 0;
let inflight = null;

// بيزامن الإيميلات اللي لسه ما اتسجلتش على السيرفر، وبعدين بيحدّث الكاش من السيرفر (هو المرجع).
function refresh({ force = false } = {}) {
  if (inflight) return inflight;
  if (!force && Date.now() - lastRefresh < MIN_REFRESH_GAP_MS) return readCache();

  inflight = (async () => {
    try {
      const local = await readCache();
      const unsynced = local.filter((e) => e.synced !== true).slice(0, 200);
      const json = unsynced.length
        ? await api('/api/emails/sync', { method: 'POST', body: { emails: unsynced.map(toSyncPayload) } })
        : await api('/api/emails');

      const serverEmails = Array.isArray(json.emails) ? json.emails : [];
      const serverIds = new Set(serverEmails.map((e) => e.id));
      const attempted = new Set(unsynced.map((e) => e.id));

      await withCache(async (current) => {
        // اللي لسه ما اتبعتش (اتسجل أثناء الطلب) بنحتفظ بيه. واللي اتبعت واترفض من السيرفر بنشيله.
        const stillPending = current.filter((e) => !serverIds.has(e.id) && e.synced !== true && !attempted.has(e.id));
        const merged = [...stillPending, ...serverEmails.map((e) => ({ ...e, synced: true }))].sort(bySentDesc);
        return { list: merged };
      });
      await setConnection('ok');
    } catch (err) {
      await setConnection(stateFromError(err));
    } finally {
      lastRefresh = Date.now();
      inflight = null;
    }
    return readCache();
  })();
  return inflight;
}

// ---------------------------------------------------------------- operations

async function registerEmail(payload) {
  await withCache(async (list) => {
    if (list.some((e) => e.id === payload.id)) return {};
    return { list: [{ ...payload, isRead: false, openCount: 0, synced: false }, ...list] };
  });

  try {
    const json = await api('/api/emails', { method: 'POST', body: payload });
    await withCache(async (list) => ({
      list: list.map((e) => (e.id === payload.id ? { ...e, ...json.email, synced: true } : e))
    }));
    await setConnection('ok');
    return { success: true };
  } catch (err) {
    await setConnection(stateFromError(err));
    // محفوظ محلياً، وهيتبعت مع أول مزامنة ناجحة
    return { success: true, localOnly: true, reason: stateFromError(err) };
  }
}

async function getEmailStatus(emailId) {
  try {
    const json = await api(`/api/emails/${encodeURIComponent(emailId)}`);
    return { success: true, email: json.email };
  } catch {
    const list = await readCache();
    return { success: true, email: list.find((e) => e.id === emailId) };
  }
}

async function getStats() {
  try {
    const json = await api('/api/stats');
    return { success: true, stats: json.stats };
  } catch {
    const list = await readCache();
    const totalSent = list.length;
    const totalRead = list.filter((e) => e.isRead).length;
    return {
      success: true,
      stats: { totalSent, totalRead, totalUnread: totalSent - totalRead, openRate: totalSent ? Math.round((totalRead / totalSent) * 100) : 0 }
    };
  }
}

// settings اختياري: بيستخدمه زر "فحص" في الـ popup قبل ما المستخدم يحفظ
async function checkServer(override) {
  const base = await getSettings();
  const settings = {
    serverUrl: override && override.serverUrl ? normalizeUrl(override.serverUrl) : base.serverUrl,
    apiKey: override && typeof override.apiKey === 'string' ? override.apiKey.trim() : base.apiKey
  };
  try {
    await api('/api/stats', { settings, timeoutMs: 4000 });
    return { reachable: true, authorized: true };
  } catch (err) {
    if (err instanceof ApiError) {
      return { reachable: true, authorized: err.status !== 401, status: err.status };
    }
    return { reachable: false, error: err.message };
  }
}

async function clearAll() {
  try {
    await api('/api/emails', { method: 'DELETE' });
  } catch (err) {
    return { success: false, error: stateFromError(err) };
  }
  await withCache(async () => ({ list: [] }));
  return { success: true };
}

// ---------------------------------------------------------------- wiring

const handlers = {
  REGISTER_EMAIL: (req) => registerEmail(req.payload),
  GET_EMAILS: async (req) => ({ success: true, emails: req.cacheOnly ? await readCache() : await refresh({ force: Boolean(req.force) }) }),
  REFRESH: async () => { await refresh(); return { success: true }; },
  GET_EMAIL_STATUS: (req) => getEmailStatus(req.emailId),
  GET_STATS: () => getStats(),
  CHECK_SERVER: (req) => checkServer(req.settings),
  CLEAR_ALL: () => clearAll()
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = handlers[request && request.type];
  if (!handler) {
    sendResponse({ success: false, error: 'Unknown message type' });
    return false;
  }
  handler(request)
    .then(sendResponse)
    .catch((err) => {
      console.error('[EmailTracker SW]', err);
      sendResponse({ success: false, error: err.message });
    });
  return true; // الرد async
});

function ensureAlarm() {
  chrome.alarms.get(REFRESH_ALARM, (alarm) => {
    if (!alarm) chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 1 });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) refresh({ force: true });
});

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['serverUrl']);
  if (!data.serverUrl) await chrome.storage.local.set({ serverUrl: DEFAULT_SERVER_URL });
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();
