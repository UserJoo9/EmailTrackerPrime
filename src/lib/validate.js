'use strict';

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_CHARS, ' ').trim().slice(0, max);
}

function parseSentAt(value, now) {
  if (typeof value !== 'string') return now.toISOString();
  const t = Date.parse(value);
  if (Number.isNaN(t) || t > now.getTime() + MAX_FUTURE_SKEW_MS) return now.toISOString();
  return new Date(t).toISOString();
}

// يرجّع { ok: true, value } أو { ok: false, error }
function parseEmailInput(body, now = new Date()) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object' };
  if (!isValidId(body.id)) return { ok: false, error: 'Invalid tracking id' };

  const subject = cleanText(body.subject, 500);
  return {
    ok: true,
    value: {
      id: body.id,
      recipient: cleanText(body.recipient, 500) || 'مستلم عبر Gmail',
      subject: subject || 'بدون عنوان',
      isFollowUp: Boolean(body.isFollowUp || /^(re:|fwd:|رد:|متابعة:)/i.test(subject)),
      sentAt: parseSentAt(body.sentAt, now),
      registeredAt: now.toISOString()
    }
  };
}

module.exports = { isValidId, cleanText, parseEmailInput };
