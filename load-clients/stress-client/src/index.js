const axios = require('axios');

const BASE_URL = process.env.API_BASE_URL || 'http://api-gateway:3000';
const NAME = process.env.CLIENT_NAME || 'stress-client';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5', 10);
const REQUESTS_PER_BURST = parseInt(process.env.REQUESTS_PER_BURST || '20', 10);
const BURST_INTERVAL_MS = parseInt(process.env.BURST_INTERVAL_MS || '1000', 10);
const ERROR_RATIO = Math.min(1, Math.max(0, parseFloat(process.env.ERROR_RATIO || '0.15')));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Password123!';

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 6000,
  validateStatus: () => true,
  headers: { 'User-Agent': `${NAME}/1.0` }
});

const stats = {
  total: 0, ok: 0, http4xx: 0, http5xx: 0, http429: 0, network: 0,
  lastReport: Date.now()
};

let adminToken = null;
let adminUserId = null;
const createdProductIds = []; // track our own products for PUT/DELETE

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomEmail = () => `admin_${Math.random().toString(36).slice(2,10)}@stress.test`;
const randomProductName = () => {
  const adjectives = ['Quantum', 'Hyper', 'Ultra', 'Smart', 'Eco', 'Pro', 'Mini'];
  const nouns = ['Widget', 'Gadget', 'Sensor', 'Drone', 'Lamp', 'Speaker', 'Cable'];
  return `${pick(adjectives)} ${pick(nouns)} ${Math.floor(Math.random() * 9999)}`;
};

async function ensureAdminAuth() {
  if (adminToken && adminUserId) return true;
  const identity = { email: randomEmail(), password: ADMIN_PASSWORD, name: 'Stress Admin' };
  await http.post('/api/users/register', identity); // 201 or 409 — we don't care
  const login = await http.post('/api/users/login', { email: identity.email, password: identity.password });
  if (login.status === 200 && login.data && login.data.token) {
    adminToken = login.data.token;
    adminUserId = login.data.user.id;
    return true;
  }
  return false;
}

function authedHttp() {
  if (!adminToken) return null;
  return axios.create({
    baseURL: BASE_URL,
    timeout: 6000,
    validateStatus: () => true,
    headers: {
      'User-Agent': `${NAME}/1.0`,
      'Authorization': `Bearer ${adminToken}`
    }
  });
}

// ─── HAPPY PATH (covers GET/POST/PUT/DELETE on the full API surface) ────────────
function pickHappyRequest() {
  const choices = [
    // Public reads
    () => http.get('/api/products'),
    () => http.get(`/api/products/${1 + Math.floor(Math.random() * 20)}`),
    () => http.get('/health'),
    () => http.get('/api'),
    // Authenticated reads
    async () => { const a = authedHttp(); return a ? a.get('/api/orders') : http.get('/api/products'); },
    async () => { const a = authedHttp(); return a && adminUserId ? a.get(`/api/users/${adminUserId}`) : http.get('/api/products'); },
    async () => { const a = authedHttp(); return a && adminUserId ? a.get(`/api/orders/user/${adminUserId}`) : http.get('/api/products'); },
    // Authenticated writes — products CRUD
    async () => {
      const a = authedHttp(); if (!a) return http.get('/api/products');
      const res = await a.post('/api/products', {
        name: randomProductName(),
        description: 'Stress-test product',
        price: +(10 + Math.random() * 900).toFixed(2),
        stock: 10 + Math.floor(Math.random() * 500),
        category: pick(['electronics', 'books', 'home', 'sports'])
      });
      const id = res.data && (res.data.id || res.data._id);
      if (id) {
        createdProductIds.push(id);
        if (createdProductIds.length > 30) createdProductIds.shift();
      }
      return res;
    },
    async () => {
      const a = authedHttp(); if (!a || createdProductIds.length === 0) return http.get('/api/products');
      const id = pick(createdProductIds);
      return a.put(`/api/products/${id}`, {
        price: +(5 + Math.random() * 1500).toFixed(2),
        stock: Math.floor(Math.random() * 1000)
      });
    },
    async () => {
      const a = authedHttp(); if (!a || createdProductIds.length < 5) return http.get('/api/products');
      const id = createdProductIds.shift();
      return a.delete(`/api/products/${id}`);
    },
    // Profile update
    async () => {
      const a = authedHttp(); if (!a || !adminUserId) return http.get('/api/products');
      return a.put(`/api/users/${adminUserId}`, { name: `Stress Admin ${Math.floor(Math.random()*999)}` });
    },
    // Create + manage orders
    async () => {
      const a = authedHttp(); if (!a || !adminUserId) return http.get('/api/products');
      return a.post('/api/orders', {
        userId: adminUserId,
        items: [{ productId: 1 + Math.floor(Math.random() * 20), quantity: 1 + Math.floor(Math.random() * 3) }]
      });
    }
  ];
  return pick(choices)();
}

// ─── BAD REQUESTS — drive 4xx, 401, 404 metrics ────────────────────────────────
function pickBadRequest() {
  const choices = [
    () => http.post('/api/orders', { items: [{ productId: 1, quantity: 1 }] }),                      // 401: protected w/o token
    () => http.get('/api/orders', { headers: { Authorization: 'Bearer not-a-real-token' } }),         // 401: bad token (auth_failures++)
    () => http.post('/api/users/login', { email: 'nope' }),                                           // 400: malformed
    () => http.get(`/api/products/does-not-exist-${Date.now()}`),                                     // 404
    () => http.post('/api/users/login', { email: `ghost_${Date.now()}@test.local`, password: 'wrong' }), // 401: bad creds
    () => http.put('/api/products/999999', { price: 10 }, { headers: { Authorization: 'Bearer fake' } }), // 401
    () => http.delete('/api/products/999999', { headers: { Authorization: 'Bearer fake' } }),         // 401
    () => http.post('/api/orders', { userId: 999999999, items: [{ productId: 1, quantity: 1 }] },
            { headers: { Authorization: `Bearer ${adminToken || 'x'}` } })                            // 404 user not found
  ];
  return pick(choices)();
}

function classify(status) {
  if (status === 429) { stats.http429++; return; }
  if (status >= 500)  { stats.http5xx++; return; }
  if (status >= 400)  { stats.http4xx++; return; }
  stats.ok++;
}

async function fireOne() {
  stats.total++;
  try {
    const res = Math.random() < ERROR_RATIO ? await pickBadRequest() : await pickHappyRequest();
    classify(res.status);
  } catch (err) {
    stats.network++;
  }
}

async function burst() {
  let inFlight = 0;
  let launched = 0;
  return new Promise((resolve) => {
    const tick = () => {
      while (inFlight < CONCURRENCY && launched < REQUESTS_PER_BURST) {
        inFlight++; launched++;
        fireOne().finally(() => {
          inFlight--;
          if (launched >= REQUESTS_PER_BURST && inFlight === 0) resolve();
          else tick();
        });
      }
    };
    tick();
  });
}

function reportStatsIfNeeded() {
  const now = Date.now();
  if (now - stats.lastReport >= 30000) {
    const errs = stats.http4xx + stats.http5xx + stats.http429 + stats.network;
    const errPct = stats.total ? ((errs / stats.total) * 100).toFixed(1) : '0.0';
    console.log(
      `[${NAME}] last 30s — total=${stats.total} ok=${stats.ok} 4xx=${stats.http4xx} 429=${stats.http429} 5xx=${stats.http5xx} net=${stats.network} (${errPct}% err)`
    );
    stats.total = stats.ok = stats.http4xx = stats.http5xx = stats.http429 = stats.network = 0;
    stats.lastReport = now;
  }
}

async function loop() {
  console.log(
    `[${NAME}] starting against ${BASE_URL} — ${REQUESTS_PER_BURST} req/burst, concurrency=${CONCURRENCY}, ` +
    `interval=${BURST_INTERVAL_MS}ms, error_ratio=${ERROR_RATIO}`
  );
  await ensureAdminAuth();
  console.log(`[${NAME}] admin auth ${adminToken ? 'OK (userId=' + adminUserId + ')' : 'FAILED — proceeding anyway'}`);

  let cyclesSinceAuthCheck = 0;
  for (;;) {
    await burst();
    reportStatsIfNeeded();
    // periodically refresh admin auth
    if (++cyclesSinceAuthCheck > 60) {
      cyclesSinceAuthCheck = 0;
      adminToken = null; adminUserId = null;
      await ensureAdminAuth();
    }
    await sleep(BURST_INTERVAL_MS);
  }
}

process.on('SIGTERM', () => { console.log(`[${NAME}] SIGTERM`); process.exit(0); });
process.on('SIGINT',  () => { console.log(`[${NAME}] SIGINT`);  process.exit(0); });
loop().catch((err) => { console.error(`[${NAME}] fatal:`, err); process.exit(1); });
