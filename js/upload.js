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
    const done = items.filter(i => i.state === 'done').length;
    const failed = items.filter(i => i.state === 'failed').length;
    $('summary').textContent = items.length ? `ส่งแล้ว ${done}/${items.length} รูป${failed ? ` · ล้มเหลว ${failed}` : ''}` : '';
    $('list').replaceChildren(...items.map(it => {
      const status = {
        wait: tag('รอ', 'muted'), prep: tag('กำลังเตรียม', 'muted'), send: tag('กำลังส่ง…', 'muted'),
        done: tag('ส่งแล้ว', 'ok'), failed: tag('ล้มเหลว', 'bad')
      }[it.state];
      const code = it.code ? tag('ทีม ' + it.code.split('-').pop(), 'ok') : (it.state === 'wait' || it.state === 'prep' ? null : tag('ไม่พบป้ายรหัส — แอดมินจะระบุเอง', 'warn'));
      return el('div', { cls: 'item' },
        it.thumbUrl ? el('img', { attrs: { src: it.thumbUrl, alt: '' } }) : el('img', { attrs: { alt: '' } }),
        el('div', { cls: 'info' }, el('div', { text: it.file.name }), status, ' ', code, it.error ? el('div', { cls: 'muted', text: it.error }) : null),
        it.state === 'failed' ? el('button', { cls: 'secondary small', text: 'ลองใหม่', on: { click: () => { it.state = 'wait'; it.error = ''; run(); } } }) : null);
    }));
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
      it.state = 'send'; render();
      await Photo.upload(it.norm, { team: it.code, name: it.file.name, takenAt: new Date(it.file.lastModified || Date.now()).toISOString() });
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
