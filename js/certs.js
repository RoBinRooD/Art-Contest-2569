// Admin tab "เกียรติบัตร": render participation certificates on this computer, review them, publish to Drive,
// and open the public download page. The blank template is kept in the system's private Drive folder (admin only)
// and loaded automatically on any admin computer; it never appears on the public web.
(function () {
  const { el, tag, LEVEL_SHORT, AWARD_LABEL, Store } = App;
  const $ = id => document.getElementById(id);
  const NAME_BOX = { x0: 300, y0: 790, x1: 2039, y1: 1000 };   // measured on the 2339 x 1654 template
  let template = null, templateSig = '';

  function fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  }

  /** Who gets what, from attendance + awards. status: cert | award | absent */
  function plan() {
    return Store.activeTeams().map(t => {
      const award = Store.awardOf(t.code);
      const present = new Set(App.presentMembers(t).map(m => m.sid));
      return {
        team: t, award,
        members: t.members.map(m => ({
          sid: m.sid, name: m.printName,
          status: award ? 'award' : present.has(m.sid) ? 'cert' : 'absent',
          award: award ? AWARD_LABEL[award.award] : ''
        }))
      };
    });
  }

  // Two centred lines in the name area: the student's name, and under it the school (smaller).
  const LAYOUT = 'name+school-v1';   // part of every certificate's hash: a layout change re-renders them all
  const fitFont = (ctx, text, maxW, from, to, step, weight) => {
    let px = from;
    for (; px > to; px -= step) { ctx.font = `${weight} ${px}px ${Poster.font}, sans-serif`; if (ctx.measureText(text).width <= maxW) break; }
    ctx.font = `${weight} ${px}px ${Poster.font}, sans-serif`;
    return px;
  };

  async function render(name, school, scale = 1, img = template, shift = 0) {
    await Poster.loadFonts();
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const sx = c.width / 2339, sy = c.height / 1654, maxW = (NAME_BOX.x1 - NAME_BOX.x0) * sx;
    const mid = ((NAME_BOX.y0 + NAME_BOX.y1) / 2) * sy + shift * c.height;
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const px = fitFont(ctx, name, maxW, 112 * sx, 56 * sx, 2 * sx, 600);
    ctx.fillText(name, c.width / 2, mid - 50 * sy);
    let spx = 0;
    if (school) {
      spx = fitFont(ctx, school, maxW, 66 * sx, 38 * sx, 2 * sx, 500);
      ctx.fillText(school, c.width / 2, mid + 62 * sy);
    }
    return { canvas: c, small: px < 76 * sx || (school && spx < 46 * sx) };
  }

  function renderSummary() {
    const box = $('certSummary');
    if (!Store.roster) return;
    const p = plan();
    const count = s => p.reduce((a, x) => a + x.members.filter(m => m.status === s).length, 0);
    const open = Store.val('setting:certOpen') === true;
    const published = Object.keys(Store.state).filter(k => k.startsWith('cert:') && Store.state[k].value).length;
    const unknown = p.filter(x => Store.attend(x.team.code).state === 'unknown').length;
    box.replaceChildren(...[
      el('div', { cls: 'stats' },
        ...[['เกียรติบัตรผู้เข้าร่วม', count('cert')], ['ได้รางวัล (ฉบับพิมพ์)', count('award')], ['ไม่ได้มา', count('absent')],
          ['อัปโหลดแล้ว', published]].map(([l, v]) => el('div', { cls: 'stat' }, el('b', { text: String(v) }), l))),
      !Store.locked() ? el('div', { cls: 'banner warn', text: 'ยังไม่ล็อกผล: สร้างตัวอย่างได้ แต่เผยแพร่ได้หลังล็อกผลเท่านั้น' }) : null,
      unknown ? el('div', { cls: 'banner warn', text: `ยังไม่ได้บันทึกการมาแข่ง ${unknown} ทีม (ทีมเหล่านี้จะไม่ได้เกียรติบัตร)` }) : null,
      el('div', { cls: 'banner ' + (open ? 'ok' : 'warn'), text: open ? 'เปิดให้ดาวน์โหลดอยู่' : 'ยังไม่เปิดให้ดาวน์โหลด' })].filter(Boolean));
    $('certOpen').textContent = open ? 'ปิดการดาวน์โหลด' : 'เปิดให้ดาวน์โหลด';
    $('certPublish').disabled = !Store.locked() || !template;
  }

  function showTemplate(img, label) {
    const okSize = img.naturalWidth === 2339 && img.naturalHeight === 1654;
    $('certTemplateStatus').replaceChildren(tag(okSize ? 'พร้อม' : 'ขนาดไม่ตรงเทมเพลตเดิม', okSize ? 'ok' : 'warn'), ` ${label} (${img.naturalWidth}×${img.naturalHeight})`);
  }

  /** Uploads a new template to the system (once); every admin computer then uses it. */
  async function loadTemplate(file) {
    $('certTemplateStatus').textContent = 'กำลังอัปโหลดเทมเพลตเข้าระบบ…';
    const img = await Photo.loadFile(file);
    const r = await Api.call('saveTemplate', { kind: 'participation', data: await Photo.blobToBase64(file), name: file.name,
      width: img.naturalWidth, height: img.naturalHeight, actor: App.actor() }, { timeoutMs: 120000 });
    template = img;
    templateSig = 'sha:' + r.sha;
    await Store.loadState();
    showTemplate(img, `${file.name} · เก็บในระบบแล้ว`);
    renderSummary();
  }

  /** Loads the stored template the first time it is needed on this computer. */
  let fetching = null;
  function ensureTemplate() {
    const stored = Store.val('template:participation');
    if (!stored) {
      if (!template) $('certTemplateStatus').textContent = 'ยังไม่มีเทมเพลตในระบบ — อัปโหลดครั้งเดียว';
      return Promise.resolve(template);
    }
    if (template && templateSig === 'sha:' + stored.sha) return Promise.resolve(template);
    if (!fetching) fetching = (async () => {
      $('certTemplateStatus').textContent = 'กำลังโหลดเทมเพลตจากระบบ…';
      try {
        const r = await Api.call('getTemplate', { kind: 'participation' }, { timeoutMs: 180000 });
        const img = (await templateFrom(r)).img;
        template = img; templateSig = 'sha:' + r.sha;
        showTemplate(img, `${stored.name || 'เทมเพลต'} · จากระบบ`);
        renderSummary();
        return img;
      } finally { fetching = null; }
    })();
    return fetching;
  }

  // ---------------------------------------------------------------- templates from the owner's Google Drive folder
  const KIND_LABEL = { participation: 'เกียรติบัตรผู้เข้าร่วม', award: 'เกียรติบัตรรางวัล (แบบเดียว)', 'award-1': 'ชนะเลิศ',
    'award-2': 'รองชนะเลิศอันดับ 1', 'award-3': 'รองชนะเลิศอันดับ 2', 'award-4': 'ชมเชย' };
  const STATUS_LABEL = { stored: ['เก็บเข้าระบบแล้ว', 'ok'], unchanged: ['มีอยู่แล้ว (ไม่เปลี่ยน)', 'ok'], duplicate_kind: ['ซ้ำประเภท — ใช้ไฟล์แรก', 'warn'],
    not_template: ['ไม่ใช่เทมเพลต (ข้าม)', 'muted'], too_big: ['ไฟล์ใหญ่เกิน 15 MB', 'bad'] };

  async function importFromDrive() {
    const box = $('tplResult');
    // empty = the saved link, else the folder set in the Apps Script (CONFIG.TEMPLATE_FOLDER_ID)
    const link = $('tplFolder').value.trim();
    box.textContent = 'กำลังดึงเทมเพลตจาก Google Drive…';
    const r = await Api.call('importTemplates', { folder: link, actor: App.actor() }, { retries: 0, timeoutMs: 300000 });
    const cur = Store.state['setting:templateFolder'];
    if (link && Store.val('setting:templateFolder') !== link) await Store.set('setting:templateFolder', link, cur ? cur.v : 0);
    $('tplFolder').value = '';
    await Store.loadState();
    template = null; templateSig = '';           // the stored participation template may have changed
    await ensureTemplate();
    const kinds = new Set(r.templates.filter(t => t.status === 'stored' || t.status === 'unchanged').map(t => t.kind));
    box.replaceChildren(
      el('div', { cls: 'banner ' + (kinds.has('participation') ? 'ok' : 'warn'), text: `โฟลเดอร์ "${r.folderName}": พบเทมเพลต ${kinds.size} แบบ — ${[...kinds].map(k => KIND_LABEL[k]).join(' · ') || 'ไม่พบ'}` }),
      el('table', {}, el('tbody', {}, r.templates.map(t => el('tr', {},
        el('td', { text: t.name }), el('td', { text: (KIND_LABEL[t.kind] || '—') + (t.pdf ? ' (PDF)' : '') }),
        el('td', {}, tag(...(STATUS_LABEL[t.status] || [t.status, 'muted']))))))),
      ...r.notes.map(n => el('details', { attrs: { style: 'margin-top:8px' } },
        el('summary', { text: `ไฟล์ตั้งค่า: ${n.name}` }),
        el('button', { cls: 'link', text: 'คัดลอกข้อความ', on: { click: async () => { await navigator.clipboard.writeText(n.text); } } }),
        el('pre', { attrs: { style: 'max-height:240px;overflow:auto;white-space:pre-wrap;font-size:12px' }, text: n.text }))));
  }

  // ---------------------------------------------------------------- award certificates (printed)
  // Same name position as the participation certificate; a small up/down shift (setting:awardNameShift, share of
  // the height) fixes a template whose name line sits elsewhere.
  let nameShift = 0;
  // Participation certificate: the same kind of shift (setting:certNameShift); by default 2% lower than the
  // original name box, which left the name too close to the line above it on the real template.
  const CERT_SHIFT_DEFAULT = 0.02;
  let certShift = CERT_SHIFT_DEFAULT;
  const shiftText = v => v > 0 ? `ลง ${(v * 100).toFixed(0)}%` : v < 0 ? `ขึ้น ${(-v * 100).toFixed(0)}%` : 'ตำแหน่งเดิม';
  const AWARD_KINDS = ['award-1', 'award-2', 'award-3', 'award-4', 'award'];
  const awardTpl = {};   // kind -> {img, sha}

  // PDF templates (the printed award certificate) are drawn with PDF.js at print resolution (long side 3508 px,
  // 300 dpi on A4); the page size in points is kept so the exported PDF has the template's own page size.
  let pdfjsReady = null;
  function loadPdfJs() {
    if (!pdfjsReady) pdfjsReady = new Promise((resolve, reject) => {
      if (window.pdfjsLib) return resolve(window.pdfjsLib);
      const sc = document.createElement('script');
      sc.src = 'js/vendor/pdfjs/pdf.min.js';
      sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdfjs/pdf.worker.min.js'; resolve(window.pdfjsLib); };
      sc.onerror = () => { pdfjsReady = null; reject(new Error('โหลดตัวอ่าน PDF ไม่ได้')); };
      document.head.appendChild(sc);
    });
    return pdfjsReady;
  }

  async function pdfTemplate(base64) {
    const lib = await loadPdfJs();
    const bin = atob(base64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const page = await doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 3508 / Math.max(vp1.width, vp1.height) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    doc.destroy();
    c.naturalWidth = c.width; c.naturalHeight = c.height;   // render() reads these like an <img>
    return { img: c, pageW: vp1.width, pageH: vp1.height };
  }

  async function templateFrom(r) {
    if (r.mime === 'application/pdf') return pdfTemplate(r.data);
    return { img: await Photo.loadFile(Photo.base64ToBlob(r.data, r.mime)) };
  }

  async function loadAwardTemplates() {
    for (const kind of AWARD_KINDS) {
      const stored = Store.val('template:' + kind);
      if (!stored) { delete awardTpl[kind]; continue; }
      if (awardTpl[kind] && awardTpl[kind].sha === stored.sha) continue;
      const r = await Api.call('getTemplate', { kind }, { timeoutMs: 180000 });
      awardTpl[kind] = { ...(await templateFrom(r)), sha: r.sha, pdf: r.mime === 'application/pdf' };
    }
  }
  // The award's own template or the general award one; a PDF (the printed certificate) wins over an image.
  const awardTplFor = a => [awardTpl['award-' + a], awardTpl.award].filter(Boolean).sort((x, y) => (y.pdf ? 1 : 0) - (x.pdf ? 1 : 0))[0] || null;
  const tplForAward = a => (awardTplFor(a) || {}).img || null;

  /** One award certificate per member of every winning team (a team of 3 = 3 certificates). Members recorded as
   *  absent are still listed, flagged for the admin to check. */
  function awardItems() {
    const out = [];
    App.LEVEL_ORDER.forEach((level, li) => Store.awardRows(level).filter(r => r.team).forEach(r => {
      const t = Store.team(r.team);
      if (!t) return;
      const a = Store.attend(t.code);
      const isAbsent = m => a.state === 'absent' || (a.state === 'partial' && a.absent.includes(m.sid));
      t.members.forEach(m => out.push({ level, li, award: r.award, order: r.order, team: t, name: m.printName, absent: isAbsent(m) }));
    }));
    return out.sort((a, b) => a.li - b.li || a.award - b.award || a.order - b.order);
  }

  async function awardPreview() {
    const msg = $('awardMsg'), grid = $('awardGrid');
    grid.querySelectorAll('img').forEach(i => URL.revokeObjectURL(i.src));
    grid.replaceChildren();
    msg.textContent = 'กำลังโหลดเทมเพลตรางวัล…';
    await loadAwardTemplates();
    const items = awardItems();
    if (!items.length) { msg.textContent = 'ยังไม่มีผลรางวัล — ใส่ผลที่แท็บผลรางวัลก่อน (หรือใช้ "เตรียมข้อมูลทดสอบ" เพื่อลอง)'; return; }
    const missingTpl = [...new Set(items.filter(i => !tplForAward(i.award)).map(i => AWARD_LABEL[i.award]))];
    let done = 0;
    for (const it of items) {
      const img = tplForAward(it.award);
      const cell = el('div', { cls: 'cert-cell' });
      if (img) {
        const r = await render(it.name, it.team.school, 0.22, img, nameShift);
        const pic = el('img', { cls: 'cert-thumb', attrs: { alt: it.name } });
        pic.src = URL.createObjectURL(await Photo.toBlob(r.canvas, 0.8));
        r.canvas.width = r.canvas.height = 0;
        cell.append(pic);
        if (r.small) cell.append(tag('ชื่อหรือโรงเรียนยาว ตัวอักษรถูกย่อ', 'warn'));
      } else cell.append(tag('ไม่มีเทมเพลตของรางวัลนี้', 'bad'));
      if (it.absent) cell.append(tag('บันทึกว่าไม่มาแข่ง — ตรวจก่อนพิมพ์', 'warn'));
      cell.append(el('div', { cls: 'muted', text: `${App.LEVEL_SHORT[it.level]} · ${AWARD_LABEL[it.award]} · ${it.team.short} · ${it.team.school}` }));
      grid.appendChild(cell);
      if (++done % 10 === 0) msg.textContent = `กำลังสร้าง ${done}/${items.length} ใบ…`;
    }
    const teams = new Set(items.map(i => i.team.code)).size, absent = items.filter(i => i.absent).length;
    msg.textContent = `${items.length} ใบ จาก ${teams} ทีมที่ได้รางวัล (ใบละคน)${absent ? ` · ${absent} คนบันทึกว่าไม่มา (มีป้ายเตือน)` : ''}` +
      (missingTpl.length ? ` · ⚠ ไม่มีเทมเพลต: ${missingTpl.join(', ')} — ดึงเทมเพลตจาก Drive ในข้อ 1` : ' · ตรวจชื่อและตำแหน่งทุกใบ');
  }

  // Minimal PDF writer: one A4-landscape page per JPEG, the image filling the page (templates are A4 proportion).
  function pdfFromJpegs(jpegs) {
    const enc = new TextEncoder(), parts = [], offsets = [];
    let size = 0;
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length; };
    const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
    const n = jpegs.length;
    // page size: the PDF template's own, else A4 in the image's orientation
    const pageSize = j => j.pw ? [j.pw, j.ph] : (j.w >= j.h ? [841.89, 595.28] : [595.28, 841.89]);
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${jpegs.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] >>`));
    jpegs.forEach((j, i) => {
      const page = 3 + i * 3, content = page + 1, image = page + 2;
      const [W, H] = pageSize(j);
      const draw = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
      obj(page, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`));
      obj(content, () => { push(`<< /Length ${draw.length} >>\nstream\n`); push(draw); push('\nendstream'); });
      obj(image, () => { push(`<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.bytes.length} >>\nstream\n`); push(j.bytes); push('\nendstream'); });
    });
    const xref = size, count = 3 + n * 3;
    push(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let i = 1; i < count; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
    push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();

  /** PDFs per person in level/award folders, plus one print-ready PDF per level. */
  async function awardExport() {
    const msg = $('awardMsg');
    if (!Store.locked()) throw new Error('ต้องล็อกผลรางวัลก่อนจึงส่งออกเกียรติบัตรรางวัลได้');
    await loadAwardTemplates();
    const items = awardItems();
    if (!items.length) throw new Error('ยังไม่มีผลรางวัล');
    const noTpl = items.filter(i => !tplForAward(i.award));
    if (noTpl.length) throw new Error('ยังไม่มีเทมเพลตของรางวัล: ' + [...new Set(noTpl.map(i => AWARD_LABEL[i.award]))].join(', '));
    let dir = null;
    if (window.showDirectoryPicker) {
      try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name === 'AbortError') return; }
    }
    const write = async (path, blob) => {
      if (!dir) { const a = el('a', { attrs: { href: URL.createObjectURL(blob), download: path.replace(/\//g, '_') } }); document.body.appendChild(a); a.click(); a.remove(); await new Promise(r => setTimeout(r, 400)); return; }
      const ps = path.split('/');
      let d = dir;
      for (const p of ps.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const w = await (await d.getFileHandle(ps[ps.length - 1], { create: true })).createWritable(); await w.write(blob); await w.close();
    };
    const byLevel = {};
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      msg.textContent = `กำลังสร้าง ${i + 1}/${items.length} ใบ…`;
      const r = await render(it.name, it.team.school, 1, tplForAward(it.award), nameShift);
      const blob = await Photo.toBlob(r.canvas, 0.92);
      const t = awardTplFor(it.award);
      const jpeg = { bytes: new Uint8Array(await blob.arrayBuffer()), w: r.canvas.width, h: r.canvas.height, pw: t.pageW, ph: t.pageH };
      r.canvas.width = r.canvas.height = 0;
      const lv = `${it.li + 1}_${App.LEVEL_SHORT[it.level]}`, aw = `${it.award}_${AWARD_LABEL[it.award]}`;
      if (dir) await write(`เกียรติบัตรรางวัล/${lv}/${aw}/${safeName(it.team.short + '_' + it.name)}.pdf`, pdfFromJpegs([jpeg]));
      (byLevel[lv] = byLevel[lv] || []).push(jpeg);
    }
    for (const [lv, list] of Object.entries(byLevel)) {
      msg.textContent = `กำลังรวมไฟล์สำหรับพิมพ์ ${lv}…`;
      await write(`เกียรติบัตรรางวัล/${lv}/รวมสำหรับพิมพ์_${lv}.pdf`, pdfFromJpegs(list));
    }
    msg.textContent = dir ? `เสร็จ: ${items.length} ใบ ในโฟลเดอร์ "เกียรติบัตรรางวัล" แยกตามระดับชั้นและรางวัล + ไฟล์รวมสำหรับพิมพ์ของแต่ละระดับ`
      : `ดาวน์โหลดไฟล์รวมสำหรับพิมพ์แล้ว ${Object.keys(byLevel).length} ไฟล์ (เบราว์เซอร์นี้เลือกโฟลเดอร์ไม่ได้ ใช้ Chrome/Edge เพื่อแยกไฟล์รายคน)`;
  }

  async function saveNameShift(delta) {
    nameShift = Math.round((nameShift + delta) * 1000) / 1000;
    const cur = Store.state['setting:awardNameShift'];
    await Store.set('setting:awardNameShift', nameShift, cur ? cur.v : 0);
    $('awardShift').textContent = 'ตำแหน่งชื่อ: ' + shiftText(nameShift);
    await awardPreview();
  }

  async function preview() {
    await ensureTemplate();
    if (!template) { $('certPreviewMsg').textContent = 'ยังไม่มีเทมเพลต — อัปโหลดครั้งแรกในข้อ 1'; return; }
    const grid = $('certGrid');
    grid.querySelectorAll('img').forEach(i => URL.revokeObjectURL(i.src));
    grid.replaceChildren();
    const items = plan().flatMap(x => x.members.filter(m => m.status === 'cert').map(m => ({ ...m, team: x.team })));
    $('certPreviewMsg').textContent = `กำลังสร้าง ${items.length} ใบ…`;
    // Each thumbnail becomes a small JPEG and its canvas is freed: a thousand live canvases would exhaust the
    // browser's memory on a big contest.
    let done = 0;
    for (const it of items) {
      const r = await render(it.name, it.team.school, 0.22, template, certShift);
      const img = el('img', { cls: 'cert-thumb', attrs: { alt: it.name, loading: 'lazy' } });
      img.src = URL.createObjectURL(await Photo.toBlob(r.canvas, 0.8));
      r.canvas.width = r.canvas.height = 0;
      grid.appendChild(el('div', { cls: 'cert-cell' }, img,
        el('div', { cls: 'muted', text: `${it.team.short} · ${it.team.school}` }), r.small ? tag('ชื่อหรือโรงเรียนยาว ตัวอักษรถูกย่อ', 'warn') : null));
      if (++done % 20 === 0) $('certPreviewMsg').textContent = `กำลังสร้าง ${done}/${items.length} ใบ…`;
    }
    $('certPreviewMsg').textContent = `${items.length} ใบ · ตรวจชื่อทุกใบก่อนเผยแพร่`;
  }

  const PUBLISH_WORKERS = 3;                       // parallel uploads; Apps Script handles a few at once
  const TRANSIENT = ['busy', 'timeout', 'network', 'server_error', 'not_json'];

  async function publishOne(it, hash) {
    const r = await render(it.name, it.team.school, 1, template, certShift);
    const data = await Photo.blobToBase64(await Photo.toBlob(r.canvas, 0.88));
    r.canvas.width = r.canvas.height = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        return await Api.call('publishCert', { sid: it.sid, code: it.team.code, data, hash, actor: App.actor() }, { timeoutMs: 120000 });
      } catch (err) {
        if (attempt >= 3 || !TRANSIENT.includes(err.code)) throw err;
        await new Promise(res => setTimeout(res, 3000 * attempt));
      }
    }
  }

  async function publish() {
    const msg = $('certPublishMsg');
    const btn = $('certPublish');
    btn.disabled = true;
    try {
      // Fresh state first, so a second press after an interruption skips everything already uploaded.
      msg.textContent = 'กำลังตรวจว่าอัปโหลดอะไรไปแล้วบ้าง…';
      await Store.loadState();
      await ensureTemplate();
      if (!template) throw new Error('ยังไม่มีเทมเพลต — อัปโหลดครั้งแรกในข้อ 1');
      const p = plan();
      const items = p.flatMap(x => x.members.filter(m => m.status === 'cert').map(m => ({ ...m, team: x.team })));
      const todo = [];
      let sent = 0, same = 0;
      items.forEach(it => {
        const hash = fnv(`${it.name}|${it.team.school}|${LAYOUT}|${certShift}|${Poster.font}|${templateSig}`);
        const cur = Store.val('cert:' + it.sid);
        if (cur && cur.hash === hash) same++; else todo.push({ it, hash });
      });
      const failed = [];
      const started = Date.now();
      let next = 0;
      const show = () => {
        const finished = sent + failed.length, left = todo.length - finished;
        const eta = finished ? Math.ceil((Date.now() - started) / finished * left / 60000) : null;
        msg.textContent = `กำลังอัปโหลด ${finished}/${todo.length} ใบ (ไม่เปลี่ยน ${same} ใบ)${eta ? ` · เหลืออีกราว ${eta} นาที` : ''} — อย่าปิดหน้านี้`;
      };
      show();
      await Promise.all(Array.from({ length: PUBLISH_WORKERS }, async () => {
        while (next < todo.length) {
          const { it, hash } = todo[next++];
          try { const res = await publishOne(it, hash); if (res.unchanged) same++; else sent++; }
          catch (err) { failed.push(`${it.team.short} ${it.name} (${Api.message(err)})`); }
          show();
        }
      }));
      if (failed.length) {
        await Store.loadState();
        msg.textContent = `อัปโหลดสำเร็จ ${sent} ใบ · ไม่สำเร็จ ${failed.length} ใบ: ${failed.slice(0, 5).join(' · ')}${failed.length > 5 ? ' …' : ''} — กด "เผยแพร่" อีกครั้ง ระบบจะทำต่อเฉพาะใบที่ยังไม่สำเร็จ`;
        return;
      }
      await finishPublish(p, sent, same);
    } finally {
      btn.disabled = !Store.locked() || !template;
    }
  }

  async function finishPublish(p, sent, same) {
    const msg = $('certPublishMsg');
    msg.textContent = 'กำลังบันทึกรายชื่อของแต่ละทีม…';
    await Api.call('publishTeams', {
      teams: p.map(x => ({ code: x.team.code, members: x.members.map(m => ({ sid: m.sid, name: m.name, status: m.status, award: m.award })) })),
      actor: App.actor()
    }, { timeoutMs: 120000 });
    await Store.loadState();
    msg.textContent = `เสร็จ: อัปโหลดใหม่ ${sent} ใบ · ไม่เปลี่ยน ${same} ใบ · บันทึก ${p.length} ทีม`;
  }

  async function toggleOpen() {
    const cur = Store.state['setting:certOpen'];
    const open = Store.val('setting:certOpen') === true;
    if (!open && !confirm('เปิดให้ครูดาวน์โหลดเกียรติบัตร? ตรวจรายชื่อครบแล้วใช่ไหม')) return;
    await Store.set('setting:certOpen', !open, cur ? cur.v : 0);
  }

  async function showLinks() {
    const r = await Api.call('tokens');
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    $('certLinkList').replaceChildren(...Store.activeTeams().map(t => {
      const url = `${base}cert.html?openExternalBrowser=1#t=${r.tokens[t.code]}`;
      return el('div', { cls: 'row', attrs: { style: 'margin:4px 0' } },
        el('b', { cls: 'code', text: t.short }), el('span', { text: `${LEVEL_SHORT[t.levelKey]} · ${t.school}` }),
        el('button', { cls: 'link', text: 'คัดลอกลิงก์', on: { click: async () => { await navigator.clipboard.writeText(url); } } }));
    }));
  }

  async function guarded(fn, msgEl) {
    try { await fn(); } catch (err) {
      const m = err.code ? Api.message(err) : String(err.message || err);
      (msgEl ? $(msgEl) : $('globalBanner')).textContent = m;
    }
  }

  $('certTemplate').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) guarded(() => loadTemplate(f), 'certTemplateStatus'); });
  $('certPreview').addEventListener('click', () => guarded(preview, 'certPreviewMsg'));
  $('awardPreview').addEventListener('click', () => guarded(awardPreview, 'awardMsg'));
  $('awardExport').addEventListener('click', () => guarded(awardExport, 'awardMsg'));
  $('awardUp').addEventListener('click', () => guarded(() => saveNameShift(-0.01), 'awardMsg'));
  $('awardDown').addEventListener('click', () => guarded(() => saveNameShift(0.01), 'awardMsg'));
  Store.on(() => {
    const v = Store.val('setting:awardNameShift'); nameShift = typeof v === 'number' ? v : 0;
    const w = Store.val('setting:certNameShift'); certShift = typeof w === 'number' ? w : CERT_SHIFT_DEFAULT;
    $('awardShift').textContent = 'ตำแหน่งชื่อ: ' + shiftText(nameShift);
    $('certShift').textContent = 'ตำแหน่งชื่อ: ' + shiftText(certShift);
  });
  async function saveCertShift(delta) {
    certShift = Math.round((certShift + delta) * 1000) / 1000;
    const cur = Store.state['setting:certNameShift'];
    await Store.set('setting:certNameShift', certShift, cur ? cur.v : 0);
    await preview();
  }
  $('certUp').addEventListener('click', () => guarded(() => saveCertShift(-0.01), 'certPreviewMsg'));
  $('certDown').addEventListener('click', () => guarded(() => saveCertShift(0.01), 'certPreviewMsg'));
  $('tplImport').addEventListener('click', () => guarded(importFromDrive, 'tplResult'));
  $('certPublish').addEventListener('click', () => guarded(publish, 'certPublishMsg'));
  $('certOpen').addEventListener('click', () => guarded(toggleOpen, 'certPublishMsg'));
  $('certLinks').addEventListener('click', () => guarded(showLinks));
  // Only while this tab is open; opening the tab renders it.
  const certsVisible = () => !$('tab-certs').classList.contains('hidden');
  // The first time the tab opens on this page load, the templates are pulled from Drive by themselves.
  let autoImported = false;
  const onShow = () => {
    renderSummary();
    if (!autoImported) {
      autoImported = true;
      guarded(importFromDrive, 'tplResult');
      return;
    }
    ensureTemplate().catch(err => { $('certTemplateStatus').textContent = Api.message(err); });
  };
  Store.on(() => { if (certsVisible()) onShow(); });
  const tabBtn = document.querySelector('#tabs button[data-tab="certs"]');
  if (tabBtn) tabBtn.addEventListener('click', onShow);
  window.CertsTab = { plan, render, _setTemplate: (img, sig) => { template = img; templateSig = sig; renderSummary(); } };
})();
