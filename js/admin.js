// Admin page: connect, self-test, live roster, check-in keying, award entry, lock.
(function () {
  const { el, tag, LEVEL_ORDER, LEVEL_SHORT, AWARD_LABEL, DEFAULT_HM, Store, timeOf } = App;
  const $ = id => document.getElementById(id);
  const REASONS = {
    no_code: 'แถวไม่มีรหัส', students_json: 'อ่านรายชื่อนักเรียนไม่ได้ (JSON เสีย)', duplicate_code: 'รหัสซ้ำ',
    short_clash: 'รหัส 3 ตัวท้ายซ้ำกับทีมอื่น', lookalike_code: 'รหัสคล้ายกันในระดับเดียวกัน (O/0, I/1 ฯลฯ)',
    student_in_two_teams: 'นักเรียนคนเดียวกันอยู่ 2 ทีม', unknown_level: 'ระดับชั้นไม่รู้จัก'
  };
  // [label, kind]: 'muted' = information only (valid as is), 'warn' = someone should look
  const WARN = {
    no_surname: ['ไม่มีนามสกุล', 'muted'], latin: ['ชื่อภาษาอังกฤษ', 'muted'],
    mixed_script: ['ชื่อปนไทย-อังกฤษ', 'warn'], title_vs_level: ['คำนำหน้าไม่เข้ากับระดับชั้น', 'warn']
  };
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
    renderAll();
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
      const ping = await Api.call('ping', {}, { retries: 0 });
      const need = window.APP_CONFIG.REQUIRED_API_VERSION;
      const verOk = String(ping.version || '') === need;
      const r = await Api.call('selftest', {}, { retries: 0 });
      list.replaceChildren(
        el('li', {}, tag(verOk ? 'ผ่าน' : 'ไม่ผ่าน', verOk ? 'ok' : 'bad'), ` รุ่นโค้ด Apps Script — ${ping.version || 'ไม่ทราบ (รุ่นเก่า)'}${verOk ? '' : ' ต้องเป็นรุ่น ' + need + ' · ' + Api.message({ code: 'old_api' })}`),
        ...r.checks.map(c => el('li', {}, tag(c.ok ? 'ผ่าน' : 'ไม่ผ่าน', c.ok ? 'ok' : 'bad'), ' ' + c.name + ' — ' + c.detail)));
      list.appendChild(el('li', { cls: 'muted', text: 'เวลาตอบกลับ ' + r.ms + ' ms' }));
    } catch (err) {
      list.replaceChildren(el('li', {}, tag('ไม่ผ่าน', 'bad'), ' ' + Api.message(err)));
    }
  }

  // ------------------------------------------------------------ render all
  function renderAll() {
    const r = Store.roster;
    if (!r) return;
    $('fresh').textContent = `ข้อมูลตาราง ณ ${timeOf(r.readAt)} · ${r.counts.teams} ทีม · ${r.counts.students} คน · แถวมีปัญหา ${r.problems.length}`;
    // Only the visible tab is rebuilt: with hundreds of teams, rebuilding hidden tabs on every check-in tap
    // made the desk laptop stall. showTab() renders a tab when it is opened.
    if (currentTab === 'roster') renderRoster(r);
    if (currentTab === 'checkin') renderCheckin();
    if (currentTab === 'awards') renderAwards();
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

  // Expected final turnout: people already here, plus the not-yet-recorded people
  // scaled by the share of recorded people who came. Before any record, assume everyone comes.
  function forecastStat(total, came, pending) {
    const recorded = total - pending;
    const rate = recorded ? came / recorded : 1;
    const expect = Math.round(came + pending * rate);
    const box = el('div', { cls: 'stat' }, el('b', { text: `≈ ${expect} คน` }), 'คาดว่าจะมาทั้งหมด');
    box.appendChild(el('div', { cls: 'muted', text: pending
      ? (recorded ? `อัตรามา ${Math.round(rate * 100)}% จาก ${recorded} คนที่บันทึกแล้ว · ช่วง ${came}–${came + pending} คน`
                  : 'ยังไม่มีการบันทึก จึงคิดว่ามาครบทุกคน')
      : 'บันทึกครบทุกทีมแล้ว (ตัวเลขจริง)' }));
    return box;
  }

  function memberLine(m) {
    const line = el('div', {}, m.printName);
    if (m.titleState === 'none') line.appendChild(tag('ไม่มีคำนำหน้า', 'warn'));
    if (m.titleState === 'check') line.appendChild(tag('ต้องตรวจ', 'bad'));
    m.warnings.filter(w => WARN[w]).forEach(w => line.appendChild(tag(WARN[w][0], WARN[w][1])));
    if (!m.idOk) line.appendChild(tag(m.script === 'latin' ? 'ไม่มีเลขบัตร 13 หลัก' : 'เลขบัตรไม่ครบ', m.script === 'latin' ? 'muted' : 'warn'));
    return line;
  }

  // ------------------------------------------------------------ check-in tab
  function renderCheckin() {
    segButtons($('ciLevels'), [['all', 'ทุกระดับ'], ...LEVEL_ORDER.map(k => [k, LEVEL_SHORT[k]])], ciLevel, k => { ciLevel = k; renderCheckin(); });
    const q = $('ciSearch').value.trim();
    const all = Store.activeTeams();
    const inLevel = all.filter(t => ciLevel === 'all' || t.levelKey === ciLevel);
    const shown = inLevel.filter(t => !q || App.fold(t.short).includes(App.fold(q)) || t.school.includes(q));

    // Teams and people per attendance state; for 'partial' the people are the ones who came.
    const teams = { present: 0, partial: 0, absent: 0, unknown: 0 };
    const people = { present: 0, partial: 0, absent: 0, unknown: 0 };
    let total = 0, came = 0;
    inLevel.forEach(t => {
      const st = Store.attend(t.code).state, here = App.presentMembers(t).length;
      teams[st]++; total += t.members.length; came += here;
      people[st] += st === 'partial' ? here : t.members.length;
    });
    const stat = (label, value) => el('div', { cls: 'stat' }, el('b', { text: String(value) }), label);
    const tp = (st) => `${teams[st]} ทีม / ${people[st]} คน`;
    $('ciStats').replaceChildren(
      stat('ผู้เข้าร่วมที่มาแล้ว', `${came} / ${total} คน`),
      stat('ทั้งหมด', `${inLevel.length} ทีม / ${total} คน`),
      stat('มาครบ', tp('present')), stat('มาไม่ครบ (นับคนที่มา)', tp('partial')),
      stat('ไม่มา', tp('absent')), stat('ยังไม่บันทึก', tp('unknown')),
      stat('คนที่ไม่มา', `${total - came - people.unknown} คน`),
      forecastStat(total, came, people.unknown));

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
    t.members.forEach(m => names.appendChild(memberEditLine(t, m, a)));
    card.appendChild(names);
    const btn = (text, cls, fn) => el('button', { cls, text, on: { click: () => guarded(fn) } });
    card.appendChild(el('div', { cls: 'row' },
      btn('มาครบ', a.state === 'present' ? '' : 'secondary', () => Store.set('attend:' + t.code, { state: 'present' })),
      btn('มาไม่ครบ…', a.state === 'partial' ? '' : 'secondary', async () => { editing = t.code; renderCheckin(); }),
      btn('ไม่มา', a.state === 'absent' ? '' : 'secondary', () => Store.set('attend:' + t.code, { state: 'absent' })),
      a.state !== 'unknown' ? btn('ล้าง', 'link', () => Store.set('attend:' + t.code, { state: 'unknown' })) : null));
    return card;
  }

  /** One member line in the check-in card: name as it will be printed + quick fixes written on the team slip. */
  function memberEditLine(t, m, a) {
    const absent = a.state === 'absent' || (a.state === 'partial' && a.absent.includes(m.sid));
    const key = 'name:' + m.sid;
    const cur = Store.state[key];
    const setName = (printName, kind) => guarded(() => Store.set(key, printName === null ? null : { printName, kind }, cur ? cur.v : 0));
    const line = el('div', { cls: 'ci-line' }, el('span', { cls: absent ? 'struck' : '', text: m.printName }));
    if (m.override === 'correction') line.appendChild(tag('แก้ชื่อแล้ว', 'ok'));
    if (m.override === 'substitute') line.appendChild(tag('เปลี่ยนตัว (แทน ' + m.basePrint + ')', 'warn'));
    if (m.titleState === 'none') {
      line.appendChild(tag('ไม่มีคำนำหน้า', 'warn'));
      // Thai titles join the given name; English titles take a space ("Miss Emma")
      const titles = m.script === 'latin' ? ['Mr.', 'Ms.', 'Miss', 'Master'] : ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว'];
      titles.forEach(ti => line.appendChild(el('button', { cls: 'link', text: '+' + ti, on: {
        click: () => setName(m.script === 'latin' ? ti + ' ' + m.basePrint : ti + m.basePrint, 'correction')
      } })));
    }
    if (m.warnings.includes('latin')) line.appendChild(tag('ชื่อภาษาอังกฤษ', 'muted'));
    if (m.warnings.includes('no_surname')) line.appendChild(tag('ไม่มีนามสกุล', 'muted'));
    const actions = el('span', { cls: 'ci-actions' },
      el('button', { cls: 'link', text: 'แก้ชื่อ', on: { click: () => {
        const v = prompt('ชื่อที่จะพิมพ์บนเกียรติบัตร (คำนำหน้าติดชื่อ เว้นวรรค 1 ครั้งก่อนนามสกุล)', m.printName);
        if (v && v.trim() && v.trim() !== m.printName) setName(v.trim(), 'correction');
      } } }),
      el('button', { cls: 'link', text: 'เปลี่ยนตัว', on: { click: () => {
        const v = prompt(`นักเรียนที่มาแข่งแทน ${m.basePrint}\nพิมพ์ชื่อเต็มพร้อมคำนำหน้า เช่น เด็กหญิงสมใจ ใจดี`, '');
        if (v && v.trim()) setName(v.trim(), 'substitute');
      } } }),
      m.override ? el('button', { cls: 'link', text: 'ยกเลิกการแก้', on: { click: () => setName(null) } }) : null);
    line.appendChild(actions);
    return line;
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
          el('button', { cls: 'secondary', text: 'ดาวน์โหลดรายชื่อสำหรับทำเกียรติบัตรรางวัล', on: { click: downloadWinners } }),
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

  /**
   * winners.json for tools/award_pdfs.py: one entry per award, with every member's print name and whether they
   * were checked in. Saved only to this computer (it contains children's names); never upload it anywhere public.
   */
  function downloadWinners() {
    const awards = [];
    LEVEL_ORDER.forEach(level => Store.awardRows(level).filter(r => r.team).forEach(r => {
      const t = Store.team(r.team);
      if (!t) return;
      const present = new Set(App.presentMembers(t).map(m => m.sid));
      awards.push({
        level, award: r.award, order: r.order, awardLabel: AWARD_LABEL[r.award], team: t.code, short: t.short, school: t.school,
        members: t.members.map(m => ({ sid: m.sid, printName: m.printName, present: present.has(m.sid), script: m.script || 'thai' }))
      });
    }));
    const data = { kind: 'award-certificates', generatedAt: new Date().toISOString(), rosterReadAt: Store.roster.readAt,
      locked: Store.locked(), awards };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = el('a', { attrs: { href: URL.createObjectURL(blob), download: 'winners.json' } });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------ start
  Api.takeKeyFromHash();
  $('apiUrl').value = Api.apiUrl();
  $('actorName').value = App.actor() === 'admin' ? '' : App.actor();
  $('saveConn').addEventListener('click', saveConnection);
  $('runTest').addEventListener('click', runTest);
  $('refresh').addEventListener('click', refresh);
  let searchTimer = 0;
  $('ciSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderCheckin, 150); });
  $('forget').addEventListener('click', () => { Api.forget(); showConnected(false); });
  // ---------------------------------------------------------------- quick end-to-end test data (before the event only)
  const bangkokToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
  const beforeEvent = () => bangkokToday() < (window.APP_CONFIG.EVENT_DATE || '9999-12-31');
  if (!beforeEvent()) $('seedCard').classList.add('hidden');

  /** A plain test picture for a team (unique per team, so each upload is its own photo). */
  async function testPhoto(t) {
    const c = el('canvas', { attrs: { width: '1600', height: '1200' } });
    const g = c.getContext('2d');
    const hue = [...t.code].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 360;
    g.fillStyle = `hsl(${hue} 45% 82%)`; g.fillRect(0, 0, 1600, 1200);
    g.fillStyle = `hsl(${hue} 50% 35%)`; g.fillRect(120, 120, 1360, 960);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 120px sans-serif';
    g.fillText('ภาพทดสอบ', 800, 560); g.font = '700 90px sans-serif'; g.fillText('ทีม ' + t.short, 800, 700);
    const blob = await Photo.toBlob(c, 0.9), thumb = await Photo.toBlob(Photo.drawScaled(c, 480), 0.8);
    return { blob, thumb, width: 1600, height: 1200 };
  }

  async function seedTestData() {
    const msg = $('seedMsg');
    if (!beforeEvent()) { msg.textContent = 'ใช้ได้ก่อนวันงานเท่านั้น'; return; }
    const typed = prompt('ระบบจะเช็กอินทุกทีม ใส่ผลรางวัลทดสอบ ใส่รูปทดสอบ และล็อกผล\nพิมพ์คำว่า  ข้อมูลทดสอบ  เพื่อยืนยัน');
    if (typed === null) return;
    if (typed.trim() !== 'ข้อมูลทดสอบ') { msg.textContent = 'พิมพ์ไม่ตรง ยังไม่ได้ทำ'; return; }
    msg.textContent = 'กำลังอ่านข้อมูลล่าสุด…';
    await Store.loadAll();
    if (Store.locked()) { msg.textContent = 'ล็อกผลอยู่แล้ว — ไปลองภาพประกาศ/เกียรติบัตรได้เลย หรือกด "ล้างข้อมูลทดสอบ" ก่อนแล้วค่อยกดใหม่'; return; }
    const teams = Store.activeTeams();

    // 1. check-in
    const todo = teams.filter(t => Store.attend(t.code).state === 'unknown');
    for (let i = 0; i < todo.length; i++) {
      msg.textContent = `1/4 เช็กอิน ${i + 1}/${todo.length} ทีม…`;
      await Store.set('attend:' + todo[i].code, { state: 'present' });
    }

    // 2. awards: 1st-3rd per level, empty slots removed
    const winners = [];
    for (const level of LEVEL_ORDER) {
      msg.textContent = `2/4 ใส่ผลรางวัล ${LEVEL_SHORT[level]}…`;
      const pool = teams.filter(t => t.levelKey === level && !Store.awardOf(t.code));
      for (const award of [1, 2, 3]) {
        const key = `award:${level}-${award}-1`, cur = Store.state[key];
        if (cur && cur.value && cur.value.team) { winners.push(Store.team(cur.value.team)); continue; }
        const t = pool.shift();
        if (!t) break;
        await Store.set(key, { level, award, order: 1, team: t.code }, cur ? cur.v : 0);
        winners.push(t);
      }
      for (const r of rowsForLevel(level).filter(r => !r.team)) await Store.set(r.key, null, r.v);
    }

    // 3. a test picture for every winner without one
    const need = winners.filter(t => t && !Store.val('photo:' + t.code));
    for (let i = 0; i < need.length; i++) {
      msg.textContent = `3/4 ใส่รูปทดสอบ ${i + 1}/${need.length}…`;
      const up = await Photo.upload(await testPhoto(need[i]), { team: need[i].code, name: 'ภาพทดสอบ-' + need[i].short + '.jpg' });
      await Store.loadState();
      const cur = Store.state['photo:' + need[i].code];
      await Store.set('photo:' + need[i].code, { sha: up.sha, corners: [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]], rot: 0, fit: 'auto', paper: 'auto' }, cur ? cur.v : 0);
    }

    // 4. lock
    msg.textContent = '4/4 ล็อกผล…';
    const lock = Store.state.lock;
    await Store.set('lock', { locked: true }, lock ? lock.v : 0);
    msg.textContent = 'พร้อมแล้ว ✓ ต่อไป: แท็บภาพประกาศ → ยืนยัน → เผยแพร่ภาพ · แท็บเกียรติบัตร → เลือกเทมเพลต → เผยแพร่ → เปิดให้ดาวน์โหลด · ลองด้วยมือถือ · เสร็จแล้วกด "ล้างข้อมูลทดสอบ"';
  }
  $('seedTest').addEventListener('click', () => guarded(seedTestData));

  $('resetTest').addEventListener('click', () => guarded(async () => {
    const typed = prompt('พิมพ์คำว่า  ล้างข้อมูลทดสอบ  เพื่อยืนยัน\n(ล้างเช็กอิน ผลรางวัล การล็อก รูปทั้งหมด การจัดภาพ และการยืนยัน)');
    if (typed === null) return;
    if (typed.trim() !== 'ล้างข้อมูลทดสอบ') { $('resetMsg').textContent = 'พิมพ์ไม่ตรง ยังไม่ได้ล้าง'; return; }
    $('resetMsg').textContent = 'กำลังล้าง…';
    const r = await Api.call('resetTestData', { confirm: 'ล้างข้อมูลทดสอบ', actor: App.actor() }, { retries: 0, timeoutMs: 120000 });
    const c = r.cleared || {};
    $('resetMsg').textContent = `ล้างแล้ว: เช็กอิน ${c['attend:'] || 0} ทีม · ช่องรางวัล ${c['award:'] || 0} · รูป ${c['photofile:'] || 0} · จัดภาพ ${c['photo:'] || 0}${c.lock ? ' · ปลดล็อกผล' : ''}`;
    await Store.loadState();
  }));
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
