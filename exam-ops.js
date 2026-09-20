/* 다올105 — 시험기간 임시 일정표 (직보·휴강·정규유지·보류)
 *
 * 왜 따로 두나: 평소 시간표는 "요일" 단위인데 시험기간은 "날짜" 단위로 움직인다.
 *   (윤슬중3 직보 9/21(월) 14시, 은가람중2 10/3(토) 휴강 …) 날짜별 임시 일정을 요일 시간표 위에
 *   얹어 보면서 강의실이 겹치는지 바로 확인해야 한다.
 *
 * 저장: Supabase ops_calendar, kind = "memo"  (표 구조 변경 없이 쓴다)
 *   d=날짜  who=강사  school=반(학교학년)  subjects=과목  slots="HH:MM-HH:MM"  room=강의실 key
 *   body = JSON {"t":"직보|휴강|정규|보류|메모","memo":"…"}
 *
 * 쓰는 곳:
 *   admin.html 대시보드 맨 아래 「시험기간 임시 일정표」 — DaolExamOps.mountTable(el)
 *   admin.html 요일별·강의실 탭 배너 + 날짜별 덧입히기 — DaolExamOps.mountDayBanner(el, day), blocksFor(date, roomKey)
 *   ops-cal.js 월간 일정표 — kind=memo 행을 그대로 읽어 "임시 N" 배지·상세에 보여준다
 *
 * 의존(주입): init({ sb, teachers, rooms, assignDay, orderByPref, fmt, onChange })
 */
window.DaolExamOps = (function () {
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const TYPES = ["직보", "휴강", "정규", "보류", "메모", "배정"];
  const TYPE_HELP = { 직보: "시험 직전 보강 — 시간·강의실 필요", 휴강: "그 날 그 반 수업 없음", 정규: "공휴일·연휴여도 평소대로 수업",
                      보류: "아직 결정 안 됨(원장 확인)", 메모: "그 날 전체 안내(예: 추석 연휴 전체 휴강)", 배정: "그 날만 이 반의 강의실을 바꿈(전체 일정표에서 지정)" };
  let dep = null, rows = [], host = null, bannerHost = null, bannerDay = null, booted = false;

  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const pad = n => (n < 10 ? "0" : "") + n;
  const iso = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
  const fmt = m => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const dowOf = d => { const p = d.split("-").map(Number); return DOW[new Date(p[0], p[1] - 1, p[2]).getDay()]; };
  const mdOf = d => (+d.slice(5, 7)) + "/" + (+d.slice(8, 10));
  const ovl = (a, b) => a.start < b.end && b.start < a.end;
  const todayISO = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth() + 1, n.getDate()); };

  /* ---------- 기간: 시험 묶음(1차지필 9·10월 / 2차지필 11·12월) 중 오늘이 속하거나 다음에 오는 것.
     첫 시험 하루 전 ~ 마지막 시험일. 묶음이 끝나면 자동으로 다음 묶음으로 넘어간다. ---------- */
  function clusters() {
    const S = window.DaolScheduleCal, ex = (S && S.EXAMS) || [], Y = (S && S.YEAR) || 2026;
    const by = {};
    ex.forEach(e => { const k = e.term; (by[k] = by[k] || { term: k, days: [] }).days.push(...e.days.map(d => iso(Y, e.month, d))); });
    return Object.values(by).map(c => {
      c.days.sort(); const s = new Date(c.days[0]); s.setDate(s.getDate() - 1);
      return { term: c.term, start: iso(s.getFullYear(), s.getMonth() + 1, s.getDate()), end: c.days[c.days.length - 1] };
    }).sort((a, b) => a.start < b.start ? -1 : 1);
  }
  function period() {
    const cs = clusters(), t = todayISO();
    if (!cs.length) return { term: "", start: "2026-09-20", end: "2026-10-16" };
    return cs.find(c => c.end >= t) || cs[cs.length - 1];
  }
  function datesIn(P) {
    const out = []; const d = new Date(P.start); const e = new Date(P.end);
    while (d <= e) { out.push(iso(d.getFullYear(), d.getMonth() + 1, d.getDate())); d.setDate(d.getDate() + 1); }
    return out;
  }
  function holidayOf(d) {
    const S = window.DaolScheduleCal, H = (S && S.HOLIDAYS) || [];
    const h = H.find(x => x[0] === d); return h ? h[1] : null;
  }
  function examsOf(d) {
    const S = window.DaolScheduleCal; if (!S || !S.EXAMS) return [];
    const m = +d.slice(5, 7), day = +d.slice(8, 10);
    return S.EXAMS.filter(e => e.month === m && e.days.indexOf(day) >= 0).map(e => {
      const days = e.days.slice().sort((a, b) => a - b), i = days.indexOf(day);
      const kind = days.length === 1 ? "one" : (i === 0 ? "start" : (i === days.length - 1 ? "end" : "mid"));
      return { school: e.school, grade: e.grade, kind, nth: i + 1, total: days.length,
               subj: (S.subjectsText ? S.subjectsText(e, day) : "") };
    });
  }
  const KIND = { start: "시작", mid: "시험중", end: "종료", one: "하루" };
  const shortSchool = s => String(s).replace("미사강변", "미강").replace("학교", "");

  /* ---------- 행 파싱 ---------- */
  function body(r) { try { return JSON.parse(r.body || "{}") || {}; } catch (e) { return { memo: r.body || "" }; } }
  function typeOf(r) { return body(r).t || "메모"; }
  function timeOf(r) {
    const m = /^(\d{1,2}:\d{2})?-?(\d{1,2}:\d{2})?$/.exec(r.slots || "");
    const s = m && m[1] ? toMin(m[1]) : null; let e = m && m[2] ? toMin(m[2]) : null;
    let bad = false;
    if (s != null && e != null && e <= s) { e = null; bad = true; }          // 끝이 시작보다 앞이면 무시하고 2시간으로 본다(정규 파서와 동일)
    return { start: s, end: e != null ? e : (s != null ? s + 120 : null), endGuessed: s != null && e == null, bad };
  }
  const entriesOn = d => rows.filter(r => r.d === d);
  const roomLabel = k => { const r = (dep.rooms || []).find(x => x.key === k); return r ? r.label : (k || ""); };

  /* ---------- 강의실 겹침 ----------
     그 날짜의 요일 정규 시간표(assignDay)와 같은 방·겹치는 시간이면 충돌.
     임시 일정끼리도 같은 날·같은 방·겹치는 시간이면 충돌. */
  function regularItems(d) {
    try { return (dep.assignDay(dowOf(d)) || {}).items || []; } catch (e) { return []; }
  }
  function conflictsOf(r, roomKey) {
    const t = timeOf(r); if (t.start == null || !roomKey) return [];
    const me = { start: t.start, end: t.end };
    const out = [];
    regularItems(r.d).forEach(it => {
      if (it.room !== roomKey || !ovl(it.s, me)) return;
      if (isOffThatDay(it.c, r.d)) return;                        // 그 날 휴강으로 잡힌 반은 방을 비운다
      out.push({ kind: "정규", name: it.c.course_name, teacher: it.c.teacher, room: roomKey, start: it.s.start, end: it.s.end });
    });
    entriesOn(r.d).forEach(o => {
      if (o === r || o.id === r.id) return;
      const ot = timeOf(o); if (ot.start == null) return;
      const orm = o.room || suggestRoom(o, true);
      if (orm !== roomKey || !ovl({ start: ot.start, end: ot.end }, me)) return;
      out.push({ kind: "임시", name: [o.who, o.school, o.subjects].filter(Boolean).join(" "), teacher: o.who, room: roomKey, start: ot.start, end: ot.end });
    });
    return out;
  }
  /* ── 반 표기(윤슬중3 · 미강고1 · 중3) → 이 항목이 가리키는 강좌 ──
     강좌명은 "중3 영어정규반 (화목토) 미강·윤슬·은가람중" 처럼 학교가 가운뎃점으로 묶여 있고 target_school 은 '공통'이 많다.
     그래서 부분문자열이 아니라 (1) 학년이 같고 (2) 학교 토큰(윤슬/미강/은가람…)이 강좌명·대상학교에 있으면 강한 일치,
     학교 정보가 아예 없는 강좌는 약한 일치 — 강한 일치가 하나도 없을 때만 쓴다. */
  const normS = s => String(s || "").replace(/\s+/g, "").replace(/학교/g, "").replace(/미사강변/g, "미강").replace(/은가람/g, "은가");
  function parseKey(school) {
    const k = normS(school);
    const m = /^(.*?)(중|고)([1-3])$/.exec(k) || /^(.*?)(중|고)$/.exec(k);
    if (!m) return { school: k, grade: "", level: "" };
    return { school: m[1] ? m[1] + m[2] : "", grade: m[3] ? m[2] + m[3] : "", level: m[2] };
  }
  /* 학교 토큰만 뽑는다 — '…미강·윤슬·은가람중' 처럼 가운뎃점으로 묶여 마지막에만 중/고가 붙은 것도 전부 학교로 본다.
     '국어정규반'·'화목토' 같은 일반 낱말은 학교가 아니므로 제외(그래야 학교 표기 없는 혼합반을 weak 로 구분할 수 있다). */
  function schoolTokens(c) {
    const src = normS((c.course_name || "") + " " + ((c.target_school || "") === "공통" ? "" : (c.target_school || "")));
    const out = []; const re = /([가-힣]+(?:·[가-힣]+)*)(중|고)(?![가-힣])/g; let m;
    while ((m = re.exec(src))) m[1].split("·").forEach(t => { if (t.length >= 2) out.push(t); });
    return out;
  }
  /* 강좌 학년 — grade 칸이 비어 있는 강좌(김영하 중2·중3 국어 정규반)는 강좌명 앞머리에서 읽는다 */
  function gradeOf(c) {
    if (c.grade) return String(c.grade);
    const m = /^(중|고)\s*([1-3])/.exec(c.course_name || "");
    return m ? m[1] + m[2] : "";
  }
  function courseMatchLevel(r, c) {
    if (!c) return 0;
    const cid = body(r).course_id;
    if (cid) return c.id === cid ? 2 : 0;                              // 전체 일정표에서 강좌를 직접 찍은 항목
    if (c.teacher !== r.who) return 0;
    const k = parseKey(r.school);
    if (!k.school && !k.grade) return 0;
    const cg = gradeOf(c);
    if (k.grade && cg.indexOf(k.grade) !== 0) return 0;              // 학년 불일치
    if (k.level && !k.grade && cg.indexOf(k.level) !== 0) return 0;  // '미강고' 처럼 학년 없이 학교만
    if (!k.school) return 2;                                                             // '중3' 처럼 학년만 → 그 학년 전부
    const want = k.school.replace(/(중|고)$/, "");
    const toks = schoolTokens(c);
    if (toks.some(t => t === want || t.indexOf(want) === 0 || want.indexOf(t) === 0)) return 2;
    return toks.length ? 0 : 1;                                                          // 학교 정보 없는 강좌 = 약한 일치
  }
  /* strong = 그 학교 반이 확실한 강좌(강의실 계산에 반영) / weak = 학교 표기 없는 혼합반(정보만 보여주고 강의실은 그대로 잡음) */
  function matchedCourses(r) {
    const all = (dep.getCourses ? dep.getCourses() : []) || [];
    const strong = all.filter(c => courseMatchLevel(r, c) === 2);
    const weak = strong.length ? [] : all.filter(c => courseMatchLevel(r, c) === 1);
    return { strong, weak, any: strong.length ? strong : weak };
  }
  function matchCourse(r, c) { return matchedCourses(r).strong.some(x => x.id === c.id); }
  function isOffThatDay(c, d) { return entriesOn(d).some(r => typeOf(r) === "휴강" && matchCourse(r, c)); }

  /* 자동 제안: 강사 선호 순서로 그 시간에 비어 있는 첫 방 */
  function suggestRoom(r, quiet) {
    const t = timeOf(r); if (t.start == null) return "";
    const keys = (dep.rooms || []).map(x => x.key);
    const order = dep.orderByPref ? dep.orderByPref(r.who, dowOf(r.d), keys) : keys;
    for (const k of order) {
      const regBusy = regularItems(r.d).some(it => it.room === k && ovl(it.s, { start: t.start, end: t.end }) && !isOffThatDay(it.c, r.d));
      if (regBusy) continue;
      const tmpBusy = entriesOn(r.d).some(o => o !== r && o.id !== r.id && o.room === k && timeOf(o).start != null && ovl(timeOf(o), t));
      if (tmpBusy) continue;
      return k;
    }
    return quiet ? "" : (order[0] || "");
  }

  /* 요일 그리드에 덧입힐 블록 — 그 날짜 임시 일정 중 시간이 있는 것 */
  function blocksFor(d, roomKey) {
    return entriesOn(d).filter(r => timeOf(r).start != null && ["직보", "정규", "보류"].indexOf(typeOf(r)) >= 0).map(r => {
      const rm = r.room || suggestRoom(r, true);
      const t = timeOf(r);
      return { room: rm, start: t.start, end: t.end, type: typeOf(r), teacher: r.who, school: r.school, subj: r.subjects,
               name: [r.school, r.subjects, typeOf(r)].filter(Boolean).join(" "), conflict: conflictsOf(r, rm).length > 0, suggested: !r.room };
    }).filter(b => !roomKey || b.room === roomKey);
  }
  /* 그 날짜에 휴강으로 잡힌 강좌 id 집합 (그리드에서 흐리게) */
  function offCourseIds(d, courses) {
    const s = new Set();
    (courses || []).forEach(c => { if (isOffThatDay(c, d)) s.add(c.id); });
    return s;
  }
  /* '전체 휴강' 메모가 있는 날(추석 연휴 등) — 정규 항목으로 따로 살린 반만 빼고 전부 휴강 */
  function allOffThatDay(d) { return entriesOn(d).some(r => typeOf(r) === "메모" && /전체\s*휴강/.test(body(r).memo || "")); }
  /* 그 날짜에 '정규'(연휴여도 수업)로 잡힌 강좌 id 집합 */
  function keepCourseIds(d) {
    const s = new Set();
    entriesOn(d).filter(r => typeOf(r) === "정규").forEach(r => matchedCourses(r).strong.forEach(c => s.add(c.id)));
    return s;
  }
  /* 읽기 전용 목록 (exam-period.html · 인쇄용) */
  function entriesHTML(d) { return entriesOn(d).map(r => entryHTML(r, { noAct: true })).join(""); }

  /* ── 날짜별 실제 배정 ──
     요일 정규표(assignDay) 위에 ① 그 날 강의실 지정(t=배정, course_id) ② 휴강·전체휴강(흐림, 방 비움) ③ 임시 수업(직보 등)을
     얹고, 같은 방·겹치는 시간을 다시 계산한다. admin 요일 탭의 덧입히기와 exam-period.html 이 같은 결과를 쓴다. */
  function roomOverrideOf(d, courseId) {
    const r = entriesOn(d).find(x => typeOf(x) === "배정" && body(x).course_id === courseId && x.room);
    return r ? r.room : null;
  }
  function assignForDate(d) {
    const courses = (dep.getCourses ? dep.getCourses() : []) || [];
    const day = dowOf(d);
    const base = (dep.assignDay(day) || {}).items || [];
    const offIds = offCourseIds(d, courses), keepIds = keepCourseIds(d), allOff = allOffThatDay(d);
    const items = base.map(it => {
      const ov = roomOverrideOf(d, it.c.id);
      const off = (allOff && !keepIds.has(it.c.id)) || offIds.has(it.c.id);
      return { c: it.c, s: it.s, room: ov || it.room, autoRoom: it.room, overridden: !!ov, roomRole: it.roomRole, off, conflict: false };
    });
    const temps = entriesOn(d).filter(r => timeOf(r).start != null && ["직보", "정규", "보류"].indexOf(typeOf(r)) >= 0).map(r => {
      const t = timeOf(r);
      return { id: r.id, room: r.room || suggestRoom(r, true), start: t.start, end: t.end, type: typeOf(r), teacher: r.who, school: r.school, subj: r.subjects,
               name: [r.school, r.subjects, typeOf(r)].filter(Boolean).join(" "), suggested: !r.room, conflict: false, bad: t.bad, endGuessed: t.endGuessed };
    });
    /* 겹침 재계산 — 휴강인 반은 방을 비운 것으로 본다 */
    const live = items.filter(it => !it.off).map(it => ({ ref: it, room: it.room, s: it.s }))
      .concat(temps.map(b => ({ ref: b, room: b.room, s: { start: b.start, end: b.end } })));
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (!a.room || a.room !== b.room || !ovl(a.s, b.s)) continue;
      /* 같은 강사·같은 과목·같은 시간의 무학년 통합반은 한 수업 — 충돌 아님 */
      const ac = a.ref.c, bc = b.ref.c;
      if (ac && bc && ac.teacher === bc.teacher && ac.subject === bc.subject && a.s.start === b.s.start && a.s.end === b.s.end) continue;
      a.ref.conflict = true; b.ref.conflict = true;
    }
    return { day, items, temps, offIds, keepIds, allOff };
  }
  /* 그 날 이 강좌의 강의실 지정 (roomKey 비면 지정 해제 → 자동) */
  async function setRoomOverride(d, c, roomKey) {
    const cur = entriesOn(d).find(x => typeOf(x) === "배정" && body(x).course_id === c.id);
    if (!roomKey) { if (cur) await remove(cur.id); return; }
    await save({ id: cur ? cur.id : null, d, t: "배정", who: c.teacher, school: c.course_name, subjects: c.subject, slots: "", room: roomKey, memo: "", course_id: c.id });
  }
  /* 그 날 이 강좌 휴강 토글 (강좌 id 로 직접 잡는다) */
  async function setOff(d, c, on) {
    const cur = entriesOn(d).find(x => typeOf(x) === "휴강" && body(x).course_id === c.id);
    if (!on) { if (cur) await remove(cur.id); return; }
    if (cur) return;
    await save({ d, t: "휴강", who: c.teacher, school: c.course_name, subjects: c.subject, slots: "", room: "", memo: "전체 일정표에서 지정", course_id: c.id });
  }
  /* 임시 수업(직보 등)의 강의실 지정 */
  async function setTempRoom(id, roomKey) {
    const r = rows.find(x => x.id === id); if (!r) return;
    await save({ id: r.id, d: r.d, t: typeOf(r), who: r.who, school: r.school, subjects: r.subjects, slots: r.slots, room: roomKey || "", memo: body(r).memo, course_id: body(r).course_id });
  }

  /* ---------- 저장 ---------- */
  async function load() {
    if (!dep || !dep.sb) { rows = []; return; }
    const P = period();
    const { data, error } = await dep.sb.from("ops_calendar").select("*").eq("kind", "memo").gte("d", P.start).lte("d", P.end).order("d");
    rows = error ? [] : (data || []);
  }
  async function save(o) {
    const bodyObj = { t: o.t, memo: o.memo || "" }; if (o.course_id) bodyObj.course_id = o.course_id;
    const row = { d: o.d, kind: "memo", who: o.who || null, school: o.school || null, subjects: o.subjects || null,
                  slots: o.slots || null, room: o.room || null, body: JSON.stringify(bodyObj) };
    if (o.id) { const { error } = await dep.sb.from("ops_calendar").update(row).eq("id", o.id); if (error) throw error; }
    else { const { error } = await dep.sb.from("ops_calendar").insert(row); if (error) throw error; }
    await load(); render(); if (dep.onChange) dep.onChange();
  }
  async function remove(id) {
    const { error } = await dep.sb.from("ops_calendar").delete().eq("id", id); if (error) throw error;
    await load(); render(); if (dep.onChange) dep.onChange();
  }

  /* ---------- CSS ---------- */
  function css() {
    if (document.getElementById("xo-style")) return;
    const s = document.createElement("style"); s.id = "xo-style";
    s.textContent = `
.xo-wrap{overflow:auto}
table.xo{width:100%;border-collapse:collapse;font-size:12.5px}
table.xo th{background:#f7f9fc;font-size:11.5px;font-weight:800;color:#5b7095;padding:8px 10px;text-align:left;border-bottom:1px solid #e6ebf2;white-space:nowrap}
table.xo td{padding:7px 10px;border-bottom:1px solid #f1f4f9;vertical-align:top}
table.xo tr.wk td{background:#fbfbfd}
table.xo tr.holi td:first-child b{color:#b91c1c}
table.xo tr.today td{background:#fdfbf5}
table.xo td.dt{white-space:nowrap;width:92px}
table.xo td.dt b{font-size:13px;color:#31405a}
table.xo td.dt small{display:block;color:#b91c1c;font-weight:700;font-size:10.5px}
table.xo td.dt.sun b{color:#b91c1c}table.xo td.dt.sat b{color:#1d4ed8}
.xo-ex{display:inline-flex;align-items:baseline;gap:3px;font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:5px;margin:1px 3px 1px 0;border:1px solid}
.xo-ex.start{background:#dbeafe;color:#1e3a8a;border-color:#93c5fd}.xo-ex.mid{background:#ffedd5;color:#7c2d12;border-color:#fdba74}
.xo-ex.end{background:#fce7f3;color:#831843;border-color:#f9a8d4}.xo-ex.one{background:#eef2ff;color:#3730a3;border-color:#c7d2fe}
.xo-ex i{font-style:normal;opacity:.85}
.xo-e{display:flex;align-items:flex-start;gap:6px;padding:4px 6px;border-radius:8px;margin:2px 0;background:#fff;border:1px solid #eef0f4}
.xo-e.c{border-color:#fca5a5;background:#fff7f7}
.xo-t{flex:none;font-size:10.5px;font-weight:800;padding:1px 6px;border-radius:6px;background:#fef9c3;color:#713f12;border:1px solid #fde047;margin-top:1px}
.xo-t.t휴강{background:#fee2e2;color:#991b1b;border-color:#fecaca}.xo-t.t정규{background:#ecfdf5;color:#065f46;border-color:#a7f3d0}
.xo-t.t보류{background:#f1f5f9;color:#475569;border-color:#cbd5e1}.xo-t.t메모{background:#f5f3ff;color:#5b21b6;border-color:#ddd6fe}
.xo-t.t배정{background:#e0f2fe;color:#075985;border-color:#bae6fd}
.xo-b{flex:1;min-width:0;line-height:1.4}
.xo-b .rm{font-weight:800;color:#1e3a5f}.xo-b .rm.sg{color:#92400e}
.xo-b .cf{display:block;color:#b91c1c;font-weight:700;font-size:11.5px}
.xo-b .memo{color:#64748b;font-size:11.5px}
.xo-a{flex:none;display:flex;gap:3px}
.xo-a button{border:1px solid #e6ebf2;background:#fff;border-radius:6px;font:inherit;font-size:11px;padding:2px 6px;cursor:pointer;color:#31405a}
.xo-a button:hover{background:#f7f9fc}
.xo-add{border:1px dashed #cbd5e1;background:#fff;border-radius:7px;font:inherit;font-size:11.5px;padding:2px 8px;cursor:pointer;color:#5b7095;margin-top:2px}
.xo-add:hover{background:#f7f9fc;color:#1e3a5f}
.xo-sum{display:flex;gap:14px;flex-wrap:wrap;padding:10px 16px;font-size:12.5px;color:#5b7095;border-bottom:1px solid #eef0f4}
.xo-sum b{color:#1e3a5f}.xo-sum .bad b{color:#b91c1c}
.xo-legend{display:flex;gap:12px;flex-wrap:wrap;padding:8px 16px 12px;font-size:11.5px;color:#5b7095}
.xo-legend span{display:inline-flex;align-items:center;gap:5px}
.xo-back{position:fixed;inset:0;background:rgba(15,20,30,.45);z-index:9500;display:flex;align-items:center;justify-content:center;padding:14px}
.xo-modal{background:#fff;border-radius:16px;width:min(560px,100%);max-height:92dvh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:inherit}
.xo-modal .hd{padding:14px 18px 10px;border-bottom:1px solid #eef0f4;font-weight:800;font-size:15px;display:flex;justify-content:space-between;align-items:center}
.xo-modal .hd button{border:0;background:none;font-size:18px;cursor:pointer;color:#64748b}
.xo-modal .bd{padding:12px 18px;display:grid;grid-template-columns:1fr 1fr;gap:10px 12px}
.xo-modal label{display:flex;flex-direction:column;gap:4px;font-size:11.5px;font-weight:700;color:#5b7095}
.xo-modal label.w{grid-column:1 / -1}
.xo-modal input,.xo-modal select,.xo-modal textarea{font:inherit;font-size:13.5px;padding:8px 10px;border:1px solid #dde3ec;border-radius:9px;background:#fff;color:#1f2937}
.xo-modal textarea{min-height:56px;resize:vertical}
.xo-modal .hint{grid-column:1 / -1;font-size:11.5px;color:#64748b;line-height:1.5;background:#f8fafc;border-radius:8px;padding:8px 10px}
.xo-modal .hint.bad{background:#fff1f2;color:#9f1239}
.xo-modal .ft{padding:10px 18px 16px;display:flex;gap:8px;justify-content:flex-end;border-top:1px solid #eef0f4}
.xo-modal .ft button{font:inherit;font-weight:700;border-radius:9px;padding:8px 14px;cursor:pointer;border:1px solid #dde3ec;background:#fff}
.xo-modal .ft button.p{background:#1e3a5f;color:#fff;border-color:#1e3a5f}
.xo-modal .ft button.d{color:#b91c1c;margin-right:auto}
.xo-ban{margin:10px 0 8px;padding:10px 14px;border-radius:12px;background:#fffbeb;border:1px solid #fde68a;font-size:12.5px;color:#713f12}
.xo-ban b{color:#78350f}
.xo-ban .dates{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.xo-ban .dch{border:1px solid #fcd34d;background:#fff;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;font-weight:700;color:#78350f}
.xo-ban .dch.on{background:#f59e0b;color:#fff;border-color:#d97706}
.xo-ban .dch small{font-weight:600;opacity:.8}
.xo-ban ul{margin:6px 0 0;padding-left:18px;line-height:1.55}
.xo-ban ul .c{color:#b91c1c;font-weight:700}
.rblk.temp{border:2px dashed #d97706!important;background:repeating-linear-gradient(135deg,#fef3c7 0 6px,#fde68a 6px 12px)!important}
.rblk.temp.conflict{border-color:#dc2626!important}
.rblk.off{opacity:.38;filter:grayscale(.6)}
.rblk.off .rt::after{content:" · 휴강";color:#b91c1c;font-weight:900}
@media(max-width:760px){.xo-modal .bd{grid-template-columns:1fr}.xo-modal label.w{grid-column:auto}table.xo{font-size:12px}}
`;
    document.head.appendChild(s);
  }

  /* ---------- 표 ---------- */
  function entryHTML(r, opts) {
    const t = typeOf(r), tm = timeOf(r);
    const rm = r.room || (tm.start != null ? suggestRoom(r, true) : "");
    const cf = rm ? conflictsOf(r, rm) : [];
    const hasTime = tm.start != null;
    const time = hasTime ? fmt(tm.start) + "~" + fmt(tm.end) + (tm.bad ? " (⚠ 종료가 시작보다 빨라 2시간으로 봄)" : (tm.endGuessed ? " (종료 미정·2시간 가정)" : "")) : "";
    const b = body(r);
    const hits = (["휴강", "정규", "보류"].indexOf(t) >= 0 && r.who) ? matchedCourses(r) : null;
    const hitHtml = hits === null ? "" : (hits.strong.length
      ? '<div class="memo">→ 강좌 ' + hits.strong.length + '개: ' + esc(hits.strong.map(c => c.course_name).join(" / ")) + '</div>'
      : (hits.weak.length
        ? '<div class="memo" style="color:#92400e">→ 학교 혼합반 ' + hits.weak.length + '개: ' + esc(hits.weak.map(c => c.course_name).join(" / ")) + ' <b>(다른 학교 학생은 수업하므로 강의실은 그대로 잡아 둠)</b></div>'
        : '<div class="memo" style="color:#b91c1c;font-weight:700">⚠ 일치하는 강좌 없음 — 반 표기를 확인하세요 (예: 윤슬중3 · 미강고1 · 중3)</div>'));
    return '<div class="xo-e' + (cf.length ? ' c' : '') + '" data-id="' + esc(r.id) + '">' +
      '<span class="xo-t t' + esc(t) + '">' + esc(t) + '</span>' +
      '<div class="xo-b"><b>' + esc(r.who || "") + '</b> ' + esc(r.school || "") + (r.subjects ? ' <span style="color:#64748b">' + esc(r.subjects) + '</span>' : '') +
      (time ? ' · ' + esc(time) : '') +
      (rm ? ' → <span class="rm' + (r.room ? '' : ' sg') + '">' + esc(roomLabel(rm)) + (r.room ? '' : ' (자동 제안 · 확정 필요)') + '</span>' : (hasTime ? ' → <span class="rm sg">빈 방 없음</span>' : '')) +
      (cf.length ? cf.map(c => '<span class="cf">⚠ 겹침 · ' + esc(c.name) + ' [' + esc(c.teacher) + '] ' + fmt(c.start) + '~' + fmt(c.end) + ' 같은 ' + esc(roomLabel(c.room)) + '</span>').join("") : '') +
      (b.memo ? '<div class="memo">' + esc(b.memo) + '</div>' : '') + hitHtml + '</div>' +
      (opts && opts.noAct ? '' : '<div class="xo-a">' + (rm && !r.room && hasTime ? '<button data-fix="' + esc(r.id) + '" data-room="' + esc(rm) + '" title="제안 강의실을 저장">확정</button>' : '') +
        '<button data-edit="' + esc(r.id) + '">수정</button><button data-del="' + esc(r.id) + '">삭제</button></div>') +
      '</div>';
  }
  function render() {
    if (host) renderTable();
    if (bannerHost) renderBanner();
  }
  function renderTable() {
    const P = period(), t = todayISO();
    const ds = datesIn(P);
    let nE = 0, nC = 0, nS = 0;
    rows.forEach(r => { nE++; const rm = r.room || suggestRoom(r, true); if (rm && conflictsOf(r, rm).length) nC++; if (!r.room && timeOf(r).start != null) nS++; });
    let h = '<div class="xo-sum"><span>' + esc(P.term || "시험") + ' 기간 <b>' + mdOf(P.start) + '(' + dowOf(P.start) + ') ~ ' + mdOf(P.end) + '(' + dowOf(P.end) + ')</b> <span style="color:#94a3b8">(시험 묶음이 끝나면 다음 묶음으로 자동 전환)</span></span>' +
      '<span>임시 일정 <b>' + nE + '건</b></span>' +
      '<span class="' + (nC ? 'bad' : '') + '">강의실 겹침 <b>' + nC + '건</b></span>' +
      '<span class="' + (nS ? 'bad' : '') + '">강의실 미확정 <b>' + nS + '건</b></span>' +
      '<span style="margin-left:auto"><button class="xo-add" data-new="' + esc(t >= P.start && t <= P.end ? t : P.start) + '">+ 일정 추가</button></span></div>';
    h += '<div class="xo-wrap"><table class="xo"><thead><tr><th>날짜</th><th>지필평가</th><th>임시 일정 (직보·휴강·정규유지) → 강의실</th></tr></thead><tbody>';
    ds.forEach(d => {
      const dow = dowOf(d), hn = holidayOf(d), ex = examsOf(d), es = entriesOn(d);
      const cls = [dow === "일" || dow === "토" ? "wk" : "", hn ? "holi" : "", d === t ? "today" : ""].filter(Boolean).join(" ");
      h += '<tr class="' + cls + '"><td class="dt ' + (dow === "일" ? "sun" : (dow === "토" ? "sat" : "")) + '"><b>' + mdOf(d) + ' (' + dow + ')</b>' + (hn ? '<small>' + esc(hn) + '</small>' : '') + (d === t ? '<small style="color:#b45309">오늘</small>' : '') + '</td>';
      h += '<td>' + (ex.length ? ex.map(e => '<span class="xo-ex ' + e.kind + '" title="' + esc(e.subj || "") + '">' + esc(shortSchool(e.school)) + (e.grade && e.grade !== "전체" ? ' ' + esc(e.grade.replace("학년", "")) : '') + ' <i>' + KIND[e.kind] + (e.total > 1 ? ' ' + e.nth + '/' + e.total : '') + '</i></span>').join("") : '<span style="color:#b6c0cf">—</span>') + '</td>';
      h += '<td>' + es.map(r => entryHTML(r)).join("") + '<button class="xo-add" data-new="' + d + '">+ 추가</button></td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="xo-legend"><span><i class="xo-ex start" style="padding:0 5px">시작</i>시험 시작일</span><span><i class="xo-ex mid" style="padding:0 5px">시험중</i>시험 중(일찍 하교)</span><span><i class="xo-ex end" style="padding:0 5px">종료</i>시험 종료일</span>' +
      '<span><i class="xo-t" style="padding:0 5px">직보</i>직전보강 — 시간·강의실 필요</span><span><i class="xo-t t휴강" style="padding:0 5px">휴강</i>그 날 그 반 수업 없음</span><span><i class="xo-t t정규" style="padding:0 5px">정규</i>연휴여도 평소대로</span>' +
      '<span>강의실이 <b style="color:#92400e">자동 제안</b>이면 아직 저장 안 된 것 — [확정]을 눌러야 요일 강의실표에 고정됩니다.</span></div>';
    host.innerHTML = h;
  }

  /* ---------- 요일별 탭 배너 ---------- */
  let overlayDate = null;
  function datesOfDow(day) { return datesIn(period()).filter(d => dowOf(d) === day); }
  function renderBanner() {
    const P = period(), day = bannerDay;
    const ds = datesOfDow(day);
    if (!ds.length) { bannerHost.innerHTML = ""; return; }
    if (overlayDate && dowOf(overlayDate) !== day) overlayDate = null;
    let h = '<div class="xo-ban"><b>시험기간 ' + mdOf(P.start) + ' ~ ' + mdOf(P.end) + ' 강의실 배정</b> — ' + day + '요일에 해당하는 날짜를 누르면 그 날 임시 일정(직보·휴강)을 아래 표에 덧입혀 보여줍니다. ' +
      '<span style="color:#92400e">빗금 블록 = 임시 수업, 흐린 블록 = 그 날 휴강</span>' +
      '<div class="dates"><span class="dch' + (!overlayDate ? ' on' : '') + '" data-ov="">평소 시간표</span>' +
      ds.map(d => { const n = entriesOn(d).length, hn = holidayOf(d); return '<span class="dch' + (overlayDate === d ? ' on' : '') + '" data-ov="' + d + '">' + mdOf(d) + (hn ? ' <small>' + esc(hn) + '</small>' : '') + (n ? ' <small>임시 ' + n + '</small>' : '') + '</span>'; }).join("") + '</div>';
    if (overlayDate) {
      const es = entriesOn(overlayDate), hn = holidayOf(overlayDate);
      h += '<ul>' + (hn ? '<li class="c">' + esc(hn) + ' — 공휴일. 정규 수업은 원장 지시가 있을 때만(“정규” 항목) 진행합니다.</li>' : '') +
        (es.length ? es.map(r => '<li>' + entryHTML(r, { noAct: true }).replace(/^<div class="xo-e[^>]*>/, '<div class="xo-e" style="border:0;background:none;padding:0;margin:0">') + '</li>').join("") : '<li>이 날 임시 일정 없음 — 평소 시간표대로.</li>') + '</ul>';
    }
    h += '</div>';
    bannerHost.innerHTML = h;
  }

  /* ---------- 입력 폼 ---------- */
  function openForm(r, d) {
    const b = r ? body(r) : {}; const tm = r ? timeOf(r) : { start: null, end: null };
    const teachers = (dep.teachers || []).map(t => t.name);
    const roomsOpt = (dep.rooms || []).map(x => '<option value="' + esc(x.key) + '"' + (r && r.room === x.key ? ' selected' : '') + '>' + esc(x.label) + '</option>').join("");
    const back = document.createElement("div"); back.className = "xo-back";
    back.innerHTML = '<div class="xo-modal"><div class="hd"><span>' + (r ? '임시 일정 수정' : '임시 일정 추가') + '</span><button data-x>✕</button></div>' +
      '<div class="bd">' +
      '<label>날짜<input type="date" name="d" value="' + esc(r ? r.d : d) + '"></label>' +
      '<label>유형<select name="t">' + TYPES.map(x => '<option' + ((r ? typeOf(r) : "직보") === x ? ' selected' : '') + '>' + x + '</option>').join("") + '</select></label>' +
      '<label>강사<select name="who"><option value="">(전체/없음)</option>' + teachers.map(n => '<option' + (r && r.who === n ? ' selected' : '') + '>' + esc(n) + '</option>').join("") + '</select></label>' +
      '<label>반 (학교+학년)<input name="school" placeholder="예: 윤슬중3 · 미강고1" value="' + esc(r ? r.school : "") + '"></label>' +
      '<label>과목<input name="subjects" placeholder="예: 국어" value="' + esc(r ? r.subjects : "") + '"></label>' +
      '<label>강의실<select name="room"><option value="">자동 제안</option>' + roomsOpt + '</select></label>' +
      '<label>시작<input type="time" name="s" step="600" value="' + (tm.start != null ? fmt(tm.start) : "") + '"></label>' +
      '<label>종료<input type="time" name="e" step="600" value="' + (tm.end != null && !tm.endGuessed ? fmt(tm.end) : "") + '"></label>' +
      '<label class="w">메모<textarea name="memo" placeholder="예: 원장 전달 — 26(토) 정규수업 유지">' + esc(b.memo || "") + '</textarea></label>' +
      '<div class="hint" id="xoHint"></div>' +
      '</div><div class="ft">' + (r ? '<button class="d" data-del>삭제</button>' : '') + '<button data-x>취소</button><button class="p" data-save>저장</button></div></div>';
    document.body.appendChild(back);
    const q = n => back.querySelector('[name="' + n + '"]');
    const hint = back.querySelector("#xoHint");
    function draft() {
      const s = q("s").value, e = q("e").value;
      return { id: r ? r.id : null, d: q("d").value, t: q("t").value, who: q("who").value, school: q("school").value.trim(), subjects: q("subjects").value.trim(),
               slots: s ? (s + (e ? "-" + e : "")) : "", room: q("room").value, memo: q("memo").value.trim(), course_id: r ? body(r).course_id : undefined };
    }
    function refresh() {
      const o = draft();
      if (!o.d) { hint.className = "hint bad"; hint.textContent = "날짜를 고르세요."; return; }
      const hn = holidayOf(o.d); const ex = examsOf(o.d);
      let msg = mdOf(o.d) + "(" + dowOf(o.d) + ")" + (hn ? " · 🔴 " + hn : "") + (ex.length ? " · 시험: " + ex.map(e => shortSchool(e.school) + " " + KIND[e.kind]).join(", ") : "");
      msg += " · " + TYPE_HELP[o.t];
      const P = period();
      if (o.d < P.start || o.d > P.end) msg += "\n⚠ 이 표의 기간(" + mdOf(P.start) + "~" + mdOf(P.end) + ") 밖 날짜 — 저장은 되지만 이 표·강의실 겹침 검사에는 안 잡히고 월간 일정표에서만 보입니다.";
      const s0 = q("s").value, e0 = q("e").value;
      if (s0 && e0 && toMin(e0) <= toMin(s0)) { hint.className = "hint bad"; hint.textContent = msg + "\n⚠ 종료 시각이 시작보다 빠르거나 같습니다."; return; }
      const fake = { id: o.id, d: o.d, who: o.who, school: o.school, subjects: o.subjects, slots: o.slots, room: o.room, body: JSON.stringify({ t: o.t }) };
      if (["휴강", "정규", "보류"].indexOf(o.t) >= 0 && o.who && o.school) {
        const hits = matchedCourses(fake);
        msg += hits.strong.length ? "\n→ 이 항목이 가리키는 강좌 " + hits.strong.length + "개: " + hits.strong.map(c => c.course_name).join(" / ")
             : (hits.weak.length ? "\n→ 학교 혼합반 " + hits.weak.length + "개: " + hits.weak.map(c => c.course_name).join(" / ") + " (다른 학교 학생은 수업하므로 강의실은 그대로 잡아 둡니다)"
             : "\n⚠ 일치하는 강좌 없음 — 반 표기를 확인하세요 (예: 윤슬중3 · 미강고1 · 중3). 이대로 저장하면 휴강이 강의실 계산에 반영되지 않습니다.");
      }
      if (["직보", "정규", "보류"].indexOf(o.t) >= 0 && timeOf(fake).start != null) {
        const rm = o.room || suggestRoom(fake, true);
        const cf = rm ? conflictsOf(fake, rm) : [];
        msg += "\n강의실: " + (rm ? roomLabel(rm) + (o.room ? "" : " (자동 제안)") : "빈 방 없음");
        if (cf.length) { hint.className = "hint bad"; hint.textContent = msg + "\n⚠ 겹침: " + cf.map(c => c.name + " [" + c.teacher + "] " + fmt(c.start) + "~" + fmt(c.end)).join(" / "); return; }
      } else if (o.t === "직보" && timeOf(fake).start == null) msg += "\n직보는 시작 시각을 넣어야 강의실 겹침을 확인할 수 있습니다.";
      hint.className = "hint"; hint.textContent = msg;
    }
    hint.style.whiteSpace = "pre-line";
    back.addEventListener("input", refresh); back.addEventListener("change", e => {
      if (e.target.name === "who") { const t = (dep.teachers || []).find(x => x.name === e.target.value); if (t && !q("subjects").value) q("subjects").value = t.subject || ""; }
      refresh();
    });
    refresh();
    back.addEventListener("click", async e => {
      if (e.target.closest("[data-x]") || e.target === back) { back.remove(); return; }
      if (e.target.closest("[data-del]")) { if (!confirm("이 임시 일정을 지울까요?")) return; try { await remove(r.id); back.remove(); } catch (err) { alert("삭제 실패: " + err.message); } return; }
      if (e.target.closest("[data-save]")) {
        const o = draft();
        if (!o.d) return alert("날짜를 고르세요.");
        if (o.t !== "메모" && !o.who) return alert("강사를 고르세요.");
        if (["직보", "휴강", "정규", "보류"].indexOf(o.t) >= 0 && !o.school) return alert("반(학교+학년)을 적어주세요. 예: 윤슬중3");
        if (o.t === "직보" && !o.slots) return alert("직보는 시작 시각이 필요합니다.");
        const s1 = q("s").value, e1 = q("e").value;
        if (s1 && e1 && toMin(e1) <= toMin(s1)) return alert("종료 시각이 시작보다 빠르거나 같습니다. 종료 시각을 고쳐주세요.");
        const P = period();
        if ((o.d < P.start || o.d > P.end) && !confirm("이 표의 기간(" + mdOf(P.start) + "~" + mdOf(P.end) + ") 밖 날짜입니다.\n저장은 되지만 이 표와 강의실 겹침 검사에는 잡히지 않습니다(월간 일정표에는 보임). 그래도 저장할까요?")) return;
        if (o.t === "휴강" && o.who && !matchedCourses({ d: o.d, who: o.who, school: o.school }).any.length &&
            !confirm("'" + o.school + "' 과 일치하는 " + o.who + " 선생님 강좌가 없습니다.\n이대로 저장하면 휴강이 강의실 계산에 반영되지 않습니다. 그래도 저장할까요?")) return;
        try { await save(o); back.remove(); } catch (err) { alert("저장 실패: " + err.message); }
      }
    });
  }

  /* ---------- 이벤트 ---------- */
  function wire(el) {
    el.addEventListener("click", async e => {
      const n = e.target.closest("[data-new]"); if (n) { openForm(null, n.dataset.new); return; }
      const ed = e.target.closest("[data-edit]"); if (ed) { const r = rows.find(x => x.id === ed.dataset.edit); if (r) openForm(r); return; }
      const fx = e.target.closest("[data-fix]"); if (fx) { const r = rows.find(x => x.id === fx.dataset.fix); if (!r) return; try { await save({ id: r.id, d: r.d, t: typeOf(r), who: r.who, school: r.school, subjects: r.subjects, slots: r.slots, room: fx.dataset.room, memo: body(r).memo }); } catch (err) { alert("저장 실패: " + err.message); } return; }
      const dl = e.target.closest("[data-del]"); if (dl) { if (!confirm("이 임시 일정을 지울까요?")) return; try { await remove(dl.dataset.del); } catch (err) { alert("삭제 실패: " + err.message); } return; }
      const ov = e.target.closest("[data-ov]"); if (ov) { overlayDate = ov.dataset.ov || null; renderBanner(); if (dep.onOverlay) dep.onOverlay(overlayDate); return; }
    });
  }

  /* ---------- 진입 ---------- */
  function init(o) { dep = o; css(); }
  async function mountTable(el) {
    if (!el) return; host = el; css();
    if (!booted) { booted = true; host.innerHTML = '<div style="padding:18px;color:#5F6B80;font-size:13px">시험기간 임시 일정표 불러오는 중…</div>'; await load(); wire(host); }
    renderTable();
  }
  async function mountDayBanner(el, day) {
    if (!el) return; bannerHost = el; bannerDay = day; css();
    if (!booted) { booted = true; await load(); }
    if (!bannerHost._wired) { wire(bannerHost); bannerHost._wired = true; }
    renderBanner();
  }
  return { init, mountTable, mountDayBanner, load, render, period, clusters, datesIn, entriesOn, blocksFor, offCourseIds, allOffThatDay, keepCourseIds,
           entriesHTML, examsOf, holidayOf, conflictsOf, suggestRoom, assignForDate, setRoomOverride, setOff, setTempRoom, typeOf, body, openForm, remove, wire,
           get overlayDate() { return overlayDate; }, get rows() { return rows; } };
})();
