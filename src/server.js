'use strict';

const { loadConfig } = require('./config');
const { createStore } = require('./store');
const { createApp } = require('./app');

const config = loadConfig();
const app = createApp({ config, store: createStore(config) });

if (require.main === module) {
  if (!config.apiKey) {
    console.warn('[security] API_KEY غير مضبوط: الـ API مفتوح (مسموح محلياً فقط). اضبطه قبل النشر.');
  }
  app.listen(config.port, () => {
    console.log(`EmailTracker Prime server: http://localhost:${config.port}`);
  });
}

module.exports = app;
