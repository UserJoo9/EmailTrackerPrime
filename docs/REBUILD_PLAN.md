# EmailTracker Prime: تحليل وخطة إعادة البناء

تاريخ التحليل: 2026-10-27 · الحالة: المرحلتين 0 و1 و2 اتنفذوا، والمرحلة 3 محتاجة اختبار على Gmail حقيقي.

## 1) اللي لقيناه (قبل)

### أمان (حرج)
| # | المشكلة | الأثر |
|---|---|---|
| S1 | الـ API والداشبورد من غير أي auth | أي حد يعرف الرابط يقرا كل المستلمين والمواضيع، ويعمل `POST /api/emails/clear` يمسح كل الداتا |
| S2 | Stored XSS في الداشبورد (`${e.recipient}` جوه template HTML) | أي حد يعمل POST بـ recipient خبيث ينفّذ JS في الداشبورد |
| S3 | XSS في الإضافة: `innerHTML` للـ modal/toast/popup ببيانات جاية من السيرفر أو من DOM بتاع Gmail | تنفيذ كود جوه صفحة Gmail |
| S4 | `host_permissions: https://*/*` | الإضافة تقدر تكلم أي موقع |
| S5 | CORS `*` + تسريب `err.message` + تخزين IP/UA الخام | سطح هجوم وخصوصية |
| S6 | `server/data/emails.json` متتبع في git ومش في `.gitignore` | خطر تسريب بيانات حقيقية |

### صحة البيانات والمعمارية
| # | المشكلة |
|---|---|
| D1 | نسختين من كل حاجة: `package.json` x2 (Express 4 مقابل 5، uuid 9 مقابل 14، dotenv 16 مقابل 18)، `vercel.json` x2، `api/index.js` x2، `node_modules` x2. Vercel بيبني من الجذر (Express 4) والتشغيل المحلي من `server/` (Express 5) |
| D2 | كل الإيميلات في hash واحد JSON، وكل فتح = قراءة ثم كتابة (race: فتحات بتضيع) |
| D3 | `GET /api/emails` بيعمل كتابة/حذف في Redis (auto-purge بنصوص ثابتة "مستلم غير محدد") وبيجيب كل الداتا كل 10 ثواني من كل تبويب Gmail (استهلاك quota) |
| D4 | إعادة تسجيل نفس الـ ID كانت بتمسح سجل الفتحات |
| D5 | نصوص منسّقة (`ar-EG`) متخزنة في الداتا بيز، وبتتحسب على السيرفر بلغة/منطقة غلط |
| D6 | الإنتاج بدون Redis بيشتغل بملفات `/tmp` بصمت وبيضيّع الداتا |
| D7 | `parseUserAgent`: فرع Edge ما كانش بيتوصل ليه أبداً (Chrome قبله) |
| D8 | داشبورد 460 سطر HTML/CSS جوه `server.js` |

### الإضافة
| # | المشكلة |
|---|---|
| E1 | `getMyEmail()` بترجع `'yalkhodary'` ثابت لو ملقتش الإيميل، و`em.includes('')` كانت بتفلتر كل المستلمين |
| E2 | الكاش بيتكتب من 3 أماكن (content، background، popup) = race وتكرار |
| E3 | اكتشاف زر الإرسال واسع (`.T-I-atl`, `*="Send"`) فبيمسك زر خيارات الجدولة وغيره = إيميلات وهمية. و5 listeners (mousedown/pointerdown/click/keydown/submit) كلهم بينادوا نفس الدالة |
| E4 | الإضافة كانت بتفرض استبدال `localhost:3000` بسيرفر Vercel (مفيش تشغيل محلي ممكن) |
| E5 | polling كل 10 ثواني من كل تبويب، والكاش من غير حد أقصى |
| E6 | إعدادات ميتة (`trackByDefault`, `showBadgesInGmail`)، وصلاحية `alarms` مش مستخدمة، و`web_accessible_resources` مش مستخدمة |
| E7 | `Math.random` + `Date.now` كـ ID |

## 2) الهيكل الجديد

```
src/{config,app,server}.js
src/routes/{pixel,emails}.js          src/middleware/auth.js
src/store/{redisStore,memoryStore,shape,index}.js
src/lib/{validate,userAgent}.js       public/{index.html,dashboard.js,dashboard.css}
extension/{background.js,manifest.json,shared/util.js,content/,popup/}
scripts/{create-icons,migrate-legacy}.js     test/*.test.js
```
نموذج Redis الجديد: `meta` (ثابت) + `count/first/last` (HINCRBY/HSETNX) + `reads:<id>` (LPUSH+LTRIM). كل فتح = pipeline واحد atomic، وكل قراءة قائمة = 4 أوامر مهما كان العدد.

## 3) المراحل

- **المرحلة 0 (حرج) ✅**: S1–S6: مفتاح `API_KEY` (fail-closed في الإنتاج)، إزالة CORS، الداشبورد ثابت بـ DOM آمن + CSP، `innerHTML` اتشال من الإضافة، أذونات ضيّقة (`optional_host_permissions`)، `.gitignore`.
- **المرحلة 1 (بنية) ✅**: D1–D8: package واحد، `src/`، store موحّد (Redis/ملف) بنفس الـ interface، تحقق من المدخلات، سكريبت ترحيل للبيانات القديمة (الـ pixel القديم `/track/pixel` و`/pixel` لسه شغالين).
- **المرحلة 2 (الإضافة) ✅**: E1–E7: background هو الكاتب الوحيد للكاش، alarm كل دقيقة بدل polling، مزامنة ذكية أوفلاين/أونلاين، حالة الاتصال (متصل / مفتاح غلط / أوفلاين)، `shared/util.js`، IDs من `crypto.randomUUID`.
- **المرحلة 3 (محتاجة Gmail حقيقي، لسه ❌)**:
  1. مطابقة صفوف Gmail بالإيميل المتتبع حالياً بالموضوع + المستلم بتخمين (`matchRecipient` بيقبل اسم المستخدم/الدومين/الاسم) = احتمال ✓✓ غلط. الأدق: ربط الـ tracking ID بـ thread-id أو message-id بعد الإرسال.
  2. الإيميلات الوهمية: التسجيل بيحصل لحظة الضغط على Send قبل ما يتأكد إن الإرسال نجح. الأدق: تأكيد الإرسال (اختفاء نافذة الكتابة / ظهور "Message sent") قبل التسجيل النهائي.
  3. فتح الراسل لرسالته من Sent: التعطيل حالياً بيتم بالـ hash `#sent` + فترة سماح 4 ثواني فقط.
  4. اختيار `display:none` للـ pixel: بعض العملاء مبيحمّلوش الصور المخفية. جرّب `opacity:0` بحجم 1×1 وقارن نسب الفتح.
- **المرحلة 4 (اختياري)**: TypeScript + bundler للإضافة (esbuild)، retention policy للداتا (حذف تلقائي بعد X يوم)، rate-limit على الـ pixel، CI يشغّل `npm test`.

## 4) التحقق

43 اختبار (`npm test`): السيرفر عبر HTTP حقيقي، الـ store بـ Redis وهمي يحاكي Upstash، الـ background الحقيقي داخل `vm`، والـ content/popup الحقيقيين على jsdom بـ DOM شبيه بـ Gmail. **اللي لم يُختبر**: Gmail الحقيقي، Upstash الحقيقي، ونشر Vercel الفعلي.

## 5) خطوات النشر (مرة واحدة)

1. على Vercel: أضف `API_KEY` ثم Redeploy.
2. `node scripts/migrate-legacy.js --dry-run` ثم بدون `--dry-run` (بـ env بتاع Upstash).
3. في الإضافة: Reload ثم الإعدادات ← API Key ← حفظ.
4. بعد ما تتأكد إن كله تمام: امسح المفتاح القديم `emailtracker:emails` من Redis يدوياً.
