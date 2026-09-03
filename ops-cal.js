/* ===== 다올105 운영 월간 일정표 (admin.html 대시보드) =====
 *
 *   DaolOpsCal.mount(document.getElementById("opsCal"))
 *
 * 이 달력이 있는 이유는 다섯 가지다.
 *   1) 신규생 첫등원                 — 수강료·강의실 안내와 첫 납부가 빠지는 사고를 막는다
 *   2) 인수인계                      — 날짜에 붙여 두면 다음 근무자가 그날 칸에서 본다
 *   3) 당일 근무자                    — 누가 데스크에 있는지 달력에서 바로
 *   4) 상담 가능 시간대                — 요일 규칙대로 자동, 그날만 예외도 가능
 *   5) 상담 예약                      — 데스크에서 직접 잡고, 잡히면 그 자리는 신청이 막힌다
 *
 * 학사일정은 두 군데서 끌어와 겹쳐 그린다.
 *   · schedule-cal.js  DaolScheduleCal.EXAMS/HOLIDAYS  — 2026 지필평가·공휴일(강사 달력과 같은 원본)
 *   · academic.js      DAOL_ACADEMIC                   — 원장이 planner.html 에서 넣는 행사·방학
 * 둘 중 하나가 없어도 나머지는 그대로 그린다.
 *
 * 저장은 두 군데로 갈린다. 이유는 개인정보다.
 *   · ops_calendar  근무자·상담 예외·방학·신규생·인수인계   (supabase_ops_calendar.sql)
 *   · bookings      상담 예약 — 학생 이름과 학부모 전화번호 (supabase_consult.sql)
 *     bookings 는 전화번호를 anon 이 못 읽게 잠겨 있고, 이 화면은 booked_slots 뷰로만 읽는다.
 * ops_calendar 표가 아직 없으면 이 기기 localStorage 로 떨어지고 그 사실을 화면에 띄운다
 * (인수인계는 기기별로 갈리면 의미가 없으므로 숨기지 않는다).
 */
(function () {
  "use strict";

  const TBL = "ops_calendar";
  const VIEW = "booked_slots";
  const LS = "daol_ops_cal_v1";
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const GRADES = { "중등": ["중1", "중2", "중3"], "고등": ["고1", "고2", "고3", "N수"] };

  const CS = () => window.DaolConsultSlots;   // consult-slots.js — 상담 시각의 유일한 원본

  let sb = null, useDB = false, bookOK = false,
      rows = [], books = [], cur = null, sel = null, host = null, booted = false;
  /* 상담 입력 폼의 임시 상태 — 다시 그려도 입력이 날아가지 않게 밖에 둔다 */
  let form = { date: null, time: "", name: "", school: "", div: "고등", grade: "", phone: "", subs: [] };

  /* ---------- 날짜 유틸 ---------- */
  const pad = n => String(n).padStart(2, "0");
  const iso = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);
  const todayISO = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth() + 1, n.getDate()); };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const won = n => (Number(n) || 0).toLocaleString() + "원";
  function addDays(isoStr, n) {
    const p = isoStr.split("-").map(Number);
    const dt = new Date(p[0], p[1] - 1, p[2] + n);
    return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }

  /* ---------- 학사일정 레이어 ---------- */
  function holidayOn(d) {                                   // d = "YYYY-MM-DD"
    const S = window.DaolScheduleCal;
    if (S && S.HOLIDAYS) { const h = S.HOLIDAYS.find(x => x[0] === d); if (h) return h[1]; }
    const A = window.DAOL_HOLIDAYS || [];
    const h2 = A.find(x => x.date === d);
    return h2 ? h2.name : null;
  }
  const MINI = { "미사강변중학교": "미강중", "미사강변고등학교": "미강고", "은가람중학교": "은가중" };
  const shortSchool = s => MINI[s] || String(s).replace("중학교", "중").replace("고등학교", "고");

  function examsOn(d) {                                     // 지필평가
    const S = window.DaolScheduleCal;
    if (!S || !S.EXAMS) return [];
    const p = d.split("-"), m = +p[1], day = +p[2];
    if (+p[0] !== 2026) return [];
    return S.EXAMS.filter(e => e.month === m && e.days.indexOf(day) >= 0)
      .map(e => ({ school: shortSchool(e.school), grade: e.grade, term: e.term, level: e.level }));
  }

  function academicOn(d) {                                  // planner.html 에서 넣은 행사·방학
    const A = window.DAOL_ACADEMIC || [];
    const SC = window.DAOL_SCHOOLS || [];
    return A.filter(e => e.start && d >= e.start && d <= (e.end || e.start)).map(e => {
      const s = SC.find(x => x.id === e.school);
      return { title: e.title || e.type, type: e.type || "", school: s ? s.name : (e.school || ""),
               color: s ? s.color : "#64748b" };
    });
  }

  /* 방학 구간 — 이 달력에 넣은 것 + planner.html 학사일정의 '방학' 항목 */
  function vacations() {
    const out = rows.filter(r => r.kind === "vacation" && r.d).map(r => [r.d, r.body || r.d]);
    (window.DAOL_ACADEMIC || []).forEach(e => {
      const t = (e.type || "") + " " + (e.title || "");
      if (e.start && /방학/.test(t)) out.push([e.start, e.end || e.start]);
    });
    return out;
  }

  /* ---------- 상담 시각 ---------- */
  /* 그날 열리는 시각. consult 행이 있으면 그날만 그 값으로 덮는다(요일 규칙 예외). */
  function slotsOn(d) {
    const ov = one(d, "consult");
    if (ov) return (ov.slots || "").split(",").map(s => s.trim())
                    .filter(s => /^\d{2}:\d{2}$/.test(s)).sort();
    const C = CS(); if (!C) return [];
    if (holidayOn(d)) return [];                            // 공휴일은 닫는다
    return C.forDate(d, { vacations: vacations() });
  }
  const bookedOn = (d, t) => books.find(b => b.slot_date === d && b.slot_time === t) || null;
  const booksOn = d => books.filter(b => b.slot_date === d)
                            .sort((a, b) => (a.slot_time || "") < (b.slot_time || "") ? -1 : 1);

  /* ---------- 저장소 ---------- */
  function lsRead() { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch (e) { return []; } }
  function lsWrite(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} }

  async function probe() {
    const cfg = window.DAOL_CONFIG;
    if (!cfg || !window.supabase) return;
    try { sb = window.supabase.createClient(cfg.url, cfg.anonKey); } catch (e) { return; }
    try { const { error } = await sb.from(TBL).select("id").limit(1); useDB = !error; } catch (e) { useDB = false; }
    /* booked_slots 는 예전 버전(슬롯 시각만)도 있을 수 있어 새 칸으로 찔러 본다 */
    try { const { error } = await sb.from(VIEW).select("id,student_name,confirmed").limit(1); bookOK = !error; }
    catch (e) { bookOK = false; }
  }

  async function loadAll() {
    if (useDB) {
      const { data, error } = await sb.from(TBL).select("*").order("d", { ascending: true });
      if (error) { useDB = false; rows = lsRead(); } else rows = data || [];
    } else rows = lsRead();

    books = [];
    if (bookOK) {
      const from = addDays(todayISO(), -120);
      const { data, error } = await sb.from(VIEW).select("*").gte("slot_date", from).order("slot_date");
      if (!error) books = data || [];
    }
  }

  async function save(row) {
    row.updated_at = new Date().toISOString();
    if (useDB) {
      if (row.id) {
        const { error } = await sb.from(TBL).update(strip(row)).eq("id", row.id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from(TBL).insert(strip(row)).select().single();
        if (error) throw error;
        row.id = data.id;
      }
    } else {
      if (!row.id) row.id = "ls_" + Math.random().toString(36).slice(2) + rows.length;
      const i = rows.findIndex(r => r.id === row.id);
      if (i >= 0) rows[i] = row; else rows.push(row);
      lsWrite(rows); return row;
    }
    const i = rows.findIndex(r => r.id === row.id);
    if (i >= 0) rows[i] = row; else rows.push(row);
    return row;
  }
  function strip(r) {                                       // DB 에 없는 키는 빼고 보낸다
    const o = {};
    ["d", "kind", "who", "slots", "student", "school", "grade", "subjects", "room",
     "pay_due", "amount", "pay_done", "told_fee", "told_room", "body", "done", "updated_by"].forEach(k => {
      if (r[k] !== undefined) o[k] = r[k] === "" ? null : r[k];
    });
    return o;
  }
  async function remove(id) {
    if (useDB) { const { error } = await sb.from(TBL).delete().eq("id", id); if (error) throw error; }
    rows = rows.filter(r => r.id !== id);
    if (!useDB) lsWrite(rows);
  }

  const byDay = (d, kind) => rows.filter(r => r.d === d && (!kind || r.kind === kind));
  const one = (d, kind) => byDay(d, kind)[0] || null;

  /* ---------- 상담 예약 쓰기 (bookings) ---------- */
  async function bookInsert(rec) {
    if (!bookOK) throw new Error("예약 표가 아직 준비되지 않았습니다 (supabase_consult.sql 실행 필요)");
    const { error } = await sb.from("bookings").insert(rec);
    if (error) {
      if (String(error.message || "").indexOf("duplicate") >= 0 || error.code === "23505")
        throw new Error("그 시간은 이미 예약이 있습니다. 화면을 새로 고쳐 주세요.");
      throw error;
    }
  }
  async function bookCancel(id) {
    const { error } = await sb.from("bookings").update({ canceled: true }).eq("id", id);
    if (error) throw error;
  }

  /* ---------- 경보 ---------- */
  function alerts() {
    const t = todayISO(), out = [];

    booksOn(t).forEach(b => out.push({
      lv: "today",
      txt: "<b>" + esc(b.student_name || "이름 미기재") + "</b> 오늘 " + esc(b.slot_time || "") + " 상담" +
           (b.arrive_time && b.arrive_time !== b.slot_time
             ? " · <b>" + esc(b.arrive_time) + " 도착</b>(레벨테스트 " + (b.level_test_min || 0) + "분)" : "") +
           [b.school, b.grade, b.subjects].filter(Boolean).map(x => " · " + esc(x)).join("")
    }));

    rows.filter(r => r.kind === "newstudent" && r.d === t).forEach(r => {
      const miss = [];
      if (!r.told_fee) miss.push("수강료 안내");
      if (!r.told_room) miss.push("강의실 안내");
      out.push({
        lv: miss.length ? "warn" : "info",
        txt: "<b>" + esc(r.student || "이름 미기재") + "</b> 오늘 첫등원" +
             (r.room ? " · " + esc(r.room) : "") +
             (miss.length ? " — <b>" + miss.join(" · ") + "</b> 아직입니다" : " — 안내 완료")
      });
    });

    rows.filter(r => r.kind === "newstudent" && !r.pay_done && r.pay_due && r.pay_due <= t)
        .sort((a, b) => a.pay_due < b.pay_due ? -1 : 1)
        .forEach(r => out.push({
          lv: "danger",
          txt: "<b>" + esc(r.student || "이름 미기재") + "</b> 첫 납부 예정일 " + r.pay_due +
               (r.amount ? " · " + won(r.amount) : "") + " — 입금 확인이 안 됐습니다"
        }));
    rows.filter(r => r.kind === "newstudent" && !r.pay_done && r.pay_due && r.pay_due > t &&
                     r.pay_due <= addDays(t, 3))
        .forEach(r => out.push({
          lv: "warn",
          txt: esc(r.student || "이름 미기재") + " 첫 납부 " + r.pay_due + " 예정" +
               (r.amount ? " · " + won(r.amount) : "")
        }));
    byDay(t, "handover").filter(r => !r.done).forEach(r => out.push({
      lv: "warn", txt: "오늘 인수인계: " + esc((r.body || "").slice(0, 60))
    }));
    if (!one(t, "staff")) out.push({ lv: "info", txt: "오늘 근무자가 지정돼 있지 않습니다" });
    return out;
  }

  /* ---------- CSS ---------- */
  function css() {
    if (document.getElementById("opsCalCss")) return;
    const s = document.createElement("style");
    s.id = "opsCalCss";
    s.textContent = `
.oc{--oc-line:var(--line,#e4e9f0);--oc-mut:var(--muted,#5F6B80)}
.oc-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--oc-line)}
.oc-bar .sp{flex:1}
.oc-rule{font-size:11.5px;color:var(--oc-mut);font-weight:700}
.oc-al{padding:0 18px 14px}
.oc-al .a{display:flex;gap:9px;align-items:flex-start;border-radius:10px;padding:9px 12px;margin-top:8px;font-size:13px;line-height:1.5}
.oc-al .a.danger{background:#fef2f2;border:1px solid #f3c9c9;color:#8f1d1d}
.oc-al .a.warn{background:#fffbeb;border:1px solid #f0dcae;color:#7a5b12}
.oc-al .a.info{background:#f3f6fb;border:1px solid #dbe3ee;color:#44506a}
.oc-al .a.today{background:#eef6ff;border:1px solid #cadcf5;color:#17427e}
.oc-al .a b{font-weight:800}
.oc-al .dot{flex:none;width:7px;height:7px;border-radius:50%;margin-top:6px;background:currentColor;opacity:.65}
.oc-wrap{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:0;align-items:start}
.oc-grid{padding:0 10px 12px}
.oc-head{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;padding:8px 8px 4px}
.oc-head div{text-align:center;font-size:11.5px;font-weight:800;color:var(--oc-mut);letter-spacing:.04em}
.oc-head div:first-child{color:#b91c1c}.oc-head div:last-child{color:#1d4ed8}
.oc-days{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;padding:0 8px}
.oc-c{min-height:96px;border:1px solid var(--oc-line);border-radius:10px;background:#fff;padding:6px 7px;
  cursor:pointer;position:relative;overflow:hidden;text-align:left;font:inherit;display:block;width:100%}
.oc-c:hover{border-color:#c3cede;box-shadow:0 2px 10px -4px rgba(16,24,40,.25)}
.oc-c.off{background:#fafbfd;opacity:.45}
.oc-c.sel{border-color:var(--navy,#1e3a5f);box-shadow:0 0 0 2px rgba(30,58,95,.16)}
.oc-c.today{background:#fdfbf5}
.oc-c.vac{background:#f7f8fa}
.oc-n{font-size:12.5px;font-weight:800;color:#31405a;display:flex;align-items:center;gap:5px}
.oc-c.sun .oc-n{color:#b91c1c}.oc-c.sat .oc-n{color:#1d4ed8}
.oc-c.holi .oc-n{color:#b91c1c}
.oc-hn{font-size:10.5px;font-weight:700;color:#b91c1c;margin-top:1px}
.oc-tag{display:inline-block;font-size:10px;font-weight:800;line-height:1.5;padding:1px 5px;border-radius:5px;margin:2px 2px 0 0;
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:top}
.oc-ex{background:#eef2ff;color:#3730a3;border:1px solid #d5dbf7}
.oc-ac{background:#f1f5f9;color:#334155;border:1px solid #dde5ee}
.oc-mk{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;position:absolute;left:7px;right:7px;bottom:6px}
.oc-m{font-size:10px;font-weight:800;padding:1px 5px;border-radius:20px;border:1px solid}
.oc-m.staff{background:#ecfdf5;color:#0f766e;border-color:#bfe6dc}
.oc-m.consult{background:#eff6ff;color:#1d4ed8;border-color:#cfe0fb}
.oc-m.book{background:#1d4ed8;color:#fff;border-color:#1d4ed8}
.oc-m.new{background:#fff7ed;color:#9a3412;border-color:#f3d5b5}
.oc-m.new.late{background:#fef2f2;color:#b91c1c;border-color:#f0c9c9}
.oc-m.hand{background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe}
.oc-side{border-left:1px solid var(--oc-line);padding:14px 16px 18px;min-height:420px}
.oc-side h3{margin:0 0 2px;font-size:15px;letter-spacing:-.01em}
.oc-side .sub{font-size:12px;color:var(--oc-mut);margin-bottom:12px}
.oc-sec{border-top:1px solid var(--oc-line);padding:12px 0 2px}
.oc-sec h4{margin:0 0 7px;font-size:12px;font-weight:800;color:#44506a;letter-spacing:.02em;
  display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.oc-in{width:100%;border:1px solid var(--oc-line);border-radius:8px;padding:7px 9px;font:inherit;font-size:13px;background:#fff;color:inherit}
.oc-in:focus{outline:2px solid rgba(30,58,95,.18);border-color:#9fb2cc}
textarea.oc-in{min-height:62px;resize:vertical;line-height:1.5}
.oc-row{display:flex;gap:6px;align-items:center;margin-bottom:6px}
.oc-row .oc-in{flex:1}
.oc-b{border:1px solid var(--oc-line);background:#fff;border-radius:8px;padding:6px 10px;font:inherit;font-size:12.5px;
  font-weight:700;color:#31405a;cursor:pointer;white-space:nowrap}
.oc-b:hover{background:#f7f9fc;border-color:#d3dbe6}
.oc-b.p{background:linear-gradient(180deg,#c2a04a,#a8873c);border-color:#96793f;color:#fff}
.oc-b.p:hover{background:linear-gradient(180deg,#b3963f,#8c6d1f)}
.oc-b.p[disabled]{background:#e7e9ee;border-color:#dcdfe6;color:#98a0ae;cursor:not-allowed}
.oc-b.x{color:#b91c1c;border-color:#f0c9c9;padding:5px 8px}
.oc-slots{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
.oc-s{border:1px solid var(--oc-line);background:#fff;border-radius:20px;padding:4px 11px;font:inherit;font-size:12px;
  font-weight:700;color:#55617A;cursor:pointer}
.oc-s.on{background:#1e3a5f;border-color:#1e3a5f;color:#fff}
.oc-s.taken{background:#f3f4f6;border-color:#e0e3e9;color:#9aa2b1;text-decoration:line-through;cursor:not-allowed}
.oc-s.taken::before{content:"✕ ";text-decoration:none;display:inline-block;color:#b91c1c;font-weight:900}
.oc-s[disabled]{cursor:not-allowed}
.oc-chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px}
.oc-ch{border:1px solid var(--oc-line);background:#fff;border-radius:20px;padding:4px 10px;font:inherit;font-size:12px;
  font-weight:700;color:#55617A;cursor:pointer}
.oc-ch.on{background:#1e3a5f;border-color:#1e3a5f;color:#fff}
.oc-ch small{font-weight:600;opacity:.7;margin-left:3px}
.oc-item{border:1px solid var(--oc-line);border-radius:10px;padding:9px 10px;margin-bottom:7px;background:#fff;font-size:12.5px}
.oc-item.late{border-color:#f0c9c9;background:#fef7f7}
.oc-item.bk{border-color:#cadcf5;background:#f7fbff}
.oc-item .t{font-weight:800;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.oc-item .m{color:var(--oc-mut);margin-top:3px;line-height:1.5}
.oc-badge{font-size:10px;font-weight:800;padding:1px 6px;border-radius:20px;border:1px solid}
.oc-badge.ok{background:#ecfdf5;color:#0f766e;border-color:#bfe6dc}
.oc-badge.no{background:#fef2f2;color:#b91c1c;border-color:#f0c9c9}
.oc-badge.bl{background:#eef6ff;color:#17427e;border-color:#cadcf5}
.oc-note{font-size:11.5px;color:var(--oc-mut);line-height:1.55;margin:8px 0 0}
.oc-err{font-size:12px;color:#b91c1c;font-weight:700;margin:6px 0 0;line-height:1.5}
.oc-warn{margin:0 18px 12px;background:#fffbeb;border:1px solid #f0dcae;color:#7a5b12;border-radius:10px;
  padding:10px 12px;font-size:12.5px;line-height:1.55}
.oc-warn a{color:#7a5b12;font-weight:800}
.oc-legend{display:flex;gap:12px;flex-wrap:wrap;padding:10px 18px 14px;font-size:11.5px;color:var(--oc-mut)}
.oc-legend span{display:inline-flex;align-items:center;gap:5px}
.oc-legend i{width:9px;height:9px;border-radius:3px;display:inline-block;border:1px solid}
.oc-tod{border:1px solid #cadcf5;background:#f7fbff;border-radius:12px;padding:12px 13px;margin-bottom:14px}
.oc-tod h4{margin:0 0 8px;font-size:12.5px;font-weight:800;color:#17427e;letter-spacing:.02em;
  display:flex;align-items:center;gap:6px}
.oc-tod .empty{font-size:12px;color:#5b7095;line-height:1.55}
@media(max-width:1080px){.oc-wrap{grid-template-columns:1fr}.oc-side{border-left:0;border-top:1px solid var(--oc-line)}}
@media(max-width:760px){.oc-c{min-height:74px}.oc-tag{display:none}.oc-mk{position:static;margin-top:5px}}
@media print{.oc-side,.oc-bar .oc-b,.oc-warn{display:none}.oc-wrap{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }

  /* ---------- 렌더 ---------- */
  function render() {
    if (!host) return;
    const y = cur.getFullYear(), m = cur.getMonth() + 1;
    const first = new Date(y, m - 1, 1), last = new Date(y, m, 0);
    const lead = first.getDay(), total = last.getDate();
    const t = todayISO(), vac = vacations();

    const al = alerts();
    const alHtml = al.length ? '<div class="oc-al">' + al.map(a =>
      '<div class="a ' + a.lv + '"><span class="dot"></span><span>' + a.txt + '</span></div>').join("") + '</div>' : "";

    let cells = "";
    for (let i = 0; i < lead; i++) cells += '<div class="oc-c off"></div>';
    for (let d = 1; d <= total; d++) {
      const ds = iso(y, m, d), dow = new Date(y, m - 1, d).getDay();
      const hn = holidayOn(ds), ex = examsOn(ds), ac = academicOn(ds);
      const staff = one(ds, "staff");
      const news = byDay(ds, "newstudent"), hands = byDay(ds, "handover").filter(r => !r.done);
      const lateNew = news.some(r => !r.pay_done && r.pay_due && r.pay_due <= t);
      const slots = slotsOn(ds), bks = booksOn(ds);
      const isVac = CS() && CS().inVacation(ds, vac);
      const cls = ["oc-c"];
      if (dow === 0) cls.push("sun"); if (dow === 6) cls.push("sat");
      if (hn) cls.push("holi"); if (isVac) cls.push("vac");
      if (ds === t) cls.push("today"); if (ds === sel) cls.push("sel");

      let tags = "";
      ex.slice(0, 2).forEach(e => {
        tags += '<span class="oc-tag oc-ex" title="' + esc(e.school + " " + e.grade + " " + e.term) + '">' +
                esc(e.school + (e.grade && e.grade !== "전체" ? " " + e.grade.replace("학년", "") : "")) + '</span>';
      });
      if (ex.length > 2) tags += '<span class="oc-tag oc-ex">+' + (ex.length - 2) + '</span>';
      ac.slice(0, 1).forEach(e => {
        tags += '<span class="oc-tag oc-ac" title="' + esc(e.school + " " + e.title) + '">' + esc(e.title) + '</span>';
      });

      let mk = "";
      if (staff && staff.who) mk += '<span class="oc-m staff">' + esc(staff.who) + '</span>';
      if (bks.length) mk += '<span class="oc-m book">상담 ' + bks.length + '</span>';
      else if (slots.length) mk += '<span class="oc-m consult">가능 ' + slots.length + '</span>';
      if (news.length) mk += '<span class="oc-m new' + (lateNew ? " late" : "") + '">첫등원 ' + news.length + '</span>';
      if (hands.length) mk += '<span class="oc-m hand">인수인계</span>';

      cells += '<button type="button" class="' + cls.join(" ") + '" data-d="' + ds + '">' +
        '<div class="oc-n">' + d + (ds === t ? ' <span style="font-size:9.5px;color:#8c6d1f">오늘</span>' : "") + '</div>' +
        (hn ? '<div class="oc-hn">' + esc(hn) + '</div>' : "") +
        tags + (mk ? '<div class="oc-mk">' + mk + '</div>' : "") +
        '</button>';
    }

    const banners =
      (useDB ? "" :
        '<div class="oc-warn"><b>근무자·인수인계가 이 기기에만 저장되고 있습니다.</b> 다른 사람 화면에는 안 보입니다. ' +
        '<a href="https://supabase.com/dashboard/project/sqogiblaagmmkpwwodgf/sql/new" target="_blank" rel="noopener">Supabase SQL 편집기</a>를 열고 ' +
        '저장소의 <code>supabase_ops_calendar.sql</code> 을 붙여넣어 한 번 실행한 뒤 이 화면을 새로고침하세요.</div>') +
      (bookOK ? "" :
        '<div class="oc-warn"><b>상담 예약이 아직 꺼져 있습니다.</b> 같은 SQL 편집기에서 ' +
        '<code>supabase_consult.sql</code> 도 한 번 실행해야 데스크에서 상담을 잡을 수 있습니다. ' +
        '(그 전까지 시간대는 보이지만 확정 버튼은 눌리지 않습니다.)</div>');

    host.className = "oc";
    host.innerHTML =
      '<div class="oc-bar">' +
        '<div class="mnav"><button data-nav="-1" title="이전 달">‹</button>' +
        '<span class="cur">' + y + '년 ' + m + '월</span>' +
        '<button data-nav="1" title="다음 달">›</button>' +
        '<button class="now" data-nav="0">이번 달</button></div>' +
        '<div class="oc-rule">상담 ' + esc(CS() ? CS().RULE_TEXT : "") + '</div>' +
        '<div class="sp"></div>' +
        '<button class="oc-b" data-act="vac">방학 기간</button>' +
        '<button class="oc-b" data-act="print">인쇄</button>' +
      '</div>' + banners + alHtml +
      '<div class="oc-wrap">' +
        '<div class="oc-grid">' +
          '<div class="oc-head">' + DOW.map(x => "<div>" + x + "</div>").join("") + '</div>' +
          '<div class="oc-days">' + cells + '</div>' +
          '<div class="oc-legend">' +
            '<span><i style="background:#eef2ff;border-color:#d5dbf7"></i>지필평가</span>' +
            '<span><i style="background:#f1f5f9;border-color:#dde5ee"></i>학사일정</span>' +
            '<span><i style="background:#ecfdf5;border-color:#bfe6dc"></i>근무자</span>' +
            '<span><i style="background:#eff6ff;border-color:#cfe0fb"></i>상담 가능</span>' +
            '<span><i style="background:#1d4ed8;border-color:#1d4ed8"></i>상담 예약됨</span>' +
            '<span><i style="background:#fff7ed;border-color:#f3d5b5"></i>신규생 첫등원</span>' +
            '<span><i style="background:#fef2f2;border-color:#f0c9c9"></i>첫 납부 미확인</span>' +
            '<span><i style="background:#f5f3ff;border-color:#ddd6fe"></i>인수인계</span>' +
          '</div>' +
        '</div>' +
        '<div class="oc-side" id="ocSide"></div>' +
      '</div>';

    host.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => {
      const n = +b.dataset.nav;
      cur = (n === 0) ? new Date() : new Date(cur.getFullYear(), cur.getMonth() + n, 1);
      render();
    });
    host.querySelector('[data-act="print"]').onclick = () => window.print();
    host.querySelector('[data-act="vac"]').onclick = vacDialog;
    host.querySelectorAll(".oc-c[data-d]").forEach(c => c.onclick = () => {
      sel = c.dataset.d;
      if (form.date !== sel) form = { date: sel, time: "", name: "", school: "", div: "고등", grade: "", phone: "", subs: [] };
      render();
    });

    if (!sel || sel.slice(0, 7) !== iso(y, m, 1).slice(0, 7)) {
      sel = (t.slice(0, 7) === iso(y, m, 1).slice(0, 7)) ? t : iso(y, m, 1);
    }
    side();
  }

  /* 방학 기간 — 월~목 22시 상담은 이 기간에 자동으로 닫힌다 */
  async function vacDialog() {
    const list = rows.filter(r => r.kind === "vacation").sort((a, b) => a.d < b.d ? -1 : 1);
    const curTxt = list.length ? list.map(r => r.d + " ~ " + (r.body || r.d)).join("\n") : "(없음)";
    const v = prompt(
      "방학 기간을 넣으면 그 기간의 월·화·수·목 22시 상담이 자동으로 닫힙니다.\n" +
      "금·토는 방학에도 그대로 엽니다.\n\n" +
      "현재 등록된 방학:\n" + curTxt + "\n\n" +
      "새로 넣으려면  2026-07-20~2026-08-16  형식으로 입력하세요.\n" +
      "전부 지우려면  삭제  라고 입력하세요.", "");
    if (v == null) return;
    const s = v.trim();
    if (!s) return;
    if (s === "삭제") { for (const r of list) await remove(r.id); return render(); }
    const m = s.match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
    if (!m) { alert("형식이 맞지 않습니다. 예: 2026-07-20~2026-08-16"); return; }
    if (m[2] < m[1]) { alert("종료일이 시작일보다 빠릅니다."); return; }
    await save({ d: m[1], kind: "vacation", body: m[2] });
    render();
  }

  /* ---------- 오른쪽: 오늘 상담 일정 (선택 날짜와 무관하게 항상 오늘) ---------- */
  function todayPanel() {
    const t = todayISO(), bks = booksOn(t);
    const p = t.split("-").map(Number);
    const dow = DOW[new Date(p[0], p[1] - 1, p[2]).getDay()];
    let inner;
    if (!bookOK) {
      inner = '<div class="empty">예약 표가 아직 준비되지 않아 오늘 상담을 불러올 수 없습니다.</div>';
    } else if (!bks.length) {
      const open = slotsOn(t);
      inner = '<div class="empty">오늘 잡힌 상담이 없습니다.' +
              (open.length ? ' 열려 있는 시간 — <b>' + open.join(" · ") + '</b>' : ' 오늘은 상담을 열지 않는 날입니다.') +
              '</div>';
    } else {
      inner = bks.map(b =>
        '<div class="oc-item bk"><div class="t">' + esc(b.slot_time || "") + ' · ' + esc(b.student_name || "이름 미기재") +
          (b.confirmed ? '<span class="oc-badge bl">확정</span>' : '<span class="oc-badge no">미확정</span>') +
          (b.source === "desk" ? '<span class="oc-badge ok">데스크</span>' : '') + '</div>' +
        '<div class="m">' + [esc(b.school || ""), esc(b.division || ""), esc(b.grade || ""), esc(b.subjects || "")]
            .filter(Boolean).join(" · ") +
          (b.arrive_time ? '<br><b>' + esc(b.arrive_time) + ' 도착</b>' +
            (b.level_test_min ? ' (레벨테스트 ' + b.level_test_min + '분)' : ' (레벨테스트 없음)') : "") +
        '</div></div>').join("");
    }
    return '<div class="oc-tod"><h4>오늘 상담 일정 <span style="font-weight:600;opacity:.75">' +
           p[1] + '/' + p[2] + ' (' + dow + ')</span>' +
           (bks.length ? '<span class="oc-badge bl">' + bks.length + '건</span>' : '') + '</h4>' + inner + '</div>';
  }

  /* ---------- 오른쪽 상세 ---------- */
  function side() {
    const el = host.querySelector("#ocSide"); if (!el) return;
    const d = sel, t = todayISO();
    const p = d.split("-").map(Number);
    const dow = DOW[new Date(p[0], p[1] - 1, p[2]).getDay()];
    const hn = holidayOn(d), ex = examsOn(d), ac = academicOn(d);
    const staff = one(d, "staff") || { d, kind: "staff", who: "" };
    const news = byDay(d, "newstudent"), hands = byDay(d, "handover");
    const slots = slotsOn(d), bks = booksOn(d), ov = one(d, "consult");
    const vac = vacations(), C = CS();
    if (form.date !== d) form = { date: d, time: "", name: "", school: "", div: "고등", grade: "", phone: "", subs: [] };

    let sch = "";
    if (hn) sch += '<div class="oc-note" style="color:#b91c1c;font-weight:700">' + esc(hn) + ' — 공휴일</div>';
    if (ex.length) sch += '<div class="oc-note"><b>지필평가</b> · ' +
      ex.map(e => esc(e.school + " " + (e.grade === "전체" ? "" : e.grade) + " " + e.term)).join(" / ") + '</div>';
    if (ac.length) sch += '<div class="oc-note"><b>학사일정</b> · ' +
      ac.map(e => esc(e.school + " " + e.title)).join(" / ") + '</div>';
    if (C && C.inVacation(d, vac)) sch += '<div class="oc-note"><b>방학 기간</b> — 월~목 상담은 닫힙니다.</div>';
    if (!sch) sch = '<div class="oc-note">이 날짜에 걸린 공휴일·지필평가·학사일정은 없습니다.</div>';

    /* 상담 시간대 — 요일 규칙대로 자동, 예약된 자리는 X */
    let slotHtml;
    if (!slots.length) {
      slotHtml = '<div class="oc-note">' +
        (hn ? '공휴일이라 상담을 열지 않습니다.'
            : (C && C.closedByVacation(d, vac)) ? '방학이라 이 요일 상담은 닫혀 있습니다.'
            : '이 요일은 상담을 열지 않습니다.') +
        ' 예외로 열려면 아래 <b>이 날만 열기</b>를 쓰세요.</div>';
    } else {
      slotHtml = '<div class="oc-slots">' + slots.map(s => {
        const b = bookedOn(d, s);
        if (b) return '<button type="button" class="oc-s taken" disabled title="' +
          esc((b.student_name || "예약") + " · " + (b.subjects || "")) + '">' + s + '</button>';
        return '<button type="button" class="oc-s' + (form.time === s ? " on" : "") +
               '" data-pick="' + s + '">' + s + '</button>';
      }).join("") + '</div>';
    }

    const subs = (C ? C.SUBJECTS : []);
    const tmin = C ? C.testMinutes(form.subs) : 0;
    const arr = (C && form.time) ? C.arriveTime(form.time, form.subs) : null;
    const canBook = bookOK && form.time && form.name.trim() && form.phone.trim() && form.subs.length;

    el.innerHTML = todayPanel() +
      '<h3>' + p[1] + '월 ' + p[2] + '일 (' + dow + ')' + (d === t ? ' · 오늘' : '') + '</h3>' +
      '<div class="sub">' + d + '</div>' + sch +

      '<div class="oc-sec"><h4>당일 근무자</h4>' +
        '<div class="oc-row"><input class="oc-in" id="ocStaff" placeholder="예: 김실장 / 오후 박조교" value="' + esc(staff.who || "") + '">' +
        '<button class="oc-b p" id="ocStaffSave">저장</button></div></div>' +

      '<div class="oc-sec"><h4>상담 시간대' +
        (ov ? '<span class="oc-badge no">이 날만 예외</span>' : '') + '</h4>' + slotHtml +
        '<div class="oc-row">' +
          '<button class="oc-b" data-open="rule">요일 규칙대로</button>' +
          '<button class="oc-b" data-open="pick">이 날만 열기</button>' +
          '<button class="oc-b" data-open="close">이 날 닫기</button>' +
        '</div>' +
        '<div class="oc-note">' + esc(C ? C.RULE_TEXT : "") +
          '. 예약된 자리는 ✕ 로 잠기고 예약 페이지에서도 신청이 막힙니다.</div>' +
      '</div>' +

      '<div class="oc-sec"><h4>상담 예약' +
        (bks.length ? '<span class="oc-badge bl">' + bks.length + '건</span>' : '') + '</h4>' +
        bks.map(b => '<div class="oc-item bk"><div class="t">' + esc(b.slot_time || "") + ' · ' +
            esc(b.student_name || "이름 미기재") +
            (b.confirmed ? '<span class="oc-badge bl">확정</span>' : '<span class="oc-badge no">미확정</span>') + '</div>' +
          '<div class="m">' + [esc(b.school || ""), esc(b.division || ""), esc(b.grade || ""), esc(b.subjects || "")]
              .filter(Boolean).join(" · ") +
            (b.arrive_time ? '<br><b>' + esc(b.arrive_time) + ' 도착</b>' +
              (b.level_test_min ? ' (레벨테스트 ' + b.level_test_min + '분)' : ' (레벨테스트 없음)') : "") + '</div>' +
          '<div class="oc-row" style="margin-top:7px;margin-bottom:0">' +
            '<button class="oc-b x" data-bcancel="' + b.id + '">예약 취소</button></div></div>').join("") +

        (slots.length ? (
          '<div class="oc-row"><input class="oc-in" id="bkName" placeholder="학생 이름" value="' + esc(form.name) + '">' +
            '<input class="oc-in" id="bkPhone" placeholder="학부모 연락처" inputmode="numeric" value="' + esc(form.phone) + '" style="max-width:140px"></div>' +
          '<div class="oc-row"><input class="oc-in" id="bkSchool" placeholder="학교 (예: 미사강변고)" value="' + esc(form.school) + '"></div>' +
          '<div class="oc-row">' +
            '<button class="oc-b' + (form.div === "중등" ? " p" : "") + '" data-div="중등">중등</button>' +
            '<button class="oc-b' + (form.div === "고등" ? " p" : "") + '" data-div="고등">고등</button>' +
            '<select class="oc-in" id="bkGrade" style="flex:1">' +
              '<option value="">학년</option>' +
              GRADES[form.div].map(g => '<option value="' + g + '"' + (form.grade === g ? " selected" : "") + '>' + g + '</option>').join("") +
            '</select></div>' +
          '<div class="oc-chips">' + subs.map(x =>
            '<button type="button" class="oc-ch' + (form.subs.indexOf(x.s) >= 0 ? " on" : "") + '" data-sub="' + esc(x.s) + '">' +
            esc(x.s) + '<small>' + (x.test ? "30분" : "테스트 없음") + '</small></button>').join("") + '</div>' +
          '<div class="oc-note" style="margin-top:0">' +
            (form.time
              ? '<b>' + esc(form.time) + ' 상담</b> · ' + (tmin ? '<b>' + esc(arr) + ' 도착</b> (레벨테스트 ' + tmin + '분)'
                                                              : '<b>' + esc(form.time) + ' 도착</b> (레벨테스트 없음)')
              : '위에서 상담 시각을 먼저 고르세요.') + '</div>' +
          '<button class="oc-b p" id="bkGo" style="width:100%;margin-top:8px"' + (canBook ? "" : " disabled") + '>상담확정</button>' +
          '<div class="oc-err" id="bkErr" hidden></div>' +
          '<div class="oc-note">상담확정을 누르면 그 자리가 잠기고, 학부모에게 <b>준비물 안내 문자</b>가, ' +
            '원장님께 <b>예약 알림</b>이 나갑니다. 노션 「신규상담」에도 자동으로 올라갑니다.</div>'
        ) : '') +
      '</div>' +

      '<div class="oc-sec"><h4>신규생 첫등원 <span style="font-weight:600;opacity:.8">수강료 · 강의실 안내</span></h4>' +
        news.map(r => {
          const late = !r.pay_done && r.pay_due && r.pay_due <= t;
          return '<div class="oc-item' + (late ? " late" : "") + '">' +
            '<div class="t">' + esc(r.student || "이름 미기재") +
              '<span class="oc-badge ' + (r.told_fee ? "ok" : "no") + '">수강료 안내</span>' +
              '<span class="oc-badge ' + (r.told_room ? "ok" : "no") + '">강의실 안내</span>' +
              '<span class="oc-badge ' + (r.pay_done ? "ok" : "no") + '">' + (r.pay_done ? "입금 확인" : "미납") + '</span></div>' +
            '<div class="m">' + [esc(r.school || ""), esc(r.grade || ""), esc(r.subjects || "")].filter(Boolean).join(" · ") +
              (r.room ? '<br>강의실 <b>' + esc(r.room) + '</b>' : "") +
              (r.pay_due ? '<br>첫 납부 예정 ' + r.pay_due : "") + (r.amount ? " · " + won(r.amount) : "") + '</div>' +
            '<div class="oc-row" style="margin-top:7px;margin-bottom:0;flex-wrap:wrap">' +
              '<button class="oc-b" data-fee="' + r.id + '">수강료 안내' + (r.told_fee ? " 취소" : " 완료") + '</button>' +
              '<button class="oc-b" data-room="' + r.id + '">강의실 안내' + (r.told_room ? " 취소" : " 완료") + '</button>' +
              '<button class="oc-b" data-pay="' + r.id + '">' + (r.pay_done ? "미확인으로" : "입금 확인") + '</button>' +
              '<button class="oc-b x" data-del="' + r.id + '">삭제</button></div></div>';
        }).join("") +
        '<div class="oc-row"><input class="oc-in" id="nsName" placeholder="학생 이름"></div>' +
        '<div class="oc-row"><input class="oc-in" id="nsSchool" placeholder="학교"><input class="oc-in" id="nsGrade" placeholder="학년" style="max-width:82px"></div>' +
        '<div class="oc-row"><input class="oc-in" id="nsSubj" placeholder="과목 (국어·영어)">' +
          '<input class="oc-in" id="nsRoom" placeholder="강의실" style="max-width:110px"></div>' +
        '<div class="oc-row"><input class="oc-in" id="nsDue" type="date" value="' + d + '" title="첫 납부 예정일">' +
          '<input class="oc-in" id="nsAmt" placeholder="수강료" inputmode="numeric" style="max-width:110px"></div>' +
        '<button class="oc-b p" id="nsAdd" style="width:100%">신규생 첫등원 등록</button>' +
        '<div class="oc-note">첫등원 당일에 수강료·강의실 안내가 안 끝났으면 맨 위에 뜹니다. ' +
          '첫 납부 예정일이 지나도 입금 확인을 안 누르면 빨간 경보로 남습니다.</div>' +
      '</div>' +

      '<div class="oc-sec"><h4>인수인계</h4>' +
        hands.map(r => '<div class="oc-item"><div class="m" style="margin-top:0;color:inherit;white-space:pre-wrap">' +
          esc(r.body || "") + '</div>' +
          '<div class="oc-row" style="margin-top:7px;margin-bottom:0">' +
          '<button class="oc-b" data-done="' + r.id + '">' + (r.done ? "처리 취소" : "처리 완료") + '</button>' +
          '<button class="oc-b x" data-del="' + r.id + '">삭제</button>' +
          (r.done ? '<span class="oc-badge ok">완료</span>' : "") + '</div></div>').join("") +
        '<textarea class="oc-in" id="hoBody" placeholder="다음 근무자가 알아야 할 것을 적어 주세요"></textarea>' +
        '<button class="oc-b p" id="hoAdd" style="width:100%;margin-top:6px">인수인계 남기기</button>' +
      '</div>';

    bind(el, d, t, slots);
  }

  /* ---------- 이벤트 ---------- */
  function bind(el, d, t, slots) {
    const $ = id => el.querySelector("#" + id);
    const reload = () => render();
    const keep = () => {                                   // 다시 그리기 전에 입력값을 붙든다
      if ($("bkName")) form.name = $("bkName").value;
      if ($("bkPhone")) form.phone = $("bkPhone").value;
      if ($("bkSchool")) form.school = $("bkSchool").value;
      if ($("bkGrade")) form.grade = $("bkGrade").value;
    };

    $("ocStaffSave").onclick = async () => {
      const v = $("ocStaff").value.trim();
      const curRow = one(d, "staff");
      if (!v && curRow) { await remove(curRow.id); return reload(); }
      if (!v) return;
      await save(Object.assign(curRow || { d, kind: "staff" }, { who: v }));
      reload();
    };

    /* 상담 시각 고르기 */
    el.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => {
      keep(); form.time = (form.time === b.dataset.pick) ? "" : b.dataset.pick; side();
    });

    /* 그날만의 예외 */
    el.querySelectorAll("[data-open]").forEach(b => b.onclick = async () => {
      const k = b.dataset.open, ovr = one(d, "consult");
      if (k === "rule") { if (ovr) await remove(ovr.id); return reload(); }
      if (k === "close") { await save(Object.assign(ovr || { d, kind: "consult" }, { slots: "" })); return reload(); }
      const v = prompt("이 날만 열 상담 시각을 쉼표로 적어 주세요. 예: 20:00,21:00,22:00\n" +
                       "(정각 1시간 단위)", slots.join(","));
      if (v == null) return;
      const list = v.split(",").map(s => s.trim()).filter(s => /^\d{1,2}:\d{2}$/.test(s))
                    .map(s => s.length === 4 ? "0" + s : s).sort();
      if (!list.length) { alert("시각을 못 읽었습니다. 예: 20:00,21:00"); return; }
      await save(Object.assign(ovr || { d, kind: "consult" }, { slots: list.join(",") }));
      reload();
    });

    /* 상담 입력 폼 */
    el.querySelectorAll("[data-div]").forEach(b => b.onclick = () => {
      keep(); form.div = b.dataset.div;
      if (GRADES[form.div].indexOf(form.grade) < 0) form.grade = "";
      side();
    });
    el.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => {
      keep();
      const s = b.dataset.sub, i = form.subs.indexOf(s);
      if (i >= 0) form.subs.splice(i, 1); else form.subs.push(s);
      side();
    });
    ["bkName", "bkPhone", "bkSchool"].forEach(id => { if ($(id)) $(id).oninput = keep; });
    if ($("bkGrade")) $("bkGrade").onchange = keep;

    if ($("bkGo")) $("bkGo").onclick = async () => {
      keep();
      const C = CS(), err = $("bkErr");
      const show = m => { err.hidden = false; err.textContent = m; };
      err.hidden = true;
      const phone = form.phone.replace(/\D/g, "");
      if (phone.length < 10) return show("연락처를 11자리로 확인해 주세요.");
      if (bookedOn(d, form.time)) return show("그 시간은 방금 다른 예약이 잡혔습니다. 새로 고쳐 주세요.");
      const tmin = C.testMinutes(form.subs);
      const rec = {
        slot_date: d, slot_time: form.time,
        arrive_time: C.arriveTime(form.time, form.subs),
        student_name: form.name.trim(), phone: phone,
        school: form.school.trim() || null,
        grade: form.grade || null, division: form.div,
        subjects: form.subs.join(","), level_test_min: tmin,
        source: "desk", confirmed: true, status: "상담확정", synced: false
      };
      $("bkGo").disabled = true; $("bkGo").textContent = "확정하는 중…";
      try {
        await bookInsert(rec);
        form = { date: d, time: "", name: "", school: "", div: form.div, grade: "", phone: "", subs: [] };
        await loadAll(); render();
      } catch (e) {
        $("bkGo").disabled = false; $("bkGo").textContent = "상담확정";
        show(e.message || "저장하지 못했습니다.");
      }
    };
    el.querySelectorAll("[data-bcancel]").forEach(b => b.onclick = async () => {
      if (!confirm("이 예약을 취소할까요? 그 시간은 다시 열립니다.\n(문자가 이미 나갔다면 따로 연락해 주세요.)")) return;
      try { await bookCancel(b.dataset.bcancel); await loadAll(); render(); }
      catch (e) { alert("취소하지 못했습니다: " + (e.message || e)); }
    });

    /* 신규생 첫등원 */
    $("nsAdd").onclick = async () => {
      const nm = $("nsName").value.trim();
      if (!nm) { $("nsName").focus(); return; }
      await save({
        d, kind: "newstudent", student: nm,
        school: $("nsSchool").value.trim(), grade: $("nsGrade").value.trim(),
        subjects: $("nsSubj").value.trim(), room: $("nsRoom").value.trim(),
        pay_due: $("nsDue").value || null,
        amount: Number(String($("nsAmt").value).replace(/[^0-9]/g, "")) || null,
        pay_done: false, told_fee: false, told_room: false
      });
      reload();
    };
    $("hoAdd").onclick = async () => {
      const b = $("hoBody").value.trim();
      if (!b) { $("hoBody").focus(); return; }
      await save({ d, kind: "handover", body: b, done: false });
      reload();
    };
    const toggle = (attr, field) => el.querySelectorAll("[data-" + attr + "]").forEach(b => b.onclick = async () => {
      const r = rows.find(x => x.id === b.dataset[attr]); if (!r) return;
      const patch = {}; patch[field] = !r[field];
      await save(Object.assign(r, patch)); reload();
    });
    toggle("pay", "pay_done"); toggle("fee", "told_fee"); toggle("room", "told_room"); toggle("done", "done");
    el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm("이 항목을 지울까요?")) return;
      await remove(b.dataset.del); reload();
    });
  }

  /* ---------- 진입 ---------- */
  async function mount(el) {
    if (!el) return;
    host = el; css();
    if (!booted) {
      booted = true;
      host.innerHTML = '<div style="padding:26px 18px;color:#5F6B80;font-size:13px">월간 일정표 불러오는 중…</div>';
      await probe();
      await loadAll();
      cur = new Date(); sel = todayISO(); form.date = sel;
    }
    render();
  }

  window.DaolOpsCal = { mount, reload: async () => { await loadAll(); render(); },
                        get rows() { return rows; }, get books() { return books; },
                        get useDB() { return useDB; }, get bookOK() { return bookOK; } };
})();
