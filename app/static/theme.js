'use strict';
/* Tallomi colour theme.
   One Hex colour (the "interface colour") is turned into the whole palette:
   a pale colour becomes the page background itself, a strong colour becomes the accent on a light page,
   and a very dark colour switches the app to a dark theme. Text colours are checked against WCAG contrast
   so any colour the user picks stays readable. Loaded in <head> so the saved colour is applied before first paint. */
(function (root) {
  const DEFAULT_COLOR = '#ECEEF0';       // 霧灰 (the owner's own book is lavender, stored in the book)
  const PRESETS = [
    ['#E6E6FA', '薰衣草紫'], ['#D6E8F7', '晴空藍'], ['#DCF0E4', '薄荷綠'], ['#FBE1E3', '蜜桃粉'],
    ['#F7EFD2', '奶油黃'], ['#ECEEF0', '霧灰'], ['#5B4BC4', '深紫'], ['#1B2438', '夜藍'],
  ];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isHex = (t) => /^#?[0-9a-fA-F]{6}$/.test(String(t).trim());
  const normalize = (t) => '#' + String(t).trim().replace(/^#/, '').toUpperCase();
  const toRgb = (hex) => { const n = parseInt(normalize(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (rgb) => '#' + rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();

  function rgbToHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  const hsl = (h, s, l) => toHex(hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)));
  const mix = (a, b, t) => toHex(toRgb(a).map((v, i) => v + (toRgb(b)[i] - v) * t));
  function lum(hex) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const [r, g, b] = toRgb(hex); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // Move lightness (darker on light pages, lighter on dark pages) until `fg` reads on `bg`.
  function readable(h, s, l, bg, min, dir) {
    let L = l, c = hsl(h, s, L);
    for (let i = 0; i < 80 && contrast(c, bg) < min; i++) { L += dir * 0.01; c = hsl(h, s, L); }
    return c;
  }

  function vars(input) {
    const base = isHex(input) ? normalize(input) : DEFAULT_COLOR;
    const [h, s, l] = rgbToHsl(toRgb(base));
    const st = clamp(s, 0.12, 0.5);
    const v = {};
    if (l < 0.25) {                                            // ---- dark theme
      const pl = clamp(l, 0.07, 0.13), ps = clamp(s, 0.15, 0.45);
      v['--paper'] = hsl(h, ps, pl); v['--surface'] = hsl(h, ps, pl + 0.05);
      v['--ink'] = hsl(h, 0.25, 0.93);
      v['--line'] = hsl(h, ps, pl + 0.14); v['--line-2'] = hsl(h, ps, pl + 0.09); v['--hover'] = hsl(h, ps, pl + 0.07);
      v['--ink-2'] = readable(h, 0.18, 0.78, v['--hover'], 7, +1); v['--ink-3'] = readable(h, 0.14, 0.64, v['--hover'], 4.8, +1);
      const accent = readable(h, clamp(s, 0.45, 0.8), 0.66, v['--surface'], 4.5, +1);
      v['--brass'] = accent; v['--brass-ink'] = hsl(h, 0.6, 0.78); v['--brass-wash'] = mix(v['--paper'], accent, 0.14);
      v['--primary'] = accent; v['--on-primary'] = hsl(h, 0.4, 0.09);
      v['--side'] = hsl(h, ps, Math.max(0.04, pl - 0.035)); v['--side-ink'] = v['--ink']; v['--side-dim'] = v['--ink-3'];
      v['--side-line'] = v['--line']; v['--side-accent'] = accent;
      v['--income'] = readable(155, 0.45, 0.62, v['--hover'], 4.5, +1); v['--expense'] = readable(5, 0.65, 0.70, v['--hover'], 4.5, +1);
      v['--danger'] = v['--expense'];
      v['--focus'] = accent; v['--shadow'] = '0 12px 40px rgba(0, 0, 0, .5)'; v['--shadow-soft'] = '0 6px 18px -12px rgba(0, 0, 0, .7)';
      v['color-scheme'] = 'dark';
    } else {                                                   // ---- light theme
      const pastel = l >= 0.78;
      const paper = pastel ? base : hsl(h, clamp(s, 0.2, 0.6), 0.955);
      v['--paper'] = paper; v['--surface'] = mix(paper, '#FFFFFF', 0.6);
      v['--ink'] = hsl(h, st * 0.8, 0.14);
      v['--line'] = mix(paper, v['--ink'], 0.17); v['--line-2'] = mix(paper, v['--ink'], 0.09); v['--hover'] = mix(paper, v['--ink'], 0.06);
      v['--ink-2'] = readable(h, st * 0.5, 0.30, v['--hover'], 7, -1); v['--ink-3'] = readable(h, st * 0.35, 0.40, v['--hover'], 4.8, -1);
      const accent = pastel ? readable(h, Math.max(st, 0.45), 0.46, v['--surface'], 4.5, -1) : readable(h, clamp(s, 0.35, 0.9), l, v['--surface'], 4.5, -1);
      v['--brass'] = accent; v['--brass-ink'] = readable(h, clamp(s, 0.35, 0.9), 0.30, mix(paper, accent, 0.14), 6, -1);
      v['--brass-wash'] = mix(paper, accent, 0.14);
      v['--primary'] = readable(h, pastel ? clamp(s, 0.3, 0.55) : clamp(s, 0.3, 0.75), 0.30, v['--surface'], 8, -1);
      v['--on-primary'] = mix(paper, '#FFFFFF', 0.85);
      v['--side'] = hsl(h, st, 0.20); v['--side-ink'] = hsl(h, 0.3, 0.94); v['--side-dim'] = hsl(h, 0.2, 0.74);
      v['--side-line'] = hsl(h, st, 0.30); v['--side-accent'] = readable(h, 0.65, 0.75, v['--side'], 4.5, +1);
      v['--income'] = readable(155, 0.55, 0.28, v['--hover'], 4.8, -1); v['--expense'] = readable(5, 0.60, 0.40, v['--hover'], 4.8, -1);
      v['--danger'] = v['--expense'];
      v['--focus'] = readable(h, clamp(s, 0.5, 0.9), 0.40, v['--hover'], 4.5, -1);
      const [r, g, b] = toRgb(v['--ink']);
      v['--shadow'] = `0 12px 40px rgba(${r}, ${g}, ${b}, .18)`; v['--shadow-soft'] = `0 6px 18px -12px rgba(${r}, ${g}, ${b}, .35)`;
      v['color-scheme'] = 'light';
    }
    return v;
  }

  function apply(input) {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    Object.entries(vars(input)).forEach(([k, val]) => el.style.setProperty(k, val));
  }

  const api = { DEFAULT_COLOR, PRESETS, isHex, normalize, vars, apply, contrast };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.Theme = api;
    let saved = null;
    try { saved = root.localStorage.getItem('pw_color'); } catch (e) { /* storage unavailable */ }
    apply(saved || DEFAULT_COLOR);
  }
})(typeof window !== 'undefined' ? window : globalThis);
