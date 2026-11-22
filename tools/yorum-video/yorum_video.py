#!/usr/bin/env python3
"""
Yorum videosu oluşturucu.

Mantık: video oynar -> yorum anında DURUR (son kare donar, arka plan kararır ve hafif yakınlaşır)
-> "pop" sesiyle yorum görseli zıplayarak gelir -> yorum seslendirilir -> görsel kaybolur -> video devam eder.

Kullanım:  python3 yorum_video.py plan.json
plan.json örneği:
{
  "video": "in/cocuk.mp4",
  "output": "out/sonuc.mp4",
  "tts": "elevenlabs",            # "elevenlabs" veya "espeak" (yerel yedek)
  "voice_id": "JBFqnCBsd6RMkjVDRZzb",
  "comments": [
    {"at": 2.5, "image": "in/yorum1.png", "audio": "in/ses1.mp3", "y": 0.25}
  ]
}
"""
import json, math, os, subprocess, sys, urllib.request
from PIL import Image, ImageEnhance, ImageFilter

FPS = 30
AR, AC = 44100, 2
POP_IN = 0.30      # görselin zıplayarak gelme süresi
LEAD = 0.42        # tık + pop efektleri bitince konuşma başlar
TAIL = 0.45        # konuşma bittikten sonra bekleme
FADE_OUT = 0.22    # kart kaybolurken whoosh sesi çalar


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"Komut başarısız: {' '.join(cmd)}\n{r.stderr[-2000:]}")
    return r.stdout


def probe(path):
    info = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]))
    v = next(s for s in info['streams'] if s['codec_type'] == 'video')
    has_audio = any(s['codec_type'] == 'audio' for s in info['streams'])
    w, h = int(v['width']), int(v['height'])
    rot = int(v.get('tags', {}).get('rotate', 0) or 0)
    for sd in v.get('side_data_list', []):
        if 'rotation' in sd:
            rot = int(sd['rotation'])
    if abs(rot) in (90, 270):
        w, h = h, w
    return w - w % 2, h - h % 2, float(info['format']['duration']), has_audio


def duration(path):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).strip())


# ---------- Seslendirme ----------
def tts_elevenlabs(text, out_mp3, voice_id, model):
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128"
    body = json.dumps({"text": text, "model_id": model,
                       "voice_settings": {"stability": 0.4, "similarity_boost": 0.8, "style": 0.3}}).encode()
    headers = {"Content-Type": "application/json", "Accept": "audio/mpeg",
               # Anahtar ortamın ağ proxy'si tarafından eklenir; yoksa ortam değişkeninden alınır.
               "xi-api-key": os.environ.get("ELEVENLABS_API_KEY", "proxy-injected")}
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r, open(out_mp3, 'wb') as f:
        f.write(r.read())


def tts_espeak(text, out_wav, speed=165, pitch=55):
    run(['espeak-ng', '-v', 'tr', '-s', str(speed), '-p', str(pitch), '-w', out_wav, text])


def make_tts(text, base, plan, c=None):
    c = c or {}
    if plan.get('tts', 'elevenlabs') == 'elevenlabs':
        out = base + '.mp3'
        tts_elevenlabs(text, out, plan.get('voice_id', 'JBFqnCBsd6RMkjVDRZzb'),
                       plan.get('model_id', 'eleven_multilingual_v2'))
    else:
        out = base + '.wav'
        tts_espeak(text, out, c.get('speed', 165), c.get('pitch', 55))
    return out


# ---------- Görüntü ----------
def ease_out_back(x, s=1.9):
    x -= 1
    return 1 + (s + 1) * x ** 3 + s * x ** 2


POSITIONS = {  # kartın ekrandaki yeri: (yatay hizalama, dikey merkez oranı)
    'sag_ust': ('R', 0.20), 'sol_ust': ('L', 0.20), 'sag_alt': ('R', 0.70), 'sol_alt': ('L', 0.70),
    'sag_orta': ('R', 0.45), 'sol_orta': ('L', 0.45), 'orta': ('C', 0.45),
}


def render_freeze(frame_png, card_png, total, W, H, raw_out, pos='sag_ust', card_scale=0.62, dim=False):
    """Video karesi olduğu gibi durur (bulanıklık/karartma yok); yorum kartı seçilen köşede belirir."""
    bg0 = Image.open(frame_png).convert('RGB').resize((W, H))
    if dim:
        bg0 = ImageEnhance.Brightness(bg0).enhance(0.6)
    card = Image.open(card_png).convert('RGBA')
    # 1000 px genişliğindeki bir kart ekranın card_scale oranı kadar yer kaplar; uzun yorumlar orantılı büyür
    sc = W * card_scale / 1000
    sc = min(sc, W * 0.92 / card.width)
    base_card = card.resize((int(card.width * sc), int(card.height * sc)), Image.LANCZOS)
    align, yc = POSITIONS.get(pos, POSITIONS['sag_ust'])
    margin = int(W * 0.04)
    cw, ch = base_card.size
    x = {'L': margin, 'R': W - margin - cw, 'C': (W - cw) // 2}[align]
    y = min(max(int(H * yc - ch / 2), int(H * 0.06)), int(H * 0.82 - ch))
    ax, ay = x + cw / 2, y + ch / 2   # animasyon merkezi
    n = int(round(total * FPS))
    with open(raw_out, 'wb') as f:
        for i in range(n):
            t = i / FPS
            if t < POP_IN:
                s = max(0.05, ease_out_back(t / POP_IN)); a = min(1, t / (POP_IN * 0.6))
            elif t > total - FADE_OUT:
                s = 1 - 0.1 * (t - (total - FADE_OUT)) / FADE_OUT; a = max(0, (total - t) / FADE_OUT)
            else:
                s, a = 1.0, 1.0
            c = base_card if abs(s - 1) < 1e-3 else base_card.resize(
                (max(1, int(cw * s)), max(1, int(ch * s))), Image.BILINEAR)
            if a < 1:
                c = c.copy(); c.putalpha(c.getchannel('A').point(lambda p: int(p * a)))
            bg = bg0.copy()
            bg.paste(c, (int(ax - c.width / 2), int(ay - c.height / 2)), c)
            f.write(bg.tobytes())
    return n


VOICE_CHAIN = (
    "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.04,"
    "areverse,silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.06,areverse,"
    "highpass=f=85,lowpass=f=14000,"                       # uğultu ve hışırtı kes
    "afftdn=nr=10:nf=-55:tn=1,"                            # hafif, uyarlamalı gürültü azaltma
    "equalizer=f=250:t=q:w=1.2:g=-2.5,"                    # çamurlu/boğuk bölgeyi temizle
    "equalizer=f=3500:t=q:w=1.0:g=3,"                      # netlik / anlaşılırlık
    "equalizer=f=10000:t=h:w=0.7:g=1.5,"                   # hava
    "deesser=i=0.4:m=0.5:f=0.5,"                           # sert 's' seslerini yumuşat
    "acompressor=threshold=-20dB:ratio=3.5:attack=4:release=90:makeup=3:knee=4,"
    "alimiter=limit=0.89:attack=3:release=40,"
    "loudnorm=I=-14:TP=-1.5:LRA=7,"
    "afade=t=in:d=0.015"
)


def process_voice(src, out):
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-af', VOICE_CHAIN, '-ar', str(AR), '-ac', '2', out])
    return out


def make_sfx(tmp):
    """Efektleri sentezler: donma tıkı, kart pop'u, çıkış whoosh'u."""
    defs = {
        # kamera deklanşörü gibi kısa tık + alttan hafif darbe
        'freeze': "aevalsrc='0.55*(random(0)*2-1)*exp(-90*t)+0.7*sin(2*PI*95*t)*exp(-30*t)':s=44100:d=0.16",
        # yükselen, yuvarlak "blup"
        'pop':    "aevalsrc='0.75*sin(2*PI*(320*t+2600*t*t))*exp(-20*t)*(1-exp(-400*t))':s=44100:d=0.17",
        # yumuşak hava sesi, ortada şişip sönen
        'whoosh': "aevalsrc='0.9*(random(0)*2-1)*pow(sin(PI*t/0.32),2)':s=44100:d=0.32",
    }
    post = {'freeze': 'highpass=f=60,lowpass=f=9000', 'pop': 'lowpass=f=6000',
            'whoosh': 'bandpass=f=1600:width_type=o:w=2.2,volume=0.7'}
    paths = {}
    for k, src in defs.items():
        paths[k] = os.path.join(tmp, f'sfx_{k}.wav')
        run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', src, '-af', post[k], '-ac', '2', paths[k]])
    return paths


def enc_v(): return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', str(FPS)]
def enc_a(): return ['-c:a', 'aac', '-b:a', '192k', '-ar', str(AR), '-ac', str(AC)]


def cut_segment(src, start, end, W, H, has_audio, out):
    vf = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={FPS}"
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{start:.3f}', '-to', f'{end:.3f}', '-i', src]
    if not has_audio:
        cmd += ['-f', 'lavfi', '-i', f'anullsrc=r={AR}:cl=stereo', '-shortest']
    d = end - start
    af = f"afade=t=in:d=0.06,afade=t=out:st={max(0, d - 0.04):.3f}:d=0.04"
    cmd += ['-map', '0:v:0', '-map', '0:a:0' if has_audio else '1:a:0', '-vf', vf, '-af', af] + enc_v() + enc_a() + [out]
    run(cmd)


def main(plan_path):
    plan = json.load(open(plan_path))
    root = os.path.dirname(os.path.abspath(plan_path))
    P = lambda p: p if os.path.isabs(p) else os.path.join(root, p)
    src = P(plan['video']); out = P(plan.get('output', 'out/sonuc.mp4'))
    tmp = P(plan.get('tmp', 'tmp')); os.makedirs(tmp, exist_ok=True); os.makedirs(os.path.dirname(out), exist_ok=True)
    W, H, dur, has_audio = probe(src)
    if has_audio and plan.get('video_lufs', -18) is not None:
        # orijinal videonun sesini dengele: yorum sesleri bunun biraz üstünde dursun
        norm = os.path.join(tmp, 'src_norm.mp4')
        run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
             '-af', f"loudnorm=I={plan.get('video_lufs', -18)}:TP=-2:LRA=11"] + enc_a() + [norm])
        src = norm
    comments = sorted(plan['comments'], key=lambda c: c['at'])

    sfx = make_sfx(tmp)

    parts, prev = [], 0.0
    for i, c in enumerate(comments):
        at = min(max(0.05, float(c['at'])), dur - 0.05)
        seg = os.path.join(tmp, f'seg{i}.mp4')
        if at - prev > 0.04:
            cut_segment(src, prev, at, W, H, has_audio, seg); parts.append(seg)
        # donan kare
        frame = os.path.join(tmp, f'frame{i}.png')
        run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{max(0, at - 1 / FPS):.3f}', '-i', src, '-frames:v', '1',
             '-vf', f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2", frame])
        # Kullanıcının kendi ses dosyası varsa onu kullan; yoksa metinden seslendir
        voice = P(c['audio']) if c.get('audio') else make_tts(c['text'], os.path.join(tmp, f'tts{i}'), plan, c)
        if plan.get('voice_fx', True):
            voice = process_voice(voice, os.path.join(tmp, f'voice{i}_fx.wav'))
        total = LEAD + duration(voice) + TAIL
        raw = os.path.join(tmp, f'freeze{i}.rgb')
        render_freeze(frame, P(c['image']), total, W, H, raw, c.get('pos', 'sag_ust'), plan.get('card_scale', 0.62), plan.get('dim', False))
        fz = os.path.join(tmp, f'freeze{i}.mp4')
        ms = lambda sec: int(sec * 1000)
        sv = plan.get('sfx_volume', 0.55)
        d_voice, d_pop, d_wh = ms(LEAD), ms(0.03), ms(max(0, total - FADE_OUT - 0.12))
        fc = (f"[1:a]volume={sv * 0.8}[f];"
              f"[2:a]volume={sv},adelay={d_pop}|{d_pop}[p];"
              f"[3:a]aresample={AR},aformat=channel_layouts=stereo,volume={plan.get('voice_volume', 1.0)},adelay={d_voice}|{d_voice}[v];"
              f"[4:a]volume={sv * 0.6},adelay={d_wh}|{d_wh}[w];"
              f"[f][p][v][w]amix=inputs=4:normalize=0:duration=longest,apad[a]")
        run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', raw,
             '-i', sfx['freeze'], '-i', sfx['pop'], '-i', voice, '-i', sfx['whoosh'],
             '-filter_complex', fc, '-map', '0:v', '-map', '[a]', '-t', f'{total:.3f}'] + enc_v() + enc_a() + [fz])
        os.remove(raw)
        parts.append(fz); prev = at
    if dur - prev > 0.04:
        seg = os.path.join(tmp, 'seg_end.mp4'); cut_segment(src, prev, dur, W, H, has_audio, seg); parts.append(seg)

    lst = os.path.join(tmp, 'list.txt')
    open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
    joined = os.path.join(tmp, 'joined.mp4')
    run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', joined, '-c:v', 'copy',
         '-af', 'loudnorm=I=-14:TP=-1.0:LRA=9', '-ar', str(AR)] + enc_a() + ['-movflags', '+faststart', out])
    print(f"Tamam: {out}  ({duration(out):.1f} sn, {W}x{H})")


if __name__ == '__main__':
    main(sys.argv[1])
