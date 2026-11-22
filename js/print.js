// Print pack. Every sheet is built from the live roster at the moment the page is opened,
// and every page carries the data time in its footer. ?demo=1 shows fictional data (no key needed).
(function () {
  const { el, LEVEL_ORDER, LEVEL_SHORT, LEVEL_FULL, AWARD_LABEL, DEFAULT_HM, Store, sortTeams } = App;
  const $ = id => document.getElementById(id);
  const DEMO = new URLSearchParams(location.search).has('demo');
  const SPARE_STICKERS_PER_LEVEL = 3;
  const SPARE_CARDS_PER_LEVEL = 2;
  let tokens = {};

  // ---------------------------------------------------------------- QR as crisp SVG
  function qrSvg(text, mode) {
    const qr = qrcode(0, 'Q');
    qr.addData(text, mode || 'Byte');
    qr.make();
    const n = qr.getModuleCount(), q = 4, size = n + q * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', size); bg.setAttribute('height', size); bg.setAttribute('fill', '#fff');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', '#000');
    svg.append(bg, p);
    return svg;
  }

  function certUrl(token) {
    const base = location.origin + location.pathname.replace(/[^/]*$/, '');
    return `${base}cert.html?openExternalBrowser=1#t=${token}`;
  }

  const teamsByLevel = level => Store.activeTeams().filter(t => t.levelKey === level);

  // ---------------------------------------------------------------- sections
  function slips() {
    const teams = Store.activeTeams();
    const sameSchoolLevel = {};
    teams.forEach(t => { const k = t.levelKey + '|' + t.school; sameSchoolLevel[k] = (sameSchoolLevel[k] || 0) + 1; });
    return teams.map(t => {
      const rows = t.members.map((m, i) => el('tr', {},
        el('td', { cls: 'box', text: String(i + 1) }),
        el('td', {}, el('div', { text: m.printName }),
          m.titleState === 'none' && m.script !== 'latin' ? el('div', { cls: 'untitled', text: 'ไม่มีคำนำหน้า โปรดวง: เด็กชาย / เด็กหญิง / นาย / นางสาว' }) : null,
          m.titleState === 'none' && m.script === 'latin' ? el('div', { cls: 'untitled', text: 'No title — please circle: Mr. / Ms. / Miss / Master · โปรดตรวจตัวสะกด' }) : null,
          m.titleState === 'check' ? el('div', { cls: 'untitled', text: 'ชื่อปนไทย-อังกฤษ โปรดเขียนชื่อที่ถูกต้องในช่องแก้ไข' }) : null),
        el('td', { cls: 'fix' }),
        el('td', { cls: 'box', text: '☐' })));
      const token = tokens[t.code];
      return el('div', { cls: 'slip' },
        el('div', { cls: 'slip-head' },
          el('div', { cls: 'code', text: t.short }),
          el('div', { cls: 'meta' }, el('div', { cls: 'school', text: t.school }), el('div', { text: LEVEL_FULL[t.levelKey] + ' · รหัส ' + t.code })),
          el('div', { cls: 'slip-tag', text: 'ใบทีม\nส่งคืนโต๊ะลงทะเบียน' })),
        el('table', {},
          el('thead', {}, el('tr', {}, el('th', { text: '#' }), el('th', { text: 'ชื่อที่จะพิมพ์บนเกียรติบัตร (โปรดตรวจ)' }),
            el('th', { text: 'ถ้าผิด แก้ไขเป็น' }), el('th', { text: 'ไม่มา ✓' }))),
          el('tbody', {}, rows)),
        sameSchoolLevel[t.levelKey + '|' + t.school] > 1 ? el('div', { cls: 'warn', text: '⚠ โรงเรียนนี้มีมากกว่า 1 ทีมในระดับนี้ — ตรวจรหัสบนสติกเกอร์ให้ตรงกับใบนี้' }) : null,
        el('div', { cls: 'lines' },
          el('span', { text: 'นักเรียนมาแข่งขัน ______ คน' }),
          el('span', { text: '☐ ไม่ประสงค์ให้เผยแพร่ชื่อนักเรียนในประกาศผลออนไลน์' })),
        el('div', { cls: 'sign', text: 'ลงชื่อครูผู้ควบคุม ...................................................   เวลา ..........' }),
        el('div', { cls: 'cut' }, el('span', { text: '✂ ฉีกส่วนล่างให้ครู' })),
        el('div', { cls: 'ticket' },
          token ? qrSvg(certUrl(token)) : el('div', { text: '(ไม่มีลิงก์)' }),
          el('div', {},
            el('div', { cls: 't1', text: 'เกียรติบัตรออนไลน์ผู้เข้าร่วมกิจกรรม' }),
            el('div', { cls: 't2', text: `ทีม ${t.short} · ${t.school}` }),
            el('div', { cls: 't2', text: 'สแกน QR นี้เพื่อรับเกียรติบัตรของนักเรียนในทีม (เปิดได้หลังประกาศผล)' }),
            el('div', { cls: 't2', text: 'โปรดเก็บหางบัตรนี้ไว้ ห้ามโพสต์ QR นี้ในที่สาธารณะ' }))));
    });
  }

  function stickers() {
    const labels = [];
    LEVEL_ORDER.forEach(level => {
      teamsByLevel(level).forEach(t => labels.push(el('div', { cls: 'label' },
        el('div', { cls: 'lv', text: LEVEL_SHORT[level] }), el('div', { cls: 'code', text: t.short }), el('div', { cls: 'full', text: t.code }))));
      for (let i = 0; i < SPARE_STICKERS_PER_LEVEL; i++) labels.push(el('div', { cls: 'label' },
        el('div', { cls: 'lv', text: LEVEL_SHORT[level] + ' (สำรอง)' }), el('div', { cls: 'blank' }), el('div', { cls: 'full', text: 'เขียนรหัสด้วยปากกา' })));
    });
    const pages = [];
    for (let i = 0; i < labels.length; i += 21) pages.push(el('div', { cls: 'labels' }, labels.slice(i, i + 21)));
    return pages;
  }

  function cards() {
    const list = [];
    LEVEL_ORDER.forEach(level => {
      teamsByLevel(level).forEach(t => list.push(el('div', { cls: 'card' },
        qrSvg(t.code.toUpperCase(), /^[0-9A-Z $%*+\-./:]+$/.test(t.code.toUpperCase()) ? 'Alphanumeric' : 'Byte'),
        el('div', { cls: 'code', text: t.short }),
        el('div', { cls: 'lv', text: LEVEL_SHORT[level] }),
        el('div', { cls: 'note', text: 'ป้ายรหัสทีม — วางใต้ผลงานในทุกภาพที่ถ่าย ห้ามบังผลงาน' }))));
      for (let i = 0; i < SPARE_CARDS_PER_LEVEL; i++) list.push(el('div', { cls: 'card' },
        el('div', { cls: 'blank', attrs: { style: 'width:70mm;height:30mm;border:0.5mm solid #000' } }),
        el('div', { cls: 'lv', text: LEVEL_SHORT[level] + ' (สำรอง — เขียนรหัสตัวใหญ่)' })));
    });
    const pages = [];
    for (let i = 0; i < list.length; i += 4) pages.push(el('div', { cls: 'cards' }, list.slice(i, i + 4)));
    return pages;
  }

  function judges() {
    return LEVEL_ORDER.map(level => {
      const rows = [];
      [1, 2, 3].forEach(a => rows.push([AWARD_LABEL[a]]));
      for (let i = 1; i <= DEFAULT_HM + 2; i++) rows.push([AWARD_LABEL[4] + ' ' + i]);
      const box = () => el('span', { cls: 'codebox' }, el('span'), el('span'), el('span'));
      const teams = teamsByLevel(level).slice().sort((a, b) => a.short.localeCompare(b.short));
      return el('div', { cls: 'break' },
        el('h1', { cls: 'doc', text: 'แบบฟอร์มผลการตัดสิน' }),
        el('h2', { cls: 'doc', text: LEVEL_FULL[level] + ' · ' + (window.APP_CONFIG.TITLE || '') }),
        el('table', { cls: 'form' },
          el('thead', {}, el('tr', {}, el('th', { text: 'รางวัล' }), el('th', { text: 'รหัสทีม (3 ตัว ดูจากสติกเกอร์หลังภาพ)' }), el('th', { text: 'หมายเหตุ' }))),
          el('tbody', {}, rows.map(r => el('tr', {}, el('td', { text: r[0] }), el('td', {}, box()), el('td'))))),
        el('div', { text: 'รหัสทีมทั้งหมดในระดับนี้ (ใช้ตรวจว่าเขียนรหัสถูก — ขีดฆ่า = ทีมที่ไม่มาแข่ง):' }),
        el('div', { cls: 'codes' }, teams.map(t => el('span', { cls: 'code' + (Store.attend(t.code).state === 'absent' ? ' absent' : ''), text: t.short }))),
        el('div', { text: 'รางวัลที่ไม่มีผู้ได้รับ ให้เขียน "ไม่มี" ในช่องรหัส · ชมเชยที่ไม่ใช้ให้ขีดฆ่าทั้งแถว' }),
        el('div', { cls: 'signs' },
          el('div', { text: 'ประธานกรรมการ' }), el('div', { text: 'กรรมการ' }), el('div', { text: 'กรรมการ' }), el('div', { text: 'วันที่ / เวลา' })));
    });
  }

  function master() {
    return LEVEL_ORDER.map(level => el('div', { cls: 'break' },
      el('h1', { cls: 'doc', text: 'ใบรายชื่อรวม (สำรองเช็กอิน)' }),
      el('h2', { cls: 'doc', text: LEVEL_FULL[level] + ' · ใช้เมื่อระบบใช้ไม่ได้ ภายหลังให้คีย์เข้าแท็บเช็กอิน' }),
      el('table', { cls: 'form master' },
        el('thead', {}, el('tr', {}, ['รหัส', 'โรงเรียน', 'นักเรียน', 'มาครบ', 'ไม่มา', 'หมายเหตุ'].map(h => el('th', { text: h })))),
        el('tbody', {}, teamsByLevel(level).map(t => el('tr', { cls: 'avoid' },
          el('td', { cls: 'code', text: t.short }), el('td', { text: t.school }),
          el('td', {}, t.members.map(m => el('div', { text: m.printName }))),
          el('td', { text: '☐' }), el('td', { text: '☐' }), el('td')))))));
  }

  function station() {
    const li = t => el('li', { text: t });
    return [el('div', { cls: 'station' },
      el('h1', { cls: 'doc', text: 'คู่มือจุดถ่ายภาพผลงาน' }),
      el('h2', { cls: 'doc', text: 'กฎข้อเดียวที่ห้ามพลาด: ไม่มีป้ายรหัสทีมในภาพ = ไม่กดถ่าย' }),
      el('ol', {},
        li('ตั้งมือถือบนขาตั้ง ห่างบอร์ดตามเทปที่พื้น เลนส์อยู่ระดับกลางบอร์ด ขนานกับบอร์ด'),
        li('ตั้งกล้อง: ปิดแฟลช · โหมดถ่ายรูปธรรมดา (ไม่ใช่ Portrait ไม่ใส่ฟิลเตอร์) · เปิดเส้นตาราง · ใช้ปุ่ม 1x หรือ 2x เท่านั้น ห้าม 0.5x ห้ามถ่างนิ้วซูม'),
        li('iPhone: ตั้งค่า > กล้อง > รูปแบบ > "เข้ากันได้มากที่สุด" และปิด Live Photo'),
        li('คนถือภาพพลิกดูรหัส 3 ตัวที่สติกเกอร์หลังภาพ หยิบป้ายรหัสทีมที่ตรงกันมาหนีบไว้ใต้ผลงาน'),
        li('วางผลงานบนขอบบอร์ด เห็นครบ 4 มุม ผลงานกินพื้นที่ราว 80% ของภาพ ป้ายรหัสอยู่ในภาพแต่ไม่บังผลงาน'),
        li('แตะหน้าจอที่ผลงานเพื่อโฟกัส ถ่าย 2 ภาพ แล้วซูมดูว่าคมและอ่านรหัสบนป้ายได้'),
        li('ภาพที่สียังเปียกหรือมันเงา: วางราบกับพื้นใกล้หน้าต่าง ปิดไฟเพดาน ถ่ายตรงลงมา'),
        li('เก็บป้ายรหัสคืนเข้ากล่อง แล้วถ่ายผลงานถัดไป · ผลงานที่ได้รางวัลอยู่กับทีมงานจนกว่าแอดมินยืนยันว่ารูปครบ'),
        li('ห้ามส่งรูปผ่าน LINE (รูปจะถูกย่อ) ให้ส่งตามวิธีที่แอดมินกำหนด และห้ามลบรูปในเครื่องจนกว่าจะโพสต์ประกาศผลแล้ว')))];
  }

  function mc() {
    const out = [];
    if (!Store.locked()) out.push(el('div', { cls: 'draft', text: 'ร่าง — ยังไม่ล็อกผลรางวัล ห้ามใช้ประกาศจริง' }));
    out.push(el('h1', { cls: 'doc', text: 'รายชื่อผู้ได้รับรางวัล สำหรับพิธีกร' }));
    LEVEL_ORDER.forEach(level => {
      const rows = Store.awardRows(level).filter(r => r.team).sort((a, b) => b.award - a.award || a.order - b.order);
      const block = el('div', { cls: 'break' }, el('h2', { cls: 'doc', text: LEVEL_FULL[level] + ' (ประกาศจากชมเชยขึ้นไป)' }));
      rows.forEach(r => {
        const t = Store.team(r.team);
        if (!t) return;
        const present = new Set(App.presentMembers(t).map(m => m.sid));
        block.appendChild(el('div', { cls: 'avoid' },
          el('div', { cls: 'mc-award', text: AWARD_LABEL[r.award] + (r.award === 4 ? '' : '') }),
          el('div', { cls: 'mc-entry' },
            el('div', { cls: 'school', text: t.school + '  (ทีม ' + t.short + ')' }),
            t.members.map(m => el('div', { cls: present.has(m.sid) ? '' : 'absent', text: m.printName + (present.has(m.sid) ? '' : '  (ไม่ได้มา)') })))));
      });
      if (!rows.length) block.appendChild(el('div', { text: 'ยังไม่มีผลรางวัล' }));
      out.push(block);
    });
    return out;
  }

  const SECTIONS = { slips, stickers, cards, judges, master, station, mc };

  function render() {
    const name = (location.hash || '#slips').slice(1);
    const fn = SECTIONS[name] || slips;
    $('section').value = SECTIONS[name] ? name : 'slips';
    $('out').replaceChildren(...fn());
    const r = Store.roster;
    $('footer').textContent = `${DEMO ? 'ข้อมูลตัวอย่าง (ไม่ใช่ข้อมูลจริง) · ' : ''}ข้อมูลตาราง ณ ${App.dateTimeOf(r.readAt)} · ${r.counts.teams} ทีม · ระบบเกียรติบัตร 2569`;
    document.title = $('section').selectedOptions[0].textContent + ' — พิมพ์';
  }

  // ---------------------------------------------------------------- demo data (fictional)
  function loadDemo() {
    const schools = ['โรงเรียนตัวอย่างวิทยาคม', 'โรงเรียนบ้านสวนดอก', 'โรงเรียนดอยคำพิทยา', 'โรงเรียนแม่ปิงศึกษา'];
    const given = ['ปิ่นฟ้า', 'ฐิติวุฒิ', 'พิมพ์ชนก', 'กันต์ธีร์', 'ญาณิศา', 'ภูริณัฐ', 'น้ำผึ้ง', 'ศุภกฤต'];
    const family = ['ใจดี', 'ป้อมน้ำผึ้ง', 'กู้เกียรติญาณ', 'ศรีสุวรรณ', 'แสงจันทร์'];
    const teams = [];
    let n = 0;
    LEVEL_ORDER.forEach((lv, li) => {
      for (let i = 0; i < 5; i++) {
        const short = 'D' + li + String.fromCharCode(65 + i);
        const size = lv === 'primary' ? 3 : 2;
        teams.push({
          code: 'DEMO-' + short, short, levelKey: lv, school: schools[(i + li) % schools.length], statusClass: 'active', flags: [],
          members: Array.from({ length: size }, (_, k) => {
            n++;
            const title = lv === 'm4' ? (k % 2 ? 'นาย' : 'นางสาว') : (k % 2 ? 'เด็กชาย' : 'เด็กหญิง');
            const untitled = n % 7 === 0;
            return { sid: 'demo' + n, printName: (untitled ? '' : title) + given[n % given.length] + ' ' + family[n % family.length], titleState: untitled ? 'none' : 'auto' };
          })
        });
      }
    });
    Store.roster = { teams, readAt: new Date().toISOString().replace('Z', '+00:00'), counts: { teams: teams.length } };
    Store.state = {
      'attend:DEMO-D0A': { value: { state: 'present', absent: [] } },
      'attend:DEMO-D0B': { value: { state: 'partial', absent: ['demo4'] } },
      'attend:DEMO-D0E': { value: { state: 'absent', absent: [] } },
      'award:primary-1-1': { value: { level: 'primary', award: 1, order: 1, team: 'DEMO-D0A' } },
      'award:primary-4-1': { value: { level: 'primary', award: 4, order: 1, team: 'DEMO-D0B' } }
    };
    teams.forEach((t, i) => { tokens[t.code] = 'demotoken' + i; });
  }

  async function start() {
    $('section').addEventListener('change', () => { location.hash = $('section').value; });
    $('printBtn').addEventListener('click', () => window.print());
    window.addEventListener('hashchange', render);
    try {
      if (DEMO) {
        loadDemo();
      } else {
        await Store.loadAll();
        tokens = (await Api.call('tokens')).tokens;
      }
      $('status').textContent = DEMO ? 'โหมดตัวอย่าง' : 'พร้อมพิมพ์';
      render();
    } catch (err) {
      $('status').textContent = Api.message(err) + (err.code === 'bad_key' || err.code === 'no_api_url' ? ' — เปิดหน้าแอดมินและเชื่อมต่อก่อน' : '');
    }
  }
  start();
})();
