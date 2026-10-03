// EmailTracker Prime - Service Worker (Manifest V3)

const DEFAULT_SERVER_URL = 'http://localhost:3000';

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['serverUrl', 'trackByDefault', 'showBadgesInGmail']);
  const updates = {};
  if (!data.serverUrl) updates.serverUrl = DEFAULT_SERVER_URL;
  if (data.trackByDefault === undefined) updates.trackByDefault = true;
  if (data.showBadgesInGmail === undefined) updates.showBadgesInGmail = true;

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
  console.log('[EmailTracker Service Worker] Installed & Initialized.');
});

async function getServerUrl() {
  const data = await chrome.storage.local.get(['serverUrl']);
  let url = (data.serverUrl || DEFAULT_SERVER_URL).trim();
  return url.replace(/\/+$/, '');
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      const serverUrl = await getServerUrl();

      switch (request.type) {
        case 'REGISTER_EMAIL': {
          // Immediately cache locally so no email is ever lost
          const local = await chrome.storage.local.get(['cachedEmails']);
          const list = Array.isArray(local.cachedEmails) ? local.cachedEmails : [];
          // Avoid duplicate ID
          if (!list.some(e => e.id === request.payload.id)) {
            list.unshift({
              ...request.payload,
              isRead: false,
              openCount: 0
            });
            await chrome.storage.local.set({ cachedEmails: list });
          }

          // Then register with server
          try {
            const res = await fetch(`${serverUrl}/api/emails`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(request.payload)
            });
            const json = await res.json();
            sendResponse({ success: true, data: json });
          } catch (netErr) {
            console.error('[EmailTracker Background] Saved locally, server sync failed:', netErr);
            sendResponse({ success: true, localOnly: true });
          }
          break;
        }

        case 'GET_EMAILS': {
          try {
            const res = await fetch(`${serverUrl}/api/emails`);
            const json = await res.json();
            if (json && Array.isArray(json.emails)) {
              await chrome.storage.local.set({ cachedEmails: json.emails });
              sendResponse({ success: true, emails: json.emails });
              return;
            }
          } catch (e) {
            console.warn('[EmailTracker] Server fetch failed, serving local cache:', e);
          }

          // Fallback to local cache
          const local = await chrome.storage.local.get(['cachedEmails']);
          sendResponse({ success: true, emails: local.cachedEmails || [] });
          break;
        }

        case 'GET_EMAIL_STATUS': {
          try {
            const res = await fetch(`${serverUrl}/api/emails/${encodeURIComponent(request.emailId)}`);
            const json = await res.json();
            sendResponse({ success: true, email: json.email });
            return;
          } catch (e) {}

          const local = await chrome.storage.local.get(['cachedEmails']);
          const email = (local.cachedEmails || []).find(e => e.id === request.emailId);
          sendResponse({ success: true, email });
          break;
        }

        case 'GET_STATS': {
          try {
            const res = await fetch(`${serverUrl}/api/stats`);
            const json = await res.json();
            sendResponse({ success: true, stats: json.stats });
            return;
          } catch (e) {}

          const local = await chrome.storage.local.get(['cachedEmails']);
          const list = local.cachedEmails || [];
          const totalSent = list.length;
          const totalRead = list.filter(e => e.isRead).length;
          sendResponse({
            success: true,
            stats: {
              totalSent,
              totalRead,
              totalUnread: totalSent - totalRead,
              openRate: totalSent > 0 ? Math.round((totalRead / totalSent) * 100) : 0
            }
          });
          break;
        }

        case 'CHECK_SERVER': {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`${serverUrl}/api/stats`, { signal: controller.signal });
            clearTimeout(timeoutId);
            sendResponse({ reachable: res.ok, status: res.status });
          } catch (e) {
            sendResponse({ reachable: false, error: e.message });
          }
          break;
        }

        case 'GET_SERVER_URL': {
          sendResponse({ serverUrl });
          break;
        }

        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (err) {
      console.error('[Service Worker Error]', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});
