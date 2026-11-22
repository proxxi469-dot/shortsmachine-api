# Turkshitpostt video şablonu

Herhangi bir videoya kanal imzasını giydirir: üstte logo, başta giriş başlığı,
isteğe bağlı altyazılar, altta sarı ilerleme çubuğu, sonda "TAKİP ET" kapanışı.

```bash
npm install          # fontlar (Anton, Bricolage Grotesque)
python3 sablon.py plan.json
```

```json
{
  "video": "girdi.mp4",
  "output": "cikti.mp4",
  "hook": "BUNU GÖRDÜN MÜ?",
  "hook_sub": "sonuna kadar izle",
  "hook_dur": 2.6,
  "outro_title": "TAKİP ET",
  "outro_sub": "↻ tekrar izle, fark ettin mi?",
  "outro_dur": 3.5,
  "subtitles": [{"start": 0.5, "end": 2.0, "text": "Altyazı"}]
}
```

Gerekenler: `ffmpeg`, Python 3, Node + Playwright (Chromium).
