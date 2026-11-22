// Admin tab "ภาพประกาศ": bring photos in, attach them to teams, straighten, review, export for Facebook.
(function () {
  const { el, tag, LEVEL_ORDER, LEVEL_SHORT, LEVEL_FULL, AWARD_LABEL, Store } = App;
  const $ = id => document.getElementById(id);
  const LEVEL_FILE = { primary: '1_primary-4-6', m1: '2_secondary-1-3', m4: '3_secondary-4-6' };
  const AWARD_FILE = { 1: 'winner', 2: 'runner-up-1', 3: 'runner-up-2', 4: 'honourable' };
  const CORNER_STORE = 'artcontest.lastCorners';
  let level = 'primary';
  let editor = null;            // { code, sha, corners, rot, fit, paper, v }
  const fullCache = new Map();  // sha -> Promise<canvas>
  const thumbCache = new Map(); // sha -> Promise<objectURL>
  const localUploads = [];

  // ---------------------------------------------------------------- data helpers
  const photofiles = () => Object.keys(Store.state).filter(k => k.startsWith('photofile:') && Store.state[k].value)
    .map(k => ({ key: k, sha: k.slice(10), v: Store.state[k].v, at: Store.state[k].at, ...Store.state[k].value }));
  function resolveTeam(guess) {
    if (!guess || !Store.roster) return null;
    const g = guess.toUpperCase();
    return Store.roster.teams.find(t => t.code.toUpperCase() === g) || null;
  }
  const photosOfTeam = code => photofiles().filter(p => { const t = resolveTeam(p.team); return t && t.code === code; });
  const chosen = code => Store.val('photo:' + code);
  const posterNamesOn = () => !!Store.val('setting:posterNames');
  const hideNames = code => !!Store.val('hidenames:' + code);

  function slots(lv) {
    return Store.awardRows(lv).filter(r => r.team).map((r, i) => ({ ...r, n: i + 1, teamObj: Store.team(r.team) }));
  }

  function jobFor(slot, photoCanvas) {
    const t = slot.teamObj, ph = chosen(slot.team) || {};
    return {
      level: slot.level, award: slot.award, photo: photoCanvas, corners: ph.corners, rot: ph.rot || 0, fit: ph.fit || 'auto', paper: ph.paper || 'auto',
      school: t ? t.school : '', names: posterNamesOn() && t && !hideNames(t.code) ? t.members.map(m => m.printName) : null
    };
  }

  function proofHash(lv) {
    const s = JSON.stringify({
      font: Poster.font, names: posterNamesOn(),
      slots: slots(lv).map(sl => ({ a: sl.award, o: sl.order, t: sl.team, s: sl.teamObj && sl.teamObj.school,
        m: sl.teamObj && sl.teamObj.members.map(m => m.printName), h: hideNames(sl.team), p: chosen(sl.team) }))
    });
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16);
  }

  async function thumbUrl(p) {
    if (!thumbCache.has(p.sha)) thumbCache.set(p.sha, (async () => {
      const r = await Api.call('getPhoto', { fileId: p.thumbId || p.fileId });
      return URL.createObjectURL(Photo.base64ToBlob(r.data));
    })());
    return thumbCache.get(p.sha);
  }

  async function fullCanvas(sha) {
    if (!fullCache.has(sha)) fullCache.set(sha, (async () => {
      const p = photofiles().find(x => x.sha === sha);
      if (!p) throw new Error('missing photo');
      const r = await Api.call('getPhoto', { fileId: p.fileId }, { timeoutMs: 120000 });
      const img = await Photo.loadFile(Photo.base64ToBlob(r.data));
      return Photo.drawScaled(img, 4096);
    })());
    return fullCache.get(sha);
  }

  function lazyThumb(p, cls = 'thumb') {
    const img = el('img', { cls, attrs: { alt: '' } });
    thumbUrl(p).then(u => { img.src = u; }).catch(() => { img.alt = 'โหลดไม่ได้'; });
    return img;
  }

  async function guarded(fn) {
    try { await fn(); } catch (err) {
      const msg = err.code ? Api.message(err) : (err.message === 'heic' ? 'ไฟล์ HEIC เปิดบน Windows ไม่ได้ ให้ตั้งกล้อง iPhone เป็น "เข้ากันได้มากที่สุด"' : String(err.message || err));
      $('globalBanner').replaceChildren(el('div', { cls: 'banner bad', text: msg }));
      if (err.code === 'conflict') await Store.loadState();
    }
  }

  // ---------------------------------------------------------------- intake
  async function showPhoneQr() {
    await guarded(async () => {
      const r = await Api.call('photoLink');
      const base = location.origin + location.pathname.replace(/[^/]*$/, '');
      const url = `${base}upload.html?openExternalBrowser=1#k=${r.photoKey}`;
      const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
      const box = $('phoneQr');
      box.replaceChildren(el('div', { cls: 'muted', text: 'สแกนด้วยกล้องของมือถือที่ใช้ถ่ายรูป (ไม่ใช่ใน LINE) แล้วเปิดลิงก์ · QR นี้ใช้ส่งรูปได้อย่างเดียว อ่านรายชื่อไม่ได้' }));
      const holder = el('div', { cls: 'qrbox' });
      holder.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 4 });   // SVG from the QR library, no sheet data
      box.append(holder, el('button', { cls: 'link', text: 'ซ่อน QR', on: { click: () => box.replaceChildren() } }));
    });
  }

  async function uploadLocal(files) {
    for (const file of files) {
      const it = { name: file.name, state: 'เตรียม' };
      localUploads.push(it); renderIntake();
      try {
        const norm = await Photo.normalize(file);
        it.code = Photo.decodeCode(norm.canvas);
        it.state = 'กำลังส่ง'; renderIntake();
        await Photo.upload(norm, { team: it.code, name: file.name, takenAt: new Date(file.lastModified || Date.now()).toISOString() });
        norm.canvas.width = norm.canvas.height = 0;
        it.state = 'ส่งแล้ว';
      } catch (err) {
        it.state = err.message === 'heic' ? 'HEIC เปิดไม่ได้' : err.message === 'decode' ? 'เปิดไม่ได้' : Api.message(err);
      }
      renderIntake();
    }
    await Store.loadState();
  }

  function renderIntake() {
    $('localUploads').replaceChildren(...localUploads.slice(-12).map(it =>
      el('div', { cls: 'muted', text: `${it.name} — ${it.state}${it.code ? ' · ทีม ' + it.code.split('-').pop() : ''}` })));
  }

  // ---------------------------------------------------------------- photo library
  function renderLibrary() {
    const all = photofiles().sort((a, b) => (a.at < b.at ? 1 : -1));
    const unknown = all.filter(p => !resolveTeam(p.team));
    $('libCount').textContent = `${all.length} รูป · ระบุทีมไม่ได้ ${unknown.length} รูป`;
    const teams = Store.activeTeams();
    $('library').replaceChildren(...all.map(p => {
      const t = resolveTeam(p.team);
      const sel = el('select', {}, el('option', { text: t ? '' : '— ระบุทีม —', attrs: { value: '' } }),
        ...teams.map(x => el('option', { text: `${x.short} · ${LEVEL_SHORT[x.levelKey]}`, attrs: { value: x.code } })));
      sel.value = t ? t.code : '';
      sel.addEventListener('change', () => guarded(() => Store.set(p.key, { team: sel.value }, p.v)));
      const usedBy = t && chosen(t.code) && chosen(t.code).sha === p.sha;
      return el('div', { cls: 'lib-item' + (t ? '' : ' unknown') }, lazyThumb(p),
        el('div', { cls: 'lib-meta' },
          t ? el('b', { cls: 'code', text: t.short }) : tag('ไม่พบป้ายรหัส', 'warn'),
          p.teamSource === 'manual' ? tag('ระบุด้วยมือ', 'muted') : null,
          usedBy ? tag('ใช้ในภาพประกาศ', 'ok') : null),
        sel);
    }));
  }

  // ---------------------------------------------------------------- slots per level
  function renderSlots() {
    const seg = $('psLevels');
    seg.replaceChildren(...LEVEL_ORDER.map(k => el('button', { cls: k === level ? 'active' : '', text: LEVEL_SHORT[k], on: { click: () => { level = k; renderAll(); } } })));
    const list = slots(level);
    if (!list.length) { $('slots').replaceChildren(el('p', { cls: 'muted', text: 'ยังไม่มีผลรางวัลของระดับนี้ (ใส่ที่แท็บผลรางวัล)' })); return; }
    $('slots').replaceChildren(el('table', {},
      el('thead', {}, el('tr', {}, ['#', 'รางวัล', 'ทีม', 'รูป', ''].map(h => el('th', { text: h })))),
      el('tbody', {}, list.map(sl => {
        const t = sl.teamObj, ph = chosen(sl.team), cands = photosOfTeam(sl.team);
        const status = ph ? tag('จัดภาพแล้ว', 'ok') : cands.length ? tag(`มีรูป ${cands.length} รูป ยังไม่ได้จัด`, 'warn') : tag('ยังไม่มีรูป', 'bad');
        return el('tr', {},
          el('td', { text: String(sl.n).padStart(2, '0') }),
          el('td', { text: AWARD_LABEL[sl.award] }),
          el('td', {}, el('b', { cls: 'code', text: t ? t.short : sl.team }), ' ', t ? t.school : tag('ไม่พบทีม', 'bad')),
          el('td', {}, status),
          el('td', {}, el('button', { cls: 'secondary small', text: 'จัดภาพ', attrs: { disabled: t ? null : '' }, on: { click: () => openEditor(sl) } })));
      }))));
  }

  // ---------------------------------------------------------------- editor
  function defaultCorners() {
    try { const c = JSON.parse(localStorage.getItem(CORNER_STORE) || 'null'); if (c && c.length === 4) return c; } catch (e) { /* ignore */ }
    return [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]];
  }

  function openEditor(sl) {
    const ph = chosen(sl.team);
    const cands = photosOfTeam(sl.team);
    editor = {
      slot: sl, code: sl.team, v: Store.state['photo:' + sl.team] ? Store.state['photo:' + sl.team].v : 0,
      sha: ph ? ph.sha : (cands[0] && cands[0].sha) || '', corners: ph && ph.corners ? ph.corners : defaultCorners(),
      rot: ph ? ph.rot : 0, fit: ph ? ph.fit : 'auto', paper: ph ? ph.paper : 'auto', src: null, drag: -1
    };
    $('editorCard').classList.remove('hidden');
    renderEditorShell();
    loadEditorPhoto();
    $('editorCard').scrollIntoView({ behavior: 'smooth' });
  }

  function renderEditorShell() {
    const sl = editor.slot, t = sl.teamObj;
    $('edTitle').textContent = `${AWARD_LABEL[sl.award]} · ${LEVEL_SHORT[sl.level]} · ทีม ${t.short} · ${t.school}`;
    const cands = photosOfTeam(editor.code);
    const others = photofiles().filter(p => !cands.includes(p));
    $('edPhotos').replaceChildren(...[
      ...cands.map(p => { const i = lazyThumb(p, 'pick' + (p.sha === editor.sha ? ' active' : '')); i.addEventListener('click', () => { editor.sha = p.sha; renderEditorShell(); loadEditorPhoto(); }); return i; }),
      cands.length ? null : el('span', { cls: 'muted', text: 'ยังไม่มีรูปที่อ่านป้ายรหัสได้เป็นทีมนี้ ' }),
      (() => {
        const s = el('select', {}, el('option', { text: 'เลือกรูปอื่น…', attrs: { value: '' } }),
          ...others.map(p => el('option', { text: `${resolveTeam(p.team) ? 'ทีม ' + resolveTeam(p.team).short : 'ไม่พบรหัส'} · ${p.name || p.sha.slice(0, 8)}`, attrs: { value: p.sha } })));
        s.addEventListener('change', () => { if (s.value) { editor.sha = s.value; renderEditorShell(); loadEditorPhoto(); } });
        return s;
      })()].filter(Boolean));
    $('edPaper').value = editor.paper;
    $('edFit').value = editor.fit;
  }

  async function loadEditorPhoto() {
    editor.src = null;
    drawSource();
    if (!editor.sha) { $('edPreview').replaceChildren(el('p', { cls: 'muted', text: 'ยังไม่ได้เลือกรูป' })); return; }
    $('edPreview').replaceChildren(el('p', { cls: 'muted', text: 'กำลังโหลดรูปเต็ม…' }));
    await guarded(async () => {
      const sha = editor.sha;
      const c = await fullCanvas(sha);
      if (!editor || editor.sha !== sha) return;
      editor.base = c;
      editor.src = Poster.rotated(c, editor.rot);
      drawSource();
      schedulePreview();
    });
  }

  function drawSource() {
    const cv = $('edSource'), ctx = cv.getContext('2d');
    if (!editor || !editor.src) { cv.width = 600; cv.height = 60; ctx.clearRect(0, 0, 600, 60); return; }
    const maxW = Math.min(900, $('edSourceWrap').clientWidth || 900);
    const s = Math.min(maxW / editor.src.width, 640 / editor.src.height);
    cv.width = Math.round(editor.src.width * s); cv.height = Math.round(editor.src.height * s);
    ctx.drawImage(editor.src, 0, 0, cv.width, cv.height);
    const pts = editor.corners.map(([x, y]) => [x * cv.width, y * cv.height]);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height);
    ctx.moveTo(...pts[0]); pts.slice(1).reverse().forEach(p => ctx.lineTo(...p)); ctx.closePath();
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ff3b6b'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(...pts[0]); pts.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath(); ctx.stroke();
    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI * 2);
      ctx.fillStyle = i === editor.drag ? '#ffd400' : '#ffffff'; ctx.fill(); ctx.stroke();
    });
  }

  let previewTimer = 0;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      if (!editor || !editor.base) return;
      await guarded(async () => {
        const job = { ...jobFor(editor.slot, editor.base), corners: editor.corners, rot: editor.rot, fit: editor.fit, paper: editor.paper };
        const r = await Poster.render(job, 0.2);
        r.canvas.className = 'poster-preview';
        $('edPreview').replaceChildren(r.canvas,
          el('div', { cls: 'muted', text: `วางแบบ: ${r.mode === 'fill' ? 'เต็มกรอบ (ตัดขอบเล็กน้อย)' : 'ทั้งภาพในกรอบ'}` }),
          ...r.warnings.map(w => el('div', {}, tag(w, 'warn'))));
      });
    }, 180);
  }

  function hookSourceCanvas() {
    const cv = $('edSource');
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    cv.addEventListener('pointerdown', e => {
      if (!editor || !editor.src) return;
      const [x, y] = pos(e);
      let best = -1, bd = 1e9;
      editor.corners.forEach(([cx, cy], i) => { const d = Math.hypot((cx - x) * cv.width, (cy - y) * cv.height); if (d < bd) { bd = d; best = i; } });
      if (bd < 40) { editor.drag = best; cv.setPointerCapture(e.pointerId); drawSource(); }
    });
    cv.addEventListener('pointermove', e => {
      if (!editor || editor.drag < 0) return;
      const [x, y] = pos(e);
      editor.corners[editor.drag] = [Math.min(1.05, Math.max(-0.05, x)), Math.min(1.05, Math.max(-0.05, y))];
      drawSource();
    });
    const end = () => { if (editor && editor.drag >= 0) { editor.drag = -1; drawSource(); schedulePreview(); } };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  function rotate(delta) {
    if (!editor || !editor.base) return;
    editor.rot = (editor.rot + delta + 360) % 360;
    editor.src = Poster.rotated(editor.base, editor.rot);
    editor.corners = defaultCorners();
    drawSource(); schedulePreview();
  }

  async function saveEditor() {
    if (!editor || !editor.sha) return;
    await guarded(async () => {
      await Store.set('photo:' + editor.code, { sha: editor.sha, corners: editor.corners, rot: editor.rot, fit: editor.fit, paper: editor.paper }, editor.v);
      try { localStorage.setItem(CORNER_STORE, JSON.stringify(editor.corners)); } catch (e) { /* ignore */ }
      closeEditor();
    });
  }

  function closeEditor() { editor = null; $('editorCard').classList.add('hidden'); renderAll(); }

  // ---------------------------------------------------------------- proof + export
  function renderProof() {
    const list = slots(level);
    const proof = Store.val('proof:' + level), posted = Store.val('posted:' + level);
    const hash = proofHash(level);
    const ready = list.length && list.every(sl => sl.teamObj && chosen(sl.team));
    const box = $('proof');
    const parts = [el('p', { cls: 'muted', text: 'ให้ประธานกรรมการ (หรือหัวหน้างาน) ดูทีละภาพ: ภาพผลงานตรงกับรางวัลและโรงเรียน และรหัสบนป้ายในรูปดิบตรงกับทีม แล้วพิมพ์ชื่อผู้ยืนยัน' })];
    if (!ready) parts.push(el('div', { cls: 'banner warn', text: 'ยังจัดภาพไม่ครบทุกรางวัลของระดับนี้' }));
    const grid = el('div', { cls: 'proof-grid' });
    list.forEach(sl => {
      const ph = chosen(sl.team), p = ph && photofiles().find(x => x.sha === ph.sha);
      const cell = el('div', { cls: 'proof-cell' },
        el('div', { cls: 'proof-title', text: `${String(sl.n).padStart(2, '0')} ${AWARD_LABEL[sl.award]} · ${sl.teamObj ? sl.teamObj.short : sl.team}` }),
        el('div', { cls: 'muted', text: sl.teamObj ? sl.teamObj.school : '' }),
        p ? lazyThumb(p, 'proof-raw') : tag('ไม่มีรูป', 'bad'));
      grid.appendChild(cell);
      if (p) fullCanvas(p.sha).then(c => Poster.render(jobFor(sl, c), 0.1)).then(r => { r.canvas.className = 'proof-poster'; cell.insertBefore(r.canvas, cell.children[2]); }).catch(() => {});
    });
    parts.push(grid);
    if (proof && proof.hash === hash) parts.push(el('div', { cls: 'banner ok', text: `ยืนยันแล้วโดย ${proof.by}` }));
    else {
      if (proof) parts.push(el('div', { cls: 'banner warn', text: 'มีการเปลี่ยนแปลงหลังยืนยัน ต้องยืนยันใหม่' }));
      const who = el('input', { attrs: { type: 'text', placeholder: 'ชื่อผู้ยืนยัน (ประธานกรรมการ)' } });
      parts.push(el('div', { cls: 'row' }, who, el('button', { text: 'ยืนยันผลรางวัลและภาพ', attrs: { disabled: ready ? null : '' }, on: { click: () => guarded(async () => {
        if (!who.value.trim()) throw new Error('พิมพ์ชื่อผู้ยืนยันก่อน');
        const e = Store.state['proof:' + level];
        await Store.set('proof:' + level, { by: who.value.trim(), hash }, e ? e.v : 0);
      }) } })));
    }
    const approved = proof && proof.hash === hash;
    parts.push(el('div', { cls: 'row', attrs: { style: 'margin-top:12px' } },
      el('button', { text: 'ส่งออกไฟล์ Facebook + ภาพเต็ม', attrs: { disabled: approved ? null : '' }, on: { click: () => guarded(() => exportLevel(level)) } }),
      el('button', { cls: 'secondary', text: 'คัดลอกข้อความโพสต์', on: { click: () => guarded(async () => { await navigator.clipboard.writeText(captionText(level)); $('exportLog').textContent = 'คัดลอกข้อความโพสต์แล้ว'; }) } })));
    if (posted) parts.push(posted.hash === hash ? el('div', { cls: 'banner ok', text: `ทำเครื่องหมายว่าโพสต์แล้ว (${posted.by})` })
      : el('div', { cls: 'banner bad', text: 'ข้อมูลเปลี่ยนหลังโพสต์แล้ว: ต้องเปลี่ยนรูปหรือข้อความในโพสต์ Facebook ด้วยมือ' }));
    if (approved) parts.push(el('button', { cls: 'link', text: 'ทำเครื่องหมายว่าโพสต์ระดับนี้แล้ว', on: { click: () => guarded(async () => {
      const e = Store.state['posted:' + level];
      await Store.set('posted:' + level, { by: App.actor(), hash }, e ? e.v : 0);
    }) } }));
    parts.push(el('div', { cls: 'muted', attrs: { id: 'exportLog' } }));
    box.replaceChildren(...parts);
  }

  function captionText(lv) {
    const lines = [`ประกาศผล${window.APP_CONFIG.TITLE || 'การประกวดวาดภาพ'}`, LEVEL_FULL[lv], ''];
    slots(lv).forEach(sl => {
      const t = sl.teamObj;
      if (!t) return;
      lines.push(`รางวัล${AWARD_LABEL[sl.award]}`);
      lines.push(t.school);
      if (!hideNames(t.code)) lines.push(t.members.map(m => m.printName).join(' · '));
      lines.push('');
    });
    return lines.join('\n').trim() + '\n';
  }

  async function exportLevel(lv) {
    const list = slots(lv);
    const log = $('exportLog');
    let dir = null;
    if (window.showDirectoryPicker) {
      try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name === 'AbortError') return; }
    }
    const write = async (path, blob) => {
      if (!dir) { const a = el('a', { attrs: { href: URL.createObjectURL(blob), download: path.replace(/\//g, '_') } }); document.body.appendChild(a); a.click(); a.remove(); await new Promise(r => setTimeout(r, 400)); return; }
      const parts = path.split('/');
      let d = dir;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
      const w = await fh.createWritable(); await w.write(blob); await w.close();
    };
    for (const sl of list) {
      log.textContent = `กำลังสร้างภาพ ${sl.n}/${list.length}…`;
      const c = await fullCanvas(chosen(sl.team).sha);
      const r = await Poster.render(jobFor(sl, c), 1);
      const name = `${String(sl.n).padStart(2, '0')}_${AWARD_FILE[sl.award]}_${sl.teamObj.short}.jpg`;
      await write(`facebook/${LEVEL_FILE[lv]}/${name}`, await Photo.toBlob(Poster.facebookCopy(r.canvas), 0.92));
      await write(`full-size/${LEVEL_FILE[lv]}/${name}`, await Photo.toBlob(r.canvas, 0.95));
      r.canvas.width = r.canvas.height = 0;
    }
    await write(`facebook/${LEVEL_FILE[lv]}/caption.txt`, new Blob(['﻿' + captionText(lv)], { type: 'text/plain;charset=utf-8' }));
    log.textContent = dir ? `บันทึกแล้ว ${list.length} ภาพ ในโฟลเดอร์ที่เลือก (facebook/ สำหรับโพสต์, full-size/ สำหรับเก็บ)` : `ดาวน์โหลดแล้ว ${list.length} ภาพ`;
  }

  // ---------------------------------------------------------------- render + wiring
  function renderAll() {
    if (!Store.roster) return;
    renderLibrary();
    renderSlots();
    renderProof();
    $('posterNames').checked = posterNamesOn();
    $('fontStatus').textContent = Poster.font === 'PosterLocal' ? 'ใช้ฟอนต์จากเครื่องนี้' : 'ใช้ฟอนต์ Mitr (ฟรี)';
  }

  function wire() {
    $('phoneQrBtn').addEventListener('click', showPhoneQr);
    $('localFiles').addEventListener('change', e => { const f = [...e.target.files]; e.target.value = ''; guarded(() => uploadLocal(f)); });
    $('reloadPhotos').addEventListener('click', () => guarded(() => Store.loadState()));
    $('posterNames').addEventListener('change', e => guarded(async () => {
      const cur = Store.state['setting:posterNames'];
      await Store.set('setting:posterNames', e.target.checked, cur ? cur.v : 0);
    }));
    $('fontFile').addEventListener('change', e => guarded(async () => { if (e.target.files[0]) { await Poster.useLocalFont(e.target.files[0]); renderAll(); if (editor) schedulePreview(); } }));
    $('edPaper').addEventListener('change', e => { if (editor) { editor.paper = e.target.value; schedulePreview(); } });
    $('edFit').addEventListener('change', e => { if (editor) { editor.fit = e.target.value; schedulePreview(); } });
    $('edRotL').addEventListener('click', () => rotate(-90));
    $('edRotR').addEventListener('click', () => rotate(90));
    $('edReset').addEventListener('click', () => { if (editor) { editor.corners = [[0.06, 0.06], [0.94, 0.06], [0.94, 0.94], [0.06, 0.94]]; drawSource(); schedulePreview(); } });
    $('edSave').addEventListener('click', saveEditor);
    $('edClose').addEventListener('click', closeEditor);
    hookSourceCanvas();
    Store.on(() => { if (!editor) renderAll(); });
    Poster.loadMeta().catch(() => {});
  }

  window.PostersTab = { wire, renderAll, _test: { resolveTeam, proofHash, captionText } };
  wire();
})();
