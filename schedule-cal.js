/* ===== 다올105 월간 일정표 컴포넌트 (2026) =====
   - 강사 페이지 등에 드롭인: DaolScheduleCal.render(el, {mySchools:[...]})
   - 공휴일(대체공휴일 포함) + 중·고 지필평가를 입체적으로 표시
   - 기본은 '실제 현재 월' 자동 선택. 월이 넘어가면 자동 갱신(autoFollow).
   데이터 출처: 2026 중/고 지필평가 일정 엑셀 + 관공서 공휴일 규정(대체공휴일 계산). */
(function () {
  const YEAR = 2026;

  /* 공휴일: [날짜, 이름] (대체공휴일 포함, 검증 완료) */
  const HOLIDAYS = [
    ["2026-01-01", "신정"],
    ["2026-02-16", "설날 연휴"], ["2026-02-17", "설날"], ["2026-02-18", "설날 연휴"],
    ["2026-03-01", "삼일절"], ["2026-03-02", "삼일절 대체"],
    ["2026-05-05", "어린이날"],
    ["2026-05-24", "부처님오신날"], ["2026-05-25", "부처님오신날 대체"],
    ["2026-06-03", "지방선거일"],
    ["2026-06-06", "현충일"],
    ["2026-08-15", "광복절"], ["2026-08-17", "광복절 대체"],
    /* 추석 대체공휴일 없음 — 설날·추석 연휴는 '일요일'과 겹칠 때만 대체 발생(규정 제3조).
       2026 추석은 목·금·토라 해당 없음. 토요일은 어린이날·3·1절·광복절 등에만 적용된다. */
    ["2026-09-24", "추석 연휴"], ["2026-09-25", "추석"], ["2026-09-26", "추석 연휴"],
    ["2026-10-03", "개천절"], ["2026-10-05", "개천절 대체"],
    ["2026-10-09", "한글날"],
    ["2026-12-25", "성탄절"],
  ];
  const HOLI = {}; HOLIDAYS.forEach(([d, n]) => { HOLI[d] = n; });

  /* 지필평가: {level, school, grade, term, month, days[]} */
  const EXAMS = [
    ["중", "미사중학교", "전체", "1차지필", 9, [21, 22]],
    ["중", "미사중학교", "3학년", "2차지필", 11, [10, 11, 12]],
    ["중", "미사중학교", "1,2학년", "2차지필", 12, [8, 9, 10]],
    ["중", "덕풍중학교", "2,3학년", "1차지필", 9, [22, 23]],
    ["중", "덕풍중학교", "3학년", "2차지필", 11, [13, 16, 17]],
    ["중", "덕풍중학교", "1,2학년", "2차지필", 12, [4, 7, 8]],
    ["중", "미사강변중학교", "2,3학년", "1차지필", 9, [29, 30]],
    ["중", "미사강변중학교", "3학년", "2차지필", 11, [16, 17, 18]],
    ["중", "미사강변중학교", "1학년", "2차지필", 12, [7, 8]],
    ["중", "미사강변중학교", "2학년", "2차지필", 12, [7, 8, 9]],
    ["중", "윤슬중학교", "2,3학년", "1차지필", 9, [21, 22]],
    ["중", "윤슬중학교", "3학년", "2차지필", 11, [12, 13, 16]],
    ["중", "윤슬중학교", "1,2학년", "2차지필", 12, [8, 9]],
    ["중", "은가람중학교", "전체", "1차지필", 9, [29, 30]],
    ["중", "은가람중학교", "3학년", "2차지필", 11, [23, 24, 25]],
    ["중", "은가람중학교", "1,2학년", "2차지필", 12, [15, 16, 17]],
    ["고", "미사고등학교", "전체", "1차지필", 10, [13, 14, 15, 16]],
    ["고", "미사고등학교", "전체", "2차지필", 12, [7, 8, 9, 10, 11]],
    ["고", "미사강변고등학교", "전체", "1차지필", 10, [1, 2, 6, 7, 8]],
    ["고", "미사강변고등학교", "전체", "2차지필", 12, [8, 9, 10, 11, 14]],
    ["고", "하남고등학교", "전체", "1차지필", 10, [12, 13, 14, 15, 16]],
    ["고", "하남고등학교", "고3", "2차지필", 11, [23, 24, 25, 26]],
    ["고", "하남고등학교", "고1,2", "2차지필", 12, [10, 11, 14, 15, 16]],
    ["고", "세마고등학교", "전체", "1차지필", 10, [7, 8, 12, 13]],
    ["고", "세마고등학교", "고3", "2차지필", 11, [23, 24, 25, 26]],
    ["고", "세마고등학교", "고1,2", "2차지필", 12, [8, 9, 10, 11]],
    ["고", "풍산고등학교", "전체", "1차지필", 10, [13, 14, 15, 16]],
    ["고", "풍산고등학교", "전체", "2차지필", 12, [7, 8, 9, 10, 11]],
  ].map(a => ({ level: a[0], school: a[1], grade: a[2], term: a[3], month: a[4], days: a[5] }));

  const MONTHS_WITH_EXAM = new Set(EXAMS.map(e => e.month));

  /* ---------- 유틸 ---------- */
  const pad = n => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const shortSchool = s => s.replace("중학교", "중").replace("고등학교", "고");
  /* 모바일 칩용 3글자 코드 — 좁은 칸(38px~)에서도 잘리지 않는 최대 길이 */
  const MINI = { "미사강변중학교": "미강중", "미사강변고등학교": "미강고", "은가람중학교": "은가중" };
  const miniSchool = s => MINI[s] || shortSchool(s).slice(0, 3);
  /* 담당학교 매칭 — 강사가 어떤 표기(풀네임·약칭·달력의 3글자 코드)로 적어도 인식한다 */
  const ALIAS = { "미강중": "미사강변중", "미강고": "미사강변고", "은가중": "은가람중",
                  "강변중": "미사강변중", "강변고": "미사강변고" };
  function schoolMatch(school, list) {
    const sh = shortSchool(school);
    return (list || []).some(raw => {
      const m = ALIAS[String(raw).trim()] || String(raw).trim();
      if (!m) return false;
      return school.includes(m) || m.includes(sh) || sh.includes(m);
    });
  }
  const shortGrade = g => g === "전체" ? "" : g.replace("학년", "").replace(/,/g, "·").replace("고", "");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function currentMonthInYear() {
    const now = new Date();
    if (now.getFullYear() < YEAR) return 1;
    if (now.getFullYear() > YEAR) return 12;
    return now.getMonth() + 1;
  }
  function todayISO() {
    const n = new Date();
    return iso(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }

  /* 선택 월의 특정 일(day)에 걸린 시험 이벤트 */
  function examsOn(month, day, filter) {
    return EXAMS.filter(e => e.month === month && e.days.includes(day) &&
      (filter === "전체" || e.level === filter));
  }

  /* ---------- CSS (1회 주입, .sc- 스코프) ---------- */
  function injectCSS() {
    if (document.getElementById("sc-style")) return;
    const css = `
.sc-wrap{--sc-mid:#0d9488;--sc-high:#d97706;--sc-red:#dc2626;--sc-navy:#1e293b;
  font-family:inherit;color:#1f2430;max-width:760px;margin:0 auto}
.sc-card{background:#fff;border:1px solid #e7e9ee;border-radius:18px;padding:16px 16px 18px;
  box-shadow:0 6px 22px rgba(20,24,40,.06)}
.sc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.sc-title{font-weight:800;font-size:18px;letter-spacing:-.02em;display:flex;align-items:center;gap:7px}
.sc-title small{font-weight:600;color:#8a90a0;font-size:12px}
.sc-nav{display:flex;align-items:center;gap:6px}
.sc-nav button{border:1px solid #e2e5ec;background:#fff;border-radius:10px;min-width:44px;height:34px;
  font-size:16px;cursor:pointer;color:#333;display:grid;place-items:center;transition:.15s}
.sc-nav button:hover{background:#f4f5f8}
.sc-nav .sc-today{width:auto;padding:0 12px;font-size:13px;font-weight:700;color:var(--sc-navy)}
.sc-months{display:flex;gap:5px;overflow-x:auto;padding:4px 2px 8px;scrollbar-width:thin}
.sc-mpill{flex:0 0 auto;border:1px solid #e2e5ec;background:#fff;border-radius:999px;padding:6px 12px;
  font-size:13px;font-weight:700;color:#555;cursor:pointer;position:relative;transition:.15s;white-space:nowrap}
.sc-mpill:hover{background:#f4f5f8}
.sc-mpill.on{background:var(--sc-navy);color:#fff;border-color:var(--sc-navy)}
.sc-mpill.cur{box-shadow:0 0 0 2px #fde68a inset}
.sc-mpill .dot{position:absolute;top:4px;right:7px;width:5px;height:5px;border-radius:50%;background:var(--sc-high)}
.sc-mpill.on .dot{background:#fde68a}
.sc-filters{display:flex;gap:6px;margin:4px 0 10px}
.sc-fp{border:1px solid #e2e5ec;background:#fff;border-radius:999px;padding:5px 12px;font-size:12.5px;
  font-weight:700;color:#666;cursor:pointer;font-family:inherit}
.sc-fp.on{color:#fff}
.sc-fp[data-f="전체"].on{background:#334155;border-color:#334155}
.sc-fp[data-f="중"].on{background:var(--sc-mid);border-color:var(--sc-mid)}
.sc-fp[data-f="고"].on{background:var(--sc-high);border-color:var(--sc-high)}
.sc-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.sc-dow{text-align:center;font-size:12px;font-weight:800;color:#9099ab;padding:2px 0 4px}
.sc-dow.sun{color:var(--sc-red)}.sc-dow.sat{color:#2563eb}
.sc-cell{min-height:78px;border:1px solid #eef0f4;border-radius:12px;padding:5px 6px 6px;
  display:flex;flex-direction:column;gap:3px;background:#fff;overflow:hidden;position:relative}
.sc-cell.pad{background:transparent;border:none}
.sc-cell.holi{background:#fef3f2;border-color:#fbd5d1}
.sc-cell.today{border-color:var(--sc-navy);box-shadow:0 0 0 2px var(--sc-navy) inset}
.sc-dnum{font-size:13px;font-weight:800;color:#39404e;line-height:1}
.sc-dnum.sun{color:var(--sc-red)}.sc-dnum.sat{color:#2563eb}
.sc-hname{font-size:10.5px;font-weight:800;color:var(--sc-red);line-height:1.15;margin-top:-1px}
.sc-chips{display:flex;flex-direction:column;gap:2px;margin-top:1px}
.sc-chip{font-size:10px;font-weight:800;line-height:1.25;border-radius:6px;padding:1px 5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-chip.mid{background:#d5f5f0;color:#0b6b62}
.sc-chip.high{background:#fdeccb;color:#9a5a06}
.sc-chip.mine{outline:2px solid #fbbf24;outline-offset:-2px}
.sc-more{font-size:9.5px;font-weight:800;color:#8a90a0}
.sc-today-badge{position:absolute;top:4px;right:5px;font-size:8.5px;font-weight:900;color:#fff;
  background:var(--sc-navy);border-radius:5px;padding:1px 4px;letter-spacing:.02em}
.sc-legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;font-size:12px;color:#6b7280;font-weight:600}
.sc-legend i{display:inline-block;width:11px;height:11px;border-radius:4px;margin-right:5px;vertical-align:-1px}
.sc-panels{margin-top:14px;display:grid;gap:12px}
.sc-panel h4{margin:0 0 7px;font-size:13px;font-weight:800;color:#39404e;display:flex;align-items:center;gap:6px}
.sc-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid #eef0f4;border-radius:10px;
  font-size:12.5px;margin-bottom:5px;background:#fbfbfd}
.sc-row .lv{flex:0 0 auto;width:9px;height:9px;border-radius:50%}
.sc-row .lv.mid{background:var(--sc-mid)}.sc-row .lv.high{background:var(--sc-high)}
.sc-row .sch{font-weight:800;color:#2b3040}
.sc-row .meta{color:#7a808f;font-weight:600}
.sc-row .dts{margin-left:auto;font-weight:800;color:#39404e;white-space:nowrap}
.sc-row.mine{background:#fffbeb;border-color:#fde68a}
.sc-row.mine .sch::after{content:" ★";color:#f59e0b}
.sc-empty{font-size:12.5px;color:#98a0b0;padding:8px 2px}
.sc-holiline{font-size:12.5px;color:#b4312a;font-weight:700;padding:5px 8px;background:#fef3f2;
  border:1px solid #fbd5d1;border-radius:10px;margin-bottom:5px;display:flex;justify-content:space-between}
.sc-cell[data-d]{cursor:pointer;-webkit-tap-highlight-color:rgba(30,58,95,.12)}
.sc-cell[data-d]:active{background:#f4f6fa}
.sc-cell.on{border-color:#f59e0b;box-shadow:0 0 0 2px #f59e0b inset}
.sc-chip .scm{display:none}
.sc-day-detail{margin-top:10px;border:1px solid #f1d9a1;background:#fffdf6;border-radius:12px;padding:10px 12px}
.sc-dd-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;font-size:13.5px}
.sc-dd-x{border:1px solid #e2e5ec;background:#fff;border-radius:8px;min-width:34px;min-height:34px;
  font-size:13px;cursor:pointer;color:#6b7280;display:grid;place-items:center}
.sc-day-detail .sc-row{background:#fff}
@media(max-width:520px){
  .sc-grid{gap:4px}
  .sc-cell{min-height:72px;padding:4px 3px 5px;border-radius:10px}
  .sc-chip .scf{display:none}
  .sc-chip .scm{display:block;text-align:center}
  .sc-chip{font-size:10px;padding:2px 0;text-overflow:clip;border-radius:5px}
  .sc-hname{font-size:9.5px}
}
@media(max-width:380px){
  .sc-chip{font-size:9.5px;letter-spacing:-.3px}
}
@media(max-width:700px){
  .sc-fp{min-height:44px;display:inline-flex;align-items:center}
  .sc-dd-x{min-width:44px;min-height:44px}
}
`;
    const st = document.createElement("style");
    st.id = "sc-style"; st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- 렌더 ---------- */
  function render(mount, opts) {
    opts = opts || {};
    if (typeof mount === "string") mount = document.querySelector(mount);
    if (!mount) return;
    injectCSS();

    let mySchools = (opts.mySchools || []).map(s => String(s).trim()).filter(Boolean);
    const state = { month: currentMonthInYear(), filter: "전체", autoFollow: true, selDay: null };

    const wrap = document.createElement("div");
    wrap.className = "sc-wrap";
    mount.innerHTML = "";
    mount.appendChild(wrap);

    function isMine(school) { return schoolMatch(school, mySchools); }

    function draw() {
      const M = state.month, F = state.filter;
      const first = new Date(YEAR, M - 1, 1).getDay(); // 0=일
      const dim = new Date(YEAR, M, 0).getDate();
      const tISO = todayISO();
      const dows = ["일", "월", "화", "수", "목", "금", "토"];

      let cells = "";
      for (let i = 0; i < first; i++) cells += `<div class="sc-cell pad"></div>`;
      for (let d = 1; d <= dim; d++) {
        const dt = iso(YEAR, M, d);
        const dow = new Date(YEAR, M - 1, d).getDay();
        const holi = HOLI[dt];
        const evs = examsOn(M, d, F);
        const isToday = dt === tISO;
        const cls = ["sc-cell"];
        if (holi) cls.push("holi");
        if (isToday) cls.push("today");
        const numcls = "sc-dnum" + (dow === 0 || holi ? " sun" : dow === 6 ? " sat" : "");
        let chips = "";
        const shown = evs.slice(0, 3);
        shown.forEach(e => {
          const mine = isMine(e.school) ? " mine" : "";
          const g = shortGrade(e.grade);
          chips += `<div class="sc-chip ${e.level === "중" ? "mid" : "high"}${mine}" title="${esc(e.school + " " + e.grade + " " + e.term)}">`
            + `<span class="scf">${esc(shortSchool(e.school))}${g ? "<sup>" + esc(g) + "</sup>" : ""}</span>`
            + `<span class="scm">${esc(miniSchool(e.school))}</span></div>`;
        });
        if (evs.length > 3) chips += `<div class="sc-more">+${evs.length - 3}개</div>`;
        if (state.selDay === d) cls.push("on");
        const alab = `${M}월 ${d}일` + (holi ? ` ${holi}` : "")
          + (evs.length ? ", " + evs.map(e => `${e.school} ${e.grade === "전체" ? "" : e.grade + " "}${e.term}`).join(", ") : ", 일정 없음");
        cells += `<div class="${cls.join(" ")}" data-d="${d}" role="button" tabindex="0" aria-label="${esc(alab)}" aria-expanded="${state.selDay === d}">
          ${isToday ? '<span class="sc-today-badge">오늘</span>' : ""}
          <span class="${numcls}">${d}</span>
          ${holi ? `<span class="sc-hname">${esc(holi)}</span>` : ""}
          <div class="sc-chips">${chips}</div>
        </div>`;
      }

      // 날짜 탭 상세 패널 — 칩이 좁아도 여기서 풀네임으로 다 보인다
      function dayDetail() {
        const d = state.selDay;
        if (!d) return "";
        const dt = iso(YEAR, M, d);
        const w = ["일", "월", "화", "수", "목", "금", "토"][new Date(YEAR, M - 1, d).getDay()];
        const holi = HOLI[dt];
        const evs = examsOn(M, d, F);
        let body = "";
        if (holi) body += `<div class="sc-holiline"><span>🔴 ${esc(holi)}</span><span>공휴일</span></div>`;
        if (evs.length) body += evs.map(e => {
          const mine = isMine(e.school) ? " mine" : "";
          return `<div class="sc-row${mine}"><span class="lv ${e.level === "중" ? "mid" : "high"}"></span>`
            + `<span class="sch">${esc(e.school)}</span>`
            + `<span class="meta">${e.grade === "전체" ? "전체" : esc(e.grade)} · ${esc(e.term)}</span>`
            + `<span class="dts">${M}/${e.days.join(", ")}</span></div>`;
        }).join("");
        if (!holi && !evs.length) body = `<div class="sc-empty">이 날은 지필·공휴일 일정이 없습니다.</div>`;
        return `<div class="sc-day-detail" id="scDayDetail">
          <div class="sc-dd-hd"><b>${M}월 ${d}일 (${w})</b><button type="button" class="sc-dd-x" aria-label="닫기">✕</button></div>
          ${body}
        </div>`;
      }

      // 월 선택 pills
      const cur = currentMonthInYear();
      let mpills = "";
      for (let m = 1; m <= 12; m++) {
        const on = m === M ? " on" : "";
        const isc = m === cur ? " cur" : "";
        const dot = MONTHS_WITH_EXAM.has(m) ? '<span class="dot"></span>' : "";
        mpills += `<button class="sc-mpill${on}${isc}" data-m="${m}">${m}월${dot}</button>`;
      }

      // 하단 패널: 공휴일 + 지필평가
      const monthHolis = HOLIDAYS.filter(([dstr]) => Number(dstr.slice(5, 7)) === M);
      let holiPanel = "";
      if (monthHolis.length) {
        holiPanel = `<div class="sc-panel"><h4>🔴 공휴일</h4>` +
          monthHolis.map(([dstr, n]) => {
            const dd = Number(dstr.slice(8, 10));
            const w = ["일", "월", "화", "수", "목", "금", "토"][new Date(dstr).getDay()];
            return `<div class="sc-holiline"><span>${esc(n)}</span><span>${M}/${dd} (${w})</span></div>`;
          }).join("") + `</div>`;
      }
      const monthExams = EXAMS.filter(e => e.month === M && (F === "전체" || e.level === F))
        .sort((a, b) => (a.days[0] - b.days[0]) || (isMine(b.school) - isMine(a.school)));
      let examPanel = `<div class="sc-panel"><h4>📝 지필평가 (${monthExams.length})</h4>`;
      if (!monthExams.length) examPanel += `<div class="sc-empty">이 달 지필평가 일정 없음</div>`;
      else examPanel += monthExams.map(e => {
        const mine = isMine(e.school) ? " mine" : "";
        return `<div class="sc-row${mine}"><span class="lv ${e.level === "중" ? "mid" : "high"}"></span>` +
          `<span class="sch">${esc(e.school)}</span>` +
          `<span class="meta">${e.grade === "전체" ? "" : esc(e.grade) + " · "}${esc(e.term)}</span>` +
          `<span class="dts">${M}/${e.days.join(", ")}</span></div>`;
      }).join("");
      examPanel += `</div>`;

      wrap.innerHTML = `
      <div class="sc-card">
        <div class="sc-head">
          <div class="sc-title">📅 월간 일정표 <small>${YEAR}년</small></div>
          <div class="sc-nav">
            <button data-nav="-1" aria-label="이전 달">‹</button>
            <button class="sc-today" data-nav="today">오늘</button>
            <button data-nav="1" aria-label="다음 달">›</button>
          </div>
        </div>
        <div class="sc-months">${mpills}</div>
        <div class="sc-filters">
          <button type="button" class="sc-fp ${F === "전체" ? "on" : ""}" data-f="전체">전체</button>
          <button type="button" class="sc-fp ${F === "중" ? "on" : ""}" data-f="중">중등</button>
          <button type="button" class="sc-fp ${F === "고" ? "on" : ""}" data-f="고">고등</button>
        </div>
        <div class="sc-grid">
          ${dows.map((w, i) => `<div class="sc-dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>`).join("")}
          ${cells}
        </div>
        ${dayDetail()}
        <div class="sc-legend">
          <span><i style="background:#0d9488"></i>중등 지필</span>
          <span><i style="background:#d97706"></i>고등 지필</span>
          <span><i style="background:#dc2626"></i>공휴일</span>
          ${mySchools.length ? '<span>★ 내 담당학교</span>' : ""}
        </div>
        <div class="sc-panels">${holiPanel}${examPanel}</div>
      </div>`;

      // 이벤트 바인딩
      wrap.querySelectorAll(".sc-cell[data-d]").forEach(c => {
        const go = () => {
          const d = Number(c.dataset.d);
          state.selDay = (state.selDay === d) ? null : d;
          draw();
          if (state.selDay) {
            const p = wrap.querySelector("#scDayDetail");
            if (p) p.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        };
        c.onclick = go;
        c.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
      });
      const ddx = wrap.querySelector(".sc-dd-x");
      if (ddx) ddx.onclick = () => { state.selDay = null; draw(); };
      wrap.querySelectorAll(".sc-mpill").forEach(b => b.onclick = () => {
        state.month = Number(b.dataset.m);
        state.autoFollow = (state.month === currentMonthInYear());
        state.selDay = null;
        draw();
      });
      wrap.querySelectorAll(".sc-fp").forEach(b => b.onclick = () => { state.filter = b.dataset.f; draw(); });
      wrap.querySelectorAll(".sc-nav button").forEach(b => b.onclick = () => {
        const v = b.dataset.nav;
        if (v === "today") { state.month = currentMonthInYear(); state.autoFollow = true; }
        else { state.month = Math.min(12, Math.max(1, state.month + Number(v))); state.autoFollow = (state.month === currentMonthInYear()); }
        state.selDay = null;
        draw();
      });
    }

    draw();

    // 실제 월이 넘어가면 자동 갱신 (autoFollow일 때만)
    function tick() {
      if (state.autoFollow) {
        const cm = currentMonthInYear();
        if (cm !== state.month) { state.month = cm; }
      }
      draw();
    }
    setInterval(tick, 60 * 60 * 1000);           // 매시간 월 롤오버 체크
    document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });

    return {
      redraw: draw,
      setSchools(arr) { mySchools = (arr || []).map(s => String(s).trim()).filter(Boolean); draw(); }
    };
  }

  window.DaolScheduleCal = { render, HOLIDAYS, EXAMS, schoolMatch };
})();
