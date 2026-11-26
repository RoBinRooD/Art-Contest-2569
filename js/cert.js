// Public certificate page. Opened from the QR on the team slip (#t=<token>), or by team code + last 4 phone digits.
// Shows each team member's certificate as a real image (press and hold to save), with save/share buttons.
(function () {
  const { el, tag } = App;
  const $ = id => document.getElementById(id);
  const call = (action, payload) => Api.call(action, payload, { noKey: true, retries: 1 });

  if (/Line\/|FBAN|FBAV|Instagram|Messenger/i.test(navigator.userAgent)) $('inApp').classList.remove('hidden');

  function token() {
    const m = location.hash.match(/[#&]t=([a-z0-9]+)/);
    return m ? m[1] : '';
  }

  function showLookup(msg) {
    $('lookup').classList.remove('hidden');
    if (msg) $('status').textContent = msg;
  }

  async function load() {
    const t = token();
    $('team').replaceChildren(); $('certs').replaceChildren();
    if (!t) { showLookup('สแกน QR บนหางบัตร หรือกรอกรหัสทีมด้านล่าง'); return; }
    $('status').textContent = 'กำลังโหลด…';
    let r;
    try { r = await call('cert', { token: t }); } catch (err) {
      showLookup(err.code === 'not_found' ? 'ลิงก์นี้ไม่ถูกต้อง ลองสแกน QR ใหม่ หรือกรอกรหัสทีมด้านล่าง' : Api.message(err));
      return;
    }
    const box = $('certs');
    if (r.poster) {
      $('team').replaceChildren(el('h2', { text: `${r.school}` }), el('div', { cls: 'muted', text: `${r.level} · ทีม ${r.short}` }));
      box.appendChild(posterBlock({ token: t }, r.short));
    }
    if (!r.open && r.poster) { $('status').replaceChildren(el('div', { cls: 'banner ok', text: `ทีมนี้ได้รับรางวัล${r.award || ''} เกียรติบัตรรางวัลฉบับพิมพ์จะมอบให้ตามช่องทางที่ผู้จัดแจ้ง` })); return; }
    if (!r.open) { $('status').replaceChildren(el('div', { cls: 'banner warn', text: 'ยังไม่เปิดให้รับเกียรติบัตร ระบบจะเปิดหลังประกาศผล โปรดเก็บหางบัตรนี้ไว้แล้วสแกนอีกครั้งภายหลัง' })); return; }
    if (!r.ready) { $('status').replaceChildren(el('div', { cls: 'banner warn', text: 'กำลังจัดทำเกียรติบัตรของทีมนี้ โปรดลองใหม่ภายหลัง' })); return; }
    $('status').replaceChildren();
    $('team').replaceChildren(el('h2', { text: `${r.school}` }), el('div', { cls: 'muted', text: `${r.level} · ทีม ${r.short}` }));
    const hasCert = r.members.some(m => m.status === 'cert');
    if (hasCert) box.appendChild(el('p', { cls: 'muted', text: 'บันทึกรูป: กดปุ่มใต้รูป หรือกดค้างที่รูปแล้วเลือก "บันทึกรูปภาพ"' }));
    r.members.forEach(m => box.appendChild(memberBlock(t, m)));
  }

  /** The team's award poster with save/share buttons. */
  function posterBlock(by, short, quietIfNone) {
    const block = el('div', { cls: 'cert' }, el('h3', { text: 'ภาพประกาศรางวัลของทีม' }));
    const slot = el('div', { cls: 'muted', text: 'กำลังโหลดภาพ…' });
    block.appendChild(slot);
    call('certPoster', by).then(r => {
      if (!short) $('team').replaceChildren(el('h2', { text: r.school }), el('div', { cls: 'muted', text: `${r.level} · ทีม ${r.short} · ${r.award}` }));
      slot.replaceWith(...imageWithSave(r.data, `ภาพประกาศรางวัล-ทีม-${r.short}.jpg`, 'ภาพประกาศรางวัล'));
    }).catch(err => {
      if (!short && err.code === 'not_found' && quietIfNone) {
        block.remove();
        $('lkMsg').textContent += ' · ไม่มีภาพประกาศของทีมนี้ (มีเฉพาะทีมที่ได้รางวัล และแอดมินเผยแพร่ภาพแล้ว)';
        return;
      }
      if (!short && err.code === 'not_found') { block.remove(); $('lkMsg').textContent = 'ไม่พบภาพประกาศของรหัสทีมนี้ (มีเฉพาะทีมที่ได้รางวัล และเผยแพร่แล้ว) ถ้าต้องการเกียรติบัตร ให้กรอกเลข 4 ตัวท้ายเบอร์ครูด้วย'; return; }
      slot.replaceChildren(tag(Api.message(err), 'bad'));
    });
    return block;
  }

  function imageWithSave(b64, fileName, alt) {
    const blob = Photo.base64ToBlob(b64);
    const url = URL.createObjectURL(blob);
    const file = new File([blob], fileName, { type: 'image/jpeg' });
    const actions = el('div', { cls: 'row' }, el('a', { cls: 'btn', text: 'บันทึกรูป', attrs: { href: url, download: fileName } }));
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      actions.appendChild(el('button', { cls: 'secondary', text: 'แชร์ / บันทึกลงรูปภาพ', on: { click: () => navigator.share({ files: [file], title: alt }).catch(() => {}) } }));
    }
    return [el('img', { attrs: { src: url, alt } }), actions];
  }

  function memberBlock(t, m) {
    const block = el('div', { cls: 'cert' }, el('h3', { text: m.name }));
    if (m.status === 'award') {
      block.appendChild(el('div', { cls: 'banner ok', text: `ทีมนี้ได้รับ${m.award ? 'รางวัล' + m.award : 'รางวัล'} เกียรติบัตรรางวัลฉบับพิมพ์จะมอบให้ตามช่องทางที่ผู้จัดแจ้ง` }));
      return block;
    }
    if (m.status === 'absent') {
      block.appendChild(el('div', { cls: 'banner warn', text: 'ไม่พบการบันทึกว่ามาร่วมกิจกรรม หากมาร่วมจริงโปรดติดต่อผู้จัดงาน' }));
      return block;
    }
    if (m.status !== 'cert') {
      block.appendChild(el('div', { cls: 'banner warn', text: 'กำลังจัดทำ โปรดลองใหม่ภายหลัง' }));
      return block;
    }
    const slot = el('div', { cls: 'muted', text: 'กำลังโหลดรูป…' });
    block.appendChild(slot);
    call('certImage', { token: t, sid: m.sid }).then(r => {
      const blob = Photo.base64ToBlob(r.data);
      const url = URL.createObjectURL(blob);
      const fileName = `เกียรติบัตร-${m.name.replace(/\s+/g, '-')}.jpg`;
      const file = new File([blob], fileName, { type: 'image/jpeg' });
      const actions = el('div', { cls: 'row' },
        el('a', { cls: 'btn', text: 'บันทึกรูป', attrs: { href: url, download: fileName } }));
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        actions.appendChild(el('button', { cls: 'secondary', text: 'แชร์ / บันทึกลงรูปภาพ', on: { click: () => navigator.share({ files: [file], title: 'เกียรติบัตร' }).catch(() => {}) } }));
      }
      slot.replaceWith(el('img', { attrs: { src: url, alt: 'เกียรติบัตรของ ' + m.name } }), actions);
    }).catch(err => { slot.replaceChildren(tag(Api.message(err), 'bad')); });
    return block;
  }

  $('lkGo').addEventListener('click', async () => {
    const code = $('lkCode').value.trim(), phone4 = $('lkPhone').value.trim();
    if (!code) { $('lkMsg').textContent = 'กรอกรหัสทีม'; return; }
    if (!phone4) {
      // team code alone: the award poster only (posters are public anyway)
      $('lkMsg').textContent = '';
      $('team').replaceChildren(); $('certs').replaceChildren(posterBlock({ code }, ''));
      $('status').textContent = '';
      return;
    }
    if (!/^\d{4}$/.test(phone4)) { $('lkMsg').textContent = 'เลขท้ายเบอร์โทรต้องมี 4 ตัว'; return; }
    $('lkMsg').textContent = 'กำลังค้นหา…';
    try {
      const r = await call('certLookup', { code, phone4 });
      if (!r.token) throw Object.assign(new Error(), { code: 'not_found' });
      $('lkMsg').textContent = '';
      $('lookup').classList.add('hidden');
      location.hash = 't=' + r.token;
    } catch (err) {
      if (err.code === 'not_open') {
        // certificates are not open yet, but a winning team's poster may already be there
        $('lkMsg').textContent = 'ยังไม่เปิดให้รับเกียรติบัตร ระบบจะเปิดหลังประกาศผล';
        $('team').replaceChildren(); $('certs').replaceChildren(posterBlock({ code }, '', true));
        $('status').textContent = '';
        return;
      }
      $('lkMsg').textContent = err.code === 'not_found' ? 'ไม่พบข้อมูลที่ตรงกัน ตรวจรหัสทีมและเบอร์โทรอีกครั้ง' : Api.message(err);
    }
  });
  window.addEventListener('hashchange', load);
  load();
})();
