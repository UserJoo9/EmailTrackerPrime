'use strict';

const express = require('express');
const { isValidId, parseEmailInput } = require('../lib/validate');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApiRouter({ store, config }) {
  const router = express.Router();

  // تسجيل إيميل جديد (idempotent: لو موجود مش بيتمسح اللي اتسجل عليه)
  router.post('/emails', wrap(async (req, res) => {
    const parsed = parseEmailInput(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });
    const { email, created } = await store.saveEmail(parsed.value);
    res.status(created ? 201 : 200).json({ success: true, email });
  }));

  // مزامنة دفعة إيميلات من كاش الإضافة (بيسجل الناقص فقط)
  router.post('/emails/sync', wrap(async (req, res) => {
    const items = Array.isArray(req.body && req.body.emails) ? req.body.emails : [];
    if (items.length > config.syncBatchLimit) {
      return res.status(413).json({ error: `Max ${config.syncBatchLimit} emails per sync` });
    }
    let registered = 0;
    for (const item of items) {
      const parsed = parseEmailInput(item);
      if (!parsed.ok) continue;
      const { created } = await store.saveEmail(parsed.value);
      if (created) registered += 1;
    }
    res.json({ success: true, registered, emails: await store.listEmails(config.listLimit) });
  }));

  router.get('/emails', wrap(async (req, res) => {
    res.json({ success: true, emails: await store.listEmails(config.listLimit) });
  }));

  router.get('/emails/:id', wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const email = await store.getEmail(req.params.id);
    if (!email) return res.status(404).json({ error: 'Email not found' });
    res.json({ success: true, email });
  }));

  router.delete('/emails/:id', wrap(async (req, res) => {
    if (!isValidId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const deleted = await store.deleteEmail(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Email not found' });
    res.json({ success: true });
  }));

  // مسح الكل: DELETE بدل POST، ومحمي بالمفتاح زي باقي الـ API
  router.delete('/emails', wrap(async (req, res) => {
    await store.clearAll();
    res.json({ success: true });
  }));

  router.get('/stats', wrap(async (req, res) => {
    const { totalSent, totalRead } = await store.getStats();
    res.json({
      success: true,
      stats: {
        totalSent,
        totalRead,
        totalUnread: totalSent - totalRead,
        openRate: totalSent > 0 ? Math.round((totalRead / totalSent) * 100) : 0
      }
    });
  }));

  return router;
}

module.exports = { createApiRouter };
