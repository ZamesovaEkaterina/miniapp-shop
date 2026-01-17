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
app.use(express.static('public'));

const db = new Low(new JSONFile('.db.json'), { users: {}, orders: [], menu: { categories: [], products: [] } });

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
    iikoTokenExp = now + 9 * 60 * 1000;
    console.log('[iiko] token acquired');
    return iikoToken;
  } catch (e) {
    console.error('[iiko] token error', e.response?.data || e.message);
    return null;
  }
}

// ===== ПОПРОБУЕМ ВСЕ ENDPOINTS =====
async function fetchIikoMenu() {
  try {
    const token = await getIikoToken();
    if (!token) throw new Error('No iiko token');

    console.log('[iiko] ========== TRYING ALL ENDPOINTS ==========');

    // 1. NOMENCLATURE (то что мы использовали)
    try {
      console.log('[iiko] 1. Trying /nomenclature...');
      const resp1 = await axios.post(`${process.env.IIKO_API_BASE}/api/1/nomenclature`, {
        organizationId: process.env.IIKO_ORG_ID
      }, { headers: { Authorization: `Bearer ${token}` } });
      
      console.log('[iiko] nomenclature keys:', Object.keys(resp1.data));
      if (resp1.data.products) {
        const activeProds = resp1.data.products.filter(p => {
          if (!p.sizePrices) return false;
          return p.sizePrices.some(sp => sp.price?.currentPrice > 0 && sp.price?.isIncludedInMenu);
        });
        console.log(`[iiko] nomenclature active products: ${activeProds.length}/${resp1.data.products.length}`);
      }
    } catch (e) {
      console.log('[iiko] /nomenclature error:', e.message);
    }

    // 2. ORGANIZATION MENU
    try {
      console.log('[iiko] 2. Trying /organization/menu...');
      const resp2 = await axios.get(`${process.env.IIKO_API_BASE}/api/1/organization/menu`, {
        params: { organizationId: process.env.IIKO_ORG_ID },
        headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log('[iiko] organization/menu keys:', Object.keys(resp2.data));
      console.log('[iiko] organization/menu data:', JSON.stringify(resp2.data).substring(0, 500));
    } catch (e) {
      console.log('[iiko] /organization/menu error:', e.message);
    }

    // 3. DELIVERY MENU
    try {
      console.log('[iiko] 3. Trying /deliveries/menu...');
      const resp3 = await axios.post(`${process.env.IIKO_API_BASE}/api/1/deliveries/menu`, {
        organizationId: process.env.IIKO_ORG_ID
      }, { headers: { Authorization: `Bearer ${token}` } });
      
      console.log('[iiko] deliveries/menu keys:', Object.keys(resp3.data));
      if (resp3.data.categories) {
        console.log('[iiko] deliveries/menu categories:', resp3.data.categories.length);
      }
      if (resp3.data.products) {
        console.log('[iiko] deliveries/menu products:', resp3.data.products.length);
        resp3.data.products.slice(0, 5).forEach((p, i) => {
          console.log(`[iiko]   [${i}] "${p.name}" price=${p.price}`);
        });
      }
    } catch (e) {
      console.log('[iiko] /deliveries/menu error:', e.message);
    }

    // 4. COMBO LIST
    try {
      console.log('[iiko] 4. Trying /combo_list...');
      const resp4 = await axios.get(`${process.env.IIKO_API_BASE}/api/1/combo_list`, {
        params: { organizationId: process.env.IIKO_ORG_ID },
        headers: { Authorization: `Bearer ${token}` }
      });
      
      console.log('[iiko] combo_list keys:', Object.keys(resp4.data));
    } catch (e) {
      console.log('[iiko] /combo_list error:', e.message);
    }

    console.log('[iiko] ==========================================');

    db.data.menu = FALLBACK;
    await db.write();
    return null;

  } catch (e) {
    console.error('[iiko] error:', e.message);
    return null;
  }
}

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

app.get('/api/menu', async (req, res) => {
  try {
    await db.read();
    const menu = db.data?.menu || { categories: [], products: [] };
    res.json(menu);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/orders', (req, res) => {
  res.json({ orders: db.data.orders.slice(-20).reverse() });
});

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

    sendOrderToIiko(record, user).catch(e => console.error('[iiko] order send failed', e));

    res.json({ ok: true, orderNumber, total });
  } catch (e) {
    console.error('[POST /api/orders] error', e);
    res.json({ ok: false, error: e.message });
  }
});

async function sendOrderToIiko(order, user) {
  const token = await getIikoToken();
  if (!token) {
    console.log('[iiko] no token, skipping order send');
    return;
  }

  try {
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
        }))
      }
    };

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

app.post('/api/whoami', (req, res) => {
  const { initData } = req.body || {};
  const v = validateInitData(initData);
  if (!v.ok) return res.status(401).json({ ok: false, error: 'initData invalid' });
  const params = new URLSearchParams(initData);
  const user = JSON.parse(params.get('user') || '{}');
  res.json({ ok: true, user });
});

async function start() {
  await db.read();
  
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
