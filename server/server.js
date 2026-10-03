require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

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

  try {
    await db.recordOpen(emailId, {
      ip: clientIp,
      userAgent: userAgent,
      headers: req.headers
    });
  } catch (err) {
    console.error('[Pixel Error]', err);
  }

  // Response with strict no-cache headers to bypass all caches & proxies
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
    const { id, recipient, subject, sentAt, isFollowUp } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Tracking ID is required' });
    }

    const email = await db.saveEmail({ id, recipient, subject, sentAt, isFollowUp });
    console.log(`[EMAIL REGISTERED] ID: ${id} | To: ${recipient} | Subject: ${subject} | FollowUp: ${email.isFollowUp}`);
    res.status(201).json({ success: true, email });
  } catch (err) {
    console.error('[API Error /api/emails POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// Batch sync (allows extension to sync offline cached emails if missing on server)
app.post('/api/emails/sync', async (req, res) => {
  try {
    const { emails } = req.body;
    if (Array.isArray(emails)) {
      for (const item of emails) {
        const existing = await db.getEmail(item.id);
        if (!existing) {
          await db.saveEmail(item);
        }
      }
    }
    const all = await db.getAllEmails();
    res.json({ success: true, emails: all });
  } catch (err) {
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

// Clear all emails
app.post('/api/emails/clear', async (req, res) => {
  try {
    await db.clearAllEmails();
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

// Web Dashboard UI (Modern, Glassmorphism, Sleek Dark UI)
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
        <title>EmailTracker Prime | لوحة المتابعة</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg: #090d16;
            --surface: #0f172a;
            --surface-hover: #1e293b;
            --card-border: #1e293b;
            --card-border-glow: #334155;
            --primary: #3b82f6;
            --primary-glow: rgba(59, 130, 246, 0.15);
            --emerald: #10b981;
            --emerald-bg: rgba(16, 185, 129, 0.12);
            --amber: #f59e0b;
            --amber-bg: rgba(245, 158, 11, 0.12);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --text-dim: #64748b;
          }

          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            font-family: 'Cairo', -apple-system, BlinkMacSystemFont, sans-serif;
          }

          body {
            background-color: var(--bg);
            color: var(--text-main);
            min-height: 100vh;
            padding: 40px 24px;
            background-image: 
              radial-gradient(at 0% 0%, rgba(59, 130, 246, 0.08) 0px, transparent 50%),
              radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.05) 0px, transparent 50%);
          }

          .container {
            max-width: 1180px;
            margin: 0 auto;
          }

          /* Header */
          header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 36px;
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(12px);
            padding: 20px 28px;
            border-radius: 18px;
            border: 1px solid var(--card-border);
          }

          .brand {
            display: flex;
            align-items: center;
            gap: 14px;
          }

          .brand-logo {
            width: 44px;
            height: 44px;
            background: linear-gradient(135deg, #2563eb, #10b981);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            font-weight: 900;
            color: #fff;
            box-shadow: 0 8px 20px rgba(37, 99, 235, 0.25);
          }

          .brand-text h1 {
            font-size: 20px;
            font-weight: 800;
            letter-spacing: -0.5px;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .brand-tag {
            font-size: 11px;
            background: rgba(16, 185, 129, 0.15);
            color: #34d399;
            padding: 2px 10px;
            border-radius: 20px;
            border: 1px solid rgba(16, 185, 129, 0.3);
            font-weight: 600;
          }

          .brand-text p {
            font-size: 13px;
            color: var(--text-muted);
          }

          .header-actions {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .refresh-btn {
            background: var(--surface);
            border: 1px solid var(--card-border);
            color: var(--text-main);
            padding: 8px 16px;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
            text-decoration: none;
          }

          .refresh-btn:hover {
            background: var(--surface-hover);
            border-color: var(--card-border-glow);
          }

          /* Metrics Grid */
          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 18px;
            margin-bottom: 36px;
          }

          @media (max-width: 900px) {
            .metrics-grid { grid-template-columns: repeat(2, 1fr); }
          }
          @media (max-width: 550px) {
            .metrics-grid { grid-template-columns: 1fr; }
          }

          .metric-card {
            background: rgba(15, 23, 42, 0.8);
            backdrop-filter: blur(10px);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 22px;
            transition: transform 0.2s, border-color 0.2s;
            position: relative;
            overflow: hidden;
          }

          .metric-card:hover {
            transform: translateY(-2px);
            border-color: var(--card-border-glow);
          }

          .metric-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
          }

          .metric-title {
            font-size: 13px;
            color: var(--text-muted);
            font-weight: 600;
          }

          .metric-icon {
            font-size: 18px;
            padding: 8px;
            border-radius: 10px;
            background: rgba(255, 255, 255, 0.04);
          }

          .metric-value {
            font-size: 32px;
            font-weight: 800;
            line-height: 1;
            letter-spacing: -1px;
            font-family: 'JetBrains Mono', monospace;
          }

          .val-sent { color: #60a5fa; }
          .val-read { color: #34d399; }
          .val-unread { color: #fbbf24; }
          .val-rate { color: #a78bfa; }

          /* Table Section */
          .section-card {
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(10px);
            border: 1px solid var(--card-border);
            border-radius: 18px;
            overflow: hidden;
          }

          .section-header {
            padding: 20px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--card-border);
          }

          .section-title {
            font-size: 16px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 10px;
          }

          .table-wrapper {
            overflow-x: auto;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            text-align: right;
          }

          th {
            background: rgba(11, 17, 33, 0.8);
            padding: 14px 20px;
            font-size: 12px;
            color: var(--text-muted);
            font-weight: 700;
            border-bottom: 1px solid var(--card-border);
            white-space: nowrap;
          }

          td {
            padding: 16px 20px;
            font-size: 13px;
            border-bottom: 1px solid rgba(30, 41, 59, 0.5);
            vertical-align: middle;
          }

          tr:last-child td {
            border-bottom: none;
          }

          tr:hover td {
            background: rgba(255, 255, 255, 0.02);
          }

          .status-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
          }

          .status-chip.is-read {
            background: var(--emerald-bg);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.25);
          }

          .status-chip.is-pending {
            background: var(--amber-bg);
            color: #fbbf24;
            border: 1px solid rgba(245, 158, 11, 0.25);
          }

          .time-badge {
            color: var(--text-muted);
            font-size: 12px;
          }

          .highlight-time {
            color: #34d399;
            font-weight: 600;
          }

          .open-count-badge {
            background: rgba(59, 130, 246, 0.15);
            color: #60a5fa;
            border: 1px solid rgba(59, 130, 246, 0.3);
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 700;
            font-family: 'JetBrains Mono', monospace;
          }

          .empty-state {
            padding: 60px 20px;
            text-align: center;
            color: var(--text-muted);
          }

          .empty-icon {
            font-size: 44px;
            margin-bottom: 12px;
            display: inline-block;
          }

          .empty-state p {
            font-size: 14px;
            line-height: 1.6;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <header>
            <div class="brand">
              <div class="brand-logo">✓✓</div>
              <div class="brand-text">
                <h1>EmailTracker Prime <span class="brand-tag">نشط السحاب</span></h1>
                <p>تتبع فتح وقراءة رسائل البريد الإلكتروني بدقة متناهية</p>
              </div>
            </div>
            <div class="header-actions">
              <button onclick="if(confirm('هل أنت متأكد من رغبتك في مسح كل السجلات والبدء من جديد؟')) { fetch('/api/emails/clear', {method:'POST'}).then(() => location.reload()); }" class="refresh-btn" style="color: #f87171; border-color: rgba(248, 113, 113, 0.3);">
                <span>🗑️</span>
                <span>مسح السجل</span>
              </button>
              <a href="javascript:location.reload()" class="refresh-btn">
                <span>🔄</span>
                <span>تحديث البيانات</span>
              </a>
            </div>
          </header>

          <div class="metrics-grid">
            <div class="metric-card">
              <div class="metric-header">
                <span class="metric-title">إجمالي المرسل</span>
                <span class="metric-icon">✉️</span>
              </div>
              <div class="metric-value val-sent">${stats.totalSent}</div>
            </div>

            <div class="metric-card">
              <div class="metric-header">
                <span class="metric-title">تمت قراءتها (مقروء)</span>
                <span class="metric-icon">🟢</span>
              </div>
              <div class="metric-value val-read">${stats.totalRead}</div>
            </div>

            <div class="metric-card">
              <div class="metric-header">
                <span class="metric-title">في الانتظار (لم يُفتح)</span>
                <span class="metric-icon">⏳</span>
              </div>
              <div class="metric-value val-unread">${stats.totalUnread}</div>
            </div>

            <div class="metric-card">
              <div class="metric-header">
                <span class="metric-title">معدل الفتح</span>
                <span class="metric-icon">📊</span>
              </div>
              <div class="metric-value val-rate">${stats.openRate}%</div>
            </div>
          </div>

          <div class="section-card">
            <div class="section-header">
              <div class="section-title">
                <span>📋</span>
                <span>سجل الإيميلات المتتبعة</span>
              </div>
            </div>

            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>الحالة</th>
                    <th>المستلم</th>
                    <th>موضوع الإيميل</th>
                    <th>وقت الإرسال</th>
                    <th>تاريخ ووقت الفتح</th>
                    <th>مرات الفتح</th>
                  </tr>
                </thead>
                <tbody>
                  ${emails.length === 0 ? `
                    <tr>
                      <td colspan="6">
                        <div class="empty-state">
                          <span class="empty-icon">📭</span>
                          <p>لا توجد إيميلات متتبعة مسجلة حتى الآن.<br>أرسل إيميلك من Gmail وسيظهر هنا تلقائياً!</p>
                        </div>
                      </td>
                    </tr>
                  ` : emails.map(e => `
                    <tr>
                      <td>
                        <span class="status-chip ${e.isRead ? 'is-read' : 'is-pending'}">
                          ${e.isRead ? '✓✓ تم الفتح' : '⏳ لم يُقرأ بعد'}
                        </span>
                        ${e.isFollowUp ? '<span style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); padding: 2px 7px; border-radius: 6px; font-size: 11px; margin-right: 6px; font-weight: 700;">متابعة / رد</span>' : ''}
                      </td>
                      <td style="font-weight: 700; color: #f1f5f9;">${e.recipient}</td>
                      <td style="color: #cbd5e1; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${e.subject || '(بدون عنوان)'}</td>
                      <td class="time-badge local-tz" data-iso="${e.sentAt}">${e.sentAtFormatted ? e.sentAtFormatted.formatted : new Date(e.sentAt).toLocaleString('ar-EG')}</td>
                      <td>
                        ${e.isRead ? `
                          <span class="highlight-time local-tz" data-iso="${e.firstReadAt}">${e.firstReadAtFormatted ? e.firstReadAtFormatted.formatted : new Date(e.firstReadAt).toLocaleString('ar-EG')}</span>
                        ` : '<span style="color: var(--text-dim);">-</span>'}
                      </td>
                      <td>
                        ${e.openCount > 0 ? `
                          <span class="open-count-badge">${e.openCount} مرة</span>
                        ` : '<span style="color: var(--text-dim);">-</span>'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <script>
          // Automatic local timezone formatting on client side
          document.querySelectorAll('.local-tz').forEach(el => {
            const iso = el.getAttribute('data-iso');
            if (iso) {
              try {
                el.textContent = new Date(iso).toLocaleString('ar-EG', {
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true
                });
              } catch(e) {}
            }
          });
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Error rendering dashboard: ' + err.message);
  }
});

if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 EmailTracker Server running on port ${PORT}`);
  });
}

module.exports = app;
