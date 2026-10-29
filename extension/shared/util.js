// EmailTracker Prime - أدوات مشتركة بين الـ background والـ content والـ popup.
// بتتحمّل كـ classic script وبتعمل global اسمه ETP (ومتاحة لـ Node للاختبارات).
(function (root) {
  'use strict';

  const ETP = {
    // السيرفر الافتراضي. تقدر تغيّره من إعدادات الإضافة.
    DEFAULT_SERVER_URL: 'https://email-tracker-prime.vercel.app',
    MAX_CACHED: 500,

    normalizeUrl(url) {
      return String(url || '').trim().replace(/\/+$/, '');
    },

    // نفس صيغة الـ ID اللي السيرفر بيقبلها: ^[A-Za-z0-9_-]{8,64}$
    // الشكل et_<timestamp>_<عشوائي base36>: نفس شكل النسخة اللي اتجربت مع Gmail. الـ hex الطويل
    // (32 حرف) كان ممكن يطابق فلاتر مانعات الإعلانات فيفشل تحميل الصورة وGmail يشيلها.
    newTrackingId() {
      const bytes = new Uint8Array(10);
      globalThis.crypto.getRandomValues(bytes);
      const rand = Array.from(bytes, (b) => (b % 36).toString(36)).join('');
      return `et_${Date.now()}_${rand}`;
    },

    // pixel بتاعنا (جديد أو قديم) بغض النظر عن الدومين
    PIXEL_SRC_RE: /\/(?:(?:track\/)?pixel|i)\/et_[A-Za-z0-9_-]+/,

    formatTime(iso, timezone) {
      if (!iso) return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      const opts = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true };
      try {
        const tz = !timezone || timezone === 'auto'
          ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo')
          : timezone;
        return date.toLocaleString('ar-EG', { ...opts, timeZone: tz });
      } catch {
        return date.toLocaleString('ar-EG');
      }
    },

    cleanSubject(str) {
      if (!str) return '';
      return String(str)
        .replace(/^(re:|fwd:|رد:|إعادة توجيه:|متابعة:)\s*/i, '')
        .replace(/[\s​-‍﻿]+/g, ' ')
        .trim()
        .toLowerCase();
    },

    // بنّاء DOM آمن: النصوص دايماً textContent (ممنوع innerHTML بأي بيانات جاية من برّه)
    el(tag, props, ...children) {
      const node = globalThis.document.createElement(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else node.setAttribute(k, v === true ? '' : String(v));
      }
      for (const c of children) if (c) node.appendChild(c);
      return node;
    }
  };

  root.ETP = ETP;
  if (typeof module !== 'undefined' && module.exports) module.exports = ETP;
})(typeof self !== 'undefined' ? self : this);
