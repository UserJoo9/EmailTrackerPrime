'use strict';

const express = require('express');
const { isValidId } = require('../lib/validate');
const { parseUserAgent, isBotOrPrefetch } = require('../lib/userAgent');

// GIF شفاف 1x1
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

const NO_CACHE = {
  'Content-Type': 'image/gif',
  'Content-Length': GIF.length,
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0'
};

function createPixelRouter({ store, config }) {
  const router = express.Router();

  async function handler(req, res) {
    // يدعم الروابط القديمة: /pixel/<id>.gif
    const id = String(req.params.id || '').replace(/\.gif$/i, '');

    if (isValidId(id)) {
      const userAgent = req.get('user-agent') || '';
      try {
        if (!isBotOrPrefetch(userAgent, req.headers)) {
          await store.recordOpen(
            id,
            { clientType: parseUserAgent(userAgent) },
            { graceMs: config.selfOpenGraceMs }
          );
        }
      } catch (err) {
        console.error('[pixel] failed to record open:', err.message);
      }
    }

    // دايماً نرد بالصورة حتى لو حصل خطأ، عشان الإيميل ما يظهرش صورة مكسورة
    res.writeHead(200, NO_CACHE);
    res.end(GIF);
  }

  // المسارين القدام لازم يفضلوا شغالين عشان الإيميلات اللي اتبعتت بالفعل
  router.get('/track/pixel/:id', handler);
  router.get('/pixel/:id', handler);
  return router;
}

module.exports = { createPixelRouter };
