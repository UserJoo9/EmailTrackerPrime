require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 1x1 Transparent GIF Buffer (43 bytes)
const TRANSPARENT_GIF_BUFFER = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// -------------------------------------------------------------
// TRACKING PIXEL ENDPOINT
// -------------------------------------------------------------
const handlePixel = async (req, res) => {
  const emailId = req.params.id.replace(/\.gif$/i, '');

  const clientIp = req.headers['x-forwarded-for'] 
    ? req.headers['x-forwarded-for'].split(',')[0].trim() 
    : (req.socket ? req.socket.remoteAddress : 'Unknown');

  const userAgent = req.headers['user-agent'] || 'Unknown';

  console.log(`[PIXEL HIT] Email ID: ${emailId} | IP: ${clientIp} | UA: ${userAgent}`);

  // Record open asynchronously
  try {
    await db.recordOpen(emailId, {
      ip: clientIp,
      userAgent: userAgent
    });
  } catch (err) {
    console.error('[Pixel Error]', err);
  }

  // Response with strict no-cache headers to ensure every open is tracked
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': TRANSPARENT_GIF_BUFFER.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, post-check=0, pre-check=0',
    'Pragma': 'no-cache',
    'Expires': 'Thu, 01 Jan 1970 00:00:00 GMT',
    'Access-Control-Allow-Origin': '*'
  });

  res.end(TRANSPARENT_GIF_BUFFER);
};

app.get('/track/pixel/:id', handlePixel);
app.get('/pixel/:id', handlePixel);
app.get('/pixel/:id.gif', handlePixel);

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// Register a newly sent email
app.post('/api/emails', async (req, res) => {
  try {
    const { id, recipient, subject, sentAt } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Tracking ID is required' });
    }

    const email = await db.saveEmail({ id, recipient, subject, sentAt });
    console.log(`[EMAIL REGISTERED] ID: ${id} | To: ${recipient} | Subject: ${subject}`);
    res.status(201).json({ success: true, email });
  } catch (err) {
    console.error('[API Error /api/emails POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// List all tracked emails
app.get('/api/emails', async (req, res) => {
  try {
    const emails = await db.getAllEmails();
    res.json({ success: true, emails });
  } catch (err) {
    console.error('[API Error /api/emails GET]', err);
    res.status(500).json({ error: err.message });
  }
});

// Get details of a single email
app.get('/api/emails/:id', async (req, res) => {
  try {
    const email = await db.getEmail(req.params.id);
    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }
    res.json({ success: true, email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete an email
app.delete('/api/emails/:id', async (req, res) => {
  try {
    const deleted = await db.deleteEmail(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Email not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stats overview
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await db.getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Web Dashboard UI
app.get('/', async (req, res) => {
  try {
    const stats = await db.getStats();
    const emails = await db.getAllEmails();

    res.send(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>EmailTracker Prime - لوحة التحكم</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
        <style>
          :root {
            --primary: #2563eb;
            --success: #16a34a;
            --warning: #f59e0b;
            --bg: #0f172a;
            --card: #1e293b;
            --text: #f8fafc;
            --text-muted: #94a3b8;
            --border: #334155;
          }
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Cairo', sans-serif; }
          body { background: var(--bg); color: var(--text); padding: 30px 20px; }
          .container { max-width: 1000px; margin: 0 auto; }
          header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
          h1 { font-size: 26px; display: flex; align-items: center; gap: 10px; }
          .badge { background: #3b82f620; color: #60a5fa; padding: 4px 12px; border-radius: 20px; font-size: 13px; border: 1px solid #3b82f640; }
          .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
          .stat-card { background: var(--card); border: 1px solid var(--border); padding: 20px; border-radius: 12px; text-align: center; }
          .stat-val { font-size: 32px; font-weight: 800; margin-top: 5px; }
          .stat-label { color: var(--text-muted); font-size: 14px; }
          .val-read { color: var(--success); }
          .val-unread { color: var(--warning); }
          .val-total { color: #38bdf8; }
          .val-rate { color: #c084fc; }
          table { width: 100%; border-collapse: collapse; background: var(--card); border-radius: 12px; overflow: hidden; border: 1px solid var(--border); }
          th, td { padding: 14px 18px; text-align: right; border-bottom: 1px solid var(--border); font-size: 14px; }
          th { background: #162032; color: var(--text-muted); font-weight: 600; }
          tr:last-child td { border-bottom: none; }
          .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
          .status-read { background: #16a34a22; color: #4ade80; border: 1px solid #16a34a44; }
          .status-unread { background: #f59e0b22; color: #fcd34d; border: 1px solid #f59e0b44; }
          .time-text { font-size: 12px; color: var(--text-muted); }
        </style>
      </head>
      <body>
        <div class="container">
          <header>
            <h1>✉️ EmailTracker Prime <span class="badge">خادم التتبع نشط (Vercel Ready)</span></h1>
            <div><a href="javascript:location.reload()" style="color: #60a5fa; text-decoration: none; font-size: 14px;">🔄 تحديث البيانات</a></div>
          </header>

          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">إجمالي الإيميلات المرسلة</div>
              <div class="stat-val val-total">${stats.totalSent}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">تمت قراءتها (مقروءة)</div>
              <div class="stat-val val-read">${stats.totalRead}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">لم تُقرأ بعد</div>
              <div class="stat-val val-unread">${stats.totalUnread}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">نسبة القراءة</div>
              <div class="stat-val val-rate">${stats.openRate}%</div>
            </div>
          </div>

          <h2 style="margin-bottom: 15px; font-size: 18px;">سجل الإيميلات المتتبعة</h2>
          <table>
            <thead>
              <tr>
                <th>الحالة</th>
                <th>المستلم</th>
                <th>عنوان الإيميل</th>
                <th>وقت الإرسال</th>
                <th>تاريخ ووقت أول فتح</th>
                <th>مرات الفتح</th>
              </tr>
            </thead>
            <tbody>
              ${emails.length === 0 ? '<tr><td colspan="6" style="text-align: center; color: #64748b; padding: 40px;">لا توجد إيميلات متتبعة بعد. أرسل إيميلك الأول من Gmail!</td></tr>' : ''}
              ${emails.map(e => `
                <tr>
                  <td>
                    <span class="status-badge ${e.isRead ? 'status-read' : 'status-unread'}">
                      ${e.isRead ? '✓✓ تم الفتح' : '✓ مرسل (لم يفتح)'}
                    </span>
                  </td>
                  <td style="font-weight: 600;">${e.recipient}</td>
                  <td>${e.subject}</td>
                  <td class="time-text">${e.sentAtFormatted ? e.sentAtFormatted.formatted : new Date(e.sentAt).toLocaleString('ar-EG')}</td>
                  <td>
                    ${e.isRead ? `<span style="color: #4ade80; font-weight: 600;">${e.firstReadAtFormatted ? e.firstReadAtFormatted.formatted : new Date(e.firstReadAt).toLocaleString('ar-EG')}</span>` : '<span style="color: #64748b;">-</span>'}
                  </td>
                  <td>
                    ${e.openCount > 0 ? `<span style="background: #334155; padding: 2px 8px; border-radius: 10px; font-size: 12px;">${e.openCount} مرة</span>` : '-'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error rendering dashboard: ' + err.message);
  }
});

// Start listening if running directly
if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 EmailTracker Prime Server is running!`);
    console.log(`📡 Local URL: http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/`);
    console.log(`=======================================================`);
  });
}

// Export for Vercel Serverless Function
module.exports = app;
