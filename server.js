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
app.use(express.json({ limit: '1mb' }));

// --- CORS: only allow your site to call this server ---
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://shortmachne.netlify.app,http://localhost:3000,http://localhost:8888')
  .split(',').map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (mobile apps, curl) and allowed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  }
}));

// --- Simple in-memory rate limiter (per IP) ---
const rateMap = new Map();
function rateLimit(maxPerMin) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - 60000;
    const hits = (rateMap.get(ip) || []).filter(t => t > windowStart);
    if (hits.length >= maxPerMin) {
      return res.status(429).json({ error: 'Too many requests, slow down a bit.' });
    }
    hits.push(now);
    rateMap.set(ip, hits);
    next();
  };
}

// ============================================================
// 1) OpenAI TTS  — POST /api/tts  { text, voice }
// ============================================================
app.post('/api/tts', rateLimit(20), async (req, res) => {
  const { text, voice = 'onyx' } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing text' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server TTS not configured' });
  }
  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice,
        input: text.substring(0, 4000),
        response_format: 'mp3',
      }),
    });
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
  const q = (req.query.q || '').toString().substring(0, 100);
  const perPage = Math.min(parseInt(req.query.per_page) || 4, 10);
  if (!q) return res.status(400).json({ error: 'Missing q' });
  if (!process.env.PEXELS_API_KEY) {
    return res.status(500).json({ error: 'Server Pexels not configured' });
  }
  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${perPage}&orientation=portrait`;
    const r = await fetch(url, { headers: { 'Authorization': process.env.PEXELS_API_KEY } });
    if (!r.ok) {
      return res.status(502).json({ error: 'Pexels provider error', status: r.status });
    }
    const data = await r.json();
    // Return only what the client needs (trim payload)
    const videos = (data.videos || []).map(v => ({
      id: v.id,
      duration: v.duration,
      files: (v.video_files || [])
        .filter(f => f.quality === 'sd' || f.quality === 'hd')
        .map(f => ({ link: f.link, width: f.width, height: f.height, quality: f.quality })),
    }));
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
// Health check
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    services: {
      tts: !!process.env.OPENAI_API_KEY,
      pexels: !!process.env.PEXELS_API_KEY,
      groq: !!process.env.GROQ_API_KEY,
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
