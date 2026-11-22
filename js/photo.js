// Photo helpers shared by upload.html (phones) and the admin poster tab (laptop).
(function () {
  const MAX_EDGE = 4096;   // safe canvas size on older iPhones; plenty for the 3378 x 2251 poster frame
  const CODE_RE = /^[A-Z0-9]{2,12}-[A-Z0-9]{2,8}$/;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = src;
    });
  }

  /** Decodes a picked file (EXIF orientation applied by the browser). HEIC fails on Windows/Android. */
  async function loadFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      await img.decode().catch(() => {});
      return img;
    } catch (e) {
      const err = new Error(/heic|heif/i.test(file.type + file.name) ? 'heic' : 'decode');
      throw err;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  function drawScaled(img, maxEdge) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const s = Math.min(1, maxEdge / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function toBlob(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode')), 'image/jpeg', quality));
  }

  /** Re-encode to JPEG (max 4096 px) + a 480 px preview. Returns {blob, thumb, width, height, canvas}. */
  async function normalize(file) {
    const img = await loadFile(file);
    const canvas = drawScaled(img, MAX_EDGE);
    const blob = await toBlob(canvas, 0.9);
    const thumb = await toBlob(drawScaled(canvas, 480), 0.8);
    return { blob, thumb, width: canvas.width, height: canvas.height, canvas };
  }

  /** Looks for the team-code card QR. Tries several scales; returns the code (upper case) or ''. */
  function decodeCode(canvas) {
    if (typeof jsQR !== 'function') return '';
    for (const edge of [1600, 2400, 1100, 3200]) {
      const c = drawScaled(canvas, edge);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const hit = jsQR(data.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
      if (hit && hit.data) {
        const code = hit.data.trim().toUpperCase();
        if (CODE_RE.test(code)) return code;
      }
    }
    return '';
  }

  async function sha256Hex(blob) {
    const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, mime = 'image/jpeg') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  /** Upload one normalised photo; resolves only when the server confirms the same byte size. */
  async function upload(norm, { team = '', name = '', takenAt = '' } = {}) {
    const [data, thumb] = await Promise.all([blobToBase64(norm.blob), blobToBase64(norm.thumb)]);
    const r = await Api.call('uploadPhoto', { data, thumb, team, name, takenAt, width: norm.width, height: norm.height, actor: App.actor() },
      { retries: 2, timeoutMs: 120000 });
    if (r.size !== norm.blob.size) throw Object.assign(new Error('size'), { code: 'size_mismatch' });
    return r;
  }

  window.Photo = { loadFile, loadImage, drawScaled, toBlob, normalize, decodeCode, sha256Hex, blobToBase64, base64ToBlob, upload };
})();
