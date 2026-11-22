// Poster compositor: straighten the artwork from four corners, place it in the template's frame,
// write the caption, export full size and a Facebook size. Runs in desktop Chrome only.
(function () {
  const FB_W = 1448, FB_H = 2048;
  const SCHOOL_COLOR = '#2e3192', NAMES_COLOR = '#231f20';
  let meta = null;
  const templates = new Map();
  let fontFamily = 'PosterMitr';
  let fontReady = null;

  async function loadMeta() {
    if (!meta) meta = (await (await fetch('assets/posters.json', { cache: 'no-cache' })).json()).posters;
    return meta;
  }
  const posterFor = (level, award) => meta.find(p => p.level === level && p.award === award);

  async function template(p) {
    if (!templates.has(p.id)) templates.set(p.id, Photo.loadImage(p.file));
    return templates.get(p.id);
  }

  function loadFonts() {
    if (!fontReady) {
      const faces = [new FontFace('PosterMitr', 'url(assets/fonts/Mitr-SemiBold.ttf)', { weight: '600' }),
                     new FontFace('PosterMitr', 'url(assets/fonts/Mitr-Medium.ttf)', { weight: '500' })];
      fontReady = Promise.all(faces.map(f => f.load().then(x => document.fonts.add(x))));
    }
    return fontReady;
  }

  /** Use a font file from this computer (e.g. the template's own font); it is never uploaded anywhere. */
  async function useLocalFont(file) {
    const face = new FontFace('PosterLocal', await file.arrayBuffer());
    await face.load();
    document.fonts.add(face);
    fontFamily = 'PosterLocal';
    return face.family;
  }

  // ---------------------------------------------------------------- geometry
  /** 3x3 homography H with H * src_i = dst_i for four points. */
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }

  function solve(A, b) {
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  /** Width/height ratio of the paper: from the preset, oriented like the dragged quad. */
  function paperAspect(quadPx, paper) {
    const w = (dist(quadPx[0], quadPx[1]) + dist(quadPx[3], quadPx[2])) / 2;
    const h = (dist(quadPx[0], quadPx[3]) + dist(quadPx[1], quadPx[2])) / 2;
    const landscape = w >= h;
    const preset = paper === '56x38' ? 56 / 38 : paper === 'A3' ? Math.SQRT2 : null;
    if (!preset) return w / h;
    return landscape ? preset : 1 / preset;
  }

  /** Sample the source quad into an outW x outH rectangle (bilinear, inverse mapping). */
  function rectify(src, quadPx, outW, outH) {
    outW = Math.max(1, Math.round(outW)); outH = Math.max(1, Math.round(outH));
    const H = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quadPx);
    const sw = src.width, sh = src.height, sd = src.data;
    const out = new ImageData(outW, outH), od = out.data;
    for (let y = 0; y < outH; y++) {
      const yc = y + 0.5;
      for (let x = 0; x < outW; x++) {
        const xc = x + 0.5;
        const w = H[6] * xc + H[7] * yc + H[8];
        let sx = (H[0] * xc + H[1] * yc + H[2]) / w - 0.5;
        let sy = (H[3] * xc + H[4] * yc + H[5]) / w - 0.5;
        if (sx < 0) sx = 0; else if (sx > sw - 1.001) sx = sw - 1.001;
        if (sy < 0) sy = 0; else if (sy > sh - 1.001) sy = sh - 1.001;
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        const o = (y * outW + x) * 4;
        for (let c = 0; c < 3; c++) {
          const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
          const bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
          od[o + c] = top + (bot - top) * fy;
        }
        od[o + 3] = 255;
      }
    }
    const c = document.createElement('canvas');
    c.width = outW; c.height = outH;
    c.getContext('2d').putImageData(out, 0, 0);
    return c;
  }

  /** Rotate a photo canvas by 0/90/180/270 degrees. */
  function rotated(canvas, rot) {
    if (!rot) return canvas;
    const c = document.createElement('canvas');
    const swap = rot === 90 || rot === 270;
    c.width = swap ? canvas.height : canvas.width;
    c.height = swap ? canvas.width : canvas.height;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return c;
  }

  // ---------------------------------------------------------------- caption
  function fitFont(ctx, text, weight, maxPx, minPx, maxW) {
    let px = maxPx;
    for (; px > minPx; px -= 2) {
      ctx.font = `${weight} ${px}px ${fontFamily}, sans-serif`;
      if (ctx.measureText(text).width <= maxW) return { px, fits: true };
    }
    ctx.font = `${weight} ${minPx}px ${fontFamily}, sans-serif`;
    return { px: minPx, fits: ctx.measureText(text).width <= maxW };
  }

  /** Split text into at most two lines at a space nearest the middle. */
  function twoLines(text) {
    const mid = text.length / 2;
    let best = -1;
    for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return best < 0 ? [text] : [text.slice(0, best), text.slice(best + 1)];
  }

  function drawCaption(ctx, p, s, school, names) {
    const band = p.captionBand, W = p.width;
    const x0 = band.x0 * s, x1 = band.x1 * s, maxW = x1 - x0;
    const lines = [];
    const warnings = [];
    let f = fitFont(ctx, school, 600, 0.045 * W * s, 0.03 * W * s, maxW);
    if (f.fits) lines.push({ text: school, px: f.px, weight: 600, color: SCHOOL_COLOR });
    else twoLines(school).forEach(t => { const g = fitFont(ctx, t, 600, 0.035 * W * s, 0.026 * W * s, maxW); lines.push({ text: t, px: g.px, weight: 600, color: SCHOOL_COLOR }); });
    if (names && names.length) {
      const joined = names.join('  ·  ');
      const g = fitFont(ctx, joined, 500, 0.028 * W * s, 0.022 * W * s, maxW);
      if (g.fits) lines.push({ text: joined, px: g.px, weight: 500, color: NAMES_COLOR });
      else twoLines(joined).forEach(t => { const h = fitFont(ctx, t, 500, 0.024 * W * s, 0.02 * W * s, maxW); lines.push({ text: t, px: h.px, weight: 500, color: NAMES_COLOR }); });
    }
    const gap = 0.25;
    const total = lines.reduce((a, l) => a + l.px * (1 + gap), 0) - lines[lines.length - 1].px * gap;
    const bandH = (band.y1 - band.y0) * s;
    if (total > bandH) warnings.push('ข้อความยาวเกินแถบ');
    if (lines.some(l => l.px < 0.03 * W * s - 0.5)) warnings.push('ตัวอักษรเล็กกว่า 3% ของความกว้างภาพ อาจอ่านยากบนมือถือ');
    let y = band.y0 * s + Math.max(0, (bandH - total) / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach(l => {
      ctx.font = `${l.weight} ${l.px}px ${fontFamily}, sans-serif`;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, (x0 + x1) / 2, y);
      y += l.px * (1 + gap);
    });
    return warnings;
  }

  // ---------------------------------------------------------------- compose
  /**
   * job = { level, award, photo (canvas, already loaded), corners [[nx,ny]x4] on the rotated photo, rot, fit, paper,
   *         school, names (array or null) }; scale 1 = full 3508 x 4961.
   */
  async function render(job, scale = 1) {
    await loadMeta(); await loadFonts();
    const p = posterFor(job.level, job.award);
    if (!p) throw new Error('no template ' + job.level + '-' + job.award);
    const img = await template(p);
    const c = document.createElement('canvas');
    c.width = Math.round(p.width * scale); c.height = Math.round(p.height * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const warnings = [];

    if (job.photo) {
      const src = rotated(job.photo, job.rot || 0);
      const corners = job.corners || [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]];
      const quadPx = corners.map(([nx, ny]) => [nx * src.width, ny * src.height]);
      const aspect = paperAspect(quadPx, job.paper);
      const [tl, tr, br, bl] = p.frame;
      const Wf = tr[0] - tl[0], Hf = bl[1] - tl[1], frameAspect = Wf / Hf;
      let mode = job.fit;
      if (mode !== 'fill' && mode !== 'fit') mode = Math.abs(aspect / frameAspect - 1) <= 0.08 ? 'fill' : 'fit';
      // fill = cover the frame (crop the overflow); fit = whole work inside the frame with a small margin
      const aw = mode === 'fill' ? Math.max(Wf, Hf * aspect) : Math.min(Wf, Hf * aspect) * 0.94;
      const ah = aw / aspect;
      const ax = (Wf - aw) / 2, ay = (Hf - ah) / 2;
      const srcData = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height);
      const art = rectify(srcData, quadPx, aw * scale, ah * scale);
      const outPx = Math.min(aw / (dist(quadPx[0], quadPx[1])), ah / dist(quadPx[0], quadPx[3]));
      if (outPx > 1.6) warnings.push(`รูปละเอียดไม่พอ (ขยาย ${outPx.toFixed(1)} เท่า) ควรถ่ายใกล้ขึ้นหรือใช้ 2x`);

      ctx.save();
      ctx.beginPath();
      const g = 2;   // grow the clip slightly so no template yellow shows at the edge
      ctx.moveTo((tl[0] - g) * scale, (tl[1] - g) * scale); ctx.lineTo((tr[0] + g) * scale, (tr[1] - g) * scale);
      ctx.lineTo((br[0] + g) * scale, (br[1] + g) * scale); ctx.lineTo((bl[0] - g) * scale, (bl[1] + g) * scale);
      ctx.closePath();
      ctx.clip();
      // frame-local (0..Wf, 0..Hf) -> poster: a parallelogram (left edge leans by bl.x - tl.x)
      ctx.setTransform(scale, 0, (bl[0] - tl[0]) / Hf * scale, scale, tl[0] * scale, tl[1] * scale);
      if (mode === 'fit') {
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(ax + 10, ay + 14, aw, ah);   // soft offset shadow
      }
      ctx.drawImage(art, ax, ay, aw, ah);
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      job.modeUsed = mode;
    }
    warnings.push(...drawCaption(ctx, p, scale, job.school || '', job.names || null));
    return { canvas: c, warnings, mode: job.modeUsed };
  }

  /** Facebook copy: 1448 x 2048, downscaled in two steps for clean text edges. */
  function facebookCopy(full) {
    const half = document.createElement('canvas');
    half.width = Math.round(full.width / 2); half.height = Math.round(full.height / 2);
    const h = half.getContext('2d'); h.imageSmoothingQuality = 'high'; h.drawImage(full, 0, 0, half.width, half.height);
    const fb = document.createElement('canvas');
    fb.width = FB_W; fb.height = FB_H;
    const f = fb.getContext('2d'); f.imageSmoothingQuality = 'high'; f.drawImage(half, 0, 0, FB_W, FB_H);
    return fb;
  }

  window.Poster = { loadMeta, loadFonts, useLocalFont, render, facebookCopy, rotated, homography, rectify, get font() { return fontFamily; } };
})();
