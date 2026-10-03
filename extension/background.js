// EmailTracker Prime - Service Worker (Manifest V3)

const DEFAULT_SERVER_URL = 'http://localhost:3000';

// Initialize default settings on install
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

// Helper to get server URL
async function getServerUrl() {
  const data = await chrome.storage.local.get(['serverUrl']);
  let url = (data.serverUrl || DEFAULT_SERVER_URL).trim();
  // Strip trailing slash
  return url.replace(/\/+$/, '');
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      const serverUrl = await getServerUrl();

      switch (request.type) {
        case 'REGISTER_EMAIL': {
          const res = await fetch(`${serverUrl}/api/emails`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
          });
          const json = await res.json();
          sendResponse({ success: true, data: json });
          break;
        }

        case 'GET_EMAILS': {
          const res = await fetch(`${serverUrl}/api/emails`);
          const json = await res.json();
          sendResponse({ success: true, emails: json.emails || [] });
          break;
        }

        case 'GET_EMAIL_STATUS': {
          const res = await fetch(`${serverUrl}/api/emails/${encodeURIComponent(request.emailId)}`);
          const json = await res.json();
          sendResponse({ success: true, email: json.email });
          break;
        }

        case 'GET_STATS': {
          const res = await fetch(`${serverUrl}/api/stats`);
          const json = await res.json();
          sendResponse({ success: true, stats: json.stats });
          break;
        }

        case 'DELETE_EMAIL': {
          const res = await fetch(`${serverUrl}/api/emails/${encodeURIComponent(request.emailId)}`, {
            method: 'DELETE'
          });
          const json = await res.json();
          sendResponse({ success: true, data: json });
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

  return true; // Keep message channel open for async response
});
