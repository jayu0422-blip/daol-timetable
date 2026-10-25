/* ───── 2027 시간표(가안) 보드 ─────
   주소: plan2027.html?admin=<원장 열쇠>&view=board   (admin.html 「2027 시간표」 탭이 iframe 으로 띄운다)
   선생님이 요청서에 입력한 값을 30초마다 다시 읽어 학년·학교별 / 강사별 / 요일별 강의실로 보여 준다.
   계산은 plan2027.html 의 rowTimes·parseTimes·ROW_GRADES 를 그대로 쓰고, 강의실은 rooms.js 의 규칙(orderByPref·ruleRoom)을 쓴다.
   원장 결정(2026-10-23): 수학·과학 → 대치더올 / 불확실·미응답 반은 시간표에 학원 가안으로 넣되 강의실 계산에서는 빼고 따로 목록으로 / 학원 가안 반은 강의실 계산에 포함 */
const B27_GRADES = [["중1","중1"],["중2","중2"],["중3","중3"],["미사고1","미사고1"],["미사고2","미사고2"],["미사고3","미사고3"],
  ["미강고1","미사강변고1"],["미강고2","미사강변고2"],["미강고3","미사강변고3"],["하남고1","하남고1"],["풍산고1","풍산고1"],["청아고1","청아고1"],["수능","수능"]];
const B27_LABEL = Object.fromEntries(B27_GRADES);
const B27_FIRM = ["open","changed","fixed","plan","keep","handoff","apply"];
const B27_STATE = {확정:"확정", 작성중:"작성 중", 가안:"학원 가안", 불확실:"개강 불확실", 조사중:"학생 조사 중", 협의:"변경 협의", 미응답:"미응답"};
const B27_OUT = ["불확실","조사중","협의","미응답"];   // 강의실 계산에서 빼는 상태

/* 선생님 응답 → 반 단위 목록 */
function b27Entries(recs){
  const out = [];
  function add(teacher, pk, P, r, a, recStatus){
    const c = (a || {}).choice || "";
    if (r.kind === "opt" && c !== "apply") return;
    let state, sessions;
    if (P.brief){ state = "확정"; sessions = parseTimes(r.time); }                        // 김재현: 학원이 확정해 안내만 한 반
    else if (B27_FIRM.includes(c) || c.startsWith("s:")){ state = recStatus === "제출완료" ? "확정" : "작성중"; sessions = rowTimes(r, a); }
    else { state = !teacher ? "가안" : c === "unsure" ? "불확실" : c === "surveying" ? "조사중" : c === "talk" ? "협의" : "미응답"; sessions = parseTimes(r.time); }
    out.push({teacher: teacher || "학원 가안", pk, subject: P.subject, id: r.id, name: r.name, grades: ROW_GRADES[r.id] || [],
      sessions, state, rooms: !B27_OUT.includes(state), memo: (a || {}).memo || "", handoff: c === "handoff", academyTime: r.time});
  }
  recs.forEach(rec => { const P = PROFILES[rec.profile]; if (!P) return; const A = (rec.answers || {}).rows || {};
    P.groups.forEach(g => g.rows.forEach(r => add(rec.teacher, rec.profile, P, r, A[r.id], rec.status))); });
  // 담당 선생님 링크가 없는 묶음(예: 고등 수학 가안)은 학원 가안 그대로 — 선생님이 이미 신청한 같은 반(예: 유용권 고1)은 겹쳐 그리지 않는다
  const taken = new Set(out.map(e => e.id));
  Object.entries(PROFILES).forEach(([pk, P]) => { if (recs.some(x => x.profile === pk)) return;
    P.groups.forEach(g => g.rows.forEach(r => { if (r.kind !== "opt" && !taken.has(r.id)) add(null, pk, P, r, null, null); })); });
  return out;
}

/* 2027 강의실 배정 — rooms.js 의 assignDay 와 같은 순서·규칙, 단 수학·과학은 항상 대치더올이 1순위 */
function b27Assign(day, ents){
  const items = [];
  ents.filter(e => e.rooms).forEach(e => e.sessions.filter(s => s.day === day).forEach(s => items.push({
    c: {id: e.id + "|" + e.teacher, course_name: e.name, teacher: e.teacher, subject: e.subject, grade: e.grades[0] || "", room_overrides: {}},
    s: {day, start: s.start, end: s.end, type: s.clinic ? "클리닉" : "정규"}, e})));
  const occ = {}; CLASS_ROOMS.forEach(r => occ[r.key] = []);
  const DACI = ["대치1","대치2","대치클리닉"], BON = ["본관1","본관2","본관3","스터디홀","상담실"];
  const byT = {}; items.forEach(it => (byT[it.c.teacher] = byT[it.c.teacher] || []).push(it));
  const prio = t => t === "임결" ? 0 : t === "유용권" ? 1 : 2;
  Object.keys(byT).sort((a, b) => prio(a) - prio(b) || a.localeCompare(b, "ko")).forEach(tch => {
    const list = byT[tch].sort((a, b) => a.s.start - b.s.start || ((a.s.type === "정규" ? 0 : 1) - (b.s.type === "정규" ? 0 : 1)));
    list.forEach(it => {
      const sci = it.c.subject === "수학" || it.c.subject === "과학";
      const primary = orderByPref(tch, day, sci ? DACI : BON);
      const others = CLASS_ROOMS.map(r => r.key).filter(k => !primary.includes(k));
      // 같은 선생님·같은 과목·같은 시간 = 통합반(한 방). 「학원 가안」은 선생님이 정해지지 않아 묶지 않는다
      const twin = tch !== "학원 가안" && list.find(x => x !== it && x.room && x.c.subject === it.c.subject && x.s.start === it.s.start && x.s.end === it.s.end);
      if (twin){ it.room = twin.room; it.roomRole = "통합반"; return; }
      const ov = ruleRoom(it, day);
      let chosen = null;
      if (ov && occ[ov]){ chosen = ov; if (occ[ov].some(x => ovl(x, it.s))) it.conflict = true; }
      else {
        for (const rk of [...primary, ...others]) if (occ[rk] && !occ[rk].some(x => ovl(x, it.s))){ chosen = rk; if (!primary.includes(rk)) it.spill = true; break; }
        if (!chosen){ chosen = primary[0]; it.conflict = true; }
      }
      it.room = chosen; occ[chosen].push(it.s);
      if (it.spill) it.roomRole = sci ? "대치더올 꽉 참" : "다른 관으로";
    });
  });
  return items.sort((a, b) => a.s.start - b.s.start);
}

/* 주간 시간표(월~일) HTML */
function b27WeekHTML(blocks, opts){
  const START = 9 * 60, END = 22 * 60, PX = 0.9, H = (END - START) * PX;
  let html = `<div class="b27-week"><div class="b27-wh"></div>` + DAYS.map(d => `<div class="b27-wh${d === "토" ? " sat" : d === "일" ? " sun" : ""}">${d}</div>`).join("");
  html += `<div class="b27-tc" style="height:${H}px">` + Array.from({length: 14}, (_, i) => `<div class="b27-t" style="top:${i * 60 * PX}px">${String(9 + i).padStart(2, "0")}:00</div>`).join("") + `</div>`;
  DAYS.forEach(d => {
    const bs = blocks.filter(b => b.day === d).map(b => Object.assign({}, b));
    layoutRoom(bs);
    html += `<div class="b27-col" style="height:${H}px">` + Array.from({length: 14}, (_, i) => `<div class="b27-line" style="top:${i * 60 * PX}px"></div>`).join("");
    bs.forEach(b => {
      const st = Math.max(b.start, START), en = Math.min(b.end, END), top = (st - START) * PX, hh = Math.max((en - st) * PX, 30);
      const L = b.lane / b.cols * 100, W = 100 / b.cols;
      const who = opts.byTeacher ? b.grades.map(g => B27_LABEL[g] || g).join("·") : (b.teacher === "학원 가안" ? "학원 가안" : b.teacher + " T");
      html += `<div class="b27-blk st-${b.state}${b.clinic ? " clinic" : ""}" style="top:${top}px;height:${hh}px;left:calc(${L}% + 2px);width:calc(${W}% - 4px);--bg:${SUBJ_COLOR[b.subject] || "#e5e7eb"}" title="${esc(b.name + " · " + fmtHM(b.start) + "~" + fmtHM(b.end) + " · " + B27_STATE[b.state])}">`
        + `<div class="b27-who">${esc(who)}</div><div class="b27-nm">${esc(b.subject)}${b.clinic ? " <span class='b27-tag'>클리닉</span>" : ""}</div>`
        + `<div class="b27-tm">${fmtHM(b.start)}~${fmtHM(b.end)}</div><div class="b27-st">${B27_STATE[b.state]}${b.handoff ? " · 수능영어반 이관" : ""}</div></div>`;
    });
    html += `</div>`;
  });
  return html + `</div>`;
}
const b27Blocks = ents => ents.flatMap(e => e.sessions.map(s => ({day: s.day, start: s.start, end: s.end, clinic: s.clinic, subject: e.subject, teacher: e.teacher, name: e.name, state: e.state, grades: e.grades, handoff: e.handoff})));

async function boardView(key){
  app.classList.add("wide");
  const EMBED = qs.get("embed") === "1";
  if (!document.getElementById("b27css")){ const st = document.createElement("style"); st.id = "b27css"; st.textContent = DAOL_ROOM_GRID_CSS + B27_CSS; document.head.append(st); }
  let recs = [], err = "", mode = "grade", sel = {grade: "중1", teacher: "", day: "월"}, last = "";
  async function load(){
    try { recs = await store.list(key); PROFILES = await store.adminProfiles(key); err = ""; last = fmtTime(new Date().toISOString()); }
    catch(e){ err = /not_admin/.test(e.message || "") ? "원장 열쇠가 맞지 않습니다." : "불러오지 못했습니다. (" + (e.message || "연결 오류") + ")"; }
    render();
  }
  function chips(list, cur, on){
    const box = h("div",{class:"b27-chips"});
    list.forEach(([v, label, n]) => { const b = h("button",{type:"button", class:"b27-chip" + (v === cur ? " on" : ""), text: label + (n != null ? " " + n : "")}); b.onclick = () => on(v); box.append(b); });
    return box;
  }
  function render(){
    if (err){ app.replaceChildren(h("div",{class:"err",text:err})); return; }
    const ents = b27Entries(recs);
    const cnt = s => ents.filter(e => e.state === s).length;
    const head = h("div",{class:"b27-head"},[
      h("div",{},[h("div",{class:"eyebrow",text:"DAOL105 · 2027"}), h("h1",{text:"2027 시간표 (가안)"}),
        h("p",{class:"muted",text:"선생님이 개강 요청서에 입력하는 내용이 30초마다 반영됩니다 · 마지막 " + last}) ]),
      h("div",{class:"b27-kpi"}, ["확정","작성중","가안","불확실","미응답"].map(s => h("span",{class:"b27-k st-" + s},[h("b",{text:String(cnt(s) + (s === "불확실" ? cnt("조사중") + cnt("협의") : 0))}), document.createTextNode(B27_STATE[s])])))]);
    const modes = chips([["grade","학년·학교별"],["teacher","강사별"],["room","요일별·강의실"]], mode, v => { mode = v; render(); });
    const legend = h("div",{class:"b27-legend",html:
      `<span class="b27-lg st-확정">확정 (제출·학원 확정)</span><span class="b27-lg st-작성중">작성 중</span><span class="b27-lg st-가안">학원 가안</span><span class="b27-lg st-미응답">불확실·미응답 (강의실 계산 제외)</span><span class="b27-lg clinic">클리닉</span>` +
      Object.entries({국어:1,영어:1,수학:1,과학:1}).map(([s]) => `<span class="b27-sw" style="background:${SUBJ_COLOR[s]}"></span>${s}`).join(" ")});
    const body = h("section",{class:"card b27-body"});
    if (mode === "grade"){
      const list = B27_GRADES.map(([k, label]) => [k, label, ents.filter(e => e.grades.includes(k) && e.sessions.length).length]);
      body.append(chips(list, sel.grade, v => { sel.grade = v; render(); }));
      const es = ents.filter(e => e.grades.includes(sel.grade));
      body.append(h("h2",{text:(B27_LABEL[sel.grade] || sel.grade) + " · 2027 주간 시간표"}), h("div",{class:"tbl",html:b27WeekHTML(b27Blocks(es), {})}));
      const none = es.filter(e => !e.sessions.length);
      if (none.length) body.append(h("p",{class:"muted",text:"시간 미정: " + none.map(e => e.subject + " · " + e.name + " (" + e.teacher + ")").join(", ")}));
    } else if (mode === "teacher"){
      const ts = [...new Set(ents.map(e => e.teacher))];
      if (!ts.includes(sel.teacher)) sel.teacher = ts[0] || "";
      body.append(chips(ts.map(t => [t, t, ents.filter(e => e.teacher === t && e.sessions.length).length]), sel.teacher, v => { sel.teacher = v; render(); }));
      const es = ents.filter(e => e.teacher === sel.teacher);
      body.append(h("h2",{text:sel.teacher + " · 2027 주간 시간표"}), h("div",{class:"tbl",html:b27WeekHTML(b27Blocks(es), {byTeacher:true})}));
      body.append(h("div",{class:"b27-rows"}, es.map(e => h("div",{class:"b27-row"},[h("b",{text:e.name}), h("span",{class:"b27-pill st-" + e.state, text:B27_STATE[e.state]}),
        h("span",{text: e.sessions.length ? e.sessions.map(s => s.day + " " + fmtHM(s.start) + "~" + fmtHM(s.end) + (s.clinic ? " 클리닉" : "")).join(" / ") : "시간 미정"}), e.memo ? h("span",{class:"muted",text:"메모: " + e.memo}) : null].filter(Boolean)))));
    } else {
      body.append(chips(DAYS.map(d => [d, d + "요일", ents.filter(e => e.rooms && e.sessions.some(s => s.day === d)).length]), sel.day, v => { sel.day = v; render(); }));
      const items = b27Assign(sel.day, ents);
      const bad = items.filter(it => it.conflict), spill = items.filter(it => it.spill);
      body.append(h("div",{class:"b27-alert " + (bad.length ? "bad" : "ok"), text: bad.length ? "⚠ 강의실이 모자랍니다 — " + bad.map(it => it.c.teacher + " " + it.c.course_name + " " + fmtHM(it.s.start)).join(", ") : "✓ " + sel.day + "요일 강의실 겹침 없음 (" + items.length + "개 블록)"}));
      if (spill.length) body.append(h("p",{class:"muted",text:"다른 관으로 밀린 수업: " + spill.map(it => it.c.teacher + " " + it.c.course_name + " → " + (ROOMS.find(r => r.key === it.room) || {}).label).join(", ")}));
      body.append(h("p",{class:"muted",text:"※ 강의실표는 10시부터 그려집니다. 10시 전에 시작하는 수업(예: 수능 국어 09:00)은 블록 안의 시간 글자가 실제 시각입니다."}));
      body.append(h("div",{class:"tbl",html:dayGridHTML({day:sel.day, title:"2027 다올105 · " + sel.day + "요일 강의실 (가안)", items})}));
      const out = ents.filter(e => !e.rooms && e.sessions.some(s => s.day === sel.day));
      body.append(h("h3",{text:sel.day + "요일 · 강의실 계산에서 뺀 반 (불확실·미응답)"}),
        out.length ? h("div",{class:"b27-rows"}, out.map(e => h("div",{class:"b27-row"},[h("b",{text:e.teacher + " · " + e.name}), h("span",{class:"b27-pill st-" + e.state, text:B27_STATE[e.state]}),
          h("span",{text:"학원 가안 " + e.sessions.filter(s => s.day === sel.day).map(s => fmtHM(s.start) + "~" + fmtHM(s.end)).join(", ")})]))) : h("p",{class:"muted",text:"없음"}));
    }
    // 전체 목록: 강의실 계산 제외 / 윈터스쿨
    const outAll = ents.filter(e => !e.rooms);
    const sideList = h("section",{class:"card"},[h("h2",{text:"강의실 계산 제외 — 불확실·미응답 반 (" + outAll.length + ")"}),
      h("p",{class:"muted",text:"시간표에는 학원 가안 시간으로 보이지만, 강의실 계산에는 넣지 않습니다. 선생님이 확정하면 자동으로 강의실 계산에 들어갑니다."}),
      outAll.length ? h("div",{class:"b27-rows"}, outAll.map(e => h("div",{class:"b27-row"},[h("b",{text:e.teacher + " · " + e.name}), h("span",{class:"b27-pill st-" + e.state, text:B27_STATE[e.state]}), h("span",{class:"muted",text:"학원 가안: " + (e.academyTime || "시간 미정")})]))) : h("p",{class:"muted",text:"없음"})]);
    const winter = recs.filter(r => ((r.answers || {}).winter || {}).plan === "yes");
    const winterSec = h("section",{class:"card"},[h("h2",{text:"윈터스쿨 특강 (" + winter.reduce((n, r) => n + ((r.answers.winter.items || []).length), 0) + ")"}),
      winter.length ? h("div",{class:"b27-rows"}, winter.flatMap(r => (r.answers.winter.items || []).map(it => h("div",{class:"b27-row"},[h("b",{text:r.teacher + " · " + (it.title || "(이름 없음)")}),
        h("span",{text:(it.start || "?") + " ~ " + (it.end || "?") + " · " + (it.sessions || "?") + "회 · " + (it.noOff ? "휴강 없음" : "휴강 " + (it.offDays || "미기재")) + " · 회차당 " + wonFmt(it.fee) + ((+it.sessions > 0 && +it.fee > 0) ? " · 합계 " + wonFmt(it.sessions * it.fee) : "")})])))) : h("p",{class:"muted",text:"아직 입력한 선생님이 없습니다."})]);
    app.replaceChildren(...[EMBED ? null : demoBar(), head, modes, legend, body, sideList, winterSec].filter(Boolean));
    if (EMBED && parent !== window) setTimeout(() => parent.postMessage({plan27Height: document.documentElement.scrollHeight}, "*"), 50);
  }
  await load();
  setInterval(() => { if (!document.hidden) load(); }, 30000);
}

const B27_CSS = `
.b27-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:12px}
.b27-head h1{margin:2px 0 4px;font-size:26px}
.b27-kpi{display:flex;gap:8px;flex-wrap:wrap}
.b27-k{display:flex;flex-direction:column;align-items:center;min-width:76px;padding:8px 10px;border-radius:12px;border:1px solid var(--line2);background:var(--surface);font-size:12.5px;color:var(--ink2)}
.b27-k b{font-size:22px;color:var(--ink);font-variant-numeric:tabular-nums}
.b27-chips{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 12px}
.b27-chip{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:8px 14px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;min-height:40px}
.b27-chip.on{background:var(--navy);color:var(--on-navy);border-color:var(--navy)}
.b27-legend{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:12.5px;color:var(--ink2);margin:0 0 12px}
.b27-lg{display:inline-block;padding:3px 8px;border-radius:6px;background:#eef2f7;border:2px solid #64748b}
.b27-sw{display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-left:6px}
.b27-week{display:grid;grid-template-columns:52px repeat(7,minmax(96px,1fr));min-width:780px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}
.b27-wh{font-weight:800;text-align:center;padding:8px 0;background:#fff7ed;border-bottom:2px solid #374151;font-size:14px}
.b27-wh.sat{color:#2563eb}.b27-wh.sun{color:#dc2626}
.b27-tc,.b27-col{position:relative;border-left:1px solid #eef0f3}
.b27-t{position:absolute;right:6px;font-size:11px;color:#6b7280;transform:translateY(-6px)}
.b27-line{position:absolute;left:0;right:0;border-top:1px solid #eef0f3}
.b27-blk{position:absolute;border-radius:8px;padding:4px 6px;font-size:11px;line-height:1.25;overflow:hidden;background:var(--bg);color:#1f2937;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.b27-blk .b27-who{font-weight:800;font-size:11px}
.b27-blk .b27-nm{font-weight:800;font-size:12px}
.b27-blk .b27-tm{font-size:10.5px}
.b27-blk .b27-st{font-size:10px;font-weight:700;opacity:.85}
.b27-tag{font-size:9.5px;background:rgba(255,255,255,.7);border-radius:3px;padding:0 3px}
.st-확정{border:2px solid #1f2937}
.st-작성중{border:2px dashed #1f2937}
.b27-blk.st-가안{border:2px dashed #94a3b8;background:repeating-linear-gradient(135deg,var(--bg) 0 7px,#fff 7px 12px)}
.b27-blk.st-불확실,.b27-blk.st-조사중,.b27-blk.st-협의,.b27-blk.st-미응답{border:2px dotted #9ca3af;background:repeating-linear-gradient(135deg,#f3f4f6 0 7px,#fff 7px 12px);color:#6b7280}
.b27-blk.clinic{background-image:repeating-linear-gradient(45deg,rgba(109,75,196,.18) 0 4px,transparent 4px 9px)}
.b27-lg.st-가안{border:2px dashed #94a3b8;background:repeating-linear-gradient(135deg,#fde7d0 0 6px,#fff 6px 10px)}
.b27-lg.st-미응답{border:2px dotted #9ca3af;background:repeating-linear-gradient(135deg,#f3f4f6 0 6px,#fff 6px 10px);color:#6b7280}
.b27-lg.clinic{border:1px solid #c4b5fd;background:repeating-linear-gradient(45deg,rgba(109,75,196,.2) 0 4px,#fff 4px 9px)}
.b27-k.st-확정,.b27-k.st-작성중{border-width:2px}
.b27-alert{padding:10px 14px;border-radius:10px;font-weight:700;margin-bottom:10px}
.b27-alert.ok{background:#e6f4ea;color:#1e6b34}
.b27-alert.bad{background:#fde8e6;color:#9b2c1d}
.b27-rows{display:flex;flex-direction:column}
.b27-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:8px 0;border-top:1px solid var(--line2);font-size:14px}
.b27-pill{font-size:12px;font-weight:700;border-radius:999px;padding:2px 9px;background:#eef2f7}
.b27-pill.st-확정{background:#1f2937;color:#fff;border:0}
.b27-pill.st-작성중{background:#fff;border:1px dashed #1f2937}
.b27-pill.st-가안{background:#fde7d0;border:0}
.b27-pill.st-불확실,.b27-pill.st-조사중,.b27-pill.st-협의,.b27-pill.st-미응답{background:#f3f4f6;color:#6b7280;border:0}
.b27-body h2{margin:6px 0 10px}
`;
