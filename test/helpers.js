'use strict';

// Redis وهمي يحاكي سلوك Upstash (بما فيه الـ auto-deserialization للـ JSON والأرقام)
function createFakeRedis() {
  const hashes = new Map();
  const lists = new Map();
  const strings = new Map(); // k -> { v, exp }

  const ser = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
  const de = (v) => {
    if (v === undefined || v === null) return null;
    try { return JSON.parse(v); } catch { return v; }
  };
  const hash = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };

  const api = {
    async hsetnx(k, f, v) { const h = hash(k); if (h.has(f)) return 0; h.set(f, ser(v)); return 1; },
    async hset(k, obj) { const h = hash(k); for (const [f, v] of Object.entries(obj)) h.set(f, ser(v)); return Object.keys(obj).length; },
    async hget(k, f) { return de(hash(k).get(f)); },
    async hgetall(k) {
      const h = hash(k);
      if (!h.size) return null;
      return Object.fromEntries([...h].map(([f, v]) => [f, de(v)]));
    },
    async hincrby(k, f, n) { const h = hash(k); const nv = (Number(h.get(f)) || 0) + n; h.set(f, String(nv)); return nv; },
    async hlen(k) { return hash(k).size; },
    async hkeys(k) { return [...hash(k).keys()]; },
    async hdel(k, ...fs) { const h = hash(k); let n = 0; fs.forEach((f) => { if (h.delete(f)) n += 1; }); return n; },
    async del(...ks) { let n = 0; ks.forEach((k) => { if (hashes.delete(k)) n += 1; if (lists.delete(k)) n += 1; if (strings.delete(k)) n += 1; }); return n; },
    async lpush(k, ...vs) { const l = lists.get(k) || []; vs.forEach((v) => l.unshift(ser(v))); lists.set(k, l); return l.length; },
    async ltrim(k, a, b) { const l = lists.get(k) || []; lists.set(k, l.slice(a, b + 1)); return 'OK'; },
    async set(k, v, opts = {}) { strings.set(k, { v: ser(v), exp: opts.px ? Date.now() + opts.px : Infinity }); return 'OK'; },
    async get(k) { const s = strings.get(k); if (!s || s.exp <= Date.now()) return null; return de(s.v); },
    async lrange(k, a, b) { const l = lists.get(k) || []; return l.slice(a, b === -1 ? undefined : b + 1).map(de); }
  };

  api.pipeline = () => {
    const ops = [];
    const p = new Proxy({}, {
      get(_, name) {
        if (name === 'exec') return async () => Promise.all(ops.map((o) => api[o.name](...o.args)));
        return (...args) => { ops.push({ name, args }); return p; };
      }
    });
    return p;
  };
  return api;
}

module.exports = { createFakeRedis };
