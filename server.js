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

// ===== FETCH IIKO MENU - БЕРЁМ ВСЮ НОМЕНКЛАТУРУ + ЦЕНЫ ИЗ ПРАЙС-ЛИСТА =====
async function fetchIikoMenu() {
  try {
    const token = await getIikoToken();
    if (!token) throw new Error('No iiko token');

    console.log('[iiko] Loading nomenclature...');

    // 1. ПОЛУЧАЕМ НОМЕНКЛАТУРУ (ВСЕ товары, не только те что в меню)
    const nomResp = await axios.post(`${process.env.IIKO_API_BASE}/api/1/nomenclature`, {
      organizationId: process.env.IIKO_ORG_ID
    }, { headers: { Authorization: `Bearer ${token}` } });

    const allProducts = nomResp.data.products || [];
    const productCategories = nomResp.data.productCategories || [];

    console.log(`[iiko] Total products in nomenclature: ${allProducts.length}`);

    // ===== ФИЛЬТРУЕМ: Только не удалённые товары (не смотрим на isIncludedInMenu!) =====
    const activeProducts = allProducts.filter(p => !p.isDeleted);
    console.log(`[iiko] Active products (not deleted): ${activeProducts.length}`);

    // 2. ПОЛУЧАЕМ PRICELISTS (текущие цены)
    console.log('[iiko] Loading pricelists...');
    let pricelistResp;
    try {
      pricelistResp = await axios.get(`${process.env.IIKO_API_BASE}/api/1/pricelists`, {
        params: { organizationId: process.env.IIKO_ORG_ID },
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (e) {
      console.log('[iiko] pricelists error:', e.message);
      pricelistResp = { data: { pricelists: [] } };
    }

    const pricelists = pricelistResp.data.pricelists || [];
    console.log(`[iiko] Available pricelists: ${pricelists.length}`);
    pricelists.forEach((pl, i) => {
      console.log(`[iiko]   [${i}] "${pl.name}" (id: ${pl.id})`);
    });

    // Берём первый активный pricelist
    let priceMap = {};
    if (pricelists.length > 0) {
      const pricelist = pricelists[0];
      console.log(`[iiko] Using pricelist: "${pricelist.name}"`);
      
      // 3. ПОЛУЧАЕМ ЦЕНЫ ИЗ ЭТОГО PRICELIST
      try {
        const pricesResp = await axios.get(
          `${process.env.IIKO_API_BASE}/api/1/pricelists/${pricelist.id}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        console.log('[iiko] Loading prices from pricelist...');
        const items = pricesResp.data.items || [];
        console.log(`[iiko] Items in pricelist: ${items.length}`);

        // Создаём map: productId -> price
        items.forEach(item => {
          if (item.productId && item.price !== undefined) {
            priceMap[item.productId] = item.price;
          }
        });

        console.log(`[iiko] Price map created: ${Object.keys(priceMap).length} products with prices`);
      } catch (e) {
        console.error('[iiko] Error loading pricelist items:', e.message);
      }
    }

    // ===== МЕРДЖИМ: товары + цены из прайс-листа =====
    const categoryMap = {};
    productCategories.forEach(pc => {
      categoryMap[pc.id] = pc.name;
    });

    const categories = [];
    const categorySet = new Set();

    // ===== БЕРЁМ ВСЕ товары и подставляем цены из прайс-листа =====
    const products = activeProducts
      .map(p => {
        // Берём цену ИЗ ПРАЙС-ЛИСТА (главный источник!)
        let price = priceMap[p.id];

        if (price === undefined) {
          // Fallback: если нет в priceList, берём из sizePrices
          price = null;
          if (p.sizePrices) {
            for (const sp of p.sizePrices) {
              if (sp.price?.currentPrice > 0) {
                price = sp.price.currentPrice;
                break;
              }
            }
          }
          price = price || 0; // Если нет цены вообще, ставим 0
        }

        const categoryId = p.parentGroup || 'default';
        const categoryName = categoryMap[categoryId] || 'Товары';
        categorySet.add(categoryId);

        return {
          id: p.id,
          name: p.name,
          price: Math.round(price * 100) / 100,
          categoryId,
          categoryName
        };
      })
      .filter(p => p.price > 0); // Показываем только товары с ценой > 0

    // ===== СОЗДАЁМ СПИСОК КАТЕГОРИЙ =====
    categorySet.forEach(cid => {
      const catName = categoryMap[cid] || 'Товары';
      categories.push({ id: cid, name: catName });
    });

    console.log('[iiko] ========== ALL PRODUCTS WITH PRICES ==========');
    products.slice(0, 40).forEach((p, i) => {
      const priceStr = p.price > 0 ? `${p.price} ₽` : 'По запросу';
      console.log(`[iiko] [${i}] "${p.name}" | price: ${priceStr} | category: ${p.categoryName}`);
    });
    if (products.length > 40) {
      console.log(`[iiko] ... and ${products.length - 40} more`);
    }
    console.log('[iiko] =============================================');

    console.log(`[iiko] ✓ Final menu: ${categories.length} categories, ${products.length} products`);

    db.data.menu = { categories, products };
    await db.write();

    return { categories, products };

  } catch (e) {
    console.error('[iiko] menu load failed:', e.message);
    console.log('[db] using FALLBACK menu');
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

// ===== API ENDPOINTS =====

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

// ===== DEBUG ENDPOINT =====
app.get('/api/debug/iiko-raw', async (req, res) => {
  try {
    const token = await getIikoToken();
    if (!token) return res.json({ error: 'No token' });

    const nomResp = await axios.post(`${process.env.IIKO_API_BASE}/api/1/nomenclature`, {
      organizationId: process.env.IIKO_ORG_ID
    }, { headers: { Authorization: `Bearer ${token}` } });

    // Логируем ВСЮ информацию
    console.log('[DEBUG] ===== GROUPS =====');
    (nomResp.data.groups || []).forEach((g, i) => {
      console.log(`[${i}] id: ${g.id} | name: ${g.name} | parent: ${g.parentGroup}`);
    });

    console.log('[DEBUG] ===== PRODUCT CATEGORIES =====');
    (nomResp.data.productCategories || []).forEach((pc, i) => {
      console.log(`[${i}] id: ${pc.id} | name: ${pc.name}`);
    });

    console.log('[DEBUG] ===== ALL PRODUCTS =====');
    const allProds = nomResp.data.products || [];
    console.log(`Total: ${allProds.length}`);
    
    allProds.forEach((p, i) => {
      const categoryId = p.parentGroup ? p.parentGroup : 'NO_CATEGORY';
      console.log(`[${i}] "${p.name}" | category: ${categoryId} | deleted: ${p.isDeleted}`);
    });

    res.json({
      groupsCount: (nomResp.data.groups || []).length,
      categoriesCount: (nomResp.data.productCategories || []).length,
      productsCount: allProds.length,
      products: allProds.map(p => ({
        id: p.id,
        name: p.name,
        parentGroup: p.parentGroup,
        isDeleted: p.isDeleted
      }))
    });

  } catch (e) {
    res.json({ error: e.message });
  }
});

// ===== START SERVER =====
async function start() {
  await db.read();
  
  const menuLoaded = await fetchIikoMenu();
  if (!menuLoaded) {
    db.data.menu = FALLBACK;
    await db.write();
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
