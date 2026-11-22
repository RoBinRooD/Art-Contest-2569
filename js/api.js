// Small client for the Apps Script JSON API.
// Every call is a POST with a text/plain JSON body (no CORS preflight), with a timeout and retries.
(function () {
  const KEY_STORE = 'artcontest.adminKey';
  const URL_STORE = 'artcontest.apiUrl';

  function safeGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function safeSet(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* private mode */ } }

  // A key can arrive in the link after '#k=' so it never reaches server logs; it is stored and removed from the address bar.
  function takeKeyFromHash() {
    const m = location.hash.match(/[#&]k=([A-Za-z0-9]+)/);
    if (m) {
      safeSet(KEY_STORE, m[1]);
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function apiUrl() { return safeGet(URL_STORE) || (window.APP_CONFIG && window.APP_CONFIG.API_URL) || ''; }

  async function call(action, payload = {}, { retries = 2, timeoutMs = 45000 } = {}) {
    const url = apiUrl();
    if (!url) throw new ApiError('no_api_url');
    const body = JSON.stringify({ action, key: safeGet(KEY_STORE), opId: crypto.randomUUID(), ...payload });
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { method: 'POST', body, signal: ctrl.signal, redirect: 'follow' });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch (e) { throw new ApiError('not_json', text.slice(0, 120)); }
        if (!data.ok) throw new ApiError(data.error || 'error', data.detail || data.entry || null);
        return data;
      } catch (err) {
        lastErr = err instanceof ApiError ? err : new ApiError(err.name === 'AbortError' ? 'timeout' : 'network', String(err));
        // server answered with a definite error: do not retry
        if (err instanceof ApiError && !['not_json'].includes(err.code)) throw lastErr;
        if (attempt < retries) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  class ApiError extends Error {
    constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
  }

  const MESSAGES = {
    no_api_url: 'ยังไม่ได้ใส่ลิงก์ Apps Script',
    bad_key: 'คีย์ไม่ถูกต้อง',
    unknown_action: 'โค้ด Apps Script ยังเป็นรุ่นเก่า: วางโค้ดใหม่จาก apps-script\\Code.gs แล้ว Deploy → Manage deployments → ดินสอ → New version',
    old_api: 'โค้ด Apps Script ยังเป็นรุ่นเก่า: วางโค้ดใหม่จาก apps-script\\Code.gs แล้ว Deploy → Manage deployments → ดินสอ → New version',
    not_set_up: 'ยังไม่ได้รัน setup ใน Apps Script',
    reg_tab_missing: 'ไม่พบแท็บ "ข้อมูล" ในตารางรับสมัคร',
    reg_header_missing: 'ไม่พบหัวคอลัมน์ที่ต้องใช้ในตารางรับสมัคร',
    team_count_dropped: 'จำนวนทีมที่อ่านได้ลดลงผิดปกติ',
    conflict: 'มีคนแก้ช่องนี้ก่อนหน้าแล้ว ระบบโหลดค่าล่าสุดให้ ตรวจแล้วทำใหม่',
    results_locked: 'ล็อกผลแล้ว ต้องปลดล็อกก่อนจึงแก้ผลรางวัลได้',
    team_has_award: 'ทีมนี้ได้รางวัลอื่นอยู่แล้ว',
    wrong_level: 'ทีมนี้ไม่ได้อยู่ในระดับชั้นนี้',
    unknown_team: 'ไม่พบทีมนี้ในตารางรับสมัคร',
    cannot_lock: 'ยังล็อกผลไม่ได้',
    bad_value: 'ข้อมูลไม่ถูกต้อง',
    bad_state_key: 'ข้อมูลไม่ถูกต้อง',
    timeout: 'เซิร์ฟเวอร์ตอบช้าเกินไป ลองใหม่อีกครั้ง',
    network: 'เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ต',
    not_json: 'เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (ตรวจว่าเปิดสิทธิ์ Anyone แล้ว)',
    server_error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์'
  };

  function message(err) { return MESSAGES[err && err.code] || ('ผิดพลาด: ' + (err && err.code || err)); }

  window.Api = {
    call, message, takeKeyFromHash, apiUrl,
    hasKey: () => !!safeGet(KEY_STORE),
    setKey: k => safeSet(KEY_STORE, k.trim()),
    setUrl: u => safeSet(URL_STORE, u.trim()),
    forget: () => { safeSet(KEY_STORE, ''); }
  };
})();
