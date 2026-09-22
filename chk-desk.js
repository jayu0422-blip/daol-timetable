/* 수행도 체크표 — 인포데스크 입력 탭 (admin.html 「수행도 체크표」).

   종이 체크표를 대신한다. 칸 구성은 체크표 스크립트(build_class_checks.py)에서 뽑은 주간 계획을
   선생님 서버(daol105-teacher)에서 받아 그대로 그린다 — 종이와 웹이 항상 같은 칸.

   ⚠ 이 저장소는 공개다. 학생 이름·기록은 이 파일에도, Supabase에도 두지 않는다.
     전부 선생님 서버 API(/api/chk2)에서 역할 키(인포·원장)로 받아 화면에만 그린다.
   ⚠ 서버는 같은 학생 키에 1초 안에 두 번 쓰면 거절(429)한다 → 학생별로 저장을 줄 세우고 1.1초 간격을 둔다.
   판정(P/F)은 서버가 다시 계산한다. 화면의 판정 표시는 미리보기일 뿐이다. */
(function () {
  "use strict";

  const API_DEFAULT = "https://daol105-teacher.pages.dev";
  const LS_KEY = "daol_chk_key", LS_API = "daol_chk_api";
  const ATT = ["출석", "지각", "결석", "병결", "조퇴", "무단"];
  const RANK3 = ["우수", "보통", "부족"], HW = ["완료", "일부", "미제출"];
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const SAVE_GAP_MS = 1100, DEBOUNCE_MS = 600;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 사생활 모드 — 이번 접속에만 */ } } };

  const S = { root: null, week: null, plan: null, records: {}, role: null, date: null, classKey: null,
    jobs: {}, saved: {}, failed: {}, pending: {}, queue: {}, err: "", loadSeq: 0 };

  /* ── 날짜 ── */
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function mondayOf(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  const addDays = (isoStr, n) => { const d = new Date(isoStr + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
  const dayLabel = (isoStr) => { const d = new Date(isoStr + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`; };

  /* ── 서버 ── */
  /* ⚠ 서버 주소는 허용 목록만 — ?chkapi=https://남의서버 링크 한 번으로 접속 키가 그쪽으로 새던 구멍(9/22 적대 검토) */
  const API_ALLOWED = [API_DEFAULT, "http://127.0.0.1:8798", "http://localhost:8798", "http://127.0.0.1:8799", "http://localhost:8799"];
  const apiBase = () => {
    const q = new URLSearchParams(location.search).get("chkapi");
    if (q && API_ALLOWED.includes(q)) ls.set(LS_API, q);
    const saved = ls.get(LS_API);
    return API_ALLOWED.includes(saved) ? saved : API_DEFAULT;
  };
  const key = () => ls.get(LS_KEY) || "";
  async function call(method, path, body) {
    const r = await fetch(apiBase() + path, { method, headers: { "content-type": "application/json", "x-beta-key": key() },
      body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch (e) { /* 본문 없음 */ }
    return { status: r.status, json: j, more: r.headers.get("x-more-parts") === "1" };
  }

  async function load(week) {
    const seq = ++S.loadSeq;   // 주 버튼을 연달아 누르면 늦게 온 옛 응답이 새 주를 덮던 문제 — 최신 요청만 반영
    S.week = week; S.plan = null; S.records = {}; S.err = "";
    render();
    if (!key()) { S.err = "nokey"; render(); return; }
    try {
      let part = 0, more = true;
      while (more && part < 10) {
        const r = await call("GET", `/api/chk2?week=${week}&part=${part}`);
        if (seq !== S.loadSeq) return;
        if (r.status === 401) { S.err = "badkey"; break; }
        if (r.status !== 200) { S.err = `서버 오류 ${r.status}`; break; }
        if (part === 0) { S.plan = r.json.plan; S.role = r.json.role; }
        Object.assign(S.records, r.json.records || {});
        more = r.more; part++;
      }
    } catch (e) { if (seq !== S.loadSeq) return; S.err = "서버에 연결하지 못했습니다 — 인터넷 연결을 확인하세요"; }
    if (S.plan) {
      const dates = S.plan.days.map((d) => d.date);
      const today = iso(new Date());
      if (!dates.includes(S.date)) S.date = dates.includes(today) ? today : dates[0];
      pickDefaultClass();
    }
    render();
  }

  function pickDefaultClass() {
    const day = S.plan.days.find((d) => d.date === S.date);
    const held = (day?.classes || []).filter((c) => c.kind === "class");
    if (!held.some((c) => c.key === S.classKey)) S.classKey = held[0]?.key || day?.classes[0]?.key || null;
  }

  /* ── 기록 읽기 ── */
  const rowOf = (sid) => S.records[sid]?.days?.[S.date]?.[S.classKey] || {};
  function setLocal(sid, patch) {   // 화면 즉시 반영(낙관적) — 새 객체로 교체
    const rec = S.records[sid] || { days: {} };
    const day = { ...(rec.days[S.date] || {}) };
    const row = { ...(day[S.classKey] || {}) };
    for (const k of ["att", "hw", "memo"]) if (k in patch) { if (patch[k] == null || patch[k] === "") delete row[k]; else row[k] = patch[k]; }
    if (patch.cells) {
      const cells = { ...(row.cells || {}) };
      for (const [id, v] of Object.entries(patch.cells)) { if (v == null) delete cells[id]; else cells[id] = v; }
      row.cells = cells;
    }
    day[S.classKey] = row;
    S.records = { ...S.records, [sid]: { ...rec, days: { ...rec.days, [S.date]: day } } };
  }

  /* ── 저장: 학생별 디바운스 + 줄 세우기 ──
     상태는 (날짜|반|학생) 단위. 대기·진행·실패가 하나라도 있으면 ✓를 보이지 않고 창 닫기를 붙잡는다.
     ⚠ 예전엔 학생 단위라 A칸 저장 성공이 줄 서 있던 B칸을 ✓로 가렸고, 그 틈에 탭을 닫으면 B가 사라졌다(9/22 적대 검토).
     ⚠ 작업에 주(week)를 묶는다 — 저장 대기 중 주를 바꾸면 새 주로 잘못 보내 거절되던 문제. */
  const ctxOf = (sid, date = S.date, classKey = S.classKey) => `${date}|${classKey}|${sid}`;
  function queueSave(sid, patch) {
    const ctxKey = ctxOf(sid);
    const failed = S.failed[ctxKey];   // 실패했던 값은 다음 저장에 함께 실어 다시 보낸다
    const prev = S.pending[ctxKey] || { sid, week: S.week, date: S.date, classKey: S.classKey, row: failed ? failed.row : {} };
    const row = { ...prev.row, ...patch };
    const cells = { ...(prev.row.cells || {}), ...(patch.cells || {}) };
    if (Object.keys(cells).length) row.cells = cells; else delete row.cells;
    const { [ctxKey]: _f, ...restFailed } = S.failed;
    S.failed = restFailed;
    S.pending = { ...S.pending, [ctxKey]: { ...prev, row } };
    setJob(ctxKey, "wait");
    clearTimeout(S.queue["t" + ctxKey]);
    S.queue["t" + ctxKey] = setTimeout(() => flush(ctxKey), DEBOUNCE_MS);
  }

  function flush(ctxKey) {
    const job = S.pending[ctxKey];
    if (!job) return;
    const { [ctxKey]: _done, ...rest } = S.pending;
    S.pending = rest;
    const lane = S.queue["lane" + job.sid] || Promise.resolve();
    const put = () => call("PUT", "/api/chk2", { week: job.week, sid: job.sid, date: job.date, classKey: job.classKey, row: job.row });
    const run = lane.then(async () => {
      setJob(ctxKey, "saving");
      let r;
      try {
        r = await put();
        if (r.status === 429 || r.status === 503) { await sleep(SAVE_GAP_MS); r = await put(); }
      } catch (e) { r = { status: 0 }; }
      const newer = !!S.pending[ctxKey];   // 그 사이 같은 칸에 새 입력이 왔으면 그 작업이 상태를 이어받는다
      if (r.status === 200) {
        if (job.week === S.week) applyServerRow(job, r.json.row);
        S.saved = { ...S.saved, [ctxKey]: true };
        setJob(ctxKey, newer ? "wait" : null);
      } else {
        S.failed = { ...S.failed, [ctxKey]: job };
        setJob(ctxKey, "err", r.json?.error || (r.status ? `오류 ${r.status}` : "연결 실패"));
      }
      await sleep(SAVE_GAP_MS);
    });
    S.queue["lane" + job.sid] = run.catch(() => {});
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function retry(ctxKey) {
    const job = S.failed[ctxKey];
    if (!job) return;
    const { [ctxKey]: _f, ...rest } = S.failed;
    S.failed = rest;
    S.pending = { ...S.pending, [ctxKey]: job };
    setJob(ctxKey, "wait");
    flush(ctxKey);
  }

  function applyServerRow(job, row) {   // 서버가 계산한 판정으로 덮는다
    const rec = S.records[job.sid] || { days: {} };
    const day = { ...(rec.days[job.date] || {}), [job.classKey]: row };
    S.records = { ...S.records, [job.sid]: { ...rec, days: { ...rec.days, [job.date]: day } } };
    if (job.date === S.date && job.classKey === S.classKey && !S.pending[ctxOf(job.sid, job.date, job.classKey)]) paintRow(job.sid);
  }

  function setJob(ctxKey, st, msg) {
    const { [ctxKey]: _old, ...rest } = S.jobs;
    S.jobs = st ? { ...rest, [ctxKey]: { st, msg } } : rest;
    const sid = ctxKey.split("|").slice(2).join("|");
    if (ctxKey !== ctxOf(sid)) return;   // 지금 보고 있는 칸이 아니면 표시만 생략(상태는 유지)
    const el = S.root?.querySelector(`[data-st="${CSS.escape(sid)}"]`);
    if (el) el.outerHTML = statusHtml(sid);
  }
  const unsaved = () => Object.keys(S.pending).length > 0 || Object.keys(S.jobs).length > 0;
  function statusHtml(sid) {
    const ctxKey = ctxOf(sid);
    const s = S.jobs[ctxKey] || (S.saved[ctxKey] ? { st: "ok" } : {});
    const map = { wait: ["…", "입력 중"], saving: ["⟳", "저장 중"], ok: ["✓", "저장됨"], err: ["!", "저장 실패 — 눌러서 다시 저장 (" + (s.msg || "") + ")"] };
    const [ic, tip] = map[s.st] || ["", ""];
    if (s.st === "err") return `<button type="button" class="ck-st ck-st-err" data-st="${esc(sid)}" data-act="retry" data-ctx="${esc(ctxKey)}" title="${esc(tip)}">${ic} 다시 저장</button>`;
    return `<span class="ck-st ck-st-${s.st || "none"}" data-st="${esc(sid)}" title="${esc(tip)}">${ic}</span>`;
  }

  /* ── 칸 편집기 ── */
  const btns = (sid, field, opts, cur, extra = "") =>
    opts.map((o) => `<button type="button" class="ck-b${cur === o ? " on" : ""}" data-sid="${esc(sid)}" data-f="${field}" data-v="${esc(o)}"${extra}>${esc(o)}</button>`).join("");

  function cellHtml(sid, col, v) {
    const id = col.id, a = `data-sid="${esc(sid)}" data-cell="${esc(id)}" data-type="${esc(col.type)}"`;
    const num = (k, ph, val) => `<input class="ck-n" inputmode="numeric" pattern="[0-9]*" ${a} data-k="${k}" placeholder="${ph}" value="${val == null ? "" : esc(val)}">`;
    const pf = v && (v.pf === "P" || v.pf === "F") ? `<span class="ck-pf ck-${v.pf}">${v.pf}</span>` : "";
    switch (col.type) {
      case "voca": return `<div class="ck-cell">${num("n", "틀림", v?.n)}<span class="ck-u">/50</span>${pf}</div>`;
      case "rev": return `<div class="ck-cell">${num("n", "점수", v?.n)}<span class="ck-u">/100</span>${pf}</div>`;
      case "listen": return `<div class="ck-cell">${num("n", "맞음", v?.n)}<span class="ck-u">/</span>${num("of", "전체", v?.of)}</div>`;
      case "wrong": return `<div class="ck-cell">${num("n", "틀림", v?.n)}<span class="ck-u">/</span>${num("of", "전체", v?.of)}</div>`;
      case "test": return `<div class="ck-cell">${num("n", "맞음", v?.n)}<span class="ck-u">/</span>${num("of", "전체", v?.of)}`
        + `<button type="button" class="ck-b ck-sm${v?.pf === "P" ? " on" : ""}" ${a} data-pf="P">P</button><button type="button" class="ck-b ck-sm${v?.pf === "F" ? " on" : ""}" ${a} data-pf="F">F</button></div>`;
      case "rank3": return `<div class="ck-cell">${RANK3.map((o) => `<button type="button" class="ck-b ck-sm${v === o ? " on" : ""}" ${a} data-v="${o}">${o}</button>`).join("")}</div>`;
      case "have": case "give": {
        const [yes, no] = col.type === "give" ? ["수령", "미수령"] : ["O", "X"];
        return `<div class="ck-cell"><button type="button" class="ck-b ck-sm${v === "O" ? " on" : ""}" ${a} data-v="O">${yes}</button>`
          + `<button type="button" class="ck-b ck-sm ck-no${v === "X" ? " on" : ""}" ${a} data-v="X">${no}</button></div>`;
      }
      default: return "";
    }
  }

  /* ── 그리기 ── */
  function render() {
    if (!S.root) return;
    S.root.innerHTML = `<div class="ck">${headHtml()}${bodyHtml()}</div>`;
  }

  function headHtml() {
    const mon = S.week || iso(mondayOf(new Date()));
    const weeks = [-7, 0, 7].map((n) => addDays(iso(mondayOf(new Date())), n));
    const who = S.role === "principal" ? "원장 키" : S.role === "infodesk" ? "인포데스크 키" : S.role ? S.role : "";
    return `<div class="ck-top">
      <div class="ck-weeks">${weeks.map((w) => `<button type="button" class="ck-w${w === mon ? " on" : ""}" data-week="${w}">${dayLabel(w)} 주</button>`).join("")}</div>
      <div class="ck-key">${who ? `<span class="ck-who">✓ ${esc(who)}로 접속</span>` : ""}<button type="button" class="ck-link" data-act="key">접속 키 ${key() ? "바꾸기" : "넣기"}</button></div>
    </div>`;
  }

  function bodyHtml() {
    if (S.err === "nokey") return `<div class="ck-empty">원장님께 받은 <b>자동 로그인 링크</b>로 이 페이지를 한 번 열면 바로 보입니다(키를 외울 필요 없음). 키를 알면 오른쪽 위 <b>접속 키 넣기</b>로 넣어도 됩니다.</div>`;
    if (S.err === "badkey") return `<div class="ck-empty ck-bad">접속 키가 맞지 않습니다. <b>접속 키 바꾸기</b>로 다시 넣어 주세요.</div>`;
    if (S.err) return `<div class="ck-empty ck-bad">${esc(S.err)}</div>`;
    if (!S.week || (!S.plan && !S.role)) return `<div class="ck-empty">불러오는 중…</div>`;
    if (!S.plan) return `<div class="ck-empty">이 주의 체크표가 아직 올라오지 않았습니다. 원장께 요청하세요.</div>`;
    const day = S.plan.days.find((d) => d.date === S.date);
    const dayChips = S.plan.days.map((d) => `<button type="button" class="ck-chip${d.date === S.date ? " on" : ""}" data-date="${esc(d.date)}">${esc(dayLabel(d.date))}</button>`).join("");
    const clsChips = (day?.classes || []).map((c) => {
      const tag = c.kind === "off" ? "휴강" : c.kind === "notice" ? "안내" : `${c.students.length}명`;
      return `<button type="button" class="ck-chip ck-c ck-k-${c.kind}${c.key === S.classKey ? " on" : ""}" data-cls="${esc(c.key)}">${esc(c.label)}<small>${esc(tag)}</small></button>`;
    }).join("");
    const notes = (day?.notes || []).filter((n) => n.text).map((n) => `<div class="ck-note"><b>${esc(n.track)}</b> — ${esc(n.text)}</div>`).join("");
    return `<div class="ck-row">${dayChips}</div><div class="ck-row">${clsChips}</div>
      <details class="ck-notes"><summary>이날 전체 안내 보기</summary>${notes}</details>${tableHtml(day)}`;
  }

  function tableHtml(day) {
    const c = (day?.classes || []).find((x) => x.key === S.classKey);
    if (!c) return "";
    if (c.kind === "off") return `<div class="ck-empty">${esc(c.label)} — 이날은 수업이 없습니다. 모르고 온 학생은 자습 안내 후 학부모께 연락하세요.</div>`;
    if (c.kind === "notice") return `<div class="ck-empty">${esc(c.label)} — ${esc(c.note)}</div>`;
    const cols = c.groups.flatMap((g) => g.cols);
    const top = c.groups.map((g) => `<th colspan="${g.cols.length}">${esc(g.title)}</th>`).join("");
    const sub = cols.map((col) => `<th>${esc(col.sub)}</th>`).join("");
    const rows = c.students.map((sid) => `<tr data-row="${esc(sid)}">${rowCells(sid, c, cols)}</tr>`).join("");
    const kc = S.plan.keepcode?.[S.date]?.[c.key];   // 킵코드 수업계획(노션 읽기 전용 사본)
    const kcHtml = kc && (kc.progress || kc.homework)
      ? `<div class="ck-today ck-kc"><b>킵코드 수업계획</b> — ${esc(kc.progress)}${kc.homework ? ` · <b>과제</b> ${esc(kc.homework)}` : ""}</div>` : "";
    return `<div class="ck-meta">${esc(c.meta)}${kcHtml}${c.note ? `<div class="ck-today"><b>오늘</b> — ${esc(c.note)}</div>` : ""}${c.hw ? `<div class="ck-today"><b>숙제 검사</b> — ${esc(c.hw)}</div>` : ""}</div>
      <div class="ck-scroll"><table class="ck-t"><thead><tr><th rowspan="2" class="ck-name">학생</th><th rowspan="2">출석</th>${top}${c.hw ? '<th rowspan="2">숙제</th>' : ""}<th rowspan="2">비고</th></tr><tr class="ck-sub">${sub}</tr></thead>
      <tbody>${rows}</tbody></table></div>
      <div class="ck-foot">칸을 채우면 자동 저장됩니다(✓ 표시). 단어 P = 틀린 5개까지 · 복습 80점 이상 — 판정은 자동입니다.</div>`;
  }

  function rowCells(sid, c, cols) {
    const r = rowOf(sid), st = S.plan.students[sid] || { name: sid };
    const tag = c.tags?.[sid] ? `<div class="ck-tag">${esc(c.tags[sid])}</div>` : "";
    const dup = sid.includes("_") ? `<span class="ck-dup">${esc(st.school || sid.split("_")[1])}</span>` : "";
    return `<td class="ck-name">${esc(st.name)}${dup} ${statusHtml(sid)}${tag}</td>`
      + `<td><div class="ck-att">${btns(sid, "att", ATT, r.att)}</div></td>`
      + cols.map((col) => `<td>${cellHtml(sid, col, r.cells?.[col.id])}</td>`).join("")
      + (c.hw ? `<td><div class="ck-cell">${btns(sid, "hw", HW, r.hw, ' data-small="1"')}</div></td>` : "")
      + `<td><input class="ck-memo" data-sid="${esc(sid)}" maxlength="300" placeholder="미통과·이월·문자 등" value="${esc(r.memo || "")}"></td>`;
  }

  function paintRow(sid) {
    const tr = S.root?.querySelector(`tr[data-row="${CSS.escape(sid)}"]`);
    if (!tr) return;
    const day = S.plan.days.find((d) => d.date === S.date);
    const c = day.classes.find((x) => x.key === S.classKey);
    const html = rowCells(sid, c, c.groups.flatMap((g) => g.cols));
    const focus = document.activeElement;
    const keep = focus && tr.contains(focus) && focus.tagName === "INPUT" ? focus.closest("td") : null;
    if (!keep) { tr.innerHTML = html; return; }
    /* 입력 중인 칸(커서)은 그대로 두고 나머지 칸만 새로 — 그 칸 밖의 판정 배지는 바로 보인다 */
    const tmp = document.createElement("tbody");
    tmp.innerHTML = `<tr>${html}</tr>`;
    const fresh = [...tmp.firstElementChild.children];
    [...tr.children].forEach((td, i) => { if (td !== keep && fresh[i]) td.replaceWith(fresh[i]); });
  }

  /* ── 이벤트 ── */
  function onClick(e) {
    const b = e.target.closest("button");
    if (!b || !S.root.contains(b)) return;
    if (b.dataset.week) { load(b.dataset.week); return; }
    if (b.dataset.date) { S.date = b.dataset.date; pickDefaultClass(); render(); return; }
    if (b.dataset.cls) { S.classKey = b.dataset.cls; render(); return; }
    if (b.dataset.act === "key") { askKey(); return; }
    if (b.dataset.act === "retry") { retry(b.dataset.ctx); return; }
    const sid = b.dataset.sid;
    if (!sid) return;
    const cur = rowOf(sid);
    if (b.dataset.f === "att" || b.dataset.f === "hw") {
      const v = cur[b.dataset.f] === b.dataset.v ? null : b.dataset.v;   // 같은 버튼 다시 누르면 지움
      setLocal(sid, { [b.dataset.f]: v }); queueSave(sid, { [b.dataset.f]: v }); paintRow(sid); return;
    }
    if (b.dataset.cell) {
      const id = b.dataset.cell, old = cur.cells?.[id];
      let v;
      if (b.dataset.pf) { const base = old && typeof old === "object" ? old : {}; v = base.pf === b.dataset.pf ? { ...base, pf: undefined } : { ...base, pf: b.dataset.pf }; if (v.pf === undefined) delete v.pf; if (!Object.keys(v).length) v = null; }
      else v = old === b.dataset.v ? null : b.dataset.v;
      setLocal(sid, { cells: { [id]: v } }); queueSave(sid, { cells: { [id]: v } }); paintRow(sid);
    }
  }

  function onInput(e) {
    const el = e.target;
    const sid = el.dataset.sid;
    if (!sid) return;
    if (el.classList.contains("ck-memo")) { setLocal(sid, { memo: el.value }); queueSave(sid, { memo: el.value.trim() || null }); return; }
    if (!el.dataset.cell) return;
    el.value = el.value.replace(/[^0-9]/g, "").slice(0, 3);
    const id = el.dataset.cell, type = el.dataset.type, old = rowOf(sid).cells?.[id];
    /* 한 칸에 입력이 둘(개수 / 전체)인 경우 — 형제 입력을 함께 읽는다.
       ⚠ 전체를 먼저 넣고 개수를 나중에 넣으면 전체가 사라지던 버그(9/22 로컬 검증에서 발견). */
    const base = old && typeof old === "object" ? { ...old } : {};
    el.closest(".ck-cell").querySelectorAll("input.ck-n").forEach((x) => {
      if (x.value === "") delete base[x.dataset.k]; else base[x.dataset.k] = Number(x.value);
    });
    if (type === "voca" || type === "rev") delete base.pf;   // 숫자가 있으면 판정은 서버가
    const v = Object.keys(base).length ? base : null;
    setLocal(sid, { cells: { [id]: v } });
    /* 전체만 있고 개수가 없으면 서버엔 "빈칸" — 화면엔 전체를 남기고 서버의 옛 개수는 지운다
       (⚠ 예전엔 저장을 건너뛰어 7/10에서 7을 지워도 서버에 7/10이 남았다) */
    const toServer = v && v.n == null && (type === "wrong" || type === "listen") ? null : v;
    queueSave(sid, { cells: { [id]: toServer } });
  }

  function askKey() {
    const k = prompt("접속 키를 넣어 주세요.\n키를 모르면 원장님께 받은 「자동 로그인 링크」로 이 페이지를 한 번 열면 됩니다(키 입력 불필요).", "");
    if (k == null) return;
    ls.set(LS_KEY, k.trim());
    load(S.week || iso(mondayOf(new Date())));
  }

  const CSS_TEXT = `
  .ck{font-size:14px}
  .ck-top{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center;margin-bottom:10px}
  .ck-weeks,.ck-row{display:flex;flex-wrap:wrap;gap:6px}
  .ck-row{margin:8px 0}
  .ck-w,.ck-chip{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 14px;font:inherit;cursor:pointer;min-height:40px}
  .ck-w.on,.ck-chip.on{background:var(--navy,#1e3a5f);border-color:var(--navy,#1e3a5f);color:#fff}
  .ck-chip small{display:block;font-size:11px;opacity:.8}
  .ck-c{border-radius:10px;text-align:left}
  .ck-k-off:not(.on){color:var(--muted);background:#f3f4f6}
  .ck-k-notice:not(.on){border-style:dashed}
  .ck-key{display:flex;gap:8px;align-items:center}
  .ck-who{color:var(--ok);font-weight:600}
  .ck-link{background:none;border:0;color:var(--info,#2563eb);text-decoration:underline;cursor:pointer;font:inherit;min-height:40px}
  .ck-empty{padding:28px 16px;text-align:center;color:var(--muted);background:var(--card);border:1px dashed var(--line);border-radius:12px}
  .ck-bad{color:var(--danger);border-color:var(--danger)}
  .ck-notes{margin:6px 0 10px;color:var(--muted)} .ck-notes summary{cursor:pointer;min-height:32px}
  .ck-note{margin:6px 0;line-height:1.6}
  .ck-meta{background:var(--brand-soft,#fdfbf5);border:1px solid var(--brand-line,#e3d7b4);border-radius:10px;padding:10px 12px;margin-bottom:8px;line-height:1.6}
  .ck-today{margin-top:4px}
  .ck-kc{padding-top:4px;border-top:1px dashed var(--brand-line,#e3d7b4);color:var(--navy,#1e3a5f)}
  .ck-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:10px;background:var(--card)}
  .ck-scroll .ck-t{display:table!important;border-collapse:collapse;min-width:100%;width:max-content;overflow:visible}
  .ck-t th,.ck-t td{border-bottom:1px solid var(--line);border-right:1px solid var(--line);padding:6px;vertical-align:middle;text-align:center}
  .ck-t thead th{background:var(--navy,#1e3a5f);color:#fff;font-weight:600;font-size:12.5px;line-height:1.35;min-width:96px;max-width:200px;white-space:normal}
  .ck-t .ck-sub th{background:#2f5586;font-weight:500}
  .ck-t td.ck-name,.ck-t th.ck-name{position:sticky;left:0;background:var(--card);text-align:left;white-space:nowrap;z-index:1;min-width:92px}
  .ck-t th.ck-name{background:var(--navy,#1e3a5f)}
  .ck-dup{margin-left:4px;font-size:11px;color:var(--brand-ink);border:1px solid var(--brand-line,#e3d7b4);border-radius:6px;padding:0 4px}
  .ck-tag{font-size:11px;color:var(--muted);white-space:normal;max-width:160px}
  .ck-att,.ck-cell{display:flex;gap:4px;align-items:center;justify-content:center;flex-wrap:nowrap}
  .ck-att{display:grid;grid-template-columns:repeat(3,62px);gap:4px}
  .ck-b{border:1px solid var(--line);background:#fff;border-radius:8px;padding:0 10px;min-height:40px;min-width:44px;font:inherit;cursor:pointer}
  .ck-b.ck-sm{min-width:40px;padding:0 8px}
  .ck-b.on{background:var(--navy,#1e3a5f);color:#fff;border-color:var(--navy,#1e3a5f)}
  .ck-b.ck-no.on{background:var(--danger);border-color:var(--danger)}
  .ck-n{width:52px;min-height:40px;border:1px solid var(--line);border-radius:8px;text-align:center;font:inherit;font-size:16px}
  .ck-u{color:var(--muted);font-size:12px}
  .ck-pf{font-weight:700;border-radius:6px;padding:2px 6px;font-size:12px}
  .ck-P{background:var(--ok-bg,#ecfdf5);color:var(--ok)} .ck-F{background:var(--danger-bg,#fef2f2);color:var(--danger)}
  .ck-memo{min-width:180px;width:100%;min-height:40px;border:1px solid var(--line);border-radius:8px;padding:0 8px;font:inherit;font-size:16px}
  .ck-st{display:inline-block;min-width:16px;font-weight:700;background:none;border:0;font:inherit}
  button.ck-st-err{border:1px solid var(--danger);border-radius:8px;padding:2px 8px;min-height:32px;cursor:pointer}
  .ck-st-ok{color:var(--ok)} .ck-st-err{color:var(--danger)} .ck-st-saving,.ck-st-wait{color:var(--muted)}
  .ck-foot{margin-top:8px;color:var(--muted);font-size:12.5px}
  @media (max-width:640px){.ck-w,.ck-chip{padding:8px 10px}}`;
  function injectCss() {
    if (document.getElementById("ck-style")) return;
    const st = document.createElement("style"); st.id = "ck-style"; st.textContent = CSS_TEXT;
    document.head.appendChild(st);
  }

  function mount(el) {
    if (!el) return;
    injectCss();
    if (S.root !== el) {
      S.root = el;
      el.addEventListener("click", onClick);
      el.addEventListener("input", onInput);
    }
    if (!S.week) load(iso(mondayOf(new Date())));
    else render();
  }

  /* 자동 로그인 링크 — admin.html?k=<키>&tab=chk
     원장·인포가 키를 몰라도 되게 한다(인포데스크 앱과 같은 방식). 키는 이 기기에 저장하고 주소창에서 즉시 지운다
     — 주소에 남으면 방문 기록·화면 공유로 새기 때문이다. 키 자체를 없애지 않는 이유: 이 페이지는 공개 주소라
     키가 없으면 누구나 학생 기록을 보고 고칠 수 있다. */
  (function autoLogin() {
    const u = new URL(location.href);
    const k = u.searchParams.get("k");
    if (k) {
      ls.set(LS_KEY, k.trim());
      u.searchParams.delete("k");
      history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
    }
    if (u.searchParams.get("tab") === "chk") {
      const open = () => document.querySelector('[data-tab="chk"]')?.click();
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", open); else setTimeout(open, 0);
    }
  })();

  window.addEventListener("beforeunload", (e) => {   // 저장 안 된 입력이 있으면 한 번 붙잡는다
    if (unsaved()) { e.preventDefault(); e.returnValue = ""; }
  });

  window.DaolChk = { mount, _state: S };
})();
