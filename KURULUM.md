# 🚀 ShortsMachine Server Kurulumu (Adım Adım)

Bu server, API key'lerini **senin sunucunda gizli tutar** — kullanıcılar key girmeden uygulamayı kullanır.

## Ne İşe Yarar?
- Kullanıcı OpenAI/Pexels/Groq key'i GİRMEZ
- Server senin key'lerinle işi yapar (ses, video, AI script)
- Key'ler güvende (kullanıcı göremez)

---

## 🛤️ KURULUM: Railway (en kolay, önerilen)

### ADIM 1: GitHub'a Yükle
Server kodunu GitHub'a koymalısın (Railway oradan çeker):
1. github.com → yeni repo oluştur (örn. "shortsmachine-api")
2. Bu klasördeki dosyaları yükle (server.js, package.json, .env.example, .gitignore)
3. ⚠️ `.env` dosyasını ASLA yükleme (sadece .env.example)

### ADIM 2: Railway'e Bağla
1. railway.app → "Start a New Project"
2. "Deploy from GitHub repo" → repo'nu seç
3. Railway otomatik kurar (npm install + start)

### ADIM 3: Key'leri Ekle (EN ÖNEMLİ)
Railway'de projende → "Variables" sekmesi → şunları ekle:
- `OPENAI_API_KEY` = senin OpenAI key'in (sk-...)
- `PEXELS_API_KEY` = senin Pexels key'in
- `GROQ_API_KEY` = senin Groq key'in
- `ALLOWED_ORIGINS` = https://shortmachne.netlify.app

### ADIM 4: URL'i Al
Railway sana bir URL verir (örn. shortsmachine-api.up.railway.app)
Bunu kopyala → siteye eklenecek.

---

## 🛤️ ALTERNATİF: Render (de ücretsiz)

1. render.com → "New Web Service"
2. GitHub repo'nu bağla
3. Build: `npm install` · Start: `npm start`
4. Environment → key'leri ekle (yukarıdaki gibi)
5. URL'i al

---

## 🧪 TEST ET

Server kurulunca, tarayıcıda şunu aç:
```
https://SENIN-URL/api/health
```
Şunu görmelisin:
```json
{"status":"ok","services":{"tts":true,"pexels":true,"groq":true}}
```
Hepsi `true` ise key'ler doğru girilmiş demektir!

---

## 🔌 SİTEYE BAĞLAMA

Server URL'ini aldıktan sonra Claude'a ver. Site kodunda
`SERVER_URL` ayarlanacak — uygulama key yerine senin server'ını kullanacak.

---

## 💰 MALİYET
- Railway: ilk $5 ücretsiz kredi, sonra ~$5/ay
- Render: ücretsiz katman (uyur, ilk istek yavaş) veya $7/ay
- API kullanımı: kullanıcı sayısına göre (senin OpenAI/Pexels hesabından)

## 🔒 GÜVENLİK
- Key'ler sadece environment variables'da (kodda değil)
- CORS sadece senin siteni kabul eder
- Rate limit: IP başına dakikada sınır (kötüye kullanım önleme)
- .env dosyasını ASLA git'e koyma
