#!/usr/bin/env python3
"""
Turkshitpostt video şablonu.

Herhangi bir videonun üstüne kanal imzasını giydirir:
  - üstte sabit logo (pause balonu + TURKSHITPOSTT)
  - başta büyük giriş başlığı (hook), "pop" ile gelir
  - isteğe bağlı altyazılar
  - altta sarı ilerleme çubuğu
  - son saniyelerde kapanış: "TAKİP ET" + logo + "tekrar izle" yazısı

Kullanım:  python3 sablon.py plan.json
{
  "video": "girdi.mp4",
  "output": "cikti.mp4",
  "hook": "BUNU GÖRDÜN MÜ?",          # boş bırakılırsa giriş başlığı yok
  "hook_sub": "sonuna kadar izle",
  "hook_dur": 2.6,
  "outro_title": "TAKİP ET",
  "outro_sub": "↻ tekrar izle, fark ettin mi?",
  "outro_dur": 3.5,
  "subtitles": [{"start": 0.5, "end": 2.0, "text": "..."}]
}
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULTS = {
    "brand": "TURKSHITPOSTT",
    "hook": "BUNU GÖRDÜN MÜ?", "hook_sub": "sonuna kadar izle", "hook_dur": 2.6,
    "outro_title": "TAKİP ET", "outro_sub": "↻ tekrar izle, fark ettin mi?", "outro_dur": 3.5,
    "colors": {"accent": "#FFD23F", "ink": "#141414"},
    "subtitles": [], "sfx": True,
}


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode:
        sys.exit(f"Komut başarısız: {' '.join(cmd[:6])}...\n{r.stderr[-2500:]}")
    return r.stdout


def probe(path):
    info = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]))
    v = next(s for s in info['streams'] if s['codec_type'] == 'video')
    return int(v['width']), int(v['height']), float(info['format']['duration']), \
        any(s['codec_type'] == 'audio' for s in info['streams'])


def main(plan_path):
    plan = {**DEFAULTS, **json.load(open(plan_path))}
    root = os.path.dirname(os.path.abspath(plan_path))
    P = lambda p: p if os.path.isabs(p) else os.path.join(root, p)
    src, out = P(plan['video']), P(plan['output'])
    tmp = P(plan.get('tmp', 'tmp_sablon')); os.makedirs(tmp, exist_ok=True)
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    W, H, D, has_audio = probe(src)

    spec = {k: plan[k] for k in ('brand', 'hook', 'hook_sub', 'outro_title', 'outro_sub', 'colors', 'subtitles')}
    spec.update(width=W, height=H, outdir=tmp)
    json.dump(spec, open(os.path.join(tmp, 'spec.json'), 'w'), ensure_ascii=False)
    run(['node', os.path.join(HERE, 'render_overlays.js'), os.path.join(tmp, 'spec.json')], cwd=HERE)

    hd, od = float(plan['hook_dur']), float(plan['outro_dur'])
    os_ = max(0.0, D - od)                       # kapanış başlangıcı
    bar_h = max(6, round(H / 160))
    acc = plan['colors']['accent'].lstrip('#')

    inputs = ['-i', src,
              '-loop', '1', '-i', os.path.join(tmp, 'logo.png'),
              '-loop', '1', '-t', f'{hd:.3f}', '-i', os.path.join(tmp, 'hook.png'),
              '-loop', '1', '-t', f'{od:.3f}', '-i', os.path.join(tmp, 'outro.png'),
              '-f', 'lavfi', '-i', f'color=c=0x{acc}:s={W}x{bar_h}:r=30']
    subs = plan['subtitles']
    for i, _ in enumerate(subs):
        inputs += ['-loop', '1', '-i', os.path.join(tmp, f'sub{i}.png')]

    f = []
    # ilerleme çubuğu: koyu iz + soldan dolan sarı çubuk
    f.append(f"[0:v]drawbox=x=0:y=ih-{bar_h}:w=iw:h={bar_h}:color=black@0.45:t=fill[v0]")
    f.append(f"[v0][4:v]overlay=x='-w+w*t/{D:.3f}':y=H-{bar_h}:shortest=1[v1]")
    f.append("[v1][1:v]overlay=0:0:shortest=1[v2]")
    last = 'v2'
    if plan['hook']:
        f.append(f"[2:v]format=rgba,fade=t=in:st=0:d=0.15:alpha=1,fade=t=out:st={hd - 0.3:.3f}:d=0.3:alpha=1[hk]")
        f.append(f"[{last}][hk]overlay=x=0:y='if(lt(t,0.22),-50*(1-t/0.22),0)':eof_action=pass[v3]")
        last = 'v3'
    for i, s in enumerate(subs):
        f.append(f"[{last}][{5 + i}:v]overlay=0:0:enable='between(t,{s['start']},{s['end']})':shortest=1[s{i}]")
        last = f's{i}'
    f.append(f"[3:v]format=rgba,fade=t=in:st=0:d=0.25:alpha=1,setpts=PTS+{os_:.3f}/TB[ou]")
    f.append(f"[{last}][ou]overlay=x=0:y='if(lt(t-{os_:.3f},0.3),70*(1-(t-{os_:.3f})/0.3),0)':eof_action=pass,format=yuv420p[vout]")

    amap = []
    if has_audio:
        if plan['sfx']:
            # giriş ve kapanışa kısa "pop" sesi
            pop = "aevalsrc='0.55*sin(2*PI*(320*t+2600*t*t))*exp(-20*t)*(1-exp(-400*t))':s=44100:d=0.17"
            inputs += ['-f', 'lavfi', '-i', pop, '-f', 'lavfi', '-i', pop]
            n = 5 + len(subs)
            d1, d2 = 0, int(os_ * 1000)
            f.append(f"[{n}:a]aformat=channel_layouts=stereo,adelay={d1}|{d1}[p1];"
                     f"[{n + 1}:a]aformat=channel_layouts=stereo,adelay={d2}|{d2}[p2];"
                     f"[0:a]aresample=44100,aformat=channel_layouts=stereo[a0];"
                     f"[a0][p1][p2]amix=inputs=3:normalize=0:duration=first[aout]")
            amap = ['-map', '[aout]']
        else:
            amap = ['-map', '0:a']

    run(['ffmpeg', '-y', '-loglevel', 'error'] + inputs +
        ['-filter_complex', ';'.join(f), '-map', '[vout]'] + amap +
        ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-r', '30',
         '-c:a', 'aac', '-b:a', '192k', '-t', f'{D:.3f}', '-movflags', '+faststart', out])
    print(f'Tamam: {out} ({D:.1f} sn)')


if __name__ == '__main__':
    main(sys.argv[1])
