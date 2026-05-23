// ============================================================
// ShortsMachine — Simple Key-Proxy Backend
// ============================================================
// PURPOSE: Keep YOUR API keys safe on the server so users never
// need to enter their own. Users just use the app; the server
// calls OpenAI / Pexels / Groq with YOUR keys.
//
// ENDPOINTS:
//   POST /api/tts        — OpenAI text-to-speech (returns mp3)
//   GET  /api/pexels     — Search Pexels videos
//   POST /api/groq       — Groq chat completion (AI script writing)
//   GET  /api/health     — Health check
//
// SECURITY:
//   - Keys live ONLY in environment variables (never in code/client)
//   - CORS locked to your site domain
//   - Simple rate limiting per IP to prevent abuse
//
// DEPLOY: Railway / Render / any Node host. See KURULUM.md.
// ============================================================

const express = require('express');
const cors = require('cors');

const app = express();
app.disable('x-powered-by'); // don't reveal Express
app.set('trust proxy', 1);   // correct client IP behind Railway proxy
app.use(express.json({ limit: '64kb' })); // tight body limit — these endpoints need little

// --- SECURITY HEADERS (basic hardening, no extra deps) ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// --- CORS: only allow your site to call this server ---
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://shortsmachine.net,https://www.shortsmachine.net,https://shortsmachine1.pages.dev,https://shortmachne.netlify.app,http://localhost:3000,http://localhost:8888')
  .split(',').map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (/^https:\/\/([a-z0-9-]+\.)?shortsmachine\.net$/.test(origin)) return cb(null, true);
    if (/^https:\/\/[a-z0-9-]+\.pages\.dev$/.test(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET', 'POST'],
  maxAge: 86400,
}));

// --- Reject oversized/malformed JSON cleanly ---
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request too large' });
  }
  if (err && err.status === 400) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  next(err);
});

// --- Input sanitizer: strip control chars, cap length ---
function cleanText(input, maxLen) {
  if (typeof input !== 'string') return '';
  // remove null bytes and most control chars, collapse to maxLen
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, maxLen);
}

// --- Rate limiter (per IP, sliding window) with global abuse guard ---
const rateMap = new Map();
let globalHits = [];
function rateLimit(maxPerMin) {
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - 60000;
    // per-IP limit
    const hits = (rateMap.get(ip) || []).filter(t => t > windowStart);
    if (hits.length >= maxPerMin) {
      return res.status(429).json({ error: 'Too many requests, slow down a bit.' });
    }
    hits.push(now);
    rateMap.set(ip, hits);
    // global abuse guard: if the whole server is flooded, shed load
    globalHits = globalHits.filter(t => t > windowStart);
    globalHits.push(now);
    if (globalHits.length > 600) { // 600 req/min across all IPs
      return res.status(503).json({ error: 'Server busy, try again shortly.' });
    }
    next();
  };
}

// --- Periodic cleanup so the rate map can't grow unbounded (memory safety) ---
setInterval(() => {
  const windowStart = Date.now() - 60000;
  for (const [ip, arr] of rateMap.entries()) {
    const kept = arr.filter(t => t > windowStart);
    if (kept.length === 0) rateMap.delete(ip);
    else rateMap.set(ip, kept);
  }
}, 120000);

// ============================================================
// 1) OpenAI TTS  — POST /api/tts  { text, voice }
// ============================================================
app.post('/api/tts', rateLimit(20), async (req, res) => {
  const body = req.body || {};
  const text = cleanText(body.text, 4000);
  if (!text) {
    return res.status(400).json({ error: 'Missing text' });
  }
  // Whitelist allowed voices — reject anything else (prevents injection of arbitrary params)
  const ALLOWED_VOICES = ['onyx','ash','echo','ballad','nova','shimmer','coral','sage','fable','alloy','verse'];
  // Voices supported by the older tts-1-hd model (used as a safe fallback)
  const LEGACY_VOICES = ['alloy','echo','fable','onyx','nova','shimmer'];
  let voice = (typeof body.voice === 'string') ? body.voice.toLowerCase() : 'onyx';
  if (!ALLOWED_VOICES.includes(voice)) voice = 'onyx';
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server TTS not configured' });
  }

  // Helper: call OpenAI TTS with a given model + voice
  async function callTTS(model, v) {
    return fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, voice: v, input: text, response_format: 'mp3' }),
    });
  }

  try {
    // Try the new model first (supports all 11 voices)
    let r = await callTTS('gpt-4o-mini-tts', voice);
    // If the new model fails, fall back to tts-1-hd with a legacy-safe voice
    if (!r.ok) {
      const errTxt = await r.text();
      console.warn('[TTS] gpt-4o-mini-tts failed (', r.status, '), falling back to tts-1-hd:', errTxt.substring(0, 120));
      const safeVoice = LEGACY_VOICES.includes(voice) ? voice : 'onyx';
      r = await callTTS('tts-1-hd', safeVoice);
    }
    if (!r.ok) {
      const errTxt = await r.text();
      console.error('[TTS] OpenAI error:', r.status, errTxt.substring(0, 200));
      return res.status(502).json({ error: 'TTS provider error', status: r.status });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.set('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch (e) {
    console.error('[TTS] error:', e.message);
    res.status(500).json({ error: 'TTS failed' });
  }
});

// ============================================================
// 2) Pexels video search  — GET /api/pexels?q=...&per_page=4
// ============================================================
app.get('/api/pexels', rateLimit(40), async (req, res) => {
  // Sanitize query: letters/numbers/spaces only, capped — prevents URL/param injection
  let q = cleanText((req.query.q || '').toString(), 80).replace(/[^\w\s\-]/g, ' ').trim();
  const perPage = Math.min(Math.max(parseInt(req.query.per_page) || 4, 1), 10);
  if (!q) return res.status(400).json({ error: 'Missing q' });
  if (!process.env.PEXELS_API_KEY) {
    return res.status(500).json({ error: 'Server Pexels not configured' });
  }
  try {
    // MULTI-SOURCE + RELEVANCE RANKING
    // Fetch a larger candidate pool from Pexels (+Pixabay if configured),
    // score each clip by how well its metadata matches the query keywords,
    // and return the most relevant ones. Response shape is unchanged.
    const want = perPage;
    const pool = Math.min(Math.max(want * 3, 15), 30);
    const tokens = q.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const scoreText = (txt) => {
      const s = (txt || '').toLowerCase();
      let sc = 0;
      for (const t of tokens) { if (s.includes(t)) sc++; }
      return sc;
    };
    const candidates = [];

    // --- Source 1: Pexels ---
    try {
      const pr = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${pool}`, { headers: { 'Authorization': process.env.PEXELS_API_KEY } });
      if (pr.ok) {
        const pd = await pr.json();
        for (const v of (pd.videos || [])) {
          const files = (v.video_files || []).map(f => ({ link: f.link, width: f.width, height: f.height, quality: f.quality }));
          if (!files.length) continue;
          const slug = (v.url || '').replace(/https?:\/\/[^/]+\/video\//, '').replace(/[-\/]/g, ' ');
          candidates.push({ id: v.id, duration: v.duration, files, _rel: scoreText(slug), _src: 'pexels' });
        }
      }
    } catch (e) { console.error('[Pexels] source error:', e.message); }

    // --- Source 2: Pixabay (only if PIXABAY_API_KEY is set) ---
    if (process.env.PIXABAY_API_KEY) {
      try {
        const xr = await fetch(`https://pixabay.com/api/videos/?key=${process.env.PIXABAY_API_KEY}&q=${encodeURIComponent(q)}&per_page=${pool}&safesearch=true`);
        if (xr.ok) {
          const xd = await xr.json();
          for (const h of (xd.hits || [])) {
            const vids = h.videos || {};
            const files = ['large', 'medium', 'small', 'tiny']
              .filter(k => vids[k] && vids[k].url)
              .map(k => ({ link: vids[k].url, width: vids[k].width, height: vids[k].height, quality: k }));
            if (!files.length) continue;
            candidates.push({ id: 'px_' + h.id, duration: h.duration, files, _rel: scoreText(h.tags), _src: 'pixabay' });
          }
        }
      } catch (e) { console.error('[Pixabay] source error:', e.message); }
    }

    if (!candidates.length) return res.status(502).json({ error: 'No footage found' });

    // Rank: relevance score desc, then prefer clips that have a portrait file
    const hasPortrait = (c) => c.files.some(f => (f.height || 0) >= (f.width || 0)) ? 1 : 0;
    candidates.sort((a, b) => (b._rel - a._rel) || (hasPortrait(b) - hasPortrait(a)));

    const videos = candidates.slice(0, want).map(c => ({ id: c.id, duration: c.duration, files: c.files }));
    res.json({ videos });
  } catch (e) {
    console.error('[Pexels] error:', e.message);
    res.status(500).json({ error: 'Pexels failed' });
  }
});

// ============================================================
// 3) Groq chat  — POST /api/groq  { prompt, system, max_tokens }
// ============================================================
app.post('/api/groq', rateLimit(30), async (req, res) => {
  const { prompt, system = 'You are a helpful assistant.', max_tokens = 500, temperature = 0.7 } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: 'Server Groq not configured' });
  }
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        temperature,
        max_tokens,
      }),
    });
    if (!r.ok) {
      const errTxt = await r.text();
      console.error('[Groq] error:', r.status, errTxt.substring(0, 200));
      return res.status(502).json({ error: 'Groq provider error', status: r.status });
    }
    const data = await r.json();
    res.json({ text: data.choices?.[0]?.message?.content || '' });
  } catch (e) {
    console.error('[Groq] error:', e.message);
    res.status(500).json({ error: 'Groq failed' });
  }
});

// ============================================================
// 4) AI Video (Seedance 2.0 Fast via fal.ai) — async queue
//    POST /api/aivideo  { prompt, duration, aspect_ratio } -> { id, status_url, response_url }
//    GET  /api/aivideo?s=<status_url>&r=<response_url>      -> { status, url? }
// ============================================================
const FAL_MODEL = 'bytedance/seedance-2.0/fast/text-to-video';
const isFalUrl = (u) => typeof u === 'string' && /^https:\/\/queue\.fal\.run\//.test(u);

app.post('/api/aivideo', rateLimit(20), async (req, res) => {
  if (!process.env.FAL_KEY) return res.status(500).json({ error: 'Server FAL not configured' });
  // Per-IP + global daily cap protects the fal balance from abuse (client coins are not trusted)
  const _ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  const _today = new Date().toDateString();
  if (!global.__aiDay || global.__aiDay.date !== _today) global.__aiDay = { date: _today, ips: {}, total: 0 };
  if (global.__aiDay.total >= 60) return res.status(429).json({ error: 'Daily AI limit reached, try again tomorrow' });
  if ((global.__aiDay.ips[_ip] || 0) >= 5) return res.status(429).json({ error: 'Daily AI limit reached for this user' });
  const prompt = cleanText((req.body && req.body.prompt || '').toString(), 600);
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  const duration = String(Math.min(Math.max(parseInt(req.body && req.body.duration) || 5, 4), 10));
  const arIn = (req.body && req.body.aspect_ratio) || '9:16';
  const aspect_ratio = ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9'].includes(arIn) ? arIn : '9:16';
  const resIn = (req.body && req.body.resolution) || '480p';
  const resolution = ['480p', '720p'].includes(resIn) ? resIn : '480p';
  try {
    const r = await fetch('https://queue.fal.run/' + FAL_MODEL, {
      method: 'POST',
      headers: { 'Authorization': 'Key ' + process.env.FAL_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, duration, resolution, aspect_ratio, generate_audio: false }),
    });
    const data = await r.json();
    if (!r.ok || !data.request_id) {
      console.error('[AIVideo] submit:', r.status, JSON.stringify(data).substring(0, 300));
      return res.status(502).json({ error: 'AI video submit failed' });
    }
    global.__aiDay.ips[_ip] = (global.__aiDay.ips[_ip] || 0) + 1; global.__aiDay.total++;
    res.json({ id: data.request_id, status_url: data.status_url, response_url: data.response_url });
  } catch (e) {
    console.error('[AIVideo] error:', e.message);
    res.status(500).json({ error: 'AI video failed' });
  }
});

app.get('/api/aivideo', rateLimit(180), async (req, res) => {
  if (!process.env.FAL_KEY) return res.status(500).json({ error: 'Server FAL not configured' });
  const s = (req.query.s || '').toString();
  const rurl = (req.query.r || '').toString();
  if (!isFalUrl(s)) return res.status(400).json({ error: 'Bad status url' });
  try {
    const sr = await fetch(s, { headers: { 'Authorization': 'Key ' + process.env.FAL_KEY } });
    const sd = await sr.json();
    if (sd.status === 'COMPLETED' && isFalUrl(rurl)) {
      const rr = await fetch(rurl, { headers: { 'Authorization': 'Key ' + process.env.FAL_KEY } });
      const rd = await rr.json();
      const url = (rd && rd.video && rd.video.url) || (rd && rd.videos && rd.videos[0] && rd.videos[0].url) || null;
      return res.json({ status: 'done', url });
    }
    return res.json({ status: sd.status || 'IN_PROGRESS' });
  } catch (e) {
    console.error('[AIVideo] status:', e.message);
    res.status(500).json({ error: 'AI video status failed' });
  }
});

// ============================================================
// 4c) AI Image (Flux schnell via fal.ai) — POST /api/image { prompt, style }
//     Cheap cartoon/illustration frames for animated shorts.
// ============================================================
app.post('/api/image', rateLimit(40), async (req, res) => {
  if (!process.env.FAL_KEY) return res.status(500).json({ error: 'Server FAL not configured' });
  const _ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  const _today = new Date().toDateString();
  if (!global.__imgDay || global.__imgDay.date !== _today) global.__imgDay = { date: _today, ips: {}, total: 0 };
  if (global.__imgDay.total >= 1500) return res.status(429).json({ error: 'Daily image limit reached' });
  if ((global.__imgDay.ips[_ip] || 0) >= 150) return res.status(429).json({ error: 'Daily image limit for this user' });
  const prompt = cleanText((req.body && req.body.prompt || '').toString(), 500);
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  const style = cleanText((req.body && req.body.style || '').toString(), 160);
  const full = (style ? style + ', ' : '') + prompt;
  // Model selection: 'dev' = higher quality (more 3D, detailed), 'schnell' = fast/cheap
  const modelIn = (req.body && req.body.model || 'schnell').toString();
  const MODELS = { schnell: 'fal-ai/flux/schnell', dev: 'fal-ai/flux/dev' };
  const model = MODELS[modelIn] || MODELS.schnell;
  const steps = (modelIn === 'dev') ? 28 : 4;
  const reqBody = { prompt: full, image_size: 'portrait_16_9', num_images: 1, num_inference_steps: steps };
  if (modelIn === 'dev') reqBody.guidance_scale = 3.5;
  const _seed = parseInt(req.body && req.body.seed);
  if (!isNaN(_seed)) reqBody.seed = _seed; // same seed across scenes -> consistent character/style
  try {
    const r = await fetch('https://fal.run/' + model, {
      method: 'POST',
      headers: { 'Authorization': 'Key ' + process.env.FAL_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });
    const d = await r.json();
    const url = d && d.images && d.images[0] && d.images[0].url;
    if (!url) { console.error('[Image]', r.status, JSON.stringify(d).substring(0, 200)); return res.status(502).json({ error: 'image failed' }); }
    global.__imgDay.ips[_ip] = (global.__imgDay.ips[_ip] || 0) + 1; global.__imgDay.total++;
    res.json({ url });
  } catch (e) { console.error('[Image]', e.message); res.status(500).json({ error: 'image failed' }); }
});

// ============================================================
// 5) Coin redeem (Gumroad license key) — POST /api/redeem { code }
//    Verifies the buyer's Gumroad license key and returns the coin amount.
//    Gumroad tracks uses count -> prevents the same code being redeemed twice.
//    NO database/accounts needed.
// ============================================================
// Fill in your real Gumroad PRODUCT IDs (Product -> Settings -> Advanced).
const COIN_PRODUCTS = {
  'qiwsh': 60,    // $5 pack
  'ouftrq': 170,  // $10 pack
};
// --- GIFT CODES: owner-generated codes to send coins to friends (no Gumroad needed) ---
// Manage your own via Railway env var GIFT_CODES = "CODE:coins,CODE:coins".
// If the env var is not set, the starter batch below is used. Single-use (in-memory).
const GIFT_STARTER = {
  'SM-7K2P9Q': 100, 'SM-M4X8RT': 100, 'SM-Q9D3LV': 100, 'SM-Z6B1HN': 100, 'SM-P3W7KC': 100,
  'SM-V8N2GS': 100, 'SM-L5T9XJ': 100, 'SM-D2K6QW': 100, 'SM-R7M4PB': 100, 'SM-H9C3VZ': 100,
  'SM-T4G8LN': 200, 'SM-X2P6KD': 200, 'SM-B5V9QM': 200, 'SM-N8L3WR': 200, 'SM-K6D2HT': 200,
};
// --- Upstash Redis (REST) — persistent gift codes ---
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const redisReady = () => !!(REDIS_URL && REDIS_TOKEN);
async function redis(cmd) {
  if (!redisReady()) return null;
  try {
    const r = await fetch(REDIS_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
    });
    const d = await r.json();
    return d ? d.result : null;
  } catch (e) { console.error('[Redis]', e.message); return null; }
}
function getGiftCodes() {
  const out = {};
  (process.env.GIFT_CODES || '').split(',').forEach(pair => {
    const parts = pair.split(':');
    const c = (parts[0] || '').trim().toUpperCase();
    const n = parseInt(parts[1]);
    if (c && !isNaN(n)) out[c] = n;
  });
  return Object.keys(out).length ? out : GIFT_STARTER;
}
if (!global.__usedGift) global.__usedGift = new Set();
app.post('/api/redeem', rateLimit(15), async (req, res) => {
  const code = cleanText((req.body && req.body.code || '').toString(), 80).trim();
  if (!code) return res.status(400).json({ error: 'Missing code' });
  // 1) GIFT codes first (owner-generated, for sending coins to friends)
  const giftUpper = code.toUpperCase();
  // 1a) Persistent Redis gift codes (atomic single-use via SET NX)
  if (redisReady()) {
    try {
      const rc = await redis(['GET', 'gc:' + giftUpper]);
      if (rc != null) {
        const claimed = await redis(['SET', 'gcu:' + giftUpper, '1', 'NX']);
        if (claimed === null) return res.json({ ok: false, reason: 'already_used' });
        console.log('[Redeem] Redis gift used:', giftUpper, '->', rc);
        return res.json({ ok: true, coins: parseInt(rc) || 0 });
      }
    } catch (e) { /* fall through */ }
  }
  const gifts = getGiftCodes();
  if (gifts[giftUpper] != null) {
    if (global.__usedGift.has(giftUpper)) return res.json({ ok: false, reason: 'already_used' });
    global.__usedGift.add(giftUpper);
    console.log('[Redeem] Gift code used:', giftUpper, '->', gifts[giftUpper]);
    return res.json({ ok: true, coins: gifts[giftUpper] });
  }
  // 2) Gumroad license keys (paid packs)
  const ids = Object.keys(COIN_PRODUCTS);
  if (!ids.length) return res.status(503).json({ ok: false, reason: 'not_configured' });
  for (const pid of ids) {
    try {
      const params = new URLSearchParams({ product_permalink: pid, license_key: code, increment_uses_count: 'true' });
      const r = await fetch('https://api.gumroad.com/v2/licenses/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(),
      });
      const d = await r.json();
      if (d && d.success) {
        const p = d.purchase || {};
        if (p.refunded || p.disputed || p.chargebacked) return res.json({ ok: false, reason: 'refunded' });
        if (d.uses && d.uses > 1) return res.json({ ok: false, reason: 'already_used' });
        return res.json({ ok: true, coins: COIN_PRODUCTS[pid] });
      }
    } catch (e) { /* try next product */ }
  }
  return res.json({ ok: false, reason: 'invalid' });
});

// ============================================================
// 5b) ADMIN: generate / list gift codes (owner only, ADMIN_KEY)
// ============================================================
function adminOk(req) { return process.env.ADMIN_KEY && (req.body && req.body.key) === process.env.ADMIN_KEY; }
app.post('/api/admin/gen', rateLimit(30), async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'forbidden' });
  if (!redisReady()) return res.status(503).json({ error: 'redis_not_configured' });
  const coins = Math.min(Math.max(parseInt(req.body && req.body.coins) || 100, 1), 100000);
  const count = Math.min(Math.max(parseInt(req.body && req.body.count) || 1, 1), 50);
  const codes = [];
  for (let i = 0; i < count; i++) {
    const c = 'SM-' + Math.random().toString(36).slice(2, 7).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
    await redis(['SET', 'gc:' + c, String(coins)]);
    await redis(['SADD', 'gc:all', c]);
    codes.push({ code: c, coins });
  }
  console.log('[Admin] Generated', count, 'codes of', coins, 'coins');
  res.json({ ok: true, codes });
});
app.post('/api/admin/list', rateLimit(30), async (req, res) => {
  if (!adminOk(req)) return res.status(403).json({ error: 'forbidden' });
  if (!redisReady()) return res.status(503).json({ error: 'redis_not_configured' });
  const all = (await redis(['SMEMBERS', 'gc:all'])) || [];
  const out = [];
  for (const c of all) {
    const coins = await redis(['GET', 'gc:' + c]);
    const used = await redis(['GET', 'gcu:' + c]);
    out.push({ code: c, coins: parseInt(coins) || 0, used: used != null });
  }
  out.sort((a, b) => (a.used === b.used ? 0 : (a.used ? 1 : -1)));
  res.json({ ok: true, codes: out });
});

// ============================================================
// 6) Unsplash images — GET /api/images?q=...  (Ken Burns fallback for missing footage)
// ============================================================
app.get('/api/images', rateLimit(40), async (req, res) => {
  if (!process.env.UNSPLASH_KEY) return res.status(500).json({ error: 'Server Unsplash not configured' });
  let q = cleanText((req.query.q || '').toString(), 80).replace(/[^\w\s\-]/g, ' ').trim();
  if (!q) return res.status(400).json({ error: 'Missing q' });
  const perPage = Math.min(Math.max(parseInt(req.query.per_page) || 4, 1), 10);
  try {
    const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${perPage}&orientation=portrait&content_filter=high`;
    const r = await fetch(url, { headers: { 'Authorization': 'Client-ID ' + process.env.UNSPLASH_KEY } });
    if (!r.ok) return res.status(502).json({ error: 'Unsplash error', status: r.status });
    const d = await r.json();
    const images = (d.results || []).map(p => ({
      url: (p.urls && (p.urls.regular || p.urls.full)) || null,
      width: p.width, height: p.height,
    })).filter(x => x.url);
    res.json({ images });
  } catch (e) {
    console.error('[Unsplash] error:', e.message);
    res.status(500).json({ error: 'Unsplash failed' });
  }
});

// ============================================================
// Health check
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    services: {
      tts: !!process.env.OPENAI_API_KEY,
      pexels: !!process.env.PEXELS_API_KEY,
      groq: !!process.env.GROQ_API_KEY,
      seedance: !!process.env.FAL_KEY,
    },
    time: new Date().toISOString(),
  });
});

app.get('/', (req, res) => {
  res.send('ShortsMachine API is running. See /api/health');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 ShortsMachine API on port ${PORT}`);
  console.log(`   Health: /api/health`);
  console.log(`   TTS key: ${process.env.OPENAI_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`   Pexels key: ${process.env.PEXELS_API_KEY ? 'set' : 'MISSING'}`);
  console.log(`   Groq key: ${process.env.GROQ_API_KEY ? 'set' : 'MISSING'}`);
});
