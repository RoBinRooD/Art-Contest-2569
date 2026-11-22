// Admin page, stage 1: connect, self-test, live roster with name preview.
// All sheet-derived text is inserted with textContent, never innerHTML.
(function () {
  const $ = id => document.getElementById(id);
  const LEVEL_ORDER = ['primary', 'm1', 'm4'];
  const LEVEL_SHORT = { primary: 'ประถม 4-6', m1: 'ม.1-3', m4: 'ม.4-6' };
  const REASONS = {
    no_code: 'แถวไม่มีรหัส', students_json: 'อ่านรายชื่อนักเรียนไม่ได้ (JSON เสีย)', duplicate_code: 'รหัสซ้ำ',
    short_clash: 'รหัส 3 ตัวท้ายซ้ำกับทีมอื่น', lookalike_code: 'รหัสคล้ายกันในระดับเดียวกัน (O/0, I/1 ฯลฯ)',
    student_in_two_teams: 'นักเรียนคนเดียวกันอยู่ 2 ทีม'
  };
  const WARN = { latin: 'มีอักษรอังกฤษ', no_surname: 'ไม่มีนามสกุล', title_vs_level: 'คำนำหน้าไม่เข้ากับระดับชั้น', empty: 'ชื่อว่าง' };

  function el(tag, opts = {}, ...children) {
    const n = document.createElement(tag);
    if (opts.cls) n.className = opts.cls;
    if (opts.text != null) n.textContent = opts.text;
    children.flat().forEach(c => c && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  const tag = (text, kind) => el('span', { cls: 'tag ' + kind, text });
  const timeOf = iso => (iso || '').slice(11, 19);

  function showConnected(yes) {
    $('connect').classList.toggle('hidden', yes);
    $('health').classList.toggle('hidden', !yes);
    $('rosterCard').classList.toggle('hidden', !yes);
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

  async function loadRoster() {
    $('refresh').disabled = true;
    $('fresh').textContent = 'กำลังอ่านตาราง…';
    try {
      const r = await Api.call('roster');
      render(r);
    } catch (err) {
      $('rosterBanner').replaceChildren(el('div', { cls: 'banner bad', text: Api.message(err) }));
      $('fresh').textContent = '';
      if (err.code === 'bad_key') showConnected(false);
    } finally {
      $('refresh').disabled = false;
    }
  }

  function render(r) {
    const c = r.counts;
    $('fresh').textContent = `ข้อมูลตาราง ณ ${timeOf(r.readAt)} · ${c.teams} ทีม · แถวมีปัญหา ${r.problems.length}`;
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

    const teams = r.teams.slice().sort((a, b) =>
      LEVEL_ORDER.indexOf(a.levelKey) - LEVEL_ORDER.indexOf(b.levelKey) || a.school.replace(/^โรงเรียน/, '').localeCompare(b.school.replace(/^โรงเรียน/, ''), 'th'));
    $('teams').replaceChildren(...teams.map(t => {
      const names = el('div');
      t.members.forEach(m => {
        const line = el('div', {}, m.printName);
        if (m.titleState === 'none') line.appendChild(tag('ไม่มีคำนำหน้า', 'warn'));
        if (m.titleState === 'check') line.appendChild(tag('ต้องตรวจ', 'bad'));
        m.warnings.filter(w => w !== 'latin' && w !== 'empty').forEach(w => line.appendChild(tag(WARN[w] || w, 'warn')));
        if (!m.idOk) line.appendChild(tag('เลขบัตรไม่ครบ', 'warn'));
        names.appendChild(line);
      });
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

  async function saveConnection() {
    const url = $('apiUrl').value.trim();
    const key = $('adminKey').value.trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
      $('connMsg').textContent = 'ลิงก์ต้องขึ้นต้นด้วย https://script.google.com/macros/s/ และลงท้ายด้วย /exec';
      return;
    }
    if (key.length < 20) { $('connMsg').textContent = 'ใส่คีย์แอดมินให้ครบ'; return; }
    Api.setUrl(url);
    Api.setKey(key);
    $('connMsg').textContent = 'กำลังทดสอบ…';
    try {
      await Api.call('roster', {}, { retries: 0 });
      $('connMsg').textContent = '';
      $('adminKey').value = '';
      showConnected(true);
      runTest();
      loadRoster();
    } catch (err) {
      $('connMsg').textContent = Api.message(err);
    }
  }

  Api.takeKeyFromHash();
  $('apiUrl').value = Api.apiUrl();
  $('saveConn').addEventListener('click', saveConnection);
  $('runTest').addEventListener('click', runTest);
  $('refresh').addEventListener('click', loadRoster);
  $('forget').addEventListener('click', () => { Api.forget(); showConnected(false); });
  if (Api.apiUrl() && Api.hasKey()) { showConnected(true); loadRoster(); }
})();
