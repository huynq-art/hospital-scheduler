const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
if (!require('fs').existsSync(DATA_DIR)) require('fs').mkdirSync(DATA_DIR, { recursive: true });

// --- Database setup: PostgreSQL (DATABASE_URL) or SQLite fallback ---
const DB_URL = process.env.DATABASE_URL;
let db, usePg = false;

if (DB_URL) {
  const { Pool } = require('pg');
  const dns = require('dns');
  dns.setDefaultResultOrder('ipv4first');
  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  db = pool;
  usePg = true;
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      console.log('  ✅ Kết nối PostgreSQL thành công');
      await doLoadPg();
    } catch(e) { console.error('PostgreSQL init error:', e.message); process.exit(1); }
  })();
} else {
  const Database = require('better-sqlite3');
  const dbPath = path.join(DATA_DIR, 'hospital.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  console.log('  ✅ Dùng SQLite');
  doLoadSqlite();
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Fixed Google Sheet ID
const SHEET_ID = '1UeHny32B0dObgKqcTdkcvV5Aq9VjM3wgw9j0IzniI14';

// CSV fetch helper (avoids CORS, follows redirects)
async function fetchSheetCSV(sheetId, gid = 0) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.text();
}

// Simple CSV parser (handles quotes and newlines in fields)
function parseCSV(csv) {
  const rows = [];
  let current = [], field = '', inQ = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQ) {
      if (c === '"') {
        if (csv[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { current.push(field.trim()); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && csv[i + 1] === '\n') i++;
      if (field.trim() || current.length) current.push(field.trim());
      field = '';
      if (current.length) rows.push(current);
      current = [];
    } else field += c;
  }
  if (field.trim() || current.length) current.push(field.trim());
  if (current.length) rows.push(current);
  return rows;
}

// Get today's date in Vietnam timezone (UTC+7)
function todayVi() {
  const f = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());
}

// Normalize date from DD/MM/YYYY → YYYY-MM-DD (or keep YYYY-MM-DD as-is)
function normDate(d) {
  d = d.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const p = d.split('/');
    return `${p[2]}-${p[1]}-${p[0]}`;
  }
  return d;
}

// Simple gender detection for Vietnamese names (server-side)
function detectGender(name) {
  const n = name.trim().toLowerCase().replace(/[-–—]+\s*(v|vv|vip|vvip)\s*$/i, '').trim();
  if (n.includes(' thị ')) return 'F';
  if (n.includes(' văn ')) return 'M';
  const parts = n.replace(/\s+\d+$/,'').split(/\s+/).filter(Boolean);
  const last = parts[parts.length-1] || '';
  const knownF = ['hồng','hương','lan','mai','hoa','nhung','hạnh','thúy','thủy','trang','ngọc','đào','liên','dung','hằng','vân','quỳnh','diệp','hà','tâm','mỹ','chi','oanh','liễu','huyền','uyên','phương','hiền','hòa','ngà','thơm'];
  const knownM = ['đức','quang','tuấn','dũng','hùng','sơn','hải','phú','cường','trung','tiến','đạt','khánh','minh','bình','lâm','tùng','kiên','giang','thắng','linh','nam','khoa','phước','tín','nhân','trí','điều','sáng','hoan','thuyết','cúc','thái','oai','hưng','đức','thịnh','dậu'];
  if (knownF.includes(last)) return 'F';
  if (knownM.includes(last)) return 'M';
  return 'U';
}

// VIP level detection from name suffixes
function detectVIPLevel(name) {
  if (!name) return null;
  var end = name.trim().replace(/[-–—]+\s*/g, ' ').trim();
  if (/ (vvip|vv)$/i.test(end)) return 'VV';
  if (/ (vip|v)$/i.test(end)) return 'V';
  return null;
}

// Map sheet columns → customer fields (by column index for this specific sheet)
function mapSheetRow(cols) {
  const name = (cols[3] || '').replace(/^"|"$/g, '').trim();
  const arr  = (cols[1] || '08:00').replace(/^"|"$/g, '').trim();
  const prod = (cols[12] || '').replace(/^"|"$/g, '').trim();
  const date = normDate((cols[0] || '').replace(/^"|"$/g, '').trim());
  const vl = detectVIPLevel(name);
  const pri = vl ? 3 : 1;
  var gRaw = (cols[4] || '').replace(/^"|"$/g, '').trim().toLowerCase();
  var gender = gRaw === 'nam' ? 'M' : (gRaw.startsWith('n') ? 'F' : detectGender(name));
  return { name, arr, prod, date, pri, rm: 'none', gender, vipLevel: vl };
}

// --- Undo history ---
const undoStack = []; // array of { custs: snapshot }
const MAX_UNDO = 20;

function pushUndo() {
  undoStack.push({ custs: JSON.parse(JSON.stringify(state.custs)) });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

// --- In-memory data store ---
let state = {
  custs: [],
  bedDefs: [
    { id: 1, name: "G1", room: "VIP 1", isT2: true },
    { id: 2, name: "G2", room: "VIP 1", isT2: true },
    { id: 3, name: "G3", room: "VIP 2", isT2: true },
    { id: 4, name: "G4", room: "VIP 2", isT2: true },
    { id: 5, name: "G5", room: "Lấy mẫu", isT2: true },
    { id: 7, name: "G7", room: "Da liễu", isT2: false },
    { id: 8, name: "G8", room: "Da liễu", isT2: false },
    { id: 9, name: "G9", room: "Da liễu", isT2: false },
    { id: 6, name: "G6", room: "BS Hải", isT2: false }
  ],
  incWait: true,
  curDate: todayVi(),
  version: 0,
  undoCount: 0,
  rules: [
    { id: "r_msc",  keyword: "MSC",           wait: 60, exec: 135, requireT2: true,  label: "MSC",              priority: 1 },
    { id: "r_nk",   keyword: "NK",            wait: 20, exec: 135, requireT2: true,  label: "NK",               priority: 2 },
    { id: "r_khangoxy", keyword: "KHANG OXY HOA", wait: 10, exec: 90,  requireT2: false, label: "Kháng oxy hóa (BS Hải)", priority: 2 },
    { id: "r_duongchat", keyword: "DUONG CHAT", wait: 10, exec: 105, requireT2: false, label: "Dưỡng chất (BS Vân)", priority: 3 },
    { id: "r_exo",  keyword: "EXO",           wait: 10, exec: 75,  requireT2: false, label: "EXO",              priority: 4 },
    { id: "r_nmn",  keyword: "NMN",           wait: 10, exec: 75,  requireT2: false, label: "NMN",              priority: 4 },
    { id: "r_sce",  keyword: "SCE",           wait: 10, exec: 75,  requireT2: false, label: "SCE",              priority: 5 },
    { id: "r_dondc_v",  keyword: "D/C VAN",   wait: 10, exec: 105, requireT2: false, label: "Đơn d/c (Vân)",    priority: 6 },
    { id: "r_dondc_h",  keyword: "D/C HAI",   wait: 10, exec: 105, requireT2: false, label: "Đơn d/c (Hải)",    priority: 7 },
    { id: "r_dondc_d",  keyword: "D/C DUNG",  wait: 10, exec: 180, requireT2: false, label: "Đơn d/c (Dũng)",   priority: 8 },
    { id: "r_dondc_ta", keyword: "D/C TUAN ANH", wait: 10, exec: 180, requireT2: false, label: "Đơn d/c (Tuấn Anh)", priority: 9 },
    { id: "r_dondc", keyword: "D/C",          wait: 10, exec: 105, requireT2: false, label: "Đơn d/c chung",    priority: 10 },
    { id: "r_donbs_v",  keyword: "DON VAN",   wait: 10, exec: 90,  requireT2: false, label: "Đơn thuốc (Vân)",  priority: 11 },
    { id: "r_donbs_h",  keyword: "DON HAI",   wait: 10, exec: 90,  requireT2: false, label: "Đơn thuốc (Hải)",  priority: 12 },
    { id: "r_donbs_d",  keyword: "DON DUNG",  wait: 10, exec: 90,  requireT2: false, label: "Đơn thuốc (Dũng)", priority: 13 },
    { id: "r_donbs_ta", keyword: "DON TUAN ANH", wait: 10, exec: 90, requireT2: false, label: "Đơn thuốc (Tuấn Anh)", priority: 14 },
    { id: "r_don",  keyword: "DON",           wait: 10, exec: 75,  requireT2: false, label: "ĐƠN THUỐC",        priority: 15 },
    { id: "r_default", keyword: "",           wait: 10, exec: 60,  requireT2: false, label: "Mặc định",         priority: 999 }
  ]
};

// --- Persistence (SQLite / PostgreSQL) ---
function saveState() {
  try {
    if (usePg) {
      savePg().catch(e => console.error('savePg error:', e.message));
    } else {
      saveSqlite();
    }
  } catch(e) { console.error('saveState error:', e.message); }
}

function saveSqlite() {
  const delC = db.prepare('DELETE FROM customers');
  const insC = db.prepare('INSERT INTO customers (id, data) VALUES (?, ?)');
  const upsR = db.prepare('INSERT OR REPLACE INTO rules (id, data) VALUES (?, ?)');
  const upsS = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    delC.run();
    for (const c of state.custs) insC.run(c.id, JSON.stringify(c));
    for (const r of state.rules) upsR.run(r.id, JSON.stringify(r));
    upsS.run('incWait', String(state.incWait));
    upsS.run('curDate', state.curDate || '');
    upsS.run('version', String(state.version));
  });
  tx();
}

async function savePg() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM customers');
    for (const c of state.custs) {
      await client.query('INSERT INTO customers (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [c.id, JSON.stringify(c)]);
    }
    for (const r of state.rules) {
      await client.query('INSERT INTO rules (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2', [r.id, JSON.stringify(r)]);
    }
    await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['incWait', String(state.incWait)]);
    await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['curDate', state.curDate || '']);
    await client.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['version', String(state.version)]);
    await client.query('COMMIT');
  } catch(e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

function loadFromRows(custRows, ruleRows, setRows) {
  if (custRows && custRows.length > 0) {
    state.custs = custRows.map(r => JSON.parse(typeof r.data === 'string' ? r.data : r.data));
    console.log('  📂 Đã khôi phục ' + state.custs.length + ' KH từ DB');
  }
  if (ruleRows && ruleRows.length > 0) {
    state.rules = ruleRows.map(r => JSON.parse(typeof r.data === 'string' ? r.data : r.data));
  }
  if (setRows) {
    for (const s of setRows) {
      if (s.key === 'incWait') state.incWait = s.value === 'true';
      else if (s.key === 'curDate' && s.value) state.curDate = s.value;
      else if (s.key === 'version') state.version = parseInt(s.value) || 0;
    }
  }
}

function doLoadSqlite() {
  try {
    const custRows = db.prepare('SELECT data FROM customers').all();
    const ruleRows = db.prepare('SELECT data FROM rules').all();
    const setRows = db.prepare('SELECT key, value FROM settings').all();
    loadFromRows(custRows, ruleRows, setRows);
  } catch(e) { console.error('loadState error:', e.message); }
}

async function doLoadPg() {
  try {
    const custRows = (await db.query('SELECT data FROM customers')).rows;
    const ruleRows = (await db.query('SELECT data FROM rules')).rows;
    const setRows = (await db.query('SELECT key, value FROM settings')).rows;
    loadFromRows(custRows, ruleRows, setRows);
  } catch(e) { console.error('loadState error:', e.message); }
  // Now start the server
  startServer();
}

// Start empty — only Google Sheet data is used
state.custs = [];

// Migrate from state.json if exists (first run after SQLite migration)
try {
  const oldFile = path.join(DATA_DIR, 'state.json');
  if (require('fs').existsSync(oldFile)) {
    var saved = JSON.parse(require('fs').readFileSync(oldFile, 'utf-8'));
    if (saved.custs) state.custs = saved.custs;
    if (saved.rules) state.rules = saved.rules;
    saveState();
    require('fs').renameSync(oldFile, oldFile + '.bak');
    console.log('  📂 Đã migrate ' + state.custs.length + ' KH từ state.json → DB');
  }
} catch(e) { console.log('migrate skip:', e.message); }

// --- Auto-fetch from Google Sheet (startup + periodic every 60s) ---
function hasManualOverride(c) {
  return c.mBed !== 'auto' || c.mTime || c.mDur != null || c.grp || c.rm === 'single';
}
async function doFetchSheet() {
  try {
    console.log('  📥 Đang lấy dữ liệu từ Google Sheet...');
    const csv = await fetchSheetCSV(SHEET_ID);
    const parsed = parseCSV(csv);
    if (parsed.length >= 2) {
      const dataRows = parsed.slice(1);
      // Build lookup of existing customers by name|date key
      var existing = {};
      for (var i = 0; i < state.custs.length; i++) {
        var c = state.custs[i];
        existing[(c.name||'') + '|' + (c.date||'')] = c;
      }
      var merged = [];
      var seen = {};
      dataRows.forEach(function(row, i) {
        var c = mapSheetRow(row);
        var key = (c.name||'') + '|' + (c.date||'');
        seen[key] = true;
        var old = existing[key];
        if (old && hasManualOverride(old)) {
          merged.push(old); // keep manual version
        } else {
          merged.push({
            id: "s_" + Date.now() + "_" + i,
            name: c.name, date: c.date || state.curDate,
            arr: c.arr.padStart(5, '0').slice(0, 5),
            prod: c.prod, pri: c.pri, rm: c.rm || 'none',
            gender: c.gender || 'U',
            vipLevel: c.vipLevel || null,
            mBed: "auto", mTime: "", mDur: null
          });
        }
      });
      // Keep manually-overridden customers not in sheet anymore
      for (var key in existing) {
        if (!seen[key] && hasManualOverride(existing[key])) {
          merged.push(existing[key]);
        }
      }
      merged = merged.filter(c => c.name || c.prod);
      if (merged.length) {
        var changed = merged.length !== state.custs.length || JSON.stringify(merged) !== JSON.stringify(state.custs);
        if (changed) {
          state.custs = merged;
          syncClients();
          console.log('  ✅ Sheet đồng bộ: ' + merged.length + ' khách');
        } else {
          console.log('  ℹ️  Sheet không thay đổi');
        }
      }
    }
  } catch (e) {
    console.log('  ⚠️  Lỗi fetch Sheet: ' + e.message);
  }
}
// Run immediately on startup, then every 60s
doFetchSheet();
setInterval(doFetchSheet, 60000);

// --- WebSocket broadcast ---
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

function syncClients() {
  state.version++;
  state.undoCount = undoStack.length;
  saveState();
  broadcast({ type: 'state', state });
}

// --- API Routes ---
app.get('/api/state', (req, res) => res.json(state));

app.post('/api/reset', (req, res) => {
  pushUndo();
  state.custs = [];
  syncClients();
  res.json({ ok: true });
});

app.post('/api/customer', (req, res) => {
  pushUndo();
  const c = req.body;
  c.id = "c_" + Date.now();
  if (!c.gender) c.gender = detectGender(c.name || '');
  if (!c.vipLevel) c.vipLevel = detectVIPLevel(c.name || '');
  if (c.vipLevel && !c.pri) c.pri = 3;
  state.custs.push(c);
  syncClients();
  res.json({ ok: true, id: c.id });
});

app.put('/api/customer/:id', (req, res) => {
  pushUndo();
  const idx = state.custs.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  state.custs[idx] = { ...state.custs[idx], ...req.body };
  syncClients();
  res.json({ ok: true });
});

app.delete('/api/customer/:id', (req, res) => {
  pushUndo();
  state.custs = state.custs.filter(c => c.id !== req.params.id);
  syncClients();
  res.json({ ok: true });
});

app.post('/api/sync-sheet', (req, res) => {
  pushUndo();
  const { rows } = req.body; // Array of { name, date, arr, prod, pri, rm }
  if (!rows || !rows.length) return res.status(400).json({ error: 'No data' });
  state.custs = rows.map((r, i) => {
    const vl = detectVIPLevel(r.name || '');
    return {
      id: "s_" + Date.now() + "_" + i,
      name: r.name || '',
      date: r.date || state.curDate,
      arr: r.arr || '08:00',
      prod: r.prod || '',
      pri: vl ? 3 : (r.pri || 1),
      rm: r.rm || 'none',
      gender: detectGender(r.name || ''),
      vipLevel: vl,
      mBed: "auto", mTime: "", mDur: null
    };
  });
  syncClients();
  res.json({ ok: true, count: state.custs.length });
});

app.post('/api/fetch-sheet', async (req, res) => {
  pushUndo();
  try {
    const csv = await fetchSheetCSV(SHEET_ID);
    const parsed = parseCSV(csv);
    if (parsed.length < 2) return res.status(400).json({ error: 'Sheet trống hoặc không đọc được' });
    const dataRows = parsed.slice(1);
    var existing = {};
    for (var i = 0; i < state.custs.length; i++) {
      var c = state.custs[i];
      existing[(c.name||'') + '|' + (c.date||'')] = c;
    }
    var merged = [];
    var seen = {};
    dataRows.forEach(function(row, i) {
      var c = mapSheetRow(row);
      var key = (c.name||'') + '|' + (c.date||'');
      seen[key] = true;
      var old = existing[key];
      if (old && hasManualOverride(old)) {
        merged.push(old);
      } else {
        merged.push({
          id: "s_" + Date.now() + "_" + i,
          name: c.name, date: c.date || state.curDate,
          arr: c.arr.padStart(5, '0').slice(0, 5),
          prod: c.prod, pri: c.pri, rm: c.rm || 'none',
          gender: c.gender || 'U',
          vipLevel: c.vipLevel || null,
          mBed: "auto", mTime: "", mDur: null
        });
      }
    });
    for (var key in existing) {
      if (!seen[key] && hasManualOverride(existing[key])) {
        merged.push(existing[key]);
      }
    }
    state.custs = merged.filter(c => c.name || c.prod);
    syncClients();
    res.json({ ok: true, count: state.custs.length });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi fetch sheet: ' + e.message });
  }
});

app.put('/api/settings', (req, res) => {
  if (req.body.incWait !== undefined) state.incWait = req.body.incWait;
  if (req.body.curDate) state.curDate = req.body.curDate;
  syncClients();
  res.json({ ok: true });
});

app.post('/api/undo', (req, res) => {
  if (!undoStack.length) return res.status(400).json({ error: 'Không có lịch sử để hoàn tác' });
  const prev = undoStack.pop();
  state.custs = prev.custs;
  syncClients();
  res.json({ ok: true, remaining: undoStack.length });
});

// --- Rules CRUD ---
app.get('/api/rules', (req, res) => res.json(state.rules));

app.post('/api/rules', (req, res) => {
  const r = req.body;
  r.id = 'r_' + Date.now();
  state.rules.push(r);
  state.rules.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  syncClients();
  res.json({ ok: true, id: r.id });
});

app.put('/api/rules/:id', (req, res) => {
  const idx = state.rules.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  state.rules[idx] = { ...state.rules[idx], ...req.body, id: req.params.id };
  state.rules.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  syncClients();
  res.json({ ok: true });
});

app.delete('/api/rules/:id', (req, res) => {
  state.rules = state.rules.filter(r => r.id !== req.params.id);
  syncClients();
  res.json({ ok: true });
});

// --- WebSocket connection ---
wss.on('connection', (ws) => {
  // Send current state on connect
  ws.send(JSON.stringify({ type: 'state', state }));
});

// --- Start ---
const PORT = process.env.PORT || 3000;
function startServer() {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  🏥 Hospital Scheduler running on http://localhost:${PORT}`);
    console.log(`  📋 Admin:     http://localhost:${PORT}/admin.html`);
    console.log(`  👁  Sales View: http://localhost:${PORT}/sales.html`);
    console.log(`  🔌 API:       http://localhost:${PORT}/api/state\n`);
  });
}

// Start now (for SQLite) or after PostgreSQL init completes
if (!usePg) startServer();
