// Shared helpers for admin.html and print.html.
// All text that comes from the sheet is inserted with textContent, never innerHTML.
(function () {
  const LEVEL_ORDER = ['primary', 'm1', 'm4'];
  const LEVEL_SHORT = { primary: 'ประถม 4-6', m1: 'ม.1-3', m4: 'ม.4-6' };
  const LEVEL_FULL = { primary: 'ระดับประถมศึกษาปีที่ 4-6', m1: 'ระดับมัธยมศึกษาปีที่ 1-3', m4: 'ระดับมัธยมศึกษาปีที่ 4-6' };
  const AWARD_LABEL = { 1: 'ชนะเลิศ', 2: 'รองชนะเลิศอันดับ 1', 3: 'รองชนะเลิศอันดับ 2', 4: 'ชมเชย' };
  const DEFAULT_HM = 4;   // default number of honourable mentions per level (editable on the awards screen)
  const ACTOR_STORE = 'artcontest.actor';

  function el(tag, opts = {}, ...children) {
    const n = document.createElement(tag);
    if (opts.cls) n.className = opts.cls;
    if (opts.text != null) n.textContent = opts.text;
    if (opts.attrs) Object.entries(opts.attrs).forEach(([k, v]) => v != null && n.setAttribute(k, v));
    if (opts.on) Object.entries(opts.on).forEach(([k, f]) => n.addEventListener(k, f));
    children.flat().forEach(c => c != null && c !== false && n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return n;
  }
  const tag = (text, kind) => el('span', { cls: 'tag ' + kind, text });
  const timeOf = iso => (iso || '').slice(11, 16);
  const dateTimeOf = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)} น.` : '';
  const schoolSortKey = s => (s || '').replace(/^โรงเรียน/, '').trim();
  const fold = s => String(s || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '2');

  function sortTeams(teams) {
    return teams.slice().sort((a, b) =>
      LEVEL_ORDER.indexOf(a.levelKey) - LEVEL_ORDER.indexOf(b.levelKey) ||
      schoolSortKey(a.school).localeCompare(schoolSortKey(b.school), 'th') ||
      a.short.localeCompare(b.short));
  }

  // ---- data store: live roster + system state
  const Store = {
    roster: null, state: {}, listeners: [],
    async loadRoster() { this.roster = await Api.call('roster'); this.emit(); return this.roster; },
    async loadState() { const r = await Api.call('state'); this.state = r.state; this.emit(); return this.state; },
    async loadAll() { await Promise.all([this.loadRoster(), this.loadState()]); },
    activeTeams() { return this.roster ? sortTeams(this.roster.teams.filter(t => t.statusClass !== 'cancelled')) : []; },
    team(code) { return this.roster && this.roster.teams.find(t => t.code === code); },
    val(key) { const e = this.state[key]; return e ? e.value : null; },
    attend(code) { return this.val('attend:' + code) || { state: 'unknown', absent: [] }; },
    locked() { const l = this.val('lock'); return !!(l && l.locked); },
    awardRows(level) {
      return Object.keys(this.state).filter(k => k.startsWith('award:') && this.state[k].value && this.state[k].value.level === level)
        .map(k => ({ key: k, v: this.state[k].v, ...this.state[k].value }))
        .sort((a, b) => a.award - b.award || a.order - b.order);
    },
    awardOf(code) {
      const k = Object.keys(this.state).find(k => k.startsWith('award:') && this.state[k].value && this.state[k].value.team === code);
      return k ? this.state[k].value : null;
    },
    async set(stateKey, value, expectV) {
      const r = await Api.call('set', { stateKey, value, expectV, actor: actor() }, { retries: 1 });
      this.state[stateKey] = r.entry;
      this.emit();
      return r;
    },
    on(fn) { this.listeners.push(fn); },
    emit() { this.applyNames(); this.listeners.forEach(f => f()); },
    // Name corrections / substitutions recorded on the day replace the sheet name everywhere (slips, posters, certificates).
    applyNames() {
      if (!this.roster) return;
      this.roster.teams.forEach(t => t.members.forEach(m => {
        if (m.basePrint === undefined) { m.basePrint = m.printName; m.baseTitleState = m.titleState; }
        const o = this.val('name:' + m.sid);
        m.printName = o ? o.printName : m.basePrint;
        m.titleState = o ? 'auto' : m.baseTitleState;
        m.override = o ? o.kind : null;
      }));
    }
  };

  // Present members of a team according to the check-in record (unknown attendance = nobody yet).
  function presentMembers(team) {
    const a = Store.attend(team.code);
    if (a.state === 'present') return team.members;
    if (a.state === 'partial') return team.members.filter(m => !a.absent.includes(m.sid));
    return [];
  }

  function actor() { try { return localStorage.getItem(ACTOR_STORE) || 'admin'; } catch (e) { return 'admin'; } }
  function setActor(n) { try { localStorage.setItem(ACTOR_STORE, n.trim()); } catch (e) { /* ignore */ } }

  window.App = { LEVEL_ORDER, LEVEL_SHORT, LEVEL_FULL, AWARD_LABEL, DEFAULT_HM, el, tag, timeOf, dateTimeOf, fold, sortTeams, Store, presentMembers, actor, setActor };
})();
