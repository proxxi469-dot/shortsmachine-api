# ElevenLabs seslendirme (GitHub Actions)

1. Bir kere: GitHub → Settings → Secrets and variables → Actions → **New repository secret**
   - Name: `ELEVENLABS_API_KEY`
   - Secret: ElevenLabs API anahtarın
2. `tts/requests/<isim>.json` dosyası ekle/değiştir ve push'la (örnek: `generate.mjs` başındaki açıklama).
3. **ElevenLabs TTS** workflow'u çalışır; sesler `tts/out/<isim>/<id>.mp3` olarak aynı dala commit'lenir.
   Hesaptaki seslerin listesi `tts/out/voices.json` dosyasına yazılır.

Aynı metin ve ayarlarla tekrar istenen satırlar yeniden üretilmez (kredi harcanmaz).
