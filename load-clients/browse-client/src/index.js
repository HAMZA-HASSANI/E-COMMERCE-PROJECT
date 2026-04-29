const axios = require('axios');

const BASE_URL = process.env.API_BASE_URL || 'http://api-gateway:3000';
const NAME = process.env.CLIENT_NAME || 'browse-client';
const MIN_INTERVAL_MS = parseInt(process.env.MIN_INTERVAL_MS || '500', 10);
const MAX_INTERVAL_MS = parseInt(process.env.MAX_INTERVAL_MS || '2000', 10);

// Pool of "popular" product IDs hit repeatedly to boost cache-hit ratio
const HOT_IDS = [1, 2, 3, 4, 5, 6, 7, 8];

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 8000,
  validateStatus: () => true,
  headers: { 'User-Agent': `${NAME}/1.0` }
});

const stats = { ok: 0, errors: 0, lastReport: Date.now() };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Anonymous-only scenarios. Mostly hot product reads (drives cache hits),
// some cold reads (drives cache misses), and occasional public auth attempts.
const SCENARIOS = [
  { name: 'list_products',       weight: 30, run: () => http.get('/api/products') },
  { name: 'product_detail_hot',  weight: 30, run: () => http.get(`/api/products/${pick(HOT_IDS)}`) },
  { name: 'product_detail_cold', weight: 10, run: () => http.get(`/api/products/${50 + Math.floor(Math.random() * 200)}`) },
  { name: 'product_detail_404',  weight: 5,  run: () => http.get(`/api/products/${999000 + Math.floor(Math.random() * 1000)}`) },
  { name: 'health_probe',        weight: 5,  run: () => http.get('/health') },
  { name: 'api_root',            weight: 3,  run: () => http.get('/api') },
  { name: 'failed_login',        weight: 10, run: () => http.post('/api/users/login', { email: `ghost_${Date.now()}@x.test`, password: 'nope' }) },
  { name: 'guest_register',      weight: 5,  run: () => http.post('/api/users/register', {
      email: `guest_${Math.random().toString(36).slice(2,10)}@example.test`,
      password: 'Password123!',
      name: 'Guest Browser'
    })
  },
  { name: 'invalid_payload',     weight: 2,  run: () => http.post('/api/users/login', { email: 'not-an-email' }) }
];

const totalWeight = SCENARIOS.reduce((s, x) => s + x.weight, 0);
function pickScenario() {
  let r = Math.random() * totalWeight;
  for (const s of SCENARIOS) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return SCENARIOS[0];
}

function reportStatsIfNeeded() {
  const now = Date.now();
  if (now - stats.lastReport >= 30000) {
    const total = stats.ok + stats.errors;
    const errPct = total ? ((stats.errors / total) * 100).toFixed(1) : '0.0';
    console.log(`[${NAME}] last 30s — total=${total} ok=${stats.ok} errors=${stats.errors} (${errPct}%)`);
    stats.ok = 0; stats.errors = 0; stats.lastReport = now;
  }
}

async function loop() {
  console.log(`[${NAME}] starting against ${BASE_URL} (interval ${MIN_INTERVAL_MS}-${MAX_INTERVAL_MS}ms)`);
  for (;;) {
    const scenario = pickScenario();
    try {
      const res = await scenario.run();
      if (res.status >= 200 && res.status < 400) stats.ok++;
      else stats.errors++;
    } catch (err) {
      stats.errors++;
    }
    reportStatsIfNeeded();
    await sleep(jitter());
  }
}

process.on('SIGTERM', () => { console.log(`[${NAME}] SIGTERM`); process.exit(0); });
process.on('SIGINT',  () => { console.log(`[${NAME}] SIGINT`);  process.exit(0); });
loop().catch((err) => { console.error(`[${NAME}] fatal:`, err); process.exit(1); });
