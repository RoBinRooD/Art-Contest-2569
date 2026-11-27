// Phone page for student helpers: record which teams came (all / some / none), nothing else.
// Opened from the admin's QR (#s=<staff key>); the key only allows reading the team list and recording attendance.
(function () {
  const { el, tag, LEVEL_ORDER, LEVEL_SHORT } = App;
  const $ = id => document.getElementById(id);
  const KEY_STORE = 'artcontest.staffKey', NAME_STORE = 'artcontest.staffName';
  const safeGet = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const STATE = { present: ['มาครบ', 'ok'], partial: ['มาไม่ครบ', 'warn'], absent: ['ไม่มา', 'bad'], unknown: ['ยังไม่บันทึก', 'muted'] };

  let teams = [], level = 'all', view = 'todo', editing = null, busy = false, lastLoad = 0;

  // key from the link, then removed from the address bar
  const m = location.hash.match(/[#&]s=([A-Za-z0-9]+)/);
  if (m) { safeSet(KEY_STORE, m[1]); history.replaceState(null, '', location.pathname + location.search); }
  const key = safeGet(KEY_STORE);
  const call = (action, payload, opts = {}) => Api.call(action, payload, { key, retries: 1, ...opts });

  function toast(text, kind = 'bad') {
    const b = el('div', { cls: 'banner ' + kind, text });
    $('toast').replaceChildren(b);
    setTimeout(() => { if (b.parentNode) b.remove(); }, kind === 'bad' ? 6000 : 2500);
  }

  // ---------------------------------------------------------------- data
  async function load(quiet) {
    if (busy) return;
    busy = true;
    try {
      if (!quiet) $('fresh').textContent = 'กำลังโหลดรายชื่อ…';
      const r = await call('staffRoster', {}, { timeoutMs: 60000 });
      teams = r.teams.sort((a, b) => LEVEL_ORDER.indexOf(a.levelKey) - LEVEL_ORDER.indexOf(b.levelKey) || a.short.localeCompare(b.short));
      lastLoad = Date.now();
      $('fresh').textContent = `ข้อมูล ณ ${App.timeOf(r.readAt)} · อัปเดตเองทุก 30 วินาที`;
      render();
    } catch (err) {
      if (err.code === 'bad_key') { $('main').classList.add('hidden'); $('noKey').classList.remove('hidden'); }
      $('fresh').textContent = Api.message(err);
    } finally { busy = false; }
  }

  async function save(t, state, absent) {
    const card = document.getElementById('t-' + t.code);
    if (card) card.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const r = await call('staffAttend', { code: t.code, state, absent: absent || [], expectV: t.attend.v, actor: safeGet(NAME_STORE) }, { retries: 0, timeoutMs: 60000 });
      const e = r.entry;
      t.attend = { state: e.value.state, absent: e.value.absent || [], by: e.by, at: e.at, v: e.v };
      editing = null;
      toast(`ทีม ${t.short}: ${STATE[state][0]} ✓`, 'ok');
    } catch (err) {
      toast(err.code === 'conflict' ? `มีคนบันทึกทีม ${t.short} ไปก่อนแล้ว — โหลดค่าล่าสุดให้ ตรวจแล้วกดใหม่` : Api.message(err));
      if (err.code === 'conflict') { editing = null; await load(true); return; }
    }
    render();
  }

  // ---------------------------------------------------------------- view
  function chips(box, items, current, pick) {
    box.replaceChildren(...items.map(([k, label]) => el('button', { cls: k === current ? 'active' : 'secondary', text: label, on: { click: () => pick(k) } })));
  }

  function render() {
    chips($('levels'), [['all', 'ทุกระดับ'], ...LEVEL_ORDER.map(k => [k, LEVEL_SHORT[k]])], level, k => { level = k; render(); });
    chips($('views'), [['todo', 'ยังไม่บันทึก'], ['all', 'ทั้งหมด'], ['partial', 'มาไม่ครบ'], ['absent', 'ไม่มา']], view, k => { view = k; render(); });
    const inLevel = teams.filter(t => level === 'all' || t.levelKey === level);
    const done = inLevel.filter(t => t.attend.state !== 'unknown').length;
    const came = inLevel.reduce((n, t) => n + (t.attend.state === 'present' ? t.members.length : t.attend.state === 'partial' ? t.members.length - t.attend.absent.length : 0), 0);
    const all = inLevel.reduce((n, t) => n + t.members.length, 0);
    const stat = (label, value) => el('div', { cls: 'stat' }, el('b', { text: String(value) }), label);
    $('stats').replaceChildren(stat('บันทึกแล้ว', `${done} / ${inLevel.length} ทีม`), stat('มาแล้ว', `${came} / ${all} คน`));

    const q = App.fold($('q').value.trim());
    const shown = inLevel.filter(t => (view === 'all' || (view === 'todo' ? t.attend.state === 'unknown' : t.attend.state === view) || t.code === editing)
      && (!q || App.fold(t.short).includes(q) || t.school.includes($('q').value.trim())));
    $('list').replaceChildren(...(shown.length ? shown.map(card)
      : [el('p', { cls: 'muted', text: view === 'todo' && !q ? 'บันทึกครบทุกทีมในระดับนี้แล้ว 🎉' : 'ไม่พบทีม' })]));
  }

  function card(t) {
    const a = t.attend, [label, kind] = STATE[a.state];
    const box = el('div', { cls: 'team ' + a.state, attrs: { id: 't-' + t.code } },
      el('div', { cls: 'head' }, el('span', { cls: 'code', text: t.short }), el('span', { cls: 'school', text: t.school })),
      el('div', {}, tag(LEVEL_SHORT[t.levelKey], 'muted'), tag(label, kind),
        a.by ? el('span', { cls: 'muted who', text: ` โดย ${a.by} ${App.timeOf(a.at)}` }) : null));
    if (editing === t.code) {
      // tick who did NOT come
      const picks = t.members.map(mb => {
        const cb = el('input', { attrs: { type: 'checkbox' } });
        cb.checked = a.absent.includes(mb.sid);
        return { mb, cb };
      });
      box.append(el('div', { cls: 'members' }, el('div', { cls: 'muted', text: 'ติ๊กคนที่ "ไม่มา"' }),
        ...picks.map(({ mb, cb }) => el('label', {}, cb, mb.name))));
      box.append(el('div', { cls: 'acts' },
        el('button', { cls: 'warn', text: 'บันทึก', on: { click: () => {
          const absent = picks.filter(p => p.cb.checked).map(p => p.mb.sid);
          if (!absent.length) return toast('ยังไม่ได้ติ๊กคนที่ไม่มา (ถ้ามาครบให้กด "มาครบ")');
          if (absent.length === t.members.length) return toast('ติ๊กครบทุกคน ถ้าไม่มาเลยให้กด "ไม่มา"');
          save(t, 'partial', absent);
        } } }),
        el('button', { cls: 'secondary', text: 'ยกเลิก', on: { click: () => { editing = null; render(); } } }),
        el('span')));
      return box;
    }
    box.append(el('div', { cls: 'members' }, ...t.members.map(mb =>
      el('div', { cls: a.absent.includes(mb.sid) || a.state === 'absent' ? 'struck' : '', text: '• ' + mb.name }))));
    box.append(el('div', { cls: 'acts' },
      el('button', { cls: 'ok', text: 'มาครบ', on: { click: () => save(t, 'present') } }),
      el('button', { cls: 'warn', text: 'มาไม่ครบ…', on: { click: () => { editing = t.code; render(); } } }),
      el('button', { cls: 'bad', text: 'ไม่มา', on: { click: () => { if (confirm(`ทีม ${t.short} ไม่มาเลยทั้งทีม?`)) save(t, 'absent'); } } })));
    if (a.state !== 'unknown') box.append(el('button', { cls: 'link', text: 'ล้างการบันทึกของทีมนี้', on: { click: () => { if (confirm(`ล้างการบันทึกทีม ${t.short}?`)) save(t, 'unknown'); } } }));
    return box;
  }

  // ---------------------------------------------------------------- start
  function start() {
    $('who').classList.add('hidden');
    $('main').classList.remove('hidden');
    let tmr = 0;
    $('q').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(render, 150); });
    load();
    setInterval(() => { if (!editing && !document.hidden && Date.now() - lastLoad > 25000) load(true); }, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > 10000) load(true); });
  }

  if (!key) { $('noKey').classList.remove('hidden'); return; }
  if (!safeGet(NAME_STORE)) {
    $('who').classList.remove('hidden');
    const go = () => { const n = $('whoName').value.trim(); if (!n) return; safeSet(NAME_STORE, n); start(); };
    $('whoSave').addEventListener('click', go);
    $('whoName').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  } else start();
})();
