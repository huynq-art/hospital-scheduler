/* ============================================================
   hospital-scheduler / public/app.js — Shared Scheduling Engine
   ============================================================ */

const bedDefs = [
  { id: 1, name: "G1", room: "VIP 1", isT2: true },
  { id: 2, name: "G2", room: "VIP 1", isT2: true },
  { id: 3, name: "G3", room: "VIP 2", isT2: true },
  { id: 4, name: "G4", room: "VIP 2", isT2: true },
  { id: 5, name: "G5", room: "Lấy mẫu", isT2: false },
  { id: 7, name: "G7", room: "Da liễu", isT2: false },
  { id: 8, name: "G8", room: "Da liễu", isT2: false },
  { id: 9, name: "G9", room: "Da liễu", isT2: false },
  { id: 6, name: "G6", room: "BS Hải", isT2: false }
];

// Room priority order for auto-scheduling
const ROOM_PRIORITY = ['VIP 1', 'VIP 2', 'Lấy mẫu', 'Da liễu', 'BS Hải'];

const matrix = {
  "MSC": { wait: 60, exec: 135, res: true },
  "NK":  { wait: 20, exec: 135, res: true }
};

// --- Utilities ---
function rmTones(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g,"d").replace(/Đ/g,"D");
}
function t2M(t) { const [h,m] = t.split(':'); return +h*60 + +m; }
function m2T(m) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }
function dFmt(d) { const p = d.split('-'); return p.length===3 ? `${p[2]}/${p[1]}/${p[0]}` : d; }
function todayVi() {
  const f = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getConf(raw) {
  // Dynamic rules from state (if available)
  if (window.__state && window.__state.rules && window.__state.rules.length) {
    try {
      var n = rmTones((raw || '').trim().toUpperCase());
      var rules = window.__state.rules;
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (!r || !r.keyword) continue;
        var parts = r.keyword.split(/\s+/);
        var allMatch = true;
        for (var j = 0; j < parts.length; j++) {
          if (!n.includes(parts[j])) { allMatch = false; break; }
        }
        if (allMatch) {
          return { n: r.label || r.keyword, w: r.wait || 10, e: r.exec || 60, r: r.requireT2 || false };
        }
      }
      // Default fallback
      var def = rules.find(function(rr) { return !rr || !rr.keyword; });
      if (def) return { n: def.label || raw, w: def.wait || 10, e: def.exec || 60, r: def.requireT2 || false };
    } catch(e) { console.error('getConf dynamic error:', e); }
  }
  // Fallback to hardcoded rules if no state or no rules
  var n = rmTones((raw || '').trim().toUpperCase());
  if(n.includes("MSC")) return { n: "MSC", w: 60, e: 135, r: true };
  if(n.includes("NK"))  return { n: "NK",  w: 20, e: 135, r: true };
  if(n.includes("NMN")||n.includes("SCE")||n.includes("EXO")) return { n: raw, w: 10, e: 75, r: false };
  if(n.includes("DON")) {
    const dc = n.includes("DUONG CHAT")||n.includes("D/C")||n.includes("DC");
    const v=n.includes("VAN"), h=n.includes("HAI"), d=n.includes("DUNG"), ta=n.includes("TUAN ANH");
    if(dc) {
      if(v||h) return { n:"Đơn d/c (Vân/Hải)", w:10, e:105, r:false };
      if(d||ta) return { n:"Đơn d/c (Dũng/Tuấn Anh)", w:10, e:180, r:false };
      return { n:"Đơn d/c", w:10, e:105, r:false };
    }
    if(v||h||d||ta) return { n:"Đơn thuốc BS", w:10, e:90, r:false };
    return { n:"ĐƠN THUỐC", w:10, e:75, r:false };
  }
  return { n: raw, w: 10, e: 60, r: false };
}

function isVIP(name, prod) {
  if(getConf(prod).r) return true;
  const cn = name.trim().toLowerCase().replace(/[-–—]+\s*/g, ' ');
  return cn.endsWith(' v') || cn.endsWith(' vv') || cn.endsWith(' vip') || cn.endsWith(' vvip');
}

// --- VIP level detection from name suffixes (V, VV, VIP, VVIP + common misspellings) ---
function detectVIPLevel(name) {
  if (!name) return null;
  var n = name.trim();
  // Normalize any dash/space separators around trailing suffixes
  var end = n.replace(/[-–—]+\s*/g, ' ').trim();
  // Check VV / VVIP first (highest)
  if (/ (vvip|vv)$/i.test(end)) return 'VV';
  // Check V / VIP
  if (/ (vip|v)$/i.test(end)) return 'V';
  return null;
}

// --- Gender detection from Vietnamese name ---
function detectGender(name) {
  const n = name.trim().toLowerCase().replace(/[-–—]+\s*(v|vv|vip|vvip)\s*$/i, '').trim();
  if (n.includes(' thị ')) return 'F';
  if (n.includes(' văn ')) return 'M';
  // Strip trailing numbers (years) before checking last name token
  const parts = n.replace(/\s+\d+$/,'').split(/\s+/).filter(Boolean);
  const last = parts[parts.length-1] || '';
  const knownF = ['hồng','hương','lan','mai','hoa','nhung','hạnh','thúy','thủy','trang','ngọc','đào','liên','dung','hằng','vân','quỳnh','diệp','hà','tâm','mỹ','chi','oanh','liễu','huyền','uyên','phương','hiền','hòa','ngà','thơm'];
  const knownM = ['đức','quang','tuấn','dũng','hùng','sơn','hải','phú','cường','trung','tiến','đạt','khánh','minh','bình','lâm','tùng','kiên','giang','thắng','linh','nam','khoa','phước','tín','nhân','trí','điều','sáng','hoan','thuyết','cúc','thái','oai','hưng','đức','thịnh'];
  if (knownF.includes(last)) return 'F';
  if (knownM.includes(last)) return 'M';
  return 'U';
}

// --- Core Scheduling ---
function calcSched(custs, bedDefs, curDate, incWait) {
  const list = custs.filter(c => (c.date || curDate) === curDate);
  const beds = bedDefs.map(b => ({ ...b, nFree: 480, tot: 0, occ: [] }));
  const res = [];
  const genMap = {}; list.forEach(p => genMap[p.id] = p.gender || detectGender(p.name));

  // 1. Process manual overrides first (strict manual assignment)
  const mans = list.filter(p => p.mBed && p.mBed !== 'auto' && p.mTime);
  mans.forEach(p => {
    const cfg = getConf(p.prod);
    const dur = p.mDur ? +p.mDur : (incWait ? cfg.w+cfg.e : cfg.e);
    const start = t2M(p.mTime);
    const bed = beds.find(b => b.id === +p.mBed);
    if(bed) {
      bed.occ.push({ s: start, e: start+dur, type: 'b', n: p.name, m: true, g: genMap[p.id] });
      bed.tot += dur;
      if(bed.isT2 && (p.rm==='single'||p.rm==='couple')) {
        const sib = beds.find(o => o.room === bed.room && o.id !== bed.id);
        if(sib) sib.occ.push({ s: start, e: start+dur, type: 'l', n: `Khóa bởi ${p.name}` });
      }
      res.push({ ...p, dur, v: isVIP(p.name, p.prod), man: true, bId: bed.id, bName: bed.name, bRm: bed.room, sTime: p.mTime, eTime: m2T(start+dur), start, wait: 0, cfg });
    }
  });

  // Track which beds are "locked by owner" (single/couple blocking sibling)
  function isRoomLocked(room, s, e) {
    const rmBeds = beds.filter(o => o.room === room);
    return rmBeds.some(b => b.occ.some(oc => {
      if (oc.type !== 'b') return false;
      const pp = list.find(x => x.name === oc.n);
      return pp && (pp.rm === 'single' || pp.rm === 'couple') && (e > oc.s && s < oc.e);
    }));
  }

  // 2. Auto-schedule remaining (with gender pairing + room priority)
  const autoList = list.filter(p => !mans.some(m => m.id === p.id));
  autoList.sort((a,b) => t2M(a.arr)-t2M(b.arr) || b.pri-a.pri);

  // Pre-group by arrival time window (30min buckets) for same-room pairing
  autoList.forEach(p => {
    const cfg = getConf(p.prod);
    const dur = p.mDur ? +p.mDur : (incWait ? cfg.w+cfg.e : cfg.e);
    const arrM = t2M(p.arr);
    const v = isVIP(p.name, p.prod);
    const pg = genMap[p.id];

    // Determine eligible beds
    const aBeds = (p.mBed && p.mBed!=='auto') ? [+p.mBed]
      : v ? [1,2,3,4] : bedDefs.map(b => b.id);

    let foundBed = null, fStart = arrM, search = arrM, found = false;
    while(!found && search < 1440) {
      let cands = beds.filter(b => aBeds.includes(b.id));
      if (!p.mBed || p.mBed === 'auto') {
        // Sort by: group room → room priority → same-gender sibling → T2 first → ID
        cands.sort((a, b) => {
          // Group-aware: prefer same room as already-scheduled group member
          if (p.grp) {
            const aGrpMatch = res.some(r => r.grp === p.grp && r.bRm === a.room);
            const bGrpMatch = res.some(r => r.grp === p.grp && r.bRm === b.room);
            if (aGrpMatch && !bGrpMatch) return -1;
            if (!aGrpMatch && bGrpMatch) return 1;
          }
          const pa = ROOM_PRIORITY.indexOf(a.room);
          const pb = ROOM_PRIORITY.indexOf(b.room);
          if (pa !== pb) return pa - pb;
          // Same room: prefer gender-matched sibling
          const siblingA = beds.find(o => o.room === a.room && o.id !== a.id);
          const siblingB = beds.find(o => o.room === b.room && o.id !== b.id);
          const aHasSameG = siblingA && siblingA.occ.some(o => o.type==='b' && o.g === pg);
          const bHasSameG = siblingB && siblingB.occ.some(o => o.type==='b' && o.g === pg);
          if (aHasSameG && !bHasSameG) return -1;
          if (!aHasSameG && bHasSameG) return 1;
          return (b.isT2 ? 1 : 0) - (a.isT2 ? 1 : 0) || a.id - b.id;
        });
      }
      for (const b of cands) {
        const e = search + dur;
        if (!b.occ.every(o => e <= o.s || search >= o.e)) continue;
        if (b.isT2 && (p.rm === 'single' || p.rm === 'couple')) {
          const sib = beds.find(o => o.room === b.room && o.id !== b.id);
          if (sib && !sib.occ.every(o => e <= o.s || search >= o.e)) continue;
        }
        if (isRoomLocked(b.room, search, e)) continue;
        // Gender separation: skip T2 bed if sibling has opposite gender (unless couple mode)
        if (b.isT2 && p.rm !== 'couple') {
          const sib = beds.find(o => o.room === b.room && o.id !== b.id);
          if (sib) {
            var oppG = sib.occ.some(function(o) { return o.type === 'b' && o.g && pg && o.g !== pg && o.g !== 'U' && pg !== 'U'; });
            if (oppG) continue;
          }
        }
        foundBed = b; fStart = search; found = true; break;
      }
      if (!found) search += 5;
    }

    if (foundBed) {
      const manMark = !!(p.mBed && p.mBed !== 'auto');
      foundBed.occ.push({ s: fStart, e: fStart + dur, type: 'b', n: p.name, m: manMark, g: pg });
      foundBed.tot += dur;
      if (foundBed.isT2 && (p.rm === 'single' || p.rm === 'couple')) {
        const sib = beds.find(o => o.room === foundBed.room && o.id !== foundBed.id);
        if (sib) sib.occ.push({ s: fStart, e: fStart + dur, type: 'l', n: `Khóa bởi ${p.name}` });
      }
      res.push({ ...p, dur, v, man: manMark, bId: foundBed.id, bName: foundBed.name, bRm: foundBed.room, sTime: m2T(fStart), eTime: m2T(fStart + dur), start: fStart, wait: fStart - arrM, cfg });
    }
  });

  return { res, beds };
}

// --- Drag & Drop helpers ---
function ganttDrop(e, bedId) {
  e.preventDefault();
  const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
  const lane = document.getElementById(`lane-${bedId}`);
  if (!lane) return;
  const rect = lane.getBoundingClientRect();
  const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const newStart = 480 + Math.round(xPct * 600 / 5) * 5; // snap to 5 min
  const newEnd = newStart + dragData.dur;
  // Validate
  const beds = window.__bedState;
  if (!beds) return;
  const targetBed = beds.find(b => b.id === bedId);
  if (!targetBed) return;
  // Check overlap on target bed
  if (!targetBed.occ.every(o => newEnd <= o.s || newStart >= o.e)) {
    alert('Giường này đã có lịch vào khung giờ đó!');
    return;
  }
  // Check service T2 requirement
  const cust = window.__state?.custs.find(c => c.id === dragData.id);
  if (!cust) return;
  var conf = getConf(cust.prod);
  if (conf && conf.r && !targetBed.isT2) {
    alert('Dịch vụ này yêu cầu giường T2!');
    return;
  }
  // Check room mode
  if (targetBed.isT2 && (cust.rm === 'single' || cust.rm === 'couple')) {
    const sib = beds.find(o => o.room === targetBed.room && o.id !== targetBed.id);
    if (sib && !sib.occ.every(o => newEnd <= o.s || newStart >= o.e)) {
      alert('Không thể xếp: phòng đã có người hoặc bị khóa!');
      return;
    }
  }
  // All good — update
  window.dropCallback(dragData.id, bedId, m2T(newStart), dragData.dur);
}

// --- Render Gantt ---
function renderGantt(containerId, scheduleData, isReadOnly) {
  const { res, beds } = scheduleData;
  window.__bedState = beds;
  let html = '';

  beds.forEach(b => {
    const util = Math.min(100, Math.round((b.tot/600)*100));
    const dropAttr = isReadOnly ? '' : `ondragover="event.preventDefault()" ondrop="ganttDrop(event, ${b.id})"`;
    html += `
      <div class="grid grid-cols-11 items-center relative z-10" style="min-height:82px">
        <div class="col-span-1 pr-2 leading-tight">
          <div class="font-bold text-sm">${b.name}</div>
          <span class="text-[10px] ${b.isT2?'bg-violet-100 text-violet-700':'bg-slate-100 text-slate-500'} px-1.5 py-0.5 rounded font-bold">${b.room}</span>
          <div class="text-[9px] text-slate-400 mt-0.5">${util}%</div>
        </div>
        <div class="col-span-10 relative bg-slate-50 border rounded-xl h-[68px] w-full" id="lane-${b.id}" ${dropAttr}></div>
      </div>`;
  });
  document.getElementById(containerId).innerHTML = html;

  // Draw patient blocks
  res.forEach(i => {
    const lane = document.getElementById(`lane-${i.bId}`);
    if(!lane) return;
    const lPct = Math.max(0, ((i.start - 480)/600)*100);
    const wPct = Math.min(100-lPct, (i.dur/600)*100);

    let cl = i.man ? "border-dashed border-2 ring-2 ring-emerald-400 border-emerald-500 bg-emerald-50 text-emerald-900"
      : i.vipLevel === 'VV' ? "bg-amber-50 border-orange-400 text-orange-900 ring-2 ring-orange-300"
      : i.vipLevel === 'V' ? "bg-violet-50 border-violet-400 text-violet-900"
      : i.v ? "bg-violet-50 border-violet-400 text-violet-900"
      : i.cfg.r ? "bg-rose-50 border-rose-400 text-rose-900"
      : i.wait>0 ? "bg-amber-50 border-amber-300 text-amber-900"
      : "bg-emerald-50 border-emerald-300 text-emerald-900";

    const vIc = i.vipLevel === 'VV' ? '<i class="fa-solid fa-crown text-orange-500"></i><i class="fa-solid fa-crown text-orange-500"></i>'
      : (i.vipLevel === 'V' || i.pri==3 || i.v) ? '<i class="fa-solid fa-crown text-amber-500 text-[10px]"></i>' : '';
    const mIc = i.man ? '✍️' : '';
    const dragAttr = isReadOnly ? '' : `draggable="true" ondragstart="event.dataTransfer.setData('text/plain', JSON.stringify({id:'${i.id}',dur:${i.dur}}))"`;
    const clickAttr = isReadOnly ? '' : `onclick="openEdit('${i.id}')"`;

    lane.innerHTML += `
      <div ${dragAttr} ${clickAttr} class="absolute h-[62px] top-[2px] rounded-lg border p-1.5 cursor-pointer shadow-sm overflow-hidden flex flex-col justify-between ${cl}" style="left:${lPct}%; width:${wPct}%">
        <div class="font-bold text-[10px] truncate leading-tight">${vIc} ${mIc} ${i.name}</div>
        <div class="text-[9px] truncate text-slate-600 font-semibold">${i.prod}</div>
        <div class="text-[9px] font-medium mt-0.5 border-t border-slate-200/50 pt-0.5 flex justify-between">
          <span>${i.sTime}-${i.eTime}</span><span class="opacity-70">${i.dur}p</span>
        </div>
      </div>`;
  });

  // Draw locks
  beds.forEach(b => {
    b.occ.forEach(o => {
      if(o.type==='l') {
        const lPct = Math.max(0, ((o.s-480)/600)*100);
        const wPct = Math.min(100-lPct, ((o.e-o.s)/600)*100);
        const lane = document.getElementById(`lane-${b.id}`);
        if(lane) lane.innerHTML += `
          <div class="absolute h-[62px] top-[2px] rounded-lg border border-dashed bg-striped-blocked flex flex-col items-center justify-center pointer-events-none" style="left:${lPct}%; width:${wPct}%">
            <span class="text-[9px] font-bold text-slate-400">🔒 Khóa</span>
          </div>`;
      }
    });
  });
}

// --- Render Stats ---
function renderStats(prefix, res) {
  let tw = 0, td = 0;
  res.forEach(i => { tw += i.wait; if(i.wait>0) td++; });
  document.getElementById(`${prefix}TotalCust`).textContent = res.length;
  document.getElementById(`${prefix}AvgWait`).textContent = res.length ? `${Math.round(tw/res.length)}p` : '0p';
  document.getElementById(`${prefix}Delayed`).textContent = td;
}

// --- Render Table (admin only) — ALL customers, including unscheduled ---
function renderTable(res, custs, curDate) {
  try {
    var tbd = document.getElementById('patientTableBody');
    if (!tbd) { console.log('renderTable: no tbody'); return; }
    var dayCusts = custs.filter(function(c) { return (c.date || curDate) === curDate; });
    if (!dayCusts.length) {
      tbd.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-400">Kh\u00f4ng c\u00f3 kh\u00e1ch h\u00e0ng trong ng\u00e0y</td></tr>';
      return;
    }
    var rows = '';
    for (var i = 0; i < dayCusts.length; i++) {
      var c = dayCusts[i];
      var sched = null;
      for (var j = 0; j < res.length; j++) { if (res[j].id === c.id) { sched = res[j]; break; } }
      var isScheduled = !!sched;
      var cfg = getConf(c.prod);

      var g = '<i class="fa-solid fa-genderless text-slate-400"></i>';
      if (c.gender === 'M') g = '<i class="fa-solid fa-mars text-blue-400"></i>';
      else if (c.gender === 'F') g = '<i class="fa-solid fa-venus text-pink-400"></i>';

      var sB = '<span class="text-slate-400 font-bold text-[10px]"><i class="fa-solid fa-circle-exclamation"></i> Ch\u01b0a x\u1ebfp</span>';
      if (isScheduled) {
        if (sched.wait > 0) sB = '<span class="text-amber-600 font-bold text-[10px]"><i class="fa-solid fa-hourglass"></i> Ch\u1edd ' + sched.wait + 'p</span>';
        else sB = '<span class="text-emerald-600 font-bold text-[10px]"><i class="fa-solid fa-check"></i> OK</span>';
      }

      var bedHtml = '<span class="text-slate-400 italic text-[11px]">Ch\u01b0a x\u00e1c \u0111\u1ecbnh</span>';
      if (isScheduled) {
        bedHtml = '<span class="font-bold text-slate-800 text-[11px]">' + sched.bRm + ' (' + sched.bName + ')</span>'
          + '<div class="text-[9px] text-slate-500">' + sched.sTime + ' - ' + sched.eTime + ' (' + sched.dur + 'p)</div>';
      }

      var pB = '<span class="text-slate-500 text-[10px]">Th\u01b0\u1eddng</span>';
      if (c.pri == 3) pB = '<span class="bg-rose-100 text-rose-700 px-2 py-0.5 rounded font-bold text-[10px]">VIP</span>';
      else if (c.pri == 2) pB = '<span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-bold text-[10px]">Th\u00e2n thi\u1ebft</span>';

      var modeCl = (c.rm === 'single') ? 'border-rose-300 bg-rose-50' : '';
      var noneSel = (c.rm === 'none') ? ' selected' : '';
      var singleSel = (c.rm === 'single') ? ' selected' : '';

      rows += '<tr class="hover:bg-slate-50 border-b border-slate-100' + (isScheduled ? '' : ' bg-amber-50/30') + '">'
        + '<td class="p-3">'
        + '<div class="font-bold text-slate-800 text-[12px] flex items-center gap-1">' + g + ' ' + c.name + '</div>'
        + '<div class="flex flex-wrap gap-1 mt-1">'
        + '<select onchange="changeRoomMode(\'' + c.id + '\',this.value)" class="text-[10px] p-0.5 border rounded bg-white text-slate-600 ' + modeCl + '">'
        + '<option value="none"' + noneSel + '>Gh\u00e9p ph\u00f2ng</option>'
        + '<option value="single"' + singleSel + '>1 m\u00ecnh 1 ph\u00f2ng</option>'
        + '</select>'
        + '</div>'
        + '</td>'
        + '<td class="p-3">' + pB + '</td>'
        + '<td class="p-3 font-semibold text-[11px]">' + c.prod.split('\n')[0] + '<div class="text-[9px] text-slate-400 font-normal">\u1ee6 ' + cfg.w + 'p + L\u00e0m ' + cfg.e + 'p</div></td>'
        + '<td class="p-3 font-medium text-slate-600 text-[11px]">' + c.arr + '</td>'
        + '<td class="p-3">' + bedHtml + '</td>'
        + '<td class="p-3">' + sB + '</td>'
        + '<td class="p-3 text-center">'
        + '<button onclick="openEdit(\'' + c.id + '\')" class="text-slate-400 hover:text-emerald-600 p-1" title="Ch\u1ec9nh s\u1eeda"><i class="fa-solid fa-pen-to-square"></i></button>'
        + '<button onclick="removeCust(\'' + c.id + '\')" class="text-slate-400 hover:text-rose-600 p-1" title="X\u00f3a"><i class="fa-solid fa-trash"></i></button>'
        + '</td>'
        + '</tr>';
    }
    tbd.innerHTML = rows;

    var countEl = document.getElementById('custTableCount');
    if (countEl) countEl.textContent = dayCusts.length + ' kh\u00e1ch (' + res.length + ' \u0111\u00e3 x\u1ebfp)';
  } catch (e) {
    console.error('renderTable error:', e);
    var tbd = document.getElementById('patientTableBody');
    if (tbd) tbd.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-rose-500">L\u1ed7i hi\u1ec3n th\u1ecb: ' + e.message + '</td></tr>';
  }
}

// --- Shared rendering entry point ---
function renderAll(state, isReadOnly, prefix) {
  try {
    const sched = calcSched(state.custs, state.bedDefs, state.curDate, state.incWait);
    console.log('renderAll: ' + sched.res.length + ' scheduled, curDate=' + state.curDate);
    renderGantt('dynamicBedLanes', sched, isReadOnly);
    renderStats(prefix || 'stat', sched.res);
    if(!isReadOnly) renderTable(sched.res, state.custs, state.curDate);
  } catch(e) {
    console.error('renderAll error:', e);
  }
}

// --- Export for HTML use ---
window.bedDefs = bedDefs;
window.matrix = matrix;
window.calcSched = calcSched;
window.renderAll = renderAll;
window.renderGantt = renderGantt;
window.renderStats = renderStats;
window.renderTable = renderTable;
window.getConf = getConf;
window.isVIP = isVIP;
window.rmTones = rmTones;
window.t2M = t2M;
window.m2T = m2T;
window.dFmt = dFmt;
window.todayVi = todayVi;
window.fmtDate = fmtDate;
window.detectGender = detectGender;
