'use strict';

const path = require('path');
const express = require('express');
const { createAuth } = require('./middleware/auth');
const { createPixelRouter } = require('./routes/pixel');
const { createApiRouter } = require('./routes/emails');

function createApp({ config, store }) {
  const app = express();
  app.disable('x-powered-by');

  // الـ pixel أول حاجة: عام ومفيهوش auth (الإيميل بيحمّله من أي مكان)
  app.use(createPixelRouter({ store, config }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // كل الـ API محمي بمفتاح. مفيش CORS: الإضافة بتكلم السيرفر من الـ service worker
  // والداشبورد من نفس الأصل.
  app.use('/api', express.json({ limit: '256kb' }), createAuth(config), createApiRouter({ store, config }));

  // الداشبورد: ملفات ثابتة بدون أي بيانات مدمجة في الـ HTML (البيانات بتتجاب بالـ API)
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'"
      );
    }
  }));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' }); // مفيش تسريب لرسالة الخطأ الداخلية
  });

  return app;
}

module.exports = { createApp };
