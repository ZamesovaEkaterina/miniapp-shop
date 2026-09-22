const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const consent = fs.readFileSync(path.join(__dirname, '..', 'public', 'consent.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

for (const required of [
  'Бар Борода — тестовая витрина',
  'Персональные данные не собираются',
  'Тестовый режим. Доставка ещё не запущена.',
  'id="tab-catalog"',
  'id="tab-checkout"',
  'id="tab-profile"',
  'id="product-modal"',
  "fetch('/api/menu'",
]) assert(html.includes(required), `Missing demo contract: ${required}`);

for (const forbidden of [
  '/api/bootstrap',
  '/api/delivery/quote',
  '/api/orders',
  'initData',
  'customer-phone',
  'customer-name',
  'id="address"',
  'consent-personal',
  'consent-policy',
]) assert(!html.includes(forbidden), `Test storefront must not contain: ${forbidden}`);

assert(server.includes("const PUBLIC_DEMO_MODE = process.env.PUBLIC_DEMO_MODE !== 'false'"), 'Demo mode must be enabled by default');
assert(server.includes('Приём заказов отключён в тестовом режиме'), 'Order API must be blocked in demo mode');
assert(server.includes('Проверка реальных адресов отключена в тестовом режиме'), 'Address API must be blocked in demo mode');
assert(consent.includes('Согласие на обработку персональных данных здесь не запрашивается'), 'Consent page must not accept consent');

console.log('privacy-safe demo contract tests passed');
