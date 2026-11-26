// Admin tab "เกียรติบัตร": render participation certificates on this computer, review them, publish to Drive,
// and open the public download page. The blank template never leaves this computer except as finished certificates.
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

  async function render(name, scale = 1) {
    await Poster.loadFonts();
    const c = document.createElement('canvas');
    c.width = Math.round(template.naturalWidth * scale); c.height = Math.round(template.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(template, 0, 0, c.width, c.height);
    const sx = c.width / 2339, maxW = (NAME_BOX.x1 - NAME_BOX.x0) * sx;
    let px = 120 * sx;
    const font = p => `600 ${p}px ${Poster.font}, sans-serif`;
    for (; px > 60 * sx; px -= 2 * sx) { ctx.font = font(px); if (ctx.measureText(name).width <= maxW) break; }
    ctx.font = font(px);
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, c.width / 2, ((NAME_BOX.y0 + NAME_BOX.y1) / 2) * sx);
    return { canvas: c, small: px < 80 * sx };
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

  async function loadTemplate(file) {
    const img = await Photo.loadFile(file);
    template = img;
    templateSig = `${file.name}|${file.size}|${img.naturalWidth}x${img.naturalHeight}`;
    const okSize = img.naturalWidth === 2339 && img.naturalHeight === 1654;
    $('certTemplateStatus').replaceChildren(tag(okSize ? 'พร้อม' : 'ขนาดไม่ตรงเทมเพลตเดิม', okSize ? 'ok' : 'warn'), ` ${file.name} (${img.naturalWidth}×${img.naturalHeight})`);
    renderSummary();
  }

  async function preview() {
    if (!template) { $('certPreviewMsg').textContent = 'เลือกไฟล์เทมเพลตก่อน'; return; }
    const grid = $('certGrid');
    grid.querySelectorAll('img').forEach(i => URL.revokeObjectURL(i.src));
    grid.replaceChildren();
    const items = plan().flatMap(x => x.members.filter(m => m.status === 'cert').map(m => ({ ...m, team: x.team })));
    $('certPreviewMsg').textContent = `กำลังสร้าง ${items.length} ใบ…`;
    // Each thumbnail becomes a small JPEG and its canvas is freed: a thousand live canvases would exhaust the
    // browser's memory on a big contest.
    let done = 0;
    for (const it of items) {
      const r = await render(it.name, 0.22);
      const img = el('img', { cls: 'cert-thumb', attrs: { alt: it.name, loading: 'lazy' } });
      img.src = URL.createObjectURL(await Photo.toBlob(r.canvas, 0.8));
      r.canvas.width = r.canvas.height = 0;
      grid.appendChild(el('div', { cls: 'cert-cell' }, img,
        el('div', { cls: 'muted', text: `${it.team.short} · ${it.team.school}` }), r.small ? tag('ชื่อยาว ตัวอักษรถูกย่อ', 'warn') : null));
      if (++done % 20 === 0) $('certPreviewMsg').textContent = `กำลังสร้าง ${done}/${items.length} ใบ…`;
    }
    $('certPreviewMsg').textContent = `${items.length} ใบ · ตรวจชื่อทุกใบก่อนเผยแพร่`;
  }

  const PUBLISH_WORKERS = 3;                       // parallel uploads; Apps Script handles a few at once
  const TRANSIENT = ['busy', 'timeout', 'network', 'server_error', 'not_json'];

  async function publishOne(it, hash) {
    const r = await render(it.name, 1);
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
      const p = plan();
      const items = p.flatMap(x => x.members.filter(m => m.status === 'cert').map(m => ({ ...m, team: x.team })));
      const todo = [];
      let sent = 0, same = 0;
      items.forEach(it => {
        const hash = fnv(`${it.name}|${Poster.font}|${templateSig}`);
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
  $('certPublish').addEventListener('click', () => guarded(publish, 'certPublishMsg'));
  $('certOpen').addEventListener('click', () => guarded(toggleOpen, 'certPublishMsg'));
  $('certLinks').addEventListener('click', () => guarded(showLinks));
  // Only while this tab is open; opening the tab renders it.
  Store.on(() => { if (!$('tab-certs').classList.contains('hidden')) renderSummary(); });
  const tabBtn = document.querySelector('#tabs button[data-tab="certs"]');
  if (tabBtn) tabBtn.addEventListener('click', renderSummary);
  window.CertsTab = { plan, render, _setTemplate: (img, sig) => { template = img; templateSig = sig; renderSummary(); } };
})();
