// Phone page: pick today's photos from the gallery, read the team card, upload one by one with retry.
(function () {
  const { el, tag } = App;
  const $ = id => document.getElementById(id);
  const items = [];
  let running = false;

  Api.takeKeyFromHash();
  if (!Api.hasKey()) { $('noKey').classList.remove('hidden'); $('main').classList.add('hidden'); }
  if (/Line\/|FBAN|FBAV|Instagram/i.test(navigator.userAgent)) $('inApp').classList.remove('hidden');

  function render() {
    // Other photos keep updating the list; keep the code box the photographer is typing in focused.
    const act = document.activeElement;
    const typingIn = act && act.dataset && act.dataset.ask ? act.dataset.ask : null;
    const done = items.filter(i => i.state === 'done').length;
    const failed = items.filter(i => i.state === 'failed').length;
    $('summary').textContent = items.length ? `ส่งแล้ว ${done}/${items.length} รูป${failed ? ` · ล้มเหลว ${failed}` : ''}` : '';
    $('list').replaceChildren(...items.map(it => {
      const status = {
        wait: tag('รอ', 'muted'), prep: tag('กำลังเตรียม', 'muted'), ask: tag('รอกรอกรหัส', 'warn'), send: tag('กำลังส่ง…', 'muted'),
        done: tag('ส่งแล้ว', 'ok'), failed: tag('ล้มเหลว', 'bad')
      }[it.state];
      const code = it.code ? tag('ทีม ' + it.code.split('-').pop(), 'ok')
        : it.typed ? tag('ทีม ' + it.typed + ' (กรอกเอง)', 'ok')
        : (it.state === 'done' || it.state === 'failed') ? tag('ไม่ระบุทีม — แอดมินจะระบุเอง', 'warn') : null;
      return el('div', { cls: 'item' + (it.state === 'ask' ? ' ask' : '') },
        it.thumbUrl ? el('img', { attrs: { src: it.thumbUrl, alt: '' } }) : el('img', { attrs: { alt: '' } }),
        el('div', { cls: 'info' }, el('div', { text: it.file.name }), status, ' ', code, it.error ? el('div', { cls: 'muted', text: it.error }) : null,
          it.state === 'ask' ? askBox(it) : null),
        it.state === 'failed' ? el('button', { cls: 'secondary small', text: 'ลองใหม่', on: { click: () => { it.state = 'wait'; it.error = ''; run(); } } }) : null);
    }));
    if (typingIn) {
      const box = $('list').querySelector(`input[data-ask="${typingIn}"]`);
      if (box) { box.focus({ preventScroll: true }); box.setSelectionRange(box.value.length, box.value.length); }
    }
  }

  // Typed team code: what is written on the code card / sticker (3 characters), or the full code.
  const cleanCode = v => v.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9-]/g, '');

  /** No team card found in the photo: the photographer types the code from the card, or sends without one. */
  function askBox(it) {
    const input = el('input', { attrs: { 'data-ask': String(items.indexOf(it)), type: 'text', inputmode: 'text', autocapitalize: 'characters', autocomplete: 'off',
      maxlength: '16', placeholder: 'รหัส 3 ตัว เช่น 3FA', value: it.draft || '' } });
    input.addEventListener('input', () => { it.draft = input.value; });
    const msg = el('div', { cls: 'muted' });
    const send = () => {
      const v = cleanCode(input.value);
      if (v.length < 2) { msg.textContent = 'กรอกรหัสบนป้ายในรูป (3 ตัว)'; input.focus(); return; }
      it.typed = v; it.state = 'wait'; render(); run();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    return el('div', { cls: 'ask-box' },
      el('div', { text: 'อ่านป้ายรหัสในรูปไม่ได้ ดูรหัสบนป้ายแล้วกรอก (ห้ามเดา)' }),
      el('div', { cls: 'row' }, input,
        el('button', { cls: 'small', text: 'ส่ง', on: { click: send } }),
        el('button', { cls: 'link', text: 'ส่งโดยไม่ระบุทีม', on: { click: () => { it.skipCode = true; it.state = 'wait'; render(); run(); } } })),
      msg);
  }

  async function processOne(it) {
    try {
      if (!it.norm) {
        it.state = 'prep'; render();
        it.norm = await Photo.normalize(it.file);
        it.thumbUrl = URL.createObjectURL(it.norm.thumb);
        it.code = Photo.decodeCode(it.norm.canvas);
        it.norm.canvas.width = it.norm.canvas.height = 0;   // free memory
      }
      if (!it.code && !it.typed && !it.skipCode) { it.state = 'ask'; render(); return; }   // wait for the photographer
      it.state = 'send'; render();
      const takenAt = new Date(it.file.lastModified || Date.now()).toISOString();
      if (it.code) {
        await Photo.upload(it.norm, { team: it.code, name: it.file.name, takenAt });
      } else if (it.typed) {
        // The typed code also rides in the file name, so the admin page still finds the team if the server
        // will not take a short code as the photo's team.
        const name = `[ทีม ${it.typed}] ${it.file.name}`;
        try { await Photo.upload(it.norm, { team: it.typed, name, takenAt }); }
        catch (err) {
          if (!['bad_value', 'unknown_team', 'wrong_level'].includes(err.code)) throw err;
          await Photo.upload(it.norm, { team: '', name, takenAt });
        }
      } else {
        await Photo.upload(it.norm, { team: '', name: it.file.name, takenAt });
      }
      it.state = 'done';
    } catch (err) {
      it.state = 'failed';
      it.error = err.message === 'heic' ? 'เป็นไฟล์ HEIC: ตั้งกล้อง iPhone เป็น "เข้ากันได้มากที่สุด" แล้วถ่ายใหม่ หรือส่งผ่านสายไปที่โน้ตบุ๊ก'
        : err.message === 'decode' ? 'เปิดรูปนี้ไม่ได้' : Api.message(err);
    }
    render();
  }

  async function run() {
    if (running) return;
    running = true;
    for (let it; (it = items.find(i => i.state === 'wait'));) await processOne(it);
    running = false;
  }

  $('files').addEventListener('change', e => {
    [...e.target.files].forEach(file => items.push({ file, state: 'wait' }));
    e.target.value = '';
    render();
    run();
  });
  window.addEventListener('online', () => { items.filter(i => i.state === 'failed').forEach(i => { i.state = 'wait'; }); run(); });
  window.addEventListener('beforeunload', e => { if (items.some(i => i.state !== 'done' && i.state !== 'failed')) { e.preventDefault(); e.returnValue = ''; } });
})();
