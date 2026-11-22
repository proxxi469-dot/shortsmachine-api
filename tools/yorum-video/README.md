# Yorum videosu oluşturucu

Video belirli anlarda donar, yorum görseli ekranın bir köşesinde "pop" ile belirir, ses okunur, video devam eder.
Sesler profesyonelce işlenir (gürültü azaltma, EQ, de-esser, kompresör, -14 LUFS) ve
donma "tık", kart "pop" ve çıkış "whoosh" efektleri görüntüyle senkron eklenir.

Gerekenler: `ffmpeg`, Python 3 + Pillow.

```bash
python3 yorum_video.py plan.json
```

```json
{
  "video": "in/video.mp4",
  "output": "out/sonuc.mp4",
  "card_scale": 0.66,
  "comments": [
    {"at": 1.5, "pos": "sag_ust", "image": "in/yorum1.png", "audio": "in/ses1.m4a"},
    {"at": 3.5, "pos": "sol_alt", "image": "in/yorum2.png", "audio": "in/ses2.mp3"}
  ]
}
```

`pos`: `sag_ust`, `sol_ust`, `sag_alt`, `sol_alt`, `sag_orta`, `sol_orta`, `orta`.
İsteğe bağlı: `sfx_volume` (0.55), `video_lufs` (-18), `voice_fx` (true), `dim` (false).
`audio` verilmezse `text` + `"tts": "elevenlabs"` ile doğrudan API'den seslendirir
(ağ izni gerekir; yoksa sesleri `tts/` workflow'u ile üret).
