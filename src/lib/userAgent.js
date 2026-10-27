'use strict';

// أسماء ودّية لعميل البريد. الترتيب مهم: Edge/Outlook لازم قبل Chrome.
function parseUserAgent(ua) {
  if (!ua) return 'Email Client';
  if (ua.includes('GoogleImageProxy')) return 'Gmail (Google Proxy)';
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'Apple iOS Mail';
  if (ua.includes('Android')) return 'Android Mail';
  if (ua.includes('Outlook') || ua.includes('Microsoft')) return 'Microsoft Outlook';
  if (ua.includes('Edg/') || ua.includes('Edge/')) return 'Microsoft Edge';
  if (ua.includes('Firefox')) return 'Mozilla Firefox';
  if (ua.includes('Chrome')) return 'Google Chrome';
  if (ua.includes('Macintosh')) return 'Apple Mac Mail / Browser';
  return 'Web / Email Client';
}

const BOT_SIGNATURES = [
  'bot', 'crawl', 'spider', 'slurp', 'headlesschrome', 'phantomjs',
  'puppeteer', 'selenium', 'barracuda', 'proofpoint', 'mimecast',
  'symantec', 'trendmicro', 'sophos', 'fireeye', 'virustotal',
  'paloalto', 'forcepoint', 'cisco', 'ironport', 'microsoft-office',
  'ms-office', 'bingpreview', 'google-safety', 'google-read-aloud',
  'feedfetcher', 'googleproducer', 'python-requests', 'curl', 'wget',
  'go-http-client', 'node-fetch', 'undici', 'axios', 'httplib'
];

// ماسحات الأمان والـ prefetch (مش فتح حقيقي من إنسان)
function isBotOrPrefetch(userAgent = '', headers = {}) {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();

  // بصمة ماسح Google الأمني القديم
  if (ua.includes('edge/12.246') || ua.includes('chrome/42.0.2311.135')) return true;

  const purpose = String(
    headers['purpose'] || headers['sec-purpose'] || headers['x-purpose'] || headers['x-moz'] || ''
  ).toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview')) return true;

  return BOT_SIGNATURES.some((sig) => ua.includes(sig));
}

module.exports = { parseUserAgent, isBotOrPrefetch };
