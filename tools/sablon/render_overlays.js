// Şablon katmanlarını (logo, giriş başlığı, altyazılar, kapanış) şeffaf PNG olarak çizer.
// Kullanım: node render_overlays.js spec.json
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const W = spec.width, H = spec.height, s = W / 720; // tüm ölçüler 720 genişliğe göre
// fontlar sayfaya gömülür (about:blank sayfası file:// fontlarını yükleyemez)
const F = (p) => 'data:font/woff2;base64,' + fs.readFileSync(path.join(__dirname, 'node_modules/@fontsource', p)).toString('base64');
const C = spec.colors;

const css = `
@font-face{font-family:Anton;font-weight:400;src:url(${F('anton/files/anton-latin-ext-400-normal.woff2')}) format('woff2');unicode-range:U+0100-02AF,U+1E00-1EFF}
@font-face{font-family:Anton;font-weight:400;src:url(${F('anton/files/anton-latin-400-normal.woff2')}) format('woff2')}
@font-face{font-family:Brico;font-weight:800;src:url(${F('bricolage-grotesque/files/bricolage-grotesque-latin-ext-800-normal.woff2')}) format('woff2');unicode-range:U+0100-02AF,U+1E00-1EFF}
@font-face{font-family:Brico;font-weight:800;src:url(${F('bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2')}) format('woff2')}
html,body{margin:0;width:${W}px;height:${H}px;background:transparent;overflow:hidden}
.abs{position:absolute;left:0;right:0;display:flex;flex-direction:column;align-items:center}
.big{font-family:Anton;color:${C.accent};text-transform:none;letter-spacing:${1 * s}px;line-height:1.02;text-align:center;
  -webkit-text-stroke:${6 * s}px ${C.ink};paint-order:stroke fill;text-shadow:0 ${5 * s}px ${14 * s}px rgba(0,0,0,.55)}
.pill{font-family:Brico;font-weight:800;background:${C.ink};color:${C.accent};border-radius:${999}px;padding:${7 * s}px ${18 * s}px ${9 * s}px}
.small{font-family:Brico;font-weight:800;color:#fff;text-shadow:0 ${2 * s}px ${6 * s}px rgba(0,0,0,.9)}
.sub{font-family:Brico;font-weight:800;color:#fff;text-align:center;max-width:${600 * s}px;line-height:1.18;
  -webkit-text-stroke:${5 * s}px ${C.ink};paint-order:stroke fill}
`;

const bubbleClean = (size, bubbleCol, barCol) => `
<svg width="${size}" height="${size}" viewBox="140 160 520 510" aria-hidden="true">
<g fill="${C.ink}"><rect x="146" y="161" width="508" height="398" rx="134"/><path d="M236 490 L196 676 L392 530 Z"/></g>
<g fill="${bubbleCol}"><rect x="160" y="175" width="480" height="370" rx="120"/><path d="M250 500 L215 650 L370 535 Z"/></g>
<rect x="318" y="270" width="58" height="180" rx="29" fill="${barCol}"/>
<rect x="424" y="270" width="58" height="180" rx="29" fill="${barCol}"/>
</svg>`;

const layers = {
  logo: () => `<div class="abs" style="top:${34 * s}px;gap:${4 * s}px">
     ${bubbleClean(54 * s, C.accent, C.ink)}
     <div class="pill" style="font-size:${17 * s}px;letter-spacing:${1.5 * s}px">${spec.brand}</div></div>`,
  hook: () => `<div class="abs" style="top:${H * 0.36}px;gap:${16 * s}px">
     <div class="big" style="font-size:${96 * s}px;max-width:${640 * s}px">${spec.hook}</div>
     ${spec.hook_sub ? `<div class="pill" style="font-size:${22 * s}px">${spec.hook_sub}</div>` : ''}</div>`,
  outro: () => `<div class="abs" style="top:${H * 0.56}px;gap:${10 * s}px">
     <div class="big" style="font-size:${84 * s}px">${spec.outro_title}</div>
     <div style="display:flex;align-items:center;gap:${10 * s}px">${bubbleClean(64 * s, C.accent, C.ink)}
       <div class="pill" style="font-size:${30 * s}px;letter-spacing:${2 * s}px">${spec.brand}</div></div>
     <div class="small" style="font-size:${21 * s}px;margin-top:${6 * s}px">${spec.outro_sub}</div></div>`,
};

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const shot = async (html, out) => {
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: out, omitBackground: true });
  };
  for (const [k, fn] of Object.entries(layers)) await shot(fn(), path.join(spec.outdir, `${k}.png`));
  for (const [i, sub] of (spec.subtitles || []).entries()) {
    await shot(`<div class="abs" style="top:${H * 0.74}px"><div class="sub" style="font-size:${34 * s}px">${sub.text}</div></div>`,
      path.join(spec.outdir, `sub${i}.png`));
  }
  await b.close();
})();
