/* ===== 다올105 — 강좌별 "실제 수업일" 편집기 =====
   강사 입력 페이지(input.html)의 강좌 카드마다 붙는다.
   요일만으로는 그 달 실제 횟수를 알 수 없다(공휴일·시험·개강일·연휴).
   그래서 강좌별로 월간 진행표를 열어 실제 수업일을 찍고, 그 결과가 정산 근거가 된다.

   사용:
     DaolCourseCal.open({ title, scheduleText, ym, marks, onSave })
     DaolCourseCal.seed(scheduleText, y, m)        // 요일 규칙 + 공휴일로 초기 마킹
     DaolCourseCal.count(marks)                    // {정,클,보,휴}
     DaolCourseCal.targetYM()                      // 15일 지나면 다음 달

   표기: 정 = 정규수업 / 클 = 클리닉(조교) / 정클 = 같은 날 둘 다 / 보 = 직전보강 / 휴 = 휴강
   원장 확정(2026-08-17): 클리닉은 정규 회차로 세지 않는다. */
(function () {
  const DAYS = "월화수목금토일";
  const DOWN = ["일", "월", "화", "수", "목", "금", "토"];
  const pad = n => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const dim = (y, m) => new Date(y, m, 0).getDate();
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* 공휴일은 schedule-cal.js가 들고 있는 검증본을 그대로 쓴다(중복 정의 금지) */
  function holidays() {
    const H = {};
    ((window.DaolScheduleCal && window.DaolScheduleCal.HOLIDAYS) || []).forEach(([d, n]) => { H[d] = n; });
    return H;
  }

  /* ── 요일 파싱 — admin.html extractDays 이식 ──
     "화요일"의 '일'을 일요일로 오인하면 회차가 2배가 된다. 세 규칙을 모두 쓴다. */
  function extractDays(seg) {
    const set = new Set();
    (seg.match(/[월화수목금토일]요일/g) || []).forEach(m => set.add(m[0]));
    (seg.match(/[월화수목금토일]{2,}/g) || []).forEach(run => { for (const ch of run) set.add(ch); });
    for (let i = 0; i < seg.length; i++) {
      const ch = seg[i];
      if (DAYS.includes(ch)) {
        const nxt = seg[i + 1] || "", prev = seg[i - 1] || "";
        if (!/[가-힣]/.test(nxt) && !/[가-힣]/.test(prev)) set.add(ch);
      }
    }
    return [...set];
  }

  /* schedule_text → { 요일번호: '정'|'클'|'정클' } */
  function weekdayPlan(scheduleText) {
    const plan = {};
    String(scheduleText || "").split(/\n|\//).forEach(seg => {
      seg = seg.trim(); if (!seg) return;
      const days = extractDays(seg); if (!days.length) return;
      const kind = /클리닉/.test(seg) ? "클" : "정";        // 관리·직보도 출근이므로 정규로 본다
      days.forEach(ch => {
        const w = (DAYS.indexOf(ch) + 1) % 7;               // 월=1 … 일=0
        const prev = plan[w];
        plan[w] = !prev ? kind : (prev === kind ? kind : "정클");
      });
    });
    return plan;
  }

  /* 요일 규칙 + 공휴일 → 초기 마킹 */
  function seed(scheduleText, y, m) {
    const plan = weekdayPlan(scheduleText), H = holidays(), out = {};
    for (let d = 1; d <= dim(y, m); d++) {
      const w = new Date(y, m - 1, d).getDay(), kind = plan[w];
      if (!kind) continue;
      const key = iso(y, m, d);
      out[key] = H[key] ? "휴" : kind;
    }
    return out;
  }

  function count(marks) {
    let 정 = 0, 클 = 0, 보 = 0, 휴 = 0;
    Object.values(marks || {}).forEach(v => {
      if (v === "정") 정++;
      else if (v === "클") 클++;
      else if (v === "정클") { 정++; 클++; }
      else if (v === "보") 보++;
      else if (v === "휴") 휴++;
    });
    return { 정, 클, 보, 휴 };
  }

  /* 15일이 지나면 다음 달 계획을 짠다 */
  function targetYM(now) {
    now = now || new Date();
    let y = now.getFullYear(), m = now.getMonth() + 1;
    if (now.getDate() > 15) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return { y, m, key: `${y}-${pad(m)}` };
  }

  /* ── CSS (1회 주입) ── */
  function css() {
    if (document.getElementById("cc-style")) return;
    const s = document.createElement("style");
    s.id = "cc-style";
    s.textContent = `
.cc-back{position:fixed;inset:0;z-index:9000;display:none}
.cc-back.on{display:block}
.cc-back .cc-dim{position:absolute;inset:0;background:rgba(15,20,30,.5)}
.cc-pan{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:18px 18px 0 0;
  max-height:92dvh;display:flex;flex-direction:column;overscroll-behavior:contain;
  font-family:"Pretendard","Malgun Gothic",system-ui,sans-serif;color:#1f2430}
.cc-hd{padding:10px 16px 8px;border-bottom:1px solid #eef0f4;flex:none}
.cc-hdl{width:38px;height:4px;border-radius:99px;background:#d7dbe2;margin:0 auto 10px}
.cc-t{font-size:16px;font-weight:800;line-height:1.3}
.cc-s{font-size:12.5px;color:#6b7280;margin-top:2px}
.cc-body{overflow:auto;padding:12px 10px 8px;flex:1;-webkit-overflow-scrolling:touch}
.cc-mrow{display:flex;align-items:center;justify-content:space-between;padding:0 6px 8px}
.cc-mrow .m{font-weight:800;font-size:15px}
.cc-g{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
.cc-dow{text-align:center;font-size:11.5px;font-weight:800;color:#9099ab;padding:2px 0 4px}
.cc-dow.s0{color:#dc2626}.cc-dow.s6{color:#2563eb}
.cc-c{aspect-ratio:1/1;min-height:44px;border:1px solid #eef0f4;border-radius:10px;background:#fff;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:0;
  font:inherit;font-size:13px;font-weight:700;cursor:pointer;position:relative;color:#39404e}
.cc-c:active{transform:scale(.94);box-shadow:0 0 0 3px #f59e0b}
.cc-c.pad{border:none;background:transparent;pointer-events:none}
.cc-c .t{font-size:10px;font-weight:800;line-height:1}
.cc-c.off{color:#8b93a3;background:#fafbfc}
.cc-c.holi{background:#fef3f2;border-color:#fbd5d1;color:#dc2626}
.cc-c.jung{background:#ecfdf5;border-color:#6ee7b7;color:#065f46}
.cc-c.clin{background:#f5f3ff;border:2px dashed #c4b5fd;color:#5b21b6}
.cc-c.both{background:#ecfdf5;border:2px dashed #a78bfa;color:#065f46}
.cc-c.boost{background:#fdf2f8;border:2px solid #f9a8d4;color:#9d174d}
.cc-c.cancel{background:#f3f4f6;border-color:#d1d5db;color:#9ca3af;text-decoration:line-through}
.cc-c.sel{box-shadow:0 0 0 3px #f59e0b}
.cc-lg{display:flex;flex-wrap:wrap;gap:9px;padding:10px 6px 2px;font-size:11.5px;color:#6b7280;font-weight:700}
.cc-lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px;vertical-align:-1px}
.cc-pick{border-top:1px solid #eef0f4;padding:10px 12px;flex:none;background:#fffbeb}
.cc-pick .lab{font-size:13px;font-weight:800;margin-bottom:8px}
.cc-chips{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
.cc-chip{min-height:48px;border:1px solid #e2e5ec;background:#fff;border-radius:10px;font:inherit;
  font-size:12.5px;font-weight:800;cursor:pointer;padding:4px 2px;line-height:1.25;color:#39404e}
.cc-chip.on{background:#f59e0b;border-color:#f59e0b;color:#fff}
.cc-ft{border-top:1px solid #eef0f4;padding:10px 14px calc(12px + env(safe-area-inset-bottom,0px));
  flex:none;display:flex;align-items:center;gap:10px;background:#fff}
.cc-sum{flex:1;min-width:0;font-size:12.5px;color:#6b7280;font-weight:700;line-height:1.35}
.cc-sum b{color:#1f2430;font-size:14px}
.cc-b{min-height:48px;border-radius:11px;border:1px solid #e2e5ec;background:#fff;font:inherit;
  font-weight:800;font-size:14px;padding:0 16px;cursor:pointer}
.cc-b.pri{background:#059669;border-color:#059669;color:#fff}
.cc-b.gh{background:#f8fafc;color:#6b7280}
@media(min-width:900px){
  .cc-pan{left:50%;top:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);
    width:600px;max-width:calc(100vw - 48px);max-height:86vh;border-radius:16px}
  .cc-hdl{display:none}
  .cc-c{min-height:56px;font-size:14px}
  .cc-chips{grid-template-columns:repeat(6,1fr)}
}`;
    document.head.appendChild(s);
  }

  /* ── 열기 ── */
  let el = null;
  function open(opts) {
    css();
    const { y, m } = opts.ym || targetYM();
    const H = holidays();
    let marks = Object.assign({}, opts.marks || seed(opts.scheduleText, y, m));
    const original = JSON.stringify(marks);
    let picked = null;

    if (!el) {
      el = document.createElement("div");
      el.className = "cc-back";
      el.innerHTML = `<div class="cc-dim" data-x="1"></div><div class="cc-pan"></div>`;
      document.body.appendChild(el);
      el.addEventListener("click", e => { if (e.target.dataset.x) close(); });
    }
    const pan = el.querySelector(".cc-pan");
    el.classList.add("on");
    history.pushState({ cc: 1 }, "");

    const KINDS = [
      ["정", "수업", "jung"], ["클", "클리닉", "clin"], ["정클", "수업+클", "both"],
      ["보", "직전보강", "boost"], ["휴", "휴강", "cancel"], [null, "없음", "off"]
    ];

    function draw() {
      const first = new Date(y, m - 1, 1).getDay(), n = dim(y, m);
      let cells = "";
      for (let i = 0; i < first; i++) cells += `<div class="cc-c pad"></div>`;
      for (let d = 1; d <= n; d++) {
        const key = iso(y, m, d), mk = marks[key];
        let cls = "cc-c", tag = "";
        if (!mk) cls += H[key] ? " holi" : " off";
        else if (mk === "정") { cls += " jung"; tag = "수업"; }
        else if (mk === "클") { cls += " clin"; tag = "클리닉"; }
        else if (mk === "정클") { cls += " both"; tag = "수업+클"; }
        else if (mk === "보") { cls += " boost"; tag = "직전보강"; }
        else if (mk === "휴") { cls += " cancel"; tag = "휴강"; }
        if (picked === key) cls += " sel";
        cells += `<button type="button" class="${cls}" data-d="${d}"
          aria-label="${m}월 ${d}일 ${tag || "수업 없음"}"><span>${d}</span>${tag ? `<span class="t">${tag}</span>` : ""}</button>`;
      }
      const c = count(marks);
      const holiHit = Object.keys(marks).filter(k => marks[k] === "휴" && H[k]).sort();
      const note = holiHit.length ? ` · 공휴일로 ${holiHit.length}회 빠짐(${holiHit.map(k => +k.slice(8, 10) + "일").join(", ")})` : "";

      pan.innerHTML = `
      <div class="cc-hd">
        <div class="cc-hdl"></div>
        <div class="cc-t">📅 ${esc(opts.title || "강좌")} — ${y}년 ${m}월 수업 진행표</div>
        <div class="cc-s">실제 수업한 날을 눌러 표시해 주세요. 이 표가 <b>수강료 정산 근거</b>가 됩니다.</div>
      </div>
      <div class="cc-body">
        <div class="cc-mrow"><span class="m">${y}. ${m}</span>
          <button type="button" class="cc-b gh" id="ccReseed" style="min-height:40px;font-size:12.5px;padding:0 10px">요일대로 다시 깔기</button></div>
        <div class="cc-g">
          ${DOWN.map((w, i) => `<div class="cc-dow s${i}">${w}</div>`).join("")}
          ${cells}
        </div>
        <div class="cc-lg">
          <span><i style="background:#6ee7b7"></i>수업</span>
          <span><i style="background:#c4b5fd"></i>클리닉(조교)</span>
          <span><i style="background:#a78bfa"></i>수업+클리닉</span>
          <span><i style="background:#f9a8d4"></i>직전보강</span>
          <span><i style="background:#d1d5db"></i>휴강</span>
          <span><i style="background:#fbd5d1"></i>공휴일</span>
        </div>
      </div>
      ${picked ? `<div class="cc-pick">
        <div class="lab">${+picked.slice(5, 7)}월 ${+picked.slice(8, 10)}일 (${DOWN[new Date(picked).getDay()]})${H[picked] ? " · " + esc(H[picked]) : ""} — 이 날은?</div>
        <div class="cc-chips">${KINDS.map(([v, t]) =>
          `<button type="button" class="cc-chip ${marks[picked] === v || (v === null && !marks[picked]) ? "on" : ""}" data-k="${v === null ? "" : v}">${t}</button>`).join("")}</div>
      </div>` : ""}
      <div class="cc-ft">
        <div class="cc-sum"><b>정규 ${c.정}회</b>${c.보 ? ` + 직전보강 ${c.보}` : ""}${c.클 ? `<br>조교 클리닉 ${c.클}일 (회차 제외)` : ""}${note ? `<br>${note.slice(3)}` : ""}</div>
        <button type="button" class="cc-b gh" id="ccCancel">닫기</button>
        <button type="button" class="cc-b pri" id="ccSave">저장</button>
      </div>`;

      pan.querySelectorAll(".cc-c[data-d]").forEach(b => b.onclick = () => {
        picked = iso(y, m, +b.dataset.d); draw();
        pan.querySelector(".cc-pick")?.scrollIntoView({ block: "nearest" });
      });
      pan.querySelectorAll(".cc-chip").forEach(b => b.onclick = () => {
        const v = b.dataset.k;
        if (!v) delete marks[picked]; else marks[picked] = v;
        draw();
      });
      pan.querySelector("#ccReseed").onclick = () => {
        const s = seed(opts.scheduleText, y, m);
        const diff = [...new Set([...Object.keys(marks), ...Object.keys(s)])].filter(k => marks[k] !== s[k]).length;
        if (diff && !confirm(`직접 고치신 ${diff}일이 사라집니다. 요일 규칙대로 되돌릴까요?`)) return;
        marks = s; picked = null; draw();
      };
      pan.querySelector("#ccCancel").onclick = () => {
        if (JSON.stringify(marks) !== original && !confirm("저장하지 않고 닫을까요? 표시한 내용이 사라집니다.")) return;
        close();
      };
      pan.querySelector("#ccSave").onclick = () => { opts.onSave && opts.onSave(marks, count(marks)); close(); };
    }
    draw();
  }

  function close() {
    if (!el || !el.classList.contains("on")) return;
    el.classList.remove("on");
    if (history.state && history.state.cc) history.back();
  }
  window.addEventListener("popstate", () => { if (el) el.classList.remove("on"); });

  window.DaolCourseCal = { open, close, seed, count, targetYM, weekdayPlan, extractDays };
})();
