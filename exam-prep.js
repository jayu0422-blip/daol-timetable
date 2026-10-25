/* 다올105 — 시험 직전보강 예측 (exam-period.html 오른쪽 월간 일정표 + 시험 과목 입력 + 직보 예측 배치)
 *
 * 흐름: 시험 2주 전 「몇 월 며칠 무슨 과목」 → 1주 전 학교·학년별 당일 과목 확정 → 시험 전날(달력상 전날) 직보를
 *   그 학교·학년·과목 반마다 자동으로 잡고, 정규수업과 섞인 강의실을 다시 짜서 예측안을 보여준다.
 *   원장이 「이 배치 적용」을 눌러야 저장된다(직보 = ops_calendar kind=memo t=직보, 정규반 방 이동 = t=배정).
 *
 * 시험 과목 저장: Supabase ops_calendar kind = "exam"
 *   d=시험일  school=학교 정식명  grade=중3·고1…  subjects="영어, 수학"  body={"stage":"과목|확정","added":true?,"cancel":true?}
 *   날짜 자체는 schedule-cal.js EXAMS 가 원본. 여기 행은 과목을 덧입히고, 빠진 날짜 추가(added)·없는 날 표시(cancel)만 한다.
 *
 * 범위: 원장 지시(2026-10-25) — 중3 + 고등 전 학년.
 * 의존: DaolScheduleCal(EXAMS), DaolExamOps(XO), rooms.js(CLASS_ROOMS·orderByPref·dayGridHTML)
 */
window.DaolExamPrep = (function () {
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const pad = n => (n < 10 ? "0" : "") + n;
  const iso = dt => dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
  const parse = d => { const p = d.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const addDays = (d, n) => { const t = parse(d); t.setDate(t.getDate() + n); return iso(t); };
  const dowOf = d => DOW[parse(d).getDay()];
  const md = d => (+d.slice(5, 7)) + "/" + (+d.slice(8, 10));
  const fmt = m => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const ovl = (a, b) => a.start < b.end && b.start < a.end;
  const shortSchool = s => String(s).replace("미사강변", "미강").replace("고등학교", "고").replace("중학교", "중").replace("학교", "");
  const normS = s => String(s || "").replace(/\s+/g, "").replace(/학교/g, "").replace(/미사강변/g, "미강").replace(/은가람/g, "은가");
  /* 요일별 기본틀 (원장 선택 2026-10-25): 평일 18~22시 · 주말 14~18시. 강사가 그 시간에 다른 수업이 있으면 다음 칸으로.
     평일 14~18시는 그 학교가 그날도 시험을 봐서 일찍 끝나는 경우에만 쓴다(그 외 평일 낮은 학생이 학교에 있음). */
  const WINDOWS = { wk: [[1080, 1320]], wkExam: [[1080, 1320], [840, 1080]], we: [[840, 1080], [600, 840], [1080, 1320]] };
  const SUBJ = [[/영어/, "영어"], [/국어|화작|화법|문학|독서|언매|고전/, "국어"], [/수학|미적|기하|대수|확통|확률/, "수학"], [/과학|물리|화학|생명|생과|지구|통과/, "과학"]];

  let dep = null, rows = [], ready = false, loadErr = "";
  const SKIP = "_직보안함";

  /* ---------- 시험 단위(날짜·학교·학년) ---------- */
  function expandGrades(e) {
    const g = String(e.grade || "");
    if (e.level === "중") {
      if (g === "전체") return ["중1", "중2", "중3"];
      return (g.match(/[1-3]/g) || []).map(n => "중" + n);
    }
    if (g === "전체") return ["고1", "고2", "고3"];
    return (g.replace(/^고/, "").match(/[1-3]/g) || []).map(n => "고" + n);
  }
  const inScope = grade => grade === "중3" || grade.indexOf("고") === 0;
  function examUnits() {
    const S = window.DaolScheduleCal, Y = (S && S.YEAR) || 2026, out = {};
    ((S && S.EXAMS) || []).forEach(e => {
      expandGrades(e).filter(inScope).forEach(gr => e.days.forEach(day => {
        const d = Y + "-" + pad(e.month) + "-" + pad(day);
        const raw = e.subjects && e.subjects[day] && e.subjects[day][gr];
        const subj = raw && raw !== "미정" ? raw : "";
        out[d + "|" + e.school + "|" + gr] = { d, school: e.school, level: e.level, grade: gr, term: e.term, subjects: subj, stage: subj ? "과목" : "날짜", rowId: null, added: false };
      }));
    });
    rows.forEach(r => {
      const b = body(r), k = r.d + "|" + r.school + "|" + r.grade;
      if (r.school === SKIP || !/^(중|고)[1-3]$/.test(r.grade || "")) return;   // 「직보 안 함」 행·이상한 학년 값은 시험 단위가 아님
      if (b.cancel) { delete out[k]; return; }
      const u = out[k] || (b.added ? { d: r.d, school: r.school, level: r.grade[0], grade: r.grade, term: "", added: true } : null);
      if (!u) return;
      out[k] = Object.assign(u, { subjects: r.subjects || "", stage: b.stage || (r.subjects ? "과목" : "날짜"), rowId: r.id });   // 저장된 행이 있으면 그 값(빈칸으로 지운 것도 존중)
    });
    return Object.values(out).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : (a.school < b.school ? -1 : 1));
  }
  function body(r) { try { return JSON.parse(r.body || "{}") || {}; } catch (e) { return {}; } }
  const subjOfText = t => { const s = new Set(); String(t || "").split(/[,·/]/).forEach(w => SUBJ.forEach(([re, n]) => { if (re.test(w)) s.add(n); })); return s; };

  /* ---------- 강좌 매칭 ---------- */
  function gradeOf(c) {
    if (c.grade) return String(c.grade);
    const m = /^(중|고)\s*([1-3])/.exec(c.course_name || ""); return m ? m[1] + m[2] : "";
  }
  function schoolTokens(c) {
    const ts = (c.target_school || "") === "공통" ? "" : (c.target_school || "");
    const out = []; const re = /([가-힣]+(?:·[가-힣]+)*)(중|고)(?![가-힣])/g;
    [c.course_name || "", ts].forEach(part => {
      const src = normS(part); let m; re.lastIndex = 0;
      while ((m = re.exec(src))) m[1].split("·").forEach(t => { if (t.length >= 2) out.push(t); });
    });
    return out;
  }
  const courseSubj = c => c.subject || ((SUBJ.find(([re]) => re.test(c.course_name || "")) || [])[1]) || "";
  /* strong = 그 학교·학년·과목 반 / weak = 학교 표기가 없는 같은 학년·과목 반(혼합반)
     과목을 적었는데 학원 과목(국·영·수·과)이 하나도 없으면(한국사·사문 …) 직보 대상 없음. 과목 미입력이면 전 과목(예측). */
  function coursesFor(u) {
    const want = normS(shortSchool(u.school)).replace(/(중|고)$/, "");
    const subs = subjOfText(u.subjects);
    if (String(u.subjects || "").trim() && !subs.size) return { strong: [], weak: [] };
    const all = (dep.getCourses() || []).filter(c => gradeOf(c).indexOf(u.grade) === 0 && courseSubj(c) && (!subs.size || subs.has(courseSubj(c))));
    const strong = [], weak = [];
    all.forEach(c => {
      const toks = schoolTokens(c);
      if (toks.some(t => t === want || t.indexOf(want) === 0 || want.indexOf(t) === 0)) strong.push(c);
      else if (!toks.length) weak.push(c);
    });
    return { strong, weak };
  }

  /* ---------- 직보가 필요한 날(= 시험 전날) ---------- */
  const unitLabel = u => shortSchool(u.school) + u.grade.slice(1);
  /* 손으로 입력한 직보가 이 시험 단위를 덮는지 — 학교 토큰 뒤 학년 숫자('미강고1·2', '미사고 고1', '미강1'), 과목이 적혀 있으면 과목까지 */
  function entryCovers(r, u, subj) {
    if (r.subjects && subj && !subjOfText(r.subjects).has(subj)) return false;
    const s = normS(r.school), want = normS(shortSchool(u.school)).replace(/(중|고)$/, "");
    const i = s.indexOf(want); if (i < 0) return false;
    const m = /^[중고]*([1-3](?:[·,.]?[1-3])*)?/.exec(s.slice(i + want.length)), digits = (m && m[1]) || "";
    return digits ? digits.indexOf(u.grade.slice(1)) >= 0 : !/[1-3]/.test(s);
  }
  /* 혼합반(강좌명에 학교가 없는 반)도 넣는다 — 중3·고등 정규반 대부분이 여러 학교를 섞어 받기 때문(2026-10-25 확인).
     필요 없는 직보는 「직보 안 함」: ops_calendar kind=exam, school="_직보안함", grade=직보 묶음 키(강사|과목|반들), d=직보 날 */
  const skipRow = (D, key) => rows.find(r => r.d === D && r.school === SKIP && r.grade === key);
  function needsOn(D) {
    const groups = {};
    examUnits().filter(u => addDays(u.d, -1) === D).forEach(u => {
      const m = coursesFor(u);
      m.strong.forEach(c => { const g = (groups[c.id] = groups[c.id] || { c, units: [], mixed: false }); g.units.push(u); g.mixed = false; });
      m.weak.forEach(c => { const g = (groups[c.id] = groups[c.id] || { c, units: [], mixed: true }); g.units.push(u); });
    });
    /* 같은 선생님·같은 과목·같은 학교학년이면 반이 둘이어도 직보는 한 번(예: 정규반 + 1:1 내신반) */
    const merged = {};
    Object.values(groups).forEach(g => {
      const labels = [...new Set(g.units.map(unitLabel))].sort();
      const k = g.c.teacher + "|" + courseSubj(g.c) + "|" + labels.join("·");
      const m = merged[k];
      if (!m) merged[k] = Object.assign({}, g, { key: k, labels, courses: [g.c] });
      else { m.courses.push(g.c); m.mixed = m.mixed && g.mixed; if (!g.mixed) m.c = g.c; }
    });
    const memo = dep.XO.entriesOn(D).filter(r => dep.XO.typeOf(r) === "직보");
    const list = Object.values(merged).map(g => {
      const subj = courseSubj(g.c), ids = g.courses.map(c => c.id);
      const done = memo.find(r => {
        const b = dep.XO.body(r);
        return ids.indexOf(b.course_id) >= 0 || (b.course_ids || []).some(x => ids.indexOf(x) >= 0) ||
               (r.who === g.c.teacher && g.units.every(u => entryCovers(r, u, subj)));
      });
      const stage = g.units.every(u => u.stage === "확정") ? "확정" : (g.units.some(u => u.stage === "날짜") ? "예측" : "가안");
      return { key: g.key, c: g.c, courses: g.courses, units: g.units, labels: g.labels, done, stage, mixed: g.mixed, skip: skipRow(D, g.key) };
    }).sort((a, b) => (a.mixed - b.mixed) || (a.c.teacher < b.c.teacher ? -1 : 1));
    return { list };
  }
  const isPending = x => !x.done && !x.skip;
  const pendingCount = D => needsOn(D).list.filter(isPending).length;
  const errMsg = e => /kind_chk|check constraint/i.test((e && e.message) || "") ? "시험 과목 저장 칸이 아직 없습니다 — Supabase SQL 1줄 실행이 필요합니다." : ((e && e.message) || String(e));
  async function toggleSkip(D, key) {
    const r = skipRow(D, key);
    const q = r ? dep.sb.from("ops_calendar").delete().eq("id", r.id)
                : dep.sb.from("ops_calendar").insert({ d: D, kind: "exam", school: SKIP, grade: key, body: JSON.stringify({ skip: true }) });
    const { error } = await q;
    if (error) throw new Error(errMsg(error));
    await load();
  }

  /* ---------- 예측 배치: 정규 + 기존 임시 + 새 직보를 한 날에 다시 짠다 ----------
     정규반을 옮길 땐 「그 반의 그날 수업 전체」를 같은 건물 안 다른 방으로(저장이 강좌 단위 하루 지정이라서).
     원장이 이날만 지정한 반·이번에 이미 옮긴 반·같은 방 같은 시간의 통합반은 옮기지 않는다. */
  function predict(D) {
    const A = dep.XO.assignForDate(D);
    const occ = A.items.filter(it => !it.off).map(it => ({ room: it.room, s: it.s, teacher: it.c.teacher, reg: it }))
      .concat(A.temps.map(b => ({ room: b.room, s: { start: b.start, end: b.end }, teacher: b.teacher })));
    const keys = dep.rooms.map(r => r.key), we = ["토", "일"].indexOf(A.day) >= 0;
    const bldg = k => (dep.rooms.find(r => r.key === k) || {}).bldg;
    const free = (k, s, skips) => !occ.some(o => skips.indexOf(o) < 0 && o.room === k && ovl(o.s, s));
    const teacherFree = (t, s) => !occ.some(o => o.teacher === t && ovl(o.s, s));
    const props = [], moves = [], moved = new Set();
    needsOn(D).list.filter(isPending).forEach(n => {
      const t = n.c.teacher;
      const examToday = n.units.every(u => examUnits().some(x => x.d === D && x.school === u.school && x.grade === u.grade));
      const W = we ? WINDOWS.we : (examToday ? WINDOWS.wkExam : WINDOWS.wk);
      let win = W.map(w => ({ start: w[0], end: w[1] })).find(s => teacherFree(t, s));
      const clash = !win; if (!win) win = { start: W[0][0], end: W[0][1] };
      const order = [...new Set(dep.orderByPref(t, A.day, keys).concat(keys))];
      let room = order.find(k => free(k, win, []));
      if (!room) {
        for (const k of order) {
          const block = occ.filter(o => o.room === k && ovl(o.s, win));
          if (!block.length || block.some(o => !o.reg || o.reg.overridden || moved.has(o.reg.c.id))) continue;
          const cids = [...new Set(block.map(o => o.reg.c.id))];
          if (block.some(a => block.some(b => a.reg.c.id !== b.reg.c.id && a.teacher === b.teacher))) continue;   // 같은 강사의 통합반은 쪼개지 않음
          const plan = [];
          const ok = cids.every(cid => {
            const mine = occ.filter(o => o.reg && o.reg.c.id === cid);
            const to = [...new Set(dep.orderByPref(mine[0].teacher, A.day, keys).concat(keys))]
              .find(x => x !== k && bldg(x) === bldg(k) && mine.every(o => free(x, o.s, mine)) &&
                         !plan.some(p => p.to === x && p.mine.some(a => mine.some(b => ovl(a.s, b.s)))));
            if (to) plan.push({ cid, mine, to, from: k });
            return !!to;
          });
          if (!ok) continue;
          plan.forEach(p => { moves.push({ c: p.mine[0].reg.c, from: p.from, to: p.to }); p.mine.forEach(o => { o.room = p.to; }); moved.add(p.cid); });
          room = k; break;
        }
      }
      props.push({ n, start: win.start, end: win.end, room: room || "", teacher: t, clash });
      occ.push({ room: room || null, s: { start: win.start, end: win.end }, teacher: t });   // 방이 없어도 강사 시간은 찬 것으로
    });
    /* 저장 대상: 과목이 정해진 것(가안·확정) + 방 있음 + 강사 겹침 없음. 나머지는 미리보기만 */
    props.forEach(p => { p.savable = !!p.room && !p.clash && p.n.stage !== "예측"; });
    const items = A.items.map(it => { const mv = moves.find(m => m.c.id === it.c.id); return mv ? Object.assign({}, it, { room: mv.to, overridden: true }) : it; });
    const temps = A.temps.concat(props.filter(p => p.room).map(p => ({ id: "pred", room: p.room, start: p.start, end: p.end, type: "직보", teacher: p.teacher,
      school: p.n.labels.join("·"), subj: courseSubj(p.n.c), name: p.n.labels.join("·") + " " + courseSubj(p.n.c) + " 직보(예측)", suggested: true, conflict: false })));
    return { A, props, moves, items, temps };
  }

  /* ---------- 저장 ---------- */
  async function load() {
    loadErr = "";
    if (!dep || !dep.sb) { rows = []; return; }
    const P = dep.XO.period();
    const { data, error } = await dep.sb.from("ops_calendar").select("*").eq("kind", "exam").gte("d", addDays(P.start, -1)).lte("d", addDays(P.end, 30)).order("d");
    rows = error ? [] : (data || []); if (error) loadErr = error.message;
    ready = true;
  }
  async function saveUnit(u, subjects, stage) {
    const row = { d: u.d, kind: "exam", school: u.school, grade: u.grade, subjects: subjects || null,
                  body: JSON.stringify(Object.assign({ stage: stage || (subjects ? "과목" : "날짜") }, u.added ? { added: true } : {})) };
    const q = u.rowId ? dep.sb.from("ops_calendar").update(row).eq("id", u.rowId) : dep.sb.from("ops_calendar").insert(row);
    const { error } = await q;
    if (error) throw new Error(errMsg(error));
    await load();
  }
  async function addDate(school, grade, d, subjects) {
    await saveUnit({ d, school, grade, added: true, rowId: null }, subjects, subjects ? "과목" : "날짜");
  }
  /* 적용: 다시 읽고 → 다시 계산 → 직보는 한 번에 insert(전부 아니면 전무) → 그 직보 자리를 만드는 정규반 이동.
     실행 중에는 다시 못 누른다. 실패해도 마지막에 반드시 다시 읽는다. */
  let applying = false;
  async function applyPrediction(D) {
    if (applying) throw new Error("저장 중입니다. 잠시만 기다려 주세요.");
    applying = true;
    try {
      await dep.XO.load(); await load();
      const R = predict(D), save = R.props.filter(p => p.savable);
      const ins = save.map(p => {
        const exams = p.n.units.map(u => md(u.d) + " " + unitLabel(u) + " " + (u.subjects || "과목 미정")).join(" / ");
        return { d: D, kind: "memo", who: p.teacher, school: p.n.labels.join("·"), subjects: courseSubj(p.n.c), slots: fmt(p.start) + "-" + fmt(p.end),
                 room: p.room, body: JSON.stringify({ t: "직보", memo: "시험 직보 자동 배치 — 시험 " + exams, course_id: p.n.c.id, course_ids: p.n.courses.map(c => c.id) }) };
      });
      if (ins.length) { const { error } = await dep.sb.from("ops_calendar").insert(ins); if (error) throw error; }
      const used = new Set(save.map(p => p.room)), mv = R.moves.filter(m => used.has(m.from));
      for (const m of mv) await dep.XO.setRoomOverride(D, m.c, m.to);
      return { saved: ins.length, skipped: R.props.length - ins.length, moves: mv.length };
    } finally {
      try { await dep.XO.load(); } catch (e) { /* 다시 읽기 실패는 화면 새로고침으로 */ }
      applying = false;
    }
  }
  const isApplying = () => applying;

  /* ---------- 화면: 오른쪽 월간 일정표 ---------- */
  function calendarHTML(sel) {
    const P = dep.XO.period(), units = examUnits(), today = iso(new Date());
    const months = []; let c = parse(P.start); c.setDate(1);
    const endM = parse(P.end); endM.setDate(1);
    while (c <= endM) { months.push([c.getFullYear(), c.getMonth()]); c = new Date(c.getFullYear(), c.getMonth() + 1, 1); }
    return months.map(([y, m]) => {
      const first = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate();
      let h = `<div class="xp-cal"><div class="xp-mt">${y}년 ${m + 1}월</div><div class="xp-grid">` + DOW.map(w => `<div class="xp-w">${w}</div>`).join("");
      for (let i = 0; i < first; i++) h += `<div></div>`;
      for (let d = 1; d <= dim; d++) {
        const ds = y + "-" + pad(m + 1) + "-" + pad(d), inP = ds >= P.start && ds <= P.end;
        const ex = units.filter(u => u.d === ds), sch = {};
        ex.forEach(u => { (sch[shortSchool(u.school)] = sch[shortSchool(u.school)] || []).push(u.grade.slice(1)); });
        const pend = inP ? pendingCount(ds) : 0, dw = new Date(y, m, d).getDay();
        const cls = ["xp-d", inP ? "in" : "out", ds === sel ? "on" : "", ds === today ? "today" : "", dw === 0 ? "sun" : dw === 6 ? "sat" : "", ex.length ? "ex" : ""].filter(Boolean).join(" ");
        h += `<button class="${cls}" ${inP ? `data-xpd="${ds}"` : "disabled"}><b>${d}</b>`
          + Object.keys(sch).map(s => `<i title="${esc(s)} ${esc(sch[s].join("·"))} 시험">${esc(s.replace(/(중|고)$/, ""))}${sch[s].length < 3 ? esc(sch[s].join("")) : ""}</i>`).join("")
          + (pend ? `<em title="직전보강 강의실 입력 필요 ${pend}반">🔔${pend}</em>` : "") + `</button>`;
      }
      return h + `</div></div>`;
    }).join("") + `<div class="xp-leg"><span><i class="xp-sw"></i>시험일</span><span>🔔 전날 직보 강의실 미입력</span></div>`;
  }

  /* ---------- 화면: 선택한 날의 직보 알림 + 예측 ---------- */
  function dayAlertHTML(D, showPred) {
    const N = needsOn(D), pend = N.list.filter(isPending);
    if (!N.list.length) return "";
    let h = `<div class="xp-alert ${pend.length ? "need" : "ok"}">`;
    h += pend.length ? `<div class="xp-ah">🔔 <b>직전보강 강의실 입력하세요</b> — 내일 시험: ${esc([...new Set(N.list.flatMap(x => x.units.map(unitLabel)))].join(", "))}</div>`
                     : `<div class="xp-ah">✓ 내일 시험 반의 직전보강이 모두 입력되어 있습니다.</div>`;
    h += `<table class="xp-t"><thead><tr><th>반(강사)</th><th>시험</th><th>상태</th><th></th></tr></thead><tbody>` + N.list.map(x => `<tr class="${x.done || x.skip ? "done" : ""}">
      <td><b>${esc(x.c.teacher)}</b> ${x.courses.map(c => esc(c.course_name)).join(" + ")}${x.mixed ? ' <span class="xp-mix" title="강좌명에 학교가 없는 반 — 그 학교 학생이 있으면 직보">혼합반</span>' : ""}</td>
      <td>${x.units.map(u => `${esc(unitLabel(u))} <span class="xp-s ${u.stage}">${u.subjects ? esc(u.subjects) : "과목 미정"}</span>`).join("<br>")}</td>
      <td>${x.done ? `✓ 입력됨 ${esc(x.done.slots || "")} ${esc(roomLabel(x.done.room))}` : x.skip ? "직보 안 함" : `<span class="xp-st ${x.stage}">${x.stage === "확정" ? "확정 — 입력 필요" : x.stage === "가안" ? "가안(2주 전 과목)" : "예측(과목 미정)"}</span>`}</td>
      <td>${x.done ? "" : `<button class="xp-b sm" data-xpskip="${esc(D)}" data-xpkey="${esc(x.key)}">${x.skip ? "되돌리기" : "직보 안 함"}</button>`}</td></tr>`).join("") + `</tbody></table>`;
    if (pend.length) {
      h += `<div class="xp-btns"><button class="xp-b" data-xppred="${D}">${showPred ? "예측 닫기" : "🧩 직보 넣은 강의실 예측 보기"}</button>`;
      if (showPred) h += `<button class="xp-b p" data-xpapply="${D}">✅ 이 배치 적용 (저장)</button>`;
      h += `</div>`;
    }
    return h + `</div>`;
  }
  function predictHTML(D) {
    const R = predict(D);
    const short = R.props.filter(p => !p.room), clash = R.props.filter(p => p.clash), savable = R.props.filter(p => p.savable);
    let h = `<div class="xp-pred"><div class="xp-ph">예측 배치 — 기본틀 ${["토", "일"].indexOf(R.A.day) >= 0 ? "주말 14~18시" : "평일 18~22시"} · 새 직보 ${R.props.length}건 · 정규반 방 이동 ${R.moves.length}건${short.length ? ` · <b class="bad">방 부족 ${short.length}건</b>` : ""}<br><small>「적용」 때 저장되는 것: 과목이 정해진(가안·확정) 직보 중 방이 있고 강사 겹침이 없는 <b>${savable.length}건</b>과 그 자리를 만드는 방 이동만. 과목 미정·겹침·방 없음은 미리보기만 합니다.</small></div>`;
    h += `<ul class="xp-ul">` + R.props.map(p => `<li class="${p.savable ? "" : "pv"}"><b>${esc(p.teacher)}</b> ${esc(p.n.labels.join("·"))} ${esc(courseSubj(p.n.c))} 직보 · ${fmt(p.start)}~${fmt(p.end)} · ${p.room ? esc(roomLabel(p.room)) : '<b class="bad">빈 방 없음</b>'}${p.clash ? ' · <b class="bad">강사 수업 겹침 — 시간 조정 필요</b>' : ""}${p.n.stage === "예측" ? ' · <span class="muted">과목 미정(미리보기만)</span>' : ""}</li>`).join("")
      + R.moves.map(m => `<li class="mv">↪ 정규반 이동(이날 하루): <b>${esc(m.c.teacher)}</b> ${esc(m.c.course_name)} · ${esc(roomLabel(m.from))} → <b>${esc(roomLabel(m.to))}</b></li>`).join("") + `</ul>`;
    h += `<div class="sheet">${dayGridHTML({ day: R.A.day, title: `${md(D)} (${R.A.day}) 직전보강 예측 배치 — 적용 전 미리보기`, items: R.items, temps: R.temps })}</div>`;
    if (clash.length) h += `<div class="muted">강사 수업 겹침 = 기본틀(평일 18~22시, 그 학교가 그날도 시험이면 14~18시 / 주말 14~18 → 10~14 → 18~22시)이 모두 막힌 경우입니다. 적용 후 아래 표에서 시간을 고쳐 주세요.</div>`;
    return h + `</div>`;
  }
  const roomLabel = k => ((dep && dep.rooms) || []).find(r => r.key === k)?.label || (k || "—");

  /* ---------- 화면: 시험 과목 입력 (학교별, 날짜 × 학년) ---------- */
  function inputHTML() {
    const P = dep.XO.period(), today = iso(new Date());
    const units = examUnits().filter(u => u.d >= P.start && u.d <= addDays(P.end, 30));
    const need2 = units.filter(u => u.stage === "날짜" && today >= addDays(u.d, -14) && today <= u.d).length;
    const need1 = units.filter(u => u.stage !== "확정" && today >= addDays(u.d, -7) && today <= u.d).length;
    const bySchool = {};
    units.forEach(u => { (bySchool[u.school] = bySchool[u.school] || []).push(u); });
    let h = `<div class="xp-in"><div class="xp-ih">📝 시험 과목 입력 <small>2주 전 = 날짜·과목 · 1주 전 = 학교·학년별 당일 과목 확정</small></div>`;
    if (loadErr) h += `<div class="xp-weak">시험 과목 저장 칸을 읽지 못했습니다: ${esc(loadErr)}</div>`;
    h += `<div class="xp-need">${need2 ? `<span class="n2">2주 안 과목 미입력 ${need2}칸</span>` : ""}${need1 ? `<span class="n1">1주 안 미확정 ${need1}칸</span>` : ""}${!need2 && !need1 ? `<span class="ok">지금 입력할 칸 없음</span>` : ""}</div>`;
    Object.keys(bySchool).forEach(sch => {
      const us = bySchool[sch], grades = [...new Set(us.map(u => u.grade))].sort(), dates = [...new Set(us.map(u => u.d))].sort();
      const hot = us.some(u => (u.stage === "날짜" && today >= addDays(u.d, -14) && today <= u.d) || (u.stage !== "확정" && today >= addDays(u.d, -7) && today <= u.d));
      h += `<details class="xp-sch" ${hot ? "open" : ""}><summary>${esc(shortSchool(sch))} <small>${dates.map(md).join("·")}</small>${hot ? ' <em>입력</em>' : ""}</summary><table class="xp-it"><thead><tr><th>날짜</th>${grades.map(g => `<th>${esc(g)}</th>`).join("")}</tr></thead><tbody>`;
      dates.forEach(d => {
        h += `<tr><td>${md(d)}(${dowOf(d)})</td>` + grades.map(g => {
          const u = us.find(x => x.d === d && x.grade === g);
          if (!u) return `<td class="na">—</td>`;
          const warn = (u.stage === "날짜" && today >= addDays(d, -14)) ? "w2" : (u.stage !== "확정" && today >= addDays(d, -7)) ? "w1" : "";
          return `<td class="${warn}"><input data-xpu="${esc(d + "|" + sch + "|" + g)}" value="${esc(u.subjects)}" placeholder="과목">`
            + `<label title="1주 전 확정"><input type="checkbox" data-xpc="${esc(d + "|" + sch + "|" + g)}" ${u.stage === "확정" ? "checked" : ""}>확정</label></td>`;
        }).join("") + `</tr>`;
      });
      h += `</tbody></table><div class="xp-add" data-xpsch="${esc(sch)}"><input type="date" data-xpad> <select data-xpag>${["중3", "고1", "고2", "고3"].map(g => `<option>${g}</option>`).join("")}</select> <input data-xpas placeholder="과목"> <button class="xp-b" data-xpadd>날짜 추가</button></div></details>`;
    });
    return h + `</div>`;
  }

  /* ---------- 이벤트 (exam-period.html 이 위임) ---------- */
  let queue = Promise.resolve();
  function onInput(e) {
    const t = e.target, key = t.dataset.xpu || t.dataset.xpc; if (!key) return false;
    const inp = document.querySelector(`[data-xpu="${CSS.escape(key)}"]`), chk = document.querySelector(`[data-xpc="${CSS.escape(key)}"]`);
    const subj = (inp ? inp.value : "").trim(), stage = chk && chk.checked ? "확정" : (subj ? "과목" : "날짜");
    queue = queue.then(async () => {
      const u = examUnits().find(x => x.d + "|" + x.school + "|" + x.grade === key); if (!u) return;   // 앞 저장 뒤 다시 찾아서 rowId 를 받는다
      try { await saveUnit(u, subj, stage); } catch (err) { alert(err.message); }
      dep.onChange();
    });
    return true;
  }
  async function onAdd(btn) {
    const box = btn.closest("[data-xpsch]"), d = box.querySelector("[data-xpad]").value, g = box.querySelector("[data-xpag]").value, s = box.querySelector("[data-xpas]").value.trim();
    if (!d) return alert("날짜를 고르세요.");
    try { await addDate(box.dataset.xpsch, g, d, s); dep.onChange(); } catch (err) { alert(err.message); }
  }

  function css() {
    if (document.getElementById("xp-style")) return;
    const s = document.createElement("style"); s.id = "xp-style";
    s.textContent = `
.xp-cal{margin-bottom:10px}.xp-mt{font-weight:900;color:#1e3a5f;font-size:14px;margin:2px 0 6px}
.xp-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
.xp-w{font-size:10.5px;color:#6b7280;text-align:center;font-weight:800}
.xp-d{min-height:52px;border:1px solid #e5e7eb;border-radius:7px;background:#fff;padding:3px;font:inherit;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:1px;overflow:hidden}
.xp-d b{font-size:11.5px;color:#31405a}.xp-d.sun b{color:#b91c1c}.xp-d.sat b{color:#1d4ed8}
.xp-d.out{opacity:.35;cursor:default}.xp-d.ex{background:#fff7ed;border-color:#fdba74}
.xp-d.on{outline:2px solid #f59e0b;outline-offset:-1px}.xp-d.today{box-shadow:inset 0 0 0 2px #c9a227}
.xp-d i{font-style:normal;font-size:9.5px;font-weight:800;color:#7c2d12;line-height:1.15;white-space:nowrap}
.xp-d em{font-style:normal;font-size:10px;font-weight:900;color:#b91c1c}
.xp-leg{display:flex;gap:10px;font-size:11px;color:#6b7280;margin-bottom:8px}.xp-sw{display:inline-block;width:10px;height:10px;background:#fff7ed;border:1px solid #fdba74;border-radius:3px;margin-right:3px;vertical-align:-1px}
.xp-alert{border-radius:12px;padding:10px 12px;margin:0 0 10px;border:1px solid}
.xp-alert.need{background:#fff7f7;border-color:#fca5a5}.xp-alert.ok{background:#f0fdf4;border-color:#bbf7d0}
.xp-ah{font-size:14px;margin-bottom:6px}.xp-alert.need .xp-ah b{color:#b91c1c}
table.xp-t{width:100%;border-collapse:collapse;font-size:12.5px}table.xp-t th{text-align:left;font-size:11px;color:#5b7095;padding:5px 6px;border-bottom:1px solid #e5e7eb}
table.xp-t td{padding:5px 6px;border-bottom:1px solid #f1f4f9;vertical-align:top}table.xp-t tr.done td{opacity:.6}
.xp-s{font-size:11px;font-weight:700;padding:0 5px;border-radius:5px;background:#eef2ff;color:#3730a3}.xp-s.확정{background:#dcfce7;color:#166534}.xp-s.날짜{background:#f3f4f6;color:#6b7280}
.xp-st{font-size:11.5px;font-weight:800;color:#b91c1c}.xp-st.가안{color:#b45309}.xp-st.예측{color:#6b7280}
.xp-mix{font-size:10.5px;font-weight:800;padding:0 5px;border-radius:5px;background:#f1f5f9;color:#475569}
.xp-b.sm{font-size:11px;padding:2px 7px;font-weight:600}
.xp-weak{font-size:12px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 8px;margin-top:6px}
.xp-btns{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.xp-b{border:1px solid #cbd5e1;background:#fff;border-radius:8px;font:inherit;font-size:12.5px;font-weight:700;padding:6px 12px;cursor:pointer;color:#1e3a5f}
.xp-b.p{background:#1e3a5f;color:#fff;border-color:#1e3a5f}
.xp-pred{border:1px dashed #94a3b8;border-radius:12px;padding:10px;margin:0 0 10px;background:#f8fafc}
.xp-ph{font-weight:800;font-size:13px;margin-bottom:6px}.xp-ul{margin:0 0 8px;padding-left:18px;font-size:12.5px;line-height:1.6}.xp-ul li.mv{color:#075985}.xp-ul li.pv{color:#6b7280}
.bad{color:#b91c1c}
.xp-in{margin-top:6px}.xp-ih{font-weight:900;color:#1e3a5f;font-size:14px}.xp-ih small{display:block;font-weight:600;color:#6b7280;font-size:11px}
.xp-need{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}.xp-need span{font-size:11.5px;font-weight:800;padding:2px 8px;border-radius:99px}
.xp-need .n2{background:#fef3c7;color:#92400e}.xp-need .n1{background:#fee2e2;color:#991b1b}.xp-need .ok{background:#f0fdf4;color:#166534}
.xp-sch{border:1px solid #e5e7eb;border-radius:9px;margin:5px 0;background:#fff}.xp-sch summary{cursor:pointer;padding:7px 9px;font-weight:800;font-size:13px}
.xp-sch summary small{font-weight:600;color:#6b7280;font-size:11px;margin-left:4px}.xp-sch summary em{font-style:normal;font-size:10.5px;background:#fee2e2;color:#991b1b;border-radius:99px;padding:0 6px;margin-left:4px}
table.xp-it{width:100%;border-collapse:collapse;font-size:12px}table.xp-it th{font-size:11px;color:#5b7095;padding:4px;text-align:left}
table.xp-it td{padding:3px 4px;border-top:1px solid #f1f4f9;vertical-align:top}table.xp-it td.na{color:#cbd5e1}
table.xp-it input:not([type]){width:100%;min-width:70px;font:inherit;font-size:12px;padding:3px 5px;border:1px solid #dde3ec;border-radius:6px}
table.xp-it label{display:block;font-size:10.5px;color:#475569;margin-top:2px}
table.xp-it td.w2 input:not([type]){border-color:#f59e0b;background:#fffbeb}table.xp-it td.w1 input:not([type]){border-color:#ef4444;background:#fff7f7}
.xp-add{display:flex;gap:4px;flex-wrap:wrap;padding:6px 8px;border-top:1px solid #f1f4f9}.xp-add input,.xp-add select{font:inherit;font-size:12px;padding:3px 5px;border:1px solid #dde3ec;border-radius:6px}.xp-add [data-xpas]{width:90px}
`;
    document.head.appendChild(s);
  }

  function init(o) { dep = o; css(); }
  return { init, load, examUnits, needsOn, pendingCount, toggleSkip, isApplying, predict, applyPrediction, calendarHTML, dayAlertHTML, predictHTML, inputHTML, onInput, onAdd,
           get ready() { return ready; } };
})();
