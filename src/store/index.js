'use strict';

const { createMemoryStore } = require('./memoryStore');
const { createRedisStore } = require('./redisStore');

function createStore(config) {
  if (config.redisUrl && config.redisToken) {
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({ url: config.redisUrl, token: config.redisToken });
    return createRedisStore(redis, { maxReads: config.maxReadsPerEmail });
  }
  if (config.isProd) {
    // على Vercel الملفات بتضيع مع كل cold start، فمنقبلش نشتغل بتخزين وهمي.
    throw new Error('Redis (Upstash/Vercel KV) is required in production: set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN');
  }
  console.warn('[store] No Redis configured: using local file storage (dev only).');
  return createMemoryStore({ persistPath: config.dataFile, maxReads: config.maxReadsPerEmail });
}

module.exports = { createStore };
