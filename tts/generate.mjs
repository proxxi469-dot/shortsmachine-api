// ElevenLabs toplu seslendirme (GitHub Actions içinde çalışır).
//
// tts/requests/<isim>.json:
// {
//   "voice_id": "varsayılan ses id",
//   "model_id": "eleven_multilingual_v2",
//   "voice_settings": { "stability": 0.4, "similarity_boost": 0.8, "style": 0.3 },
//   "items": [
//     { "id": "yorum1", "text": "Okunacak metin", "voice_id": "(isteğe bağlı) bu satıra özel ses" }
//   ]
// }
// Çıktı: tts/out/<isim>/<id>.mp3 (+ aynı ayarlarla tekrar üretmemek için <id>.json)
// Ayrıca hesaptaki sesler tts/out/voices.json dosyasına yazılır.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("ELEVENLABS_API_KEY secret'ı tanımlı değil (Settings → Secrets and variables → Actions).");
  process.exit(1);
}
const API = "https://api.elevenlabs.io/v1";
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const REQ_DIR = path.join(ROOT, "requests");
const OUT_DIR = path.join(ROOT, "out");
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL = "eleven_multilingual_v2";

async function api(p, init = {}) {
  const res = await fetch(API + p, { ...init, headers: { "xi-api-key": KEY, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${p} → HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res;
}

async function listVoices() {
  const data = await (await api("/voices")).json();
  const voices = (data.voices || []).map((v) => ({
    voice_id: v.voice_id, name: v.name, category: v.category, labels: v.labels,
  }));
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "voices.json"), JSON.stringify(voices, null, 2) + "\n");
  console.log(`voices.json: ${voices.length} ses`);
}

async function main() {
  try {
    await listVoices();
  } catch (e) {
    // Kısıtlı anahtarlarda voices_read izni olmayabilir; seslendirmeye engel değil
    console.warn(`Ses listesi alınamadı (atlandı): ${e.message}`);
  }
  if (!existsSync(REQ_DIR)) return;
  let made = 0, skipped = 0, failed = 0;
  for (const file of (await readdir(REQ_DIR)).filter((f) => f.endsWith(".json"))) {
    const name = file.replace(/\.json$/, "");
    const req = JSON.parse(await readFile(path.join(REQ_DIR, file), "utf8"));
    const dir = path.join(OUT_DIR, name);
    await mkdir(dir, { recursive: true });
    for (const item of req.items || []) {
      const body = {
        text: item.text,
        model_id: item.model_id || req.model_id || DEFAULT_MODEL,
        voice_settings: { ...(req.voice_settings || {}), ...(item.voice_settings || {}) },
      };
      const voice = item.voice_id || req.voice_id || DEFAULT_VOICE;
      const hash = createHash("sha256").update(JSON.stringify({ voice, body })).digest("hex").slice(0, 16);
      const mp3 = path.join(dir, `${item.id}.mp3`);
      const meta = path.join(dir, `${item.id}.json`);
      if (existsSync(mp3) && existsSync(meta) && JSON.parse(await readFile(meta, "utf8")).hash === hash) {
        skipped++; continue;   // aynı metin + ayar zaten üretilmiş: kredi harcama
      }
      try {
        const res = await api(`/text-to-speech/${voice}?output_format=mp3_44100_128`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify(body),
        });
        await writeFile(mp3, Buffer.from(await res.arrayBuffer()));
        await writeFile(meta, JSON.stringify({ hash, voice_id: voice, ...body }, null, 2) + "\n");
        console.log(`✓ ${name}/${item.id}`); made++;
      } catch (e) {
        console.error(`✗ ${name}/${item.id}: ${e.message}`); failed++;
      }
    }
  }
  console.log(`Üretilen: ${made}, atlanan: ${skipped}, hatalı: ${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
