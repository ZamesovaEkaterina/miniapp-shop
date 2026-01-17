// server.js — Express-сервер для Mini App + iiko интеграция
require('dotenv').config();

function mask(s){ return s ? String(s).slice(0,4) + '...' + String(s).slice(-4) : null; }
console.log('[ENV]', {
  BOT_TOKEN: mask(process.env.BOT_TOKEN),
  IIKO_API_BASE: process.env.IIKO_API_BASE || null,
  IIKO_API_LOGIN: mask(process.env.IIKO_API_LOGIN),
  IIKO_ORG_ID: process.env.IIKO_ORG_ID || null,
});

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const { nanoid } = require('nanoid');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // отдаём фронт из /public

// простая JSON-база в памяти
const db = new Low(new JSONFile('.db.json'), { users: {}, orders: [], menu: { categories: [], products: [] } });

// ===== TELEGRAM INIT DATA VALIDATION =====
function validateInitData(initData) {
  if (!initData) return { ok: false, reason: 'empty' };
  const params = new URLSearchParams(initData);
  const data = [];
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue;
    data.push(`${k}=${v}`);
  }
  data.sort();
  const dataCheckString = data.join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(process.env.BOT_TOKEN || 'MISSING_BOT_TOKEN')
    .digest();
  const hmac = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');
  const hash = params.get('hash');
  return { ok: hmac === hash, reason: hmac === hash ? null : 'hash_mismatch' };
}

// ===== IIKO TOKEN =====
let iikoToken = null;
let iikoTokenExp = 0;

async function getIikoToken() {
  const now = Date.now();
  if (iikoToken && now < iikoTokenExp) return iikoToken;
  if (!process.env.IIKO_API_LOGIN || !process.env.IIKO_API_BASE) return null;
  
  try {
    const resp = await axios.post(`${process.env.IIKO_API_BASE}/api/1/access_token`, {
      apiLogin: process.env.IIKO_API_LOGIN
    });
    iikoToken = resp.data.token;
    iikoTokenExp = now + 9 * 60 * 1000; // 9 минут (токен живёт 10)
    console.log('[iiko] token acquired');
    return iikoToken;
  } catch (e) {
    console.error('[iiko] token error', e.response?.data || e.message);
    return null;
  }
}

// ===== IIKO MENU (ПОЛНЫЙ DEBUG) =====
async function fetchIikoMenu() {
  try {
    const token = await getIikoToken();
    if (!token) throw new Error('No iiko token (offline mode)');

    console.log('[iiko] Loading menu from nomenclature...');

    const resp = await axios.post(`${process.env.IIKO_API_BASE}/api/1/nomenclature`, {
      organizationId: process.env.IIKO_ORG_ID
    }, { headers: { Authorization: `Bearer ${token}` } });

    // ===== ПОЛНЫЙ DEBUG: выводим СТРУКТУРУ ответа =====
    console.log('[iiko] ========== RESPONSE STRUCTURE ==========');
    console.log('[iiko] Root keys:', Object.keys(resp.data).sort());
    console.log('[iiko] productGroups count:', resp.data.productGroups?.length || 0);
    console.log('[iiko] products count:', resp.data.products?.length || 0);
    console.log('[iiko] =========================================');

    // Выводим ПЕРВЫЙ товар полностью
    if (resp.data.products && resp.data.products.length > 0) {
      console.log('[iiko] ПЕРВЫЙ товар (ПОЛНЫЙ):', JSON.stringify(resp.data.products[0], null, 2));
    }

    // Выводим первые 5 товаров (краткие)
    if (resp.data.products && resp.data.products.length > 0) {
      console.log('[iiko] ========== ПЕРВЫЕ 5 ТОВАРОВ ==========');
      resp.data.products.slice(0, 5).forEach((p, i) => {
        console.log(`[iiko] [${i}] name: "${p.name}" | type: "${p.type}" | parentGroup: "${p.parentGroup}" | isDeleted: ${p.isDeleted}`);
        if (p.sizePrices && p.sizePrices.length > 0) {
          const firstSize = p.sizePrices[0];
          if (firstSize.price) {
            console.log(`[iiko]      ↳ sizePrices[0]: price=${firstSize.price.currentPrice}, inMenu=${firstSize.price.isIncludedInMenu}`);
          }
        }
      });
      console.log('[iiko] ======================================');
    }

    // НА ЭТОМ ОСТАНОВИМСЯ, ДРУГИХ ФИЛЬТРОВ НЕТ
    db.data.menu = FALLBACK;
    await db.write();

    return null; // для отладки

  } catch (e) {
    console.error('[iiko] error:', e.message);
    return null;
  }
}

// Fallback меню (на случай, если iiko недоступен)
const FALLBACK = {
  categories: [
    { id: 'c1', name: 'Бургеры' },
    { id: 'c2', name: 'Закуски' }
  ],
  products: [
    { id: 'p1', name: 'Классик Бургер', price: 350, categoryId: 'c1', categoryName: 'Бургеры' },
    { id: 'p2', name: 'Двойной Бургер', price: 450, categoryId: 'c1', categoryName: 'Бургеры' },
    { id: 'p3', name: 'Картофель фри', price: 150, categoryId: 'c2', categoryName: 'Закуски' },
  ]
};

// ===== API ENDPOINTS =====

// 1. Bootstrap: загрузить профиль + меню + заказы
app.post('/api/bootstrap', async (req, res) => {
  const { initData } = req.body || {};
  let user = null;

  if (initData) {
    const v = validateInitData(initData);
    if (!v.ok) return res.status(401).json({ error: 'initData invalid: ' + v.reason });
    const params = new URLSearchParams(initData);
    const userRaw = params.get('user');
    if (userRaw) {
      try {
        user = JSON.parse(userRaw);
        db.data.users[user.id] = db.data.users[user.id] || { id: user.id, first_name: user.first_name };
        await db.write();
      } catch (e) {
        console.error('Parse user error', e);
      }
    }
  }

  const menu = db.data.menu?.products?.length ? db.data.menu : FALLBACK;
  const orders = user ? db.data.orders.filter(o => o.userId === user.id) : [];
  
  res.json({ user, categories: menu.categories, products: menu.products, orders });
});

// 2. Получить меню
app.get('/api/menu', async (req, res) => {
  try {
    await db.read();
    const menu = db.data?.menu || { categories: [], products: [] };
    res.json(menu);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 3. Получить заказы (последние 20 для всех, или фильтровать по userId если нужно)
app.get('/api/orders', (req, res) => {
  res.json({ orders: db.data.orders.slice(-20).reverse() });
});

// 4. Создать заказ
app.post('/api/orders', async (req, res) => {
  try {
    const { initData, items, delivery } = req.body || {};
    const v = validateInitData(initData);
    if (!v.ok) return res.status(401).json({ ok: false, error: 'initData invalid' });

    const params = new URLSearchParams(initData);
    const user = JSON.parse(params.get('user') || '{}');

    if (!Array.isArray(items) || !items.length) {
      return res.json({ ok: false, error: 'Пустая корзина' });
    }

    const menu = db.data.menu?.products?.length ? db.data.menu : FALLBACK;
    const byId = Object.fromEntries(menu.products.map(p => [p.id, p]));
    
    let subtotal = 0;
    const lines = [];
    for (const it of items) {
      const prod = byId[it.id];
      if (!prod) return res.json({ ok: false, error: `Товар не найден: ${it.id}` });
      const qty = Math.max(1, parseInt(it.qty || 1, 10));
      subtotal += prod.price * qty;
      lines.push({ id: prod.id, name: prod.name, price: prod.price, qty });
    }

    const fee = (delivery?.method === 'courier')
      ? (delivery?.zone === 'zone2' ? 200 : delivery?.zone === 'zone1' ? 100 : 0)
      : 0;

    const total = Math.round((subtotal + fee) * 100) / 100;

    const orderNumber = nanoid(6);
    const record = {
      id: nanoid(),
      number: orderNumber,
      userId: user?.id || null,
      items: lines,
      delivery: { ...delivery, fee },
      subtotal,
      total,
      status: 'created',
      iikoSent: false,
      createdAt: Date.now()
    };
    
    db.data.orders.push(record);
    await db.write();

    // Пытаемся отправить в iiko (асинхронно, не ждём)
    sendOrderToIiko(record, user).catch(e => console.error('[iiko] order send failed', e));

    res.json({ ok: true, orderNumber, total });
  } catch (e) {
    console.error('[POST /api/orders] error', e);
    res.json({ ok: false, error: e.message });
  }
});

// ===== IIKO ORDER SEND (ASYNC) =====
async function sendOrderToIiko(order, user) {
  const token = await getIikoToken();
  if (!token) {
    console.log('[iiko] no token, skipping order send');
    return;
  }

  try {
    // Примерный payload для iiko (зависит от версии API)
    const payload = {
      organizationId: process.env.IIKO_ORG_ID,
      order: {
        phone: user?.phone || '',
        customer: {
          name: `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Guest',
          id: user?.id?.toString() || null
        },
        items: order.items.map(i => ({
          productId: i.id,
          amount: i.qty
        })),
        comment: `Telegram Mini App order #${order.number}, delivery: ${order.delivery?.method} (${order.delivery?.zone}), address: ${order.delivery?.address || 'N/A'}`
      }
    };

    // Пробуем отправить
    const resp = await axios.post(
      `${process.env.IIKO_API_BASE}/api/1/deliveries/create`,
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    console.log('[iiko] order sent:', resp.data?.id);
  } catch (e) {
    console.error('[iiko] order send error', e.response?.data || e.message);
  }
}

// ===== DEBUG =====
app.post('/api/whoami', (req, res) => {
  const { initData } = req.body || {};
  const v = validateInitData(initData);
  if (!v.ok) return res.status(401).json({ ok: false, error: 'initData invalid' });
  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user') || '{}');
  res.json({ ok: true, user });
});

// ===== START =====
async function start() {
  await db.read();
  
  // Пытаемся загрузить меню из iiko при старте
  const menuLoaded = await fetchIikoMenu();
  if (!menuLoaded) {
    console.log('[db] using FALLBACK menu');
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('[fatal] startup error:', err);
  process.exit(1);
});
