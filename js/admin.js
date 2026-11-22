// Admin page: connect, self-test, live roster, check-in keying, award entry, lock.
(function () {
  const { el, tag, LEVEL_ORDER, LEVEL_SHORT, AWARD_LABEL, DEFAULT_HM, Store, timeOf } = App;
  const $ = id => document.getElementById(id);
  const REASONS = {
    no_code: 'แถวไม่มีรหัส', students_json: 'อ่านรายชื่อนักเรียนไม่ได้ (JSON เสีย)', duplicate_code: 'รหัสซ้ำ',
    short_clash: 'รหัส 3 ตัวท้ายซ้ำกับทีมอื่น', lookalike_code: 'รหัสคล้ายกันในระดับเดียวกัน (O/0, I/1 ฯลฯ)',
    student_in_two_teams: 'นักเรียนคนเดียวกันอยู่ 2 ทีม', unknown_level: 'ระดับชั้นไม่รู้จัก'
  };
  const WARN = { no_surname: 'ไม่มีนามสกุล', title_vs_level: 'คำนำหน้าไม่เข้ากับระดับชั้น' };
  const ATTEND = {
    present: ['มาครบ', 'ok'], partial: ['มาไม่ครบ', 'warn'], absent: ['ไม่มา', 'bad'], unknown: ['ยังไม่บันทึก', 'muted']
  };
  let currentTab = 'roster', ciLevel = 'all', awLevel = 'primary', editing = null;

  // ------------------------------------------------------------ helpers
  function flash(text, kind = 'bad') {
    const b = el('div', { cls: 'banner ' + kind, text });
    $('globalBanner').replaceChildren(b);
    if (kind !== 'bad') setTimeout(() => b.remove(), 4000);
  }

  async function guarded(fn) {
    try {
      await fn();
    } catch (err) {
      if (err.code === 'conflict') { await Store.loadState(); }
      let msg = Api.message(err);
      if (Array.isArray(err.detail) && err.code === 'cannot_lock') msg += ': ' + err.detail.slice(0, 8).join(' · ') + (err.detail.length > 8 ? ` และอีก ${err.detail.length - 8} รายการ` : '');
      flash(msg);
      if (err.code === 'bad_key') showConnected(false);
    }
  }

  function segButtons(container, items, current, onPick) {
    container.replaceChildren(...items.map(([k, label]) =>
      el('button', { cls: k === current ? 'active' : '', text: label, on: { click: () => onPick(k) } })));
  }

  // ------------------------------------------------------------ connection + tabs
  function showConnected(yes) {
    $('connect').classList.toggle('hidden', yes);
    $('tabs').classList.toggle('hidden', !yes);
    $('refresh').classList.toggle('hidden', !yes);
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('hidden', !yes || s.id !== 'tab-' + currentTab));
  }

  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + name));
    try { sessionStorage.setItem('artcontest.tab', name); } catch (e) { /* ignore */ }
  }

  async function saveConnection() {
    const url = $('apiUrl').value.trim();
    const key = $('adminKey').value.trim();
    const name = $('actorName').value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
      $('connMsg').textContent = 'ลิงก์ต้องขึ้นต้นด้วย https://script.google.com/macros/s/ และลงท้ายด้วย /exec';
      return;
    }
    if (!name) { $('connMsg').textContent = 'ใส่ชื่อผู้ใช้งาน'; return; }
    if (key.length < 20) { $('connMsg').textContent = 'ใส่คีย์แอดมินให้ครบ'; return; }
    Api.setUrl(url); Api.setKey(key); App.setActor(name);
    $('connMsg').textContent = 'กำลังทดสอบ…';
    try {
      await Store.loadAll();
      $('connMsg').textContent = '';
      $('adminKey').value = '';
      showConnected(true);
      showTab('roster');
      runTest();
    } catch (err) {
      $('connMsg').textContent = Api.message(err);
    }
  }

  async function refresh() {
    $('refresh').disabled = true;
    $('fresh').textContent = 'กำลังอ่านตาราง…';
    await guarded(() => Store.loadAll());
    $('refresh').disabled = false;
  }

  async function runTest() {
    const list = $('checks');
    list.replaceChildren(el('li', { cls: 'muted', text: 'กำลังทดสอบ…' }));
    try {
      const r = await Api.call('selftest', {}, { retries: 0 });
      list.replaceChildren(...r.checks.map(c => el('li', {}, tag(c.ok ? 'ผ่าน' : 'ไม่ผ่าน', c.ok ? 'ok' : 'bad'), ' ' + c.name + ' — ' + c.detail)));
      list.appendChild(el('li', { cls: 'muted', text: 'เวลาตอบกลับ ' + r.ms + ' ms' }));
    } catch (err) {
      list.replaceChildren(el('li', {}, tag('ไม่ผ่าน', 'bad'), ' ' + Api.message(err)));
    }
  }

  // ------------------------------------------------------------ render all
  function renderAll() {
    const r = Store.roster;
    if (!r) return;
    $('fresh').textContent = `ข้อมูลตาราง ณ ${timeOf(r.readAt)} · ${r.counts.teams} ทีม · แถวมีปัญหา ${r.problems.length}`;
    renderRoster(r);
    renderCheckin();
    renderAwards();
  }

  // ------------------------------------------------------------ roster tab
  function renderRoster(r) {
    const c = r.counts;
    $('rosterBanner').replaceChildren(r.fromSnapshot
      ? el('div', { cls: 'banner warn', text: `อ่านตารางสดไม่สำเร็จ (${Api.message({ code: r.liveError })}) — กำลังแสดงข้อมูลสำรอง ณ ${timeOf(r.readAt)}` })
      : el('div', { cls: 'banner ok', text: 'อ่านจากตารางรับสมัครตัวจริงเมื่อสักครู่ (ไม่ได้คัดลอกข้อมูล)' }));
    const stat = (label, value) => el('div', { cls: 'stat' }, el('b', { text: String(value) }), label);
    const stats = [stat('ทีม', c.teams), stat('นักเรียน', c.students)];
    LEVEL_ORDER.forEach(k => { const v = c.byLevel[k]; if (v) stats.push(stat(LEVEL_SHORT[k], `${v.teams} ทีม / ${v.students} คน`)); });
    stats.push(stat('ไม่มีคำนำหน้า', c.untitled), stat('ชื่อต้องตรวจ', c.check));
    if (c.unknownStatus) stats.push(stat('สถานะไม่รู้จัก', c.unknownStatus));
    if (c.cancelled) stats.push(stat('ยกเลิก', c.cancelled));
    $('stats').replaceChildren(...stats);
    $('problems').replaceChildren(...(r.problems.length
      ? [el('div', { cls: 'banner warn' }, el('b', { text: 'ต้องตรวจ: ' }),
          ...r.problems.map(p => el('div', { text: `${p.code} — ${REASONS[p.reason] || p.reason}${p.other ? ' (' + p.other + ')' : ''}` })))]
      : []));
    $('teams').replaceChildren(...App.sortTeams(r.teams).map(t => {
      const names = el('div');
      t.members.forEach(m => names.appendChild(memberLine(m)));
      const status = el('td', { cls: 'hide-sm' }, t.status);
      if (t.statusClass === 'unknown') status.appendChild(tag('ไม่รู้จัก', 'warn'));
      if (t.statusClass === 'cancelled') status.appendChild(tag('ยกเลิก', 'bad'));
      t.flags.forEach(f => status.appendChild(tag(REASONS[f] || f, 'bad')));
      return el('tr', {},
        el('td', {}, el('div', { cls: 'code', text: t.short }), el('div', { cls: 'muted', text: t.code })),
        el('td', { text: LEVEL_SHORT[t.levelKey] || t.levelKey }),
        el('td', { text: t.school }),
        el('td', {}, names),
        status);
    }));
  }

  function memberLine(m) {
    const line = el('div', {}, m.printName);
    if (m.titleState === 'none') line.appendChild(tag('ไม่มีคำนำหน้า', 'warn'));
    if (m.titleState === 'check') line.appendChild(tag('ต้องตรวจ', 'bad'));
    m.warnings.filter(w => WARN[w]).forEach(w => line.appendChild(tag(WARN[w], 'warn')));
    if (!m.idOk) line.appendChild(tag('เลขบัตรไม่ครบ', 'warn'));
    return line;
  }

  // ------------------------------------------------------------ check-in tab
  function renderCheckin() {
    segButtons($('ciLevels'), [['all', 'ทุกระดับ'], ...LEVEL_ORDER.map(k => [k, LEVEL_SHORT[k]])], ciLevel, k => { ciLevel = k; renderCheckin(); });
    const q = $('ciSearch').value.trim();
    const all = Store.activeTeams();
    const inLevel = all.filter(t => ciLevel === 'all' || t.levelKey === ciLevel);
    const shown = inLevel.filter(t => !q || App.fold(t.short).includes(App.fold(q)) || t.school.includes(q));

    const counts = { present: 0, partial: 0, absent: 0, unknown: 0, students: 0 };
    inLevel.forEach(t => { counts[Store.attend(t.code).state]++; counts.students += App.presentMembers(t).length; });
    const stat = (label, value) => el('div', { cls: 'stat' }, el('b', { text: String(value) }), label);
    $('ciStats').replaceChildren(stat('ทีมทั้งหมด', inLevel.length), stat('มาครบ', counts.present), stat('มาไม่ครบ', counts.partial),
      stat('ไม่มา', counts.absent), stat('ยังไม่บันทึก', counts.unknown), stat('นักเรียนที่มา', counts.students));

    $('ciList').replaceChildren(...shown.map(teamCheckinCard));
  }

  function teamCheckinCard(t) {
    const a = Store.attend(t.code);
    const [label, kind] = ATTEND[a.state];
    const head = el('div', { cls: 'ci-head' },
      el('span', { cls: 'code big', text: t.short }),
      el('div', { cls: 'ci-school' }, el('div', { text: t.school }), el('div', { cls: 'muted', text: LEVEL_SHORT[t.levelKey] + ' · ' + t.members.length + ' คน' })),
      tag(label, kind));
    const card = el('div', { cls: 'ci-card ' + a.state }, head);

    if (editing === t.code) {
      const boxes = t.members.map(m => {
        const cb = el('input', { attrs: { type: 'checkbox' } });
        cb.checked = a.absent.includes(m.sid);
        return { m, cb };
      });
      card.appendChild(el('div', { cls: 'muted', text: 'ติ๊กคนที่ไม่มา' }));
      boxes.forEach(({ m, cb }) => card.appendChild(el('label', { cls: 'ci-member' }, cb, ' ' + m.printName)));
      card.appendChild(el('div', { cls: 'row' },
        el('button', { text: 'บันทึก', on: { click: () => guarded(async () => {
          const absent = boxes.filter(b => b.cb.checked).map(b => b.m.sid);
          if (!absent.length) return flash('ยังไม่ได้ติ๊กคนที่ไม่มา (ถ้ามาครบให้กด "มาครบ")');
          if (absent.length === t.members.length) return flash('ติ๊กครบทุกคน ถ้าไม่มาเลยให้กด "ไม่มา"');
          await Store.set('attend:' + t.code, { state: 'partial', absent });
          editing = null; renderCheckin();
        }) } }),
        el('button', { cls: 'secondary', text: 'ยกเลิก', on: { click: () => { editing = null; renderCheckin(); } } })));
      return card;
    }

    const names = el('div', { cls: 'ci-names' });
    t.members.forEach(m => {
      const absent = a.state === 'absent' || (a.state === 'partial' && a.absent.includes(m.sid));
      names.appendChild(el('div', { cls: absent ? 'struck' : '' }, m.printName));
    });
    card.appendChild(names);
    const btn = (text, cls, fn) => el('button', { cls, text, on: { click: () => guarded(fn) } });
    card.appendChild(el('div', { cls: 'row' },
      btn('มาครบ', a.state === 'present' ? '' : 'secondary', () => Store.set('attend:' + t.code, { state: 'present' })),
      btn('มาไม่ครบ…', a.state === 'partial' ? '' : 'secondary', async () => { editing = t.code; renderCheckin(); }),
      btn('ไม่มา', a.state === 'absent' ? '' : 'secondary', () => Store.set('attend:' + t.code, { state: 'absent' })),
      a.state !== 'unknown' ? btn('ล้าง', 'link', () => Store.set('attend:' + t.code, { state: 'unknown' })) : null));
    return card;
  }

  // ------------------------------------------------------------ awards tab
  function rowsForLevel(level) {
    const stored = Store.awardRows(level);
    const knownKeys = new Set(Object.keys(Store.state));
    const rows = stored.slice();
    [1, 2, 3, 4].forEach(award => {
      const defaults = award === 4 ? DEFAULT_HM : 1;
      for (let n = 1; n <= defaults; n++) {
        const key = `award:${level}-${award}-${n}`;
        if (!knownKeys.has(key)) rows.push({ key, v: 0, level, award, order: n, team: '', virtual: true });
      }
    });
    return rows.sort((a, b) => a.award - b.award || a.order - b.order);
  }

  function nextOrder(level, award) {
    let max = 0;
    Object.keys(Store.state).forEach(k => {
      const m = k.match(new RegExp(`^award:${level}-${award}-(\\d+)$`));
      if (m) max = Math.max(max, Number(m[1]));
    });
    return Math.max(max, award === 4 ? DEFAULT_HM : 1) + 1;
  }

  function renderAwards() {
    segButtons($('awLevels'), LEVEL_ORDER.map(k => [k, LEVEL_SHORT[k]]), awLevel, k => { awLevel = k; renderAwards(); });
    const locked = Store.locked();
    const teams = Store.activeTeams().filter(t => t.levelKey === awLevel);
    const rows = rowsForLevel(awLevel);
    const groups = [1, 2, 3, 4].map(award => {
      const list = rows.filter(r => r.award === award);
      const box = el('div', { cls: 'aw-group' }, el('h3', { text: AWARD_LABEL[award] }));
      list.forEach((r, i) => box.appendChild(awardRow(r, teams, locked, list.length > 1 ? i + 1 : null)));
      if (!locked) box.appendChild(el('button', { cls: 'link', text: '+ เพิ่มช่อง' + AWARD_LABEL[award], on: { click: () => guarded(async () => {
        const n = nextOrder(awLevel, award);
        await Store.set(`award:${awLevel}-${award}-${n}`, { level: awLevel, award, order: n, team: '' }, 0);
      }) } }));
      return box;
    });
    const filled = rows.filter(r => r.team).length;
    $('awList').replaceChildren(el('p', { cls: 'muted', text: `${LEVEL_SHORT[awLevel]}: ${teams.length} ทีม · ใส่ผลแล้ว ${filled}/${rows.length} ช่อง` }), ...groups);
    renderLock();
  }

  function awardRow(r, teams, locked, number) {
    const sel = el('select', { attrs: { disabled: locked ? '' : null } });
    sel.appendChild(el('option', { text: '— เลือกทีม —', attrs: { value: '' } }));
    teams.slice().sort((a, b) => a.short.localeCompare(b.short)).forEach(t => {
      const other = Store.awardOf(t.code);
      const takenElsewhere = other && !(other.award === r.award && other.order === r.order && other.level === r.level);
      const o = el('option', { text: `${t.short} · ${t.school}${takenElsewhere ? ' (ได้' + AWARD_LABEL[other.award] + 'แล้ว)' : ''}`, attrs: { value: t.code } });
      if (takenElsewhere) o.disabled = true;
      sel.appendChild(o);
    });
    sel.value = r.team || '';
    sel.addEventListener('change', () => guarded(async () => {
      const team = sel.value;
      if (r.team && team !== r.team && !confirm(`เปลี่ยนจาก ${Store.team(r.team)?.short || r.team} เป็น ${team ? Store.team(team).short : '(ว่าง)'} ?`)) { sel.value = r.team; return; }
      await Store.set(r.key, { level: r.level, award: r.award, order: r.order, team }, r.v);
    }));

    const info = el('div', { cls: 'aw-info' });
    const t = r.team && Store.team(r.team);
    if (r.team && !t) info.appendChild(tag('ไม่พบทีมนี้ในตารางรับสมัครแล้ว', 'bad'));
    if (t) {
      const a = Store.attend(t.code);
      info.appendChild(el('div', { text: t.members.map(m => m.printName).join(' · ') }));
      if (a.state === 'unknown') info.appendChild(tag('ยังไม่ได้เช็กอิน — ไปบันทึกที่แท็บเช็กอิน', 'warn'));
      if (a.state === 'absent') info.appendChild(tag('บันทึกว่าไม่มา', 'bad'));
      if (a.state === 'partial') info.appendChild(tag('มาไม่ครบ', 'warn'));
      if (t.statusClass === 'cancelled') info.appendChild(tag('ถูกยกเลิกในระบบรับสมัคร', 'bad'));
    }
    const del = !locked ? el('button', { cls: 'link', text: 'ลบช่อง', on: { click: () => guarded(async () => {
      if (!confirm('ลบช่องรางวัลนี้? (ใช้เมื่อรางวัลนี้ไม่มีผู้ได้รับ)')) return;
      await Store.set(r.key, null, r.v);
    }) } }) : null;
    return el('div', { cls: 'aw-row' }, el('span', { cls: 'aw-num', text: number ? String(number) : '' }), sel, del, info);
  }

  function renderLock() {
    const card = $('lockCard');
    const lock = Store.state.lock;
    if (Store.locked()) {
      card.replaceChildren(
        el('h2', { text: 'ล็อกผลแล้ว' }),
        el('div', { cls: 'banner ok', text: `ล็อกโดย ${lock.value.by} เมื่อ ${App.dateTimeOf(lock.at)} — แก้ผลรางวัลไม่ได้จนกว่าจะปลดล็อก (การเช็กอินยังแก้ได้)` }),
        el('div', { cls: 'row' },
          el('a', { cls: 'btn', text: 'พิมพ์รายชื่อสำหรับพิธีกร', attrs: { href: 'print.html#mc', target: '_blank', rel: 'noopener' } }),
          el('button', { cls: 'secondary', text: 'ปลดล็อก', on: { click: () => guarded(async () => {
            if (!confirm('ปลดล็อกผล? ใช้เมื่อต้องแก้ผลรางวัลเท่านั้น')) return;
            await Store.set('lock', { locked: false }, lock.v);
          }) } })));
      return;
    }
    card.replaceChildren(
      el('h2', { text: 'ล็อกผล' }),
      el('p', { cls: 'muted', text: 'ก่อนล็อก ให้อีกคนอ่านทวนกับแบบฟอร์มที่ประธานกรรมการเซ็นทีละระดับ ระบบจะไม่ยอมล็อกถ้ายังมีช่องรางวัลว่าง หรือมีทีมที่ยังไม่ได้บันทึกการมาแข่ง' }),
      el('button', { text: 'ล็อกผลรางวัล', on: { click: () => guarded(async () => {
        if (!confirm('ยืนยันล็อกผลรางวัลทุกระดับ?')) return;
        await Store.set('lock', { locked: true }, lock ? lock.v : 0);
        flash('ล็อกผลแล้ว', 'ok');
      }) } }));
  }

  // ------------------------------------------------------------ start
  Api.takeKeyFromHash();
  $('apiUrl').value = Api.apiUrl();
  $('actorName').value = App.actor() === 'admin' ? '' : App.actor();
  $('saveConn').addEventListener('click', saveConnection);
  $('runTest').addEventListener('click', runTest);
  $('refresh').addEventListener('click', refresh);
  $('ciSearch').addEventListener('input', renderCheckin);
  $('forget').addEventListener('click', () => { Api.forget(); showConnected(false); });
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  Store.on(renderAll);
  let saved = 'roster';
  try { saved = sessionStorage.getItem('artcontest.tab') || 'roster'; } catch (e) { /* ignore */ }
  if (Api.apiUrl() && Api.hasKey()) {
    showConnected(true);
    showTab(saved);
    refresh();
  }
})();
