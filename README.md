# EmailTracker Prime ✉️✓✓

تتبع فتح رسائل Gmail: **إضافة Chrome** بتحقن pixel شفاف في الرسالة وقت الإرسال، و**سيرفر Express** (على Vercel + Upstash Redis) بيسجل الفتح، و**داشبورد** لمتابعة الإيميلات.

```
extension/   إضافة Chrome (MV3): background + content (Gmail) + popup + shared
src/         السيرفر: app, routes, store (Redis/ملف), lib, middleware
public/      الداشبورد (ملفات ثابتة، البيانات بتتجاب بالـ API)
api/         نقطة دخول Vercel
scripts/     create-icons, migrate-legacy
test/        اختبارات (node:test + jsdom)
docs/        REBUILD_PLAN.md
```

## 1) النشر على Vercel

1. ارفع المشروع على GitHub واعمل Import في Vercel (من غير أي Build settings).
2. اربط قاعدة **Upstash Redis** من تبويب **Storage** (المتغيرات بتتضبط تلقائياً).
3. **ضروري:** أضف متغير البيئة `API_KEY` بقيمة عشوائية طويلة، مثلاً:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   بدون `API_KEY` السيرفر في الإنتاج بيرفض كل طلبات الـ API (الـ pixel بيفضل شغال).
4. اعمل Redeploy.

> الـ pixel (`/track/pixel/:id`) عام لازم يفضل كده (الإيميل بيحمّله من أي مكان). كل حاجة تانية (`/api/*` والداشبورد) محتاجة المفتاح.

## 2) تثبيت الإضافة

1. `chrome://extensions` ← فعّل **Developer mode** ← **Load unpacked** ← اختار مجلد `extension`.
2. افتح الإضافة ← **الإعدادات**: ضع **رابط السيرفر** و**API Key** ← **فحص** ← **حفظ**.
   (لو الرابط مش الافتراضي، Chrome هيطلب صلاحية الوصول للسيرفر ده.)

## 3) تشغيل محلي

```bash
cp .env.example .env        # واضبط API_KEY
npm install
npm start                   # http://localhost:3000   (أو start-server.bat على ويندوز)
npm test
```
محلياً من غير Redis بيتخزن في `data/emails.json` (للتطوير فقط، ومتجاهَل في git).

## 4) الترحيل من النسخة القديمة (v1)

النسخة القديمة كانت بتخزن كل الإيميلات في hash واحد على Redis. النموذج الجديد مختلف (عدّادات atomic)، فاعمل مرة واحدة:

```bash
node scripts/migrate-legacy.js --dry-run   # معاينة
node scripts/migrate-legacy.js             # ترحيل فعلي (بيشيل الأشباح وقراءات البوتات والـ IP)
```
البيانات القديمة مبتتمسحش. وكاش الإضافة القديم بيتزامن لوحده مع أول اتصال.

## الـ API

كلها بتحتاج `Authorization: Bearer <API_KEY>`:

| Method | Path | الوصف |
|---|---|---|
| POST | `/api/emails` | تسجيل إيميل (idempotent) |
| POST | `/api/emails/sync` | تسجيل دفعة (حد أقصى 200) |
| GET | `/api/emails` | القائمة (أحدث 500، من غير تفاصيل الفتحات) |
| GET | `/api/emails/:id` | التفاصيل + آخر 50 فتحة |
| DELETE | `/api/emails/:id` | حذف إيميل |
| DELETE | `/api/emails` | مسح الكل |
| GET | `/api/stats` | الإحصائيات |

## ملاحظات خصوصية وحدود

- السيرفر مبيخزنش IP ولا الـ User-Agent الخام للمستلم، بس نوع العميل (مثلاً "Gmail Proxy").
- تتبع الفتح بالـ pixel تقريبي: Apple Mail Privacy Protection وبعض الماسحات بتحمّل الصور تلقائياً، وبعض العملاء بيحجبها. وفي بلدان/سياقات كتير (مثلاً GDPR) لازم تبلّغ المستلمين.
