'use strict';

const crypto = require('crypto');

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeEqual(a, b) {
  return crypto.timingSafeEqual(digest(a), digest(b));
}

// حماية الـ API بمفتاح. بدون مفتاح في الإنتاج => السيرفر يرفض (fail closed).
function createAuth(config) {
  return function requireApiKey(req, res, next) {
    if (!config.apiKey) {
      if (config.isProd) {
        return res.status(503).json({ error: 'API_KEY is not configured on the server' });
      }
      return next(); // تطوير محلي فقط
    }
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !safeEqual(token, config.apiKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

module.exports = { createAuth };
