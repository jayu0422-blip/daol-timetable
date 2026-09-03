/* ===== 다올105 운영 월간 일정표 (admin.html 대시보드) =====
 *
 *   DaolOpsCal.mount(document.getElementById("opsCal"))
 *
 * 이 달력이 있는 이유는 네 가지다.
 *   1) 신규생 첫 납부가 빠지는 사고를 막는다   — 예정일 지나고 미입금이면 맨 위에 경보
 *   2) 인수인계                                — 날짜에 붙여 두면 다음 근무자가 그날 칸에서 본다
 *   3) 당일 근무자                              — 누가 데스크에 있는지 달력에서 바로
 *   4) 상담 가능 시간대                          — 날짜별로 열어 둘 시각을 지정
 *
 * 학사일정은 두 군데서 끌어와 겹쳐 그린다.
 *   · schedule-cal.js  DaolScheduleCal.EXAMS/HOLIDAYS  — 2026 지필평가·공휴일(강사 달력과 같은 원본)
 *   · academic.js      DAOL_ACADEMIC                   — 원장이 planner.html 에서 넣는 행사·방학
 * 둘 중 하나가 없어도 나머지는 그대로 그린다.
 *
 * 저장은 Supabase public.ops_calendar. 표가 아직 없으면 이 기기 localStorage 로 떨어지고
 * 그 사실을 화면에 띄운다(인수인계는 기기별로 갈리면 의미가 없으므로 숨기지 않는다).
 */
(function () {
  "use strict";

  const TBL = "ops_calendar";
  const LS = "daol_ops_cal_v1";
  const KINDS = ["staff", "consult", "newstudent", "handover", "memo"];
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];

  /* 상담 슬롯 팔레트 — booking.html 이 실제로 쓰는 시각을 포함한다 */
  const SLOT_PALETTE = ["10:00", "11:00", "11:30", "12:30", "13:30", "14:30",
                        "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
  const QUICK = {
    "평일 기본": ["10:00"],                                        // booking.html WEEKDAY_SLOTS
    "토요일 기본": ["11:30", "12:30", "13:30", "14:30", "15:00"],   // booking.html SAT_SLOTS
  };

  let sb = null, useDB = false, rows = [], cur = null, sel = null, host = null, booted = false;

  /* ---------- 날짜 유틸 ---------- */
  const pad = n => String(n).padStart(2, "0");
  const iso = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);
  const todayISO = () => { const n = new Date(); return iso(n.getFullYear(), n.getMonth() + 1, n.getDate()); };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const won = n => (Number(n) || 0).toLocaleString() + "원";

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

  /* ---------- 저장소 ---------- */
  function lsRead() { try { return JSON.parse(localStorage.getItem(LS) || "[]"); } catch (e) { return []; } }
  function lsWrite(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} }

  async function probe() {
    const cfg = window.DAOL_CONFIG;
    if (!cfg || !window.supabase) return false;
    try {
      sb = window.supabase.createClient(cfg.url, cfg.anonKey);
      const { error } = await sb.from(TBL).select("id").limit(1);
      return !error;
    } catch (e) { return false; }
  }

  async function loadAll() {
    if (useDB) {
      const { data, error } = await sb.from(TBL).select("*").order("d", { ascending: true });
      if (error) { useDB = false; rows = lsRead(); return; }
      rows = data || [];
    } else {
      rows = lsRead();
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
    ["d", "kind", "who", "slots", "student", "school", "grade", "subjects",
     "pay_due", "amount", "pay_done", "body", "done", "updated_by"].forEach(k => {
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

  /* ---------- 경보 ---------- */
  function alerts() {
    const t = todayISO(), out = [];
    rows.filter(r => r.kind === "newstudent" && !r.pay_done && r.pay_due && r.pay_due <= t)
        .sort((a, b) => a.pay_due < b.pay_due ? -1 : 1)
        .forEach(r => out.push({
          lv: "danger", d: r.pay_due,
          txt: "<b>" + esc(r.student || "이름 미기재") + "</b> 첫 납부 예정일 " + r.pay_due +
               (r.amount ? " · " + won(r.amount) : "") + " — 입금 확인이 안 됐습니다"
        }));
    rows.filter(r => r.kind === "newstudent" && !r.pay_done && r.pay_due && r.pay_due > t &&
                     r.pay_due <= addDays(t, 3))
        .forEach(r => out.push({
          lv: "warn", d: r.pay_due,
          txt: esc(r.student || "이름 미기재") + " 첫 납부 " + r.pay_due + " 예정" +
               (r.amount ? " · " + won(r.amount) : "")
        }));
    byDay(t, "handover").filter(r => !r.done).forEach(r => out.push({
      lv: "warn", d: t, txt: "오늘 인수인계: " + esc((r.body || "").slice(0, 60))
    }));
    if (!one(t, "staff")) out.push({ lv: "info", d: t, txt: "오늘 근무자가 지정돼 있지 않습니다" });
    return out;
  }
  function addDays(isoStr, n) {
    const p = isoStr.split("-").map(Number);
    const dt = new Date(p[0], p[1] - 1, p[2] + n);
    return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
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
.oc-al{padding:0 18px 14px}
.oc-al .a{display:flex;gap:9px;align-items:flex-start;border-radius:10px;padding:9px 12px;margin-top:8px;font-size:13px;line-height:1.5}
.oc-al .a.danger{background:#fef2f2;border:1px solid #f3c9c9;color:#8f1d1d}
.oc-al .a.warn{background:#fffbeb;border:1px solid #f0dcae;color:#7a5b12}
.oc-al .a.info{background:#f3f6fb;border:1px solid #dbe3ee;color:#44506a}
.oc-al .a b{font-weight:800}
.oc-al .dot{flex:none;width:7px;height:7px;border-radius:50%;margin-top:6px;background:currentColor;opacity:.65}
.oc-wrap{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:0;align-items:start}
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
.oc-m.new{background:#fff7ed;color:#9a3412;border-color:#f3d5b5}
.oc-m.new.late{background:#fef2f2;color:#b91c1c;border-color:#f0c9c9}
.oc-m.hand{background:#f5f3ff;color:#6d28d9;border-color:#ddd6fe}
.oc-side{border-left:1px solid var(--oc-line);padding:14px 16px 18px;min-height:420px}
.oc-side h3{margin:0 0 2px;font-size:15px;letter-spacing:-.01em}
.oc-side .sub{font-size:12px;color:var(--oc-mut);margin-bottom:12px}
.oc-sec{border-top:1px solid var(--oc-line);padding:12px 0 2px}
.oc-sec:first-of-type{border-top:0;padding-top:0}
.oc-sec h4{margin:0 0 7px;font-size:12px;font-weight:800;color:#44506a;letter-spacing:.02em}
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
.oc-b.x{color:#b91c1c;border-color:#f0c9c9;padding:5px 8px}
.oc-slots{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
.oc-s{border:1px solid var(--oc-line);background:#fff;border-radius:20px;padding:4px 10px;font:inherit;font-size:12px;
  font-weight:700;color:#55617A;cursor:pointer}
.oc-s.on{background:#1e3a5f;border-color:#1e3a5f;color:#fff}
.oc-item{border:1px solid var(--oc-line);border-radius:10px;padding:9px 10px;margin-bottom:7px;background:#fff;font-size:12.5px}
.oc-item.late{border-color:#f0c9c9;background:#fef7f7}
.oc-item .t{font-weight:800;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.oc-item .m{color:var(--oc-mut);margin-top:3px;line-height:1.5}
.oc-badge{font-size:10px;font-weight:800;padding:1px 6px;border-radius:20px;border:1px solid}
.oc-badge.ok{background:#ecfdf5;color:#0f766e;border-color:#bfe6dc}
.oc-badge.no{background:#fef2f2;color:#b91c1c;border-color:#f0c9c9}
.oc-note{font-size:11.5px;color:var(--oc-mut);line-height:1.55;margin:8px 0 0}
.oc-warn{margin:0 18px 12px;background:#fffbeb;border:1px solid #f0dcae;color:#7a5b12;border-radius:10px;
  padding:10px 12px;font-size:12.5px;line-height:1.55}
.oc-warn a{color:#7a5b12;font-weight:800}
.oc-legend{display:flex;gap:12px;flex-wrap:wrap;padding:10px 18px 14px;font-size:11.5px;color:var(--oc-mut)}
.oc-legend span{display:inline-flex;align-items:center;gap:5px}
.oc-legend i{width:9px;height:9px;border-radius:3px;display:inline-block;border:1px solid}
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
    const t = todayISO();

    const al = alerts();
    const alHtml = al.length ? '<div class="oc-al">' + al.map(a =>
      '<div class="a ' + a.lv + '"><span class="dot"></span><span>' + a.txt + '</span></div>').join("") + '</div>' : "";

    let cells = "";
    for (let i = 0; i < lead; i++) cells += '<div class="oc-c off"></div>';
    for (let d = 1; d <= total; d++) {
      const ds = iso(y, m, d), dow = new Date(y, m - 1, d).getDay();
      const hn = holidayOn(ds), ex = examsOn(ds), ac = academicOn(ds);
      const staff = one(ds, "staff"), cons = one(ds, "consult");
      const news = byDay(ds, "newstudent"), hands = byDay(ds, "handover").filter(r => !r.done);
      const lateNew = news.some(r => !r.pay_done && r.pay_due && r.pay_due <= t);
      const cls = ["oc-c"];
      if (dow === 0) cls.push("sun"); if (dow === 6) cls.push("sat");
      if (hn) cls.push("holi"); if (ds === t) cls.push("today"); if (ds === sel) cls.push("sel");

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
      if (cons && cons.slots) mk += '<span class="oc-m consult">상담 ' + cons.slots.split(",").filter(Boolean).length + '</span>';
      if (news.length) mk += '<span class="oc-m new' + (lateNew ? " late" : "") + '">신규 ' + news.length + '</span>';
      if (hands.length) mk += '<span class="oc-m hand">인수인계</span>';

      cells += '<button type="button" class="' + cls.join(" ") + '" data-d="' + ds + '">' +
        '<div class="oc-n">' + d + (ds === t ? ' <span style="font-size:9.5px;color:#8c6d1f">오늘</span>' : "") + '</div>' +
        (hn ? '<div class="oc-hn">' + esc(hn) + '</div>' : "") +
        tags + (mk ? '<div class="oc-mk">' + mk + '</div>' : "") +
        '</button>';
    }

    host.className = "oc";
    host.innerHTML =
      '<div class="oc-bar">' +
        '<div class="mnav"><button data-nav="-1" title="이전 달">‹</button>' +
        '<span class="cur">' + y + '년 ' + m + '월</span>' +
        '<button data-nav="1" title="다음 달">›</button>' +
        '<button class="now" data-nav="0">이번 달</button></div>' +
        '<div class="sp"></div>' +
        '<button class="oc-b" data-act="print">인쇄</button>' +
      '</div>' +
      (useDB ? "" :
        '<div class="oc-warn"><b>이 기기에만 저장되고 있습니다.</b> 근무자·인수인계는 다른 사람 화면에 안 보입니다. ' +
        '중앙 저장으로 바꾸려면 <a href="https://supabase.com/dashboard/project/sqogiblaagmmkpwwodgf/sql/new" target="_blank" rel="noopener">Supabase SQL 편집기</a>를 열고 ' +
        '저장소의 <code>supabase_ops_calendar.sql</code> 내용을 붙여넣어 한 번 실행한 뒤 이 화면을 새로고침하세요.</div>') +
      alHtml +
      '<div class="oc-wrap">' +
        '<div class="oc-grid">' +
          '<div class="oc-head">' + DOW.map(x => "<div>" + x + "</div>").join("") + '</div>' +
          '<div class="oc-days">' + cells + '</div>' +
          '<div class="oc-legend">' +
            '<span><i style="background:#eef2ff;border-color:#d5dbf7"></i>지필평가</span>' +
            '<span><i style="background:#f1f5f9;border-color:#dde5ee"></i>학사일정</span>' +
            '<span><i style="background:#ecfdf5;border-color:#bfe6dc"></i>근무자</span>' +
            '<span><i style="background:#eff6ff;border-color:#cfe0fb"></i>상담 가능</span>' +
            '<span><i style="background:#fff7ed;border-color:#f3d5b5"></i>신규생</span>' +
            '<span><i style="background:#fef2f2;border-color:#f0c9c9"></i>첫 납부 미확인</span>' +
            '<span><i style="background:#f5f3ff;border-color:#ddd6fe"></i>인수인계</span>' +
          '</div>' +
        '</div>' +
        '<div class="oc-side" id="ocSide"></div>' +
      '</div>';

    host.querySelectorAll("[data-nav]").forEach(b => b.onclick = () => {
      const n = +b.dataset.nav;
      if (n === 0) cur = new Date();
      else cur = new Date(cur.getFullYear(), cur.getMonth() + n, 1);
      render();
    });
    host.querySelector('[data-act="print"]').onclick = () => window.print();
    host.querySelectorAll(".oc-c[data-d]").forEach(c => c.onclick = () => { sel = c.dataset.d; render(); });

    if (!sel || sel.slice(0, 7) !== iso(y, m, 1).slice(0, 7)) {
      sel = (t.slice(0, 7) === iso(y, m, 1).slice(0, 7)) ? t : iso(y, m, 1);
    }
    side();
  }

  /* ---------- 오른쪽 상세 ---------- */
  function side() {
    const el = host.querySelector("#ocSide"); if (!el) return;
    const d = sel, t = todayISO();
    const p = d.split("-").map(Number);
    const dow = DOW[new Date(p[0], p[1] - 1, p[2]).getDay()];
    const hn = holidayOn(d), ex = examsOn(d), ac = academicOn(d);
    const staff = one(d, "staff") || { d, kind: "staff", who: "" };
    const cons = one(d, "consult") || { d, kind: "consult", slots: "" };
    const on = (cons.slots || "").split(",").map(s => s.trim()).filter(Boolean);
    const news = byDay(d, "newstudent"), hands = byDay(d, "handover");

    let sch = "";
    if (hn) sch += '<div class="oc-note" style="color:#b91c1c;font-weight:700">' + esc(hn) + ' — 공휴일</div>';
    if (ex.length) sch += '<div class="oc-note"><b>지필평가</b> · ' +
      ex.map(e => esc(e.school + " " + (e.grade === "전체" ? "" : e.grade) + " " + e.term)).join(" / ") + '</div>';
    if (ac.length) sch += '<div class="oc-note"><b>학사일정</b> · ' +
      ac.map(e => esc(e.school + " " + e.title)).join(" / ") + '</div>';
    if (!hn && !ex.length && !ac.length)
      sch = '<div class="oc-note">이 날짜에 걸린 공휴일·지필평가·학사일정은 없습니다.</div>';

    el.innerHTML =
      '<h3>' + p[1] + '월 ' + p[2] + '일 (' + dow + ')' + (d === t ? ' · 오늘' : '') + '</h3>' +
      '<div class="sub">' + d + '</div>' + sch +

      '<div class="oc-sec"><h4>당일 근무자</h4>' +
        '<div class="oc-row"><input class="oc-in" id="ocStaff" placeholder="예: 김실장 / 오후 박조교" value="' + esc(staff.who || "") + '">' +
        '<button class="oc-b p" id="ocStaffSave">저장</button></div></div>' +

      '<div class="oc-sec"><h4>상담 가능 시간대</h4>' +
        '<div class="oc-slots">' + SLOT_PALETTE.map(s =>
          '<button type="button" class="oc-s' + (on.indexOf(s) >= 0 ? " on" : "") + '" data-slot="' + s + '">' + s + '</button>').join("") + '</div>' +
        '<div class="oc-row">' + Object.keys(QUICK).map(k =>
          '<button class="oc-b" data-quick="' + esc(k) + '">' + esc(k) + '</button>').join("") +
          '<button class="oc-b" data-quick="__none">비우기</button></div>' +
        '<div class="oc-note">여기서 고른 시각이 그날 상담 가능 시간입니다. ' +
          '예약 페이지(booking.html)는 아직 자체 규칙으로 돌아가므로, 이 표와 다르면 예약 페이지 쪽을 맞춰야 합니다.</div>' +
      '</div>' +

      '<div class="oc-sec"><h4>신규 등록생 · 첫 납부</h4>' +
        news.map(r => {
          const late = !r.pay_done && r.pay_due && r.pay_due <= t;
          return '<div class="oc-item' + (late ? " late" : "") + '">' +
            '<div class="t">' + esc(r.student || "이름 미기재") +
              '<span class="oc-badge ' + (r.pay_done ? "ok" : "no") + '">' + (r.pay_done ? "입금 확인" : "미확인") + '</span></div>' +
            '<div class="m">' + [esc(r.school || ""), esc(r.grade || ""), esc(r.subjects || "")].filter(Boolean).join(" · ") +
              (r.pay_due ? '<br>첫 납부 예정 ' + r.pay_due : "") + (r.amount ? " · " + won(r.amount) : "") + '</div>' +
            '<div class="oc-row" style="margin-top:7px;margin-bottom:0">' +
              '<button class="oc-b" data-pay="' + r.id + '">' + (r.pay_done ? "미확인으로" : "입금 확인") + '</button>' +
              '<button class="oc-b x" data-del="' + r.id + '">삭제</button></div></div>';
        }).join("") +
        '<div class="oc-row"><input class="oc-in" id="nsName" placeholder="학생 이름"></div>' +
        '<div class="oc-row"><input class="oc-in" id="nsSchool" placeholder="학교"><input class="oc-in" id="nsGrade" placeholder="학년" style="max-width:82px"></div>' +
        '<div class="oc-row"><input class="oc-in" id="nsSubj" placeholder="과목 (국어·영어)"></div>' +
        '<div class="oc-row"><input class="oc-in" id="nsDue" type="date" value="' + d + '" title="첫 납부 예정일">' +
          '<input class="oc-in" id="nsAmt" placeholder="금액" inputmode="numeric" style="max-width:110px"></div>' +
        '<button class="oc-b p" id="nsAdd" style="width:100%">신규생 추가</button>' +
        '<div class="oc-note">첫 납부 예정일이 지나도 입금 확인을 안 누르면 이 달력 맨 위에 빨간 경보로 남습니다.</div>' +
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

    /* --- 이벤트 --- */
    const $ = id => el.querySelector("#" + id);
    const reload = async () => { render(); };

    $("ocStaffSave").onclick = async () => {
      const v = $("ocStaff").value.trim();
      const curRow = one(d, "staff");
      if (!v && curRow) { await remove(curRow.id); return reload(); }
      if (!v) return;
      await save(Object.assign(curRow || { d, kind: "staff" }, { who: v }));
      reload();
    };

    el.querySelectorAll("[data-slot]").forEach(b => b.onclick = async () => {
      const s = b.dataset.slot, i = on.indexOf(s);
      if (i >= 0) on.splice(i, 1); else on.push(s);
      on.sort();
      const cr = one(d, "consult");
      if (!on.length && cr) { await remove(cr.id); return reload(); }
      await save(Object.assign(cr || { d, kind: "consult" }, { slots: on.join(",") }));
      reload();
    });
    el.querySelectorAll("[data-quick]").forEach(b => b.onclick = async () => {
      const k = b.dataset.quick, cr = one(d, "consult");
      if (k === "__none") { if (cr) await remove(cr.id); return reload(); }
      await save(Object.assign(cr || { d, kind: "consult" }, { slots: QUICK[k].join(",") }));
      reload();
    });

    $("nsAdd").onclick = async () => {
      const nm = $("nsName").value.trim();
      if (!nm) { $("nsName").focus(); return; }
      await save({
        d, kind: "newstudent", student: nm,
        school: $("nsSchool").value.trim(), grade: $("nsGrade").value.trim(),
        subjects: $("nsSubj").value.trim(),
        pay_due: $("nsDue").value || null,
        amount: Number(String($("nsAmt").value).replace(/[^0-9]/g, "")) || null,
        pay_done: false
      });
      reload();
    };
    $("hoAdd").onclick = async () => {
      const b = $("hoBody").value.trim();
      if (!b) { $("hoBody").focus(); return; }
      await save({ d, kind: "handover", body: b, done: false });
      reload();
    };
    el.querySelectorAll("[data-pay]").forEach(b => b.onclick = async () => {
      const r = rows.find(x => x.id === b.dataset.pay); if (!r) return;
      await save(Object.assign(r, { pay_done: !r.pay_done })); reload();
    });
    el.querySelectorAll("[data-done]").forEach(b => b.onclick = async () => {
      const r = rows.find(x => x.id === b.dataset.done); if (!r) return;
      await save(Object.assign(r, { done: !r.done })); reload();
    });
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
      useDB = await probe();
      await loadAll();
      cur = new Date(); sel = todayISO();
    }
    render();
  }

  window.DaolOpsCal = { mount, reload: async () => { await loadAll(); render(); },
                        get rows() { return rows; }, get useDB() { return useDB; } };
})();
