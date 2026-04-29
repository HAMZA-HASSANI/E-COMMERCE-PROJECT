const axios = require('axios');

const BASE_URL = process.env.API_BASE_URL || 'http://api-gateway:3000';
const NAME = process.env.CLIENT_NAME || 'shopper-client';
const MIN_CYCLE_MS = parseInt(process.env.MIN_CYCLE_MS || '4000', 10);
const MAX_CYCLE_MS = parseInt(process.env.MAX_CYCLE_MS || '10000', 10);
const PASSWORD = process.env.SHOPPER_PASSWORD || 'Password123!';
const RELOGIN_PROB = parseFloat(process.env.RELOGIN_PROB || '0.05'); // 5% chance to reauth each cycle

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 8000,
  validateStatus: () => true,
  headers: { 'User-Agent': `${NAME}/1.0` }
});

const stats = { cycles: 0, ok: 0, errors: 0, lastReport: Date.now() };
let token = null;
let identity = null;
let userId = null;
let myOrders = []; // remembered order ids for GET /:id and PUT /:id

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => MIN_CYCLE_MS + Math.random() * (MAX_CYCLE_MS - MIN_CYCLE_MS);
const randomEmail = () => `shopper_${Math.random().toString(36).slice(2, 10)}@example.test`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const recordResp = (res) => {
  if (res.status >= 200 && res.status < 300) stats.ok++;
  else stats.errors++;
  return res;
};

async function ensureAuthenticated(force = false) {
  if (!force && token && userId) return true;

  if (force) {
    token = null;
    userId = null;
    delete http.defaults.headers.common.Authorization;
  }

  identity = identity || { email: randomEmail(), password: PASSWORD, name: 'Load Tester' };

  const reg = recordResp(await http.post('/api/users/register', identity));
  if (reg.status !== 201 && reg.status !== 200 && reg.status !== 409) {
    console.warn(`[${NAME}] register -> ${reg.status} ${JSON.stringify(reg.data)}`);
  }

  const login = recordResp(await http.post('/api/users/login', { email: identity.email, password: identity.password }));
  if (login.status === 200 && login.data && login.data.token && login.data.user) {
    token = login.data.token;
    userId = login.data.user.id;
    http.defaults.headers.common.Authorization = `Bearer ${token}`;
    return true;
  }
  console.warn(`[${NAME}] login -> ${login.status} ${JSON.stringify(login.data)}`);
  identity = null;
  return false;
}

// 1. Browse — always
async function browse() {
  const list = recordResp(await http.get('/api/products'));
  if (list.status !== 200) return null;
  const products = Array.isArray(list.data) ? list.data : list.data.products || list.data.items || [];

  const views = 1 + Math.floor(Math.random() * 4);
  for (let i = 0; i < views; i++) {
    const p = pick(products);
    if (p && (p.id || p._id)) {
      recordResp(await http.get(`/api/products/${p.id || p._id}`));
      await sleep(150 + Math.random() * 400);
    }
  }
  return products;
}

// 2. Profile — random GET / PUT on own user
async function viewOrUpdateProfile() {
  const r = Math.random();
  if (r < 0.6) {
    recordResp(await http.get(`/api/users/${userId}`));
  } else if (r < 0.85) {
    recordResp(await http.put(`/api/users/${userId}`, { name: `Load Tester ${Math.floor(Math.random()*1000)}` }));
  } else {
    // Listing all users — may be 200 or 403 depending on policy
    recordResp(await http.get('/api/users/'));
  }
}

// 3. Place an order (~50%)
async function placeOrder(products) {
  if (!products || products.length === 0) return;
  const chosen = products.slice().sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3));
  const payload = {
    userId,
    items: chosen.map((p) => ({ productId: p.id || p._id, quantity: 1 + Math.floor(Math.random() * 3) }))
  };
  const order = recordResp(await http.post('/api/orders', payload));
  if (order.status >= 200 && order.status < 300 && order.data && (order.data.id || order.data.orderId)) {
    const oid = order.data.id || order.data.orderId;
    myOrders.push(oid);
    if (myOrders.length > 20) myOrders.shift();
  } else if (order.status === 401) {
    token = null;
    userId = null;
    delete http.defaults.headers.common.Authorization;
  }
}

// 4. Order management — GET list / GET detail / PUT status
async function manageOrders() {
  const r = Math.random();
  if (r < 0.5) {
    recordResp(await http.get('/api/orders'));
  } else if (r < 0.75) {
    recordResp(await http.get(`/api/orders/user/${userId}`));
  } else if (myOrders.length > 0) {
    const oid = pick(myOrders);
    if (Math.random() < 0.6) {
      recordResp(await http.get(`/api/orders/${oid}`));
    } else {
      const status = pick(['shipped', 'delivered', 'cancelled']);
      recordResp(await http.put(`/api/orders/${oid}`, { status }));
    }
  }
}

async function cycle() {
  if (Math.random() < RELOGIN_PROB) {
    await ensureAuthenticated(true); // force re-login (drives login counters)
  } else if (!(await ensureAuthenticated())) {
    return;
  }

  const products = await browse();
  if (Math.random() < 0.4) await viewOrUpdateProfile();
  if (Math.random() < 0.5) await placeOrder(products);
  if (Math.random() < 0.5) await manageOrders();
  stats.cycles++;
}

function reportStatsIfNeeded() {
  const now = Date.now();
  if (now - stats.lastReport >= 30000) {
    const total = stats.ok + stats.errors;
    const errPct = total ? ((stats.errors / total) * 100).toFixed(1) : '0.0';
    console.log(`[${NAME}] last 30s — cycles=${stats.cycles} requests=${total} ok=${stats.ok} errors=${stats.errors} (${errPct}%)`);
    stats.cycles = 0; stats.ok = 0; stats.errors = 0; stats.lastReport = now;
  }
}

async function loop() {
  console.log(`[${NAME}] starting against ${BASE_URL} (cycle ${MIN_CYCLE_MS}-${MAX_CYCLE_MS}ms)`);
  for (;;) {
    try {
      await cycle();
    } catch (err) {
      stats.errors++;
      console.error(`[${NAME}] cycle failed: ${err.code || err.message}`);
    }
    reportStatsIfNeeded();
    await sleep(jitter());
  }
}

process.on('SIGTERM', () => { console.log(`[${NAME}] SIGTERM`); process.exit(0); });
process.on('SIGINT',  () => { console.log(`[${NAME}] SIGINT`);  process.exit(0); });
loop().catch((err) => { console.error(`[${NAME}] fatal:`, err); process.exit(1); });
