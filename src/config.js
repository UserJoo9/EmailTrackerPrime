'use strict';

const path = require('path');

require('dotenv').config();

function loadConfig(env = process.env) {
  const isVercel = Boolean(env.VERCEL);
  return {
    port: Number(env.PORT) || 3000,
    // مفتاح الـ API (سر مشترك بين السيرفر والإضافة والداشبورد)
    apiKey: (env.API_KEY || '').trim(),
    isProd: isVercel || env.NODE_ENV === 'production',
    redisUrl: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '',
    redisToken: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '',
    // التخزين المحلي (للتطوير فقط)
    dataFile: env.DATA_FILE || path.join(__dirname, '..', 'data', 'emails.json'),
    // تجاهل أي فتح خلال X ملي ثانية من التسجيل (الراسل بيفتح رسالته بنفسه)
    selfOpenGraceMs: Number(env.SELF_OPEN_GRACE_MS) || 4000,
    maxReadsPerEmail: 50,
    listLimit: 500,
    syncBatchLimit: 200
  };
}

module.exports = { loadConfig };
