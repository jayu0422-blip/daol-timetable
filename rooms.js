/* 다올105 — 강의실 자동배정 (admin.html 에서 그대로 옮김, 2026-09-20)
 *
 * 한 곳에 둔 이유: 요일별·강의실 탭(admin.html)과 시험기간 전체 일정표(exam-period.html), 나중의 TV 표시 페이지가
 * 같은 배정 규칙을 써야 한다. 규칙을 고칠 땐 이 파일만 고친다.
 *
 * 전제(호출하는 페이지가 전역으로 선언): let DATA = [강좌…]  /  const GRADE_ORDER = [...]
 * 내보내는 전역: ROOMS, CLASS_ROOMS, GRID_ROOMS, SUBJ_COLOR, TEACHER_ROOM_RULE, SESSION_SPLITS,
 *   korToMin, extractDays, parseDayTimes, orderByPref, ruleRoom, ovl, fitCheck, assignDay, splitRoom, layoutRoom, roomOptions,
 *   dayGridHTML(opts) — 요일 그리드 HTML (평소 + 시험기간 덧입히기)
 */
const ROOMS=[
  {key:"본관1",label:"1강의실",bldg:"다올105"},
  {key:"본관2",label:"2강의실",bldg:"다올105"},
  {key:"본관3",label:"3강의실",bldg:"다올105"},
  {key:"스터디홀",label:"스터디홀",bldg:"다올105"},
  {key:"복도",label:"복도테이블",bldg:"다올105"},
  {key:"상담실",label:"상담실",bldg:"다올105"},
  {key:"대치1",label:"대치더올 1강의실",bldg:"대치더올"},
  {key:"대치2",label:"대치더올 2강의실",bldg:"대치더올"},
  {key:"대치클리닉",label:"대치더올 클리닉룸",bldg:"대치더올"}
];
const CLASS_ROOMS=ROOMS.filter(r=>!r.testOnly);
function korToMin(str){ const m=String(str).match(/(오전|오후)\s*(\d{1,2})시(?:\s*(\d{1,2})분)?/); if(m){ let h=(+m[2])%12; if(m[1]==="오후") h+=12; return h*60+(m[3]?+m[3]:0); } return null; }
// 요일 추출 (단어 속 글자 오인식 방지: "수업"의 수, "목표"의 목 제외)
function extractDays(seg){
  const set=new Set();
  (seg.match(/[월화수목금토일]요일/g)||[]).forEach(m=>set.add(m[0]));          // 화요일 → 화
  (seg.match(/[월화수목금토일]{2,}/g)||[]).forEach(run=>{ for(const ch of run) set.add(ch); }); // 월수금, 화목토
  for(let i=0;i<seg.length;i++){ const ch=seg[i]; if("월화수목금토일".includes(ch)){ const nxt=seg[i+1]||"", prev=seg[i-1]||""; if(!/[가-힣]/.test(nxt)&&!/[가-힣]/.test(prev)) set.add(ch); } } // 단독 요일: 앞뒤가 한글이 아님
  return [...set];
}
function parseDayTimes(text){
  const out=[]; let hadTime=false, failedAny=false;
  String(text||"").split(/\n|\//).forEach(seg=>{
    seg=seg.trim(); if(!seg) return;
    const days=extractDays(seg); if(!days.length) return;
    const type=/클리닉/.test(seg)?"클리닉":(/관리/.test(seg)?"관리":(/직보/.test(seg)?"직보":"정규"));
    let s=null,e=null;
    let m=seg.match(/(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/);
    if(m){ s=(+m[1])*60+(+m[2]); e=(+m[3])*60+(+m[4]); }
    else{
      const parts=seg.split(/[~\-–]/);
      if(parts.length>=2){ const a=korToMin(parts[0]),b=korToMin(parts[1]); if(a!=null&&b!=null){ s=a; e=b; } }
      if(s==null){ const m2=seg.match(/(\d{1,2}):(\d{2})/); if(m2){ s=(+m2[1])*60+(+m2[2]); } else { const a=korToMin(seg); if(a!=null) s=a; } if(s!=null) e=s+120; }
      if(s==null){ const m3=seg.match(/(\d{1,2})\s*[-~]\s*(\d{1,2})\s*시/); if(m3){ let h1=+m3[1],h2=+m3[2]; if(h1<12)h1+=12; if(h2<12)h2+=12; s=h1*60; e=h2*60; } }
    }
    if(s==null){ failedAny=true; return; }
    if(e==null||e<=s) e=s+120;
    hadTime=true; days.forEach(d=>out.push({day:d,start:s,end:e,type}));
  });
  return {sessions:out, ok:hadTime, failed:failedAny&&!hadTime};
}
function orderByPref(teacher,day,rooms){
  let pref=[];
  if(teacher==="윤재영") pref=["본관2","본관3","스터디홀","상담실","본관1"];   // 중등영어: 2강의실 우선, 넘치면 3강의실·스터디홀·상담실
  else if(teacher==="이정관") pref=["본관2"];
  else if(teacher==="황웅") pref=["본관1","본관3","스터디홀","본관2"];      // 정규 1강 · 클리닉 3강
  else if(teacher==="민귀홍") pref=["본관1","본관2","본관3","스터디홀"];   // 정규 1강 · 클리닉 2강
  else if(teacher==="김영하"&&day==="토") pref=["본관3"];
  else if(teacher==="유용권") pref=["대치2","대치1","대치클리닉","본관1","본관3","스터디홀","본관2"]; // 대치2 우선; 다올105로 밀리면 1강의실(수업)·3강·스터디홀(관리)
  else if(teacher==="임결") pref=["대치1","대치2","대치클리닉","본관2","본관3","스터디홀","본관1"];   // 대치1 우선
  return [...pref.filter(r=>rooms.includes(r)), ...rooms.filter(r=>!pref.includes(r))];
}
// 강사별 「정규 / 클리닉」 고정 강의실 — 학년이 달라도 절대 한 방에 섞이지 않게 (원장 규칙 2026-08-28)
// 값은 강의실 이름이거나 {요일:강의실} — 민귀홍 클리닉처럼 요일마다 방이 다른 경우가 있다
const TEACHER_ROOM_RULE={
  "황웅":  {"정규":"본관1","클리닉":"본관3"}
  // 민귀홍은 강좌·요일마다 방이 달라(목 미강고1=1강 / 미강고2=3강, 일 미강고2=1강 / 미강고1=2강)
  // 규칙으로 묶지 않고 강좌별 수동 지정에 맡긴다. 두 강좌 모두 지정이 있어 통합 병합에 덮이지 않는다.
};
function ruleRoom(it,day){
  const r=TEACHER_ROOM_RULE[it.c.teacher]; if(!r) return null;
  const v=r[it.s.type];
  return (v && typeof v==="object") ? (v[day]||null) : (v||null);
}
function ovl(a,b){ return a.start<b.end && b.start<a.end; }
function fitCheck(list, rooms, occ, day){
  const sim={}; rooms.forEach(r=>sim[r]=[...(occ[r]||[])]);
  for(const it of list){ if((it.c.room_overrides||{})[day]) continue; let ok=false; for(const r of rooms){ if(!sim[r].some(x=>ovl(x,it.s))){ sim[r].push(it.s); ok=true; break; } } if(!ok) return false; }
  return true;
}
function assignDay(day){
  const items=[], unparsed=[];
  DATA.forEach(c=>{ if(!(c.course_name||"").trim()) return;
    const p=parseDayTimes(c.schedule_text); if(p.failed) unparsed.push(c);
    p.sessions.filter(s=>s.day===day).forEach(s=>{
      const sp=SESSION_SPLITS.find(x=>x.days.includes(day)&&x.match(c)&&s.start<x.at&&s.end>x.at);
      if(sp){ items.push({c,s:{...s,end:sp.at},forced:splitRoom(sp.roomBefore,day)});
              items.push({c,s:{...s,start:sp.at},forced:splitRoom(sp.roomAfter,day)}); }
      else items.push({c,s});
    }); });
  const occ={}; CLASS_ROOMS.forEach(r=>occ[r.key]=[]);
  const DACI=["대치1","대치2","대치클리닉"], BON=["본관1","본관2","본관3","스터디홀","상담실"];
  const byT={}; items.forEach(it=>{ (byT[it.c.teacher]=byT[it.c.teacher]||[]).push(it); });
  const prio=t=> t==="임결"?0 : t==="유용권"?1 : 2;      // 대치더올 우선권: 임결 > 유용권
  Object.keys(byT).sort((a,b)=> prio(a)-prio(b) || a.localeCompare(b,"ko")).forEach(tch=>{
    const list=byT[tch].sort((a,b)=> a.s.start-b.s.start || (GRADE_ORDER.indexOf(a.c.grade)-GRADE_ORDER.indexOf(b.c.grade)) || ((a.s.type==="정규"?0:1)-(b.s.type==="정규"?0:1)));
    const sci=list.some(it=>it.c.subject==="수학"||it.c.subject==="과학");
    // (B) 같은 관 보장: 우선건물에 이 강사 전 세션이 다 들어가면 그 건물, 아니면 통째로 다른 건물로
    let primaryRooms;
    if(sci){ const daciPref=orderByPref(tch,day,DACI); primaryRooms = (tch==="임결"||fitCheck(list,daciPref,occ,day)) ? daciPref : orderByPref(tch,day,BON); }
    else primaryRooms=orderByPref(tch,day,BON);
    const otherRooms=CLASS_ROOMS.map(r=>r.key).filter(k=>!primaryRooms.includes(k));
    list.forEach(it=>{
      if(it.forced){ it.room=it.forced; occ[it.forced]&&occ[it.forced].push(it.s); return; }  // 세션 분할 강제 강의실
      // (A) 강사 규칙 > 수동 지정 > 자동 배정. 지정이 있으면 통합 병합으로 덮이지 않는다
      const ov=ruleRoom(it,day) || (it.c.room_overrides||{})[day];
      if(!ov){
        // 무학년 통합반(같은 강사·과목·시간) → 이미 배정된 같은 방을 공유. 충돌 아님
        const twin=list.find(x=>x!==it && x.room && x.c.subject===it.c.subject && x.s.start===it.s.start && x.s.end===it.s.end);
        if(twin){ it.room=twin.room; it.merged=true; return; }
      }
      let chosen=null;
      if(ov && occ[ov]){ chosen=ov; if(occ[ov].some(x=>ovl(x,it.s))) it.conflict=true; }
      else{
        for(const rk of [...primaryRooms, ...otherRooms]){
          if(occ[rk] && !occ[rk].some(x=>ovl(x,it.s))){ chosen=rk; if(!primaryRooms.includes(rk)) it.spill=true; break; }
        }
        if(!chosen){ chosen=primaryRooms[0]||"본관1"; it.conflict=true; }
      }
      it.room=chosen; occ[chosen].push(it.s);
    });
    // (C) 동시 복수반 → 수업실 1 + 관리실 N
    list.forEach(base=>{
      const grp=list.filter(x=>ovl(x.s,base.s));
      if(grp.length>=2){
        // 같은 강사·같은 과목·시간까지 완전히 동일 → 무학년 통합반(한 수업). 수업실/관리실로 나누지 않음
        const merged = grp.every(x=>x.c.subject===grp[0].c.subject && x.s.start===grp[0].s.start && x.s.end===grp[0].s.end
                                 && x.room===grp[0].room);   // 방이 다르면 통합반이 아니다
        if(merged){ grp.forEach(x=>x.roomRole="통합(무학년)"); return; }
        grp.forEach(x=>{ if(x.s.type==="클리닉"||x.s.type==="관리") x.roomRole="관리실"; });
        const reg=grp.filter(x=>x.s.type==="정규"||x.s.type==="직보").sort((a,b)=>GRADE_ORDER.indexOf(a.c.grade)-GRADE_ORDER.indexOf(b.c.grade));
        if(reg.length>=2) reg.forEach((x,idx)=>{ x.roomRole=idx===0?"수업실":"관리실"; });
      }
    });
  });
  items.sort((a,b)=>a.s.start-b.s.start);
  return {items, unparsed};
}
const SUBJ_COLOR={국어:"#fbcfe8",영어:"#bfdbfe",수학:"#fed7aa",과학:"#ddd6fe",사회:"#bbf7d0",기타:"#e5e7eb"};
const GRID_ROOMS=ROOMS;   // 복도테이블도 실제로 수업을 하는 자리라 그리드·배정 모두에 들어간다
// 한 수업이 중간에 방을 옮기는 경우(그리드에서만 분할, 데이터는 1강좌 유지)
// 한 수업이 도중에 강의실을 옮기는 경우. roomBefore/roomAfter 는 문자열이거나
// {요일:강의실} 객체 — 요일마다 옮겨 갈 방이 다를 수 있다.
const SESSION_SPLITS=[
  // 화요일 — 하남고1 클리닉은 6:30~8시를 복도테이블에서 하고, 8시에 중1 A반이
  // 스터디홀에서 빠지면 스터디홀로 옮긴다. (하남중3·미사중3은 토·일 1:1로 빠졌다 — 2026-09-05)
  { days:["화"], at:20*60, roomBefore:"복도", roomAfter:"스터디홀",
    match:c=>c.teacher==="윤재영" && (c.course_name||"").includes("하남고1") }
];
function splitRoom(v,day){ return (v && typeof v==="object") ? (v[day]||null) : v; }
// 같은 강의실에 겹치는 블록 → 좌우 분할(합반/통합관리 시각화)
function layoutRoom(blks){
  blks.sort((a,b)=>a.start-b.start||a.end-b.end);
  const laneEnd=[];
  blks.forEach(b=>{ let i=0; for(;i<laneEnd.length;i++){ if(laneEnd[i]<=b.start) break; } b.lane=i; laneEnd[i]=b.end; });
  blks.forEach(b=>{ const grp=blks.filter(x=>x.start<b.end&&b.start<x.end); b.cols=Math.max(0,...grp.map(x=>x.lane))+1; });
}
function roomOptions(selKey){ return ['<option value="">자동</option>', ...CLASS_ROOMS.map(r=>`<option value="${r.key}" ${r.key===selKey?"selected":""}>${r.label}</option>`)].join(""); }

/* ===== 요일 그리드 HTML =====
   opts: { day:"월", title, items(assignDay 결과), temps(DaolExamOps.blocksFor), offIds(Set — 그 날 휴강 강좌 id), allOff(bool — 전체 휴강일), note }
   admin.html 의 renderDay 와 exam-period.html 이 같은 함수를 쓴다. */
const RM_esc = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;");
const RM_fmt = m => String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
function dayGridHTML(opts){
  const items = opts.items||[], temps = opts.temps||[], offIds = opts.offIds||new Set(), keepIds = opts.keepIds||new Set(), allOff = !!opts.allOff;
  const cols=GRID_ROOMS, START=10*60, END=22*60, PX=1.0, H=(END-START)*PX;
  const gc=`54px repeat(${cols.length},1fr)`;
  let html=`<div class="day-title">${RM_esc(opts.title||("2026 다올105 · "+opts.day+"요일 시간표 (강의실 배정)"))}</div>`;
  if(opts.note) html+=`<div class="day-note">${opts.note}</div>`;
  html+=`<div class="rgrid" style="grid-template-columns:${gc}">`;
  html+=`<div class="rg-head" style="border-left:none"></div>`+cols.map(r=>`<div class="rg-head ${r.bldg==="대치더올"?"b대치":""}">${r.label}</div>`).join("");
  html+=`<div style="grid-column:1 / -1;display:grid;grid-template-columns:${gc};position:relative">`;
  html+=`<div class="rg-timecol" style="height:${H}px">`;
  for(let t=START;t<=END;t+=60) html+=`<div class="rg-time" style="top:${(t-START)*PX}px">${String(Math.floor(t/60)).padStart(2,"0")}:00</div>`;
  html+=`</div>`;
  cols.forEach(r=>{
    html+=`<div class="rg-body" style="height:${H}px">`;
    for(let t=START;t<=END;t+=60) html+=`<div class="rg-line" style="top:${(t-START)*PX}px"></div>`;
    let blks=items.filter(it=>it.room===r.key).map(it=>({start:it.s.start,end:it.s.end,type:it.s.type,role:it.roomRole,name:it.c.course_name,teacher:it.c.teacher,subj:it.c.subject,conflict:it.conflict,kind:"class",off:it.off!=null?it.off:((allOff&&!keepIds.has(it.c.id))||offIds.has(it.c.id)),overridden:it.overridden}));
    temps.filter(b=>b.room===r.key).forEach(b=>blks.push({start:b.start,end:b.end,type:b.type,name:b.name,teacher:b.teacher,subj:b.subj,conflict:b.conflict,kind:"temp",suggested:b.suggested}));
    layoutRoom(blks);
    blks.forEach(b=>{
      const st=Math.max(b.start,START), en=Math.min(b.end,END), top=(st-START)*PX, h=Math.max((en-st)*PX,26);
      const L=(b.lane/b.cols*100), W=(100/b.cols);
      const pos=`top:${top}px;height:${h}px;left:calc(${L}% + 2px);width:calc(${W}% - 4px);right:auto`;
      if(b.kind==="retest") html+=`<div class="rblk" style="${pos};background:#fee2e2;border:1px dashed #f87171"><div class="rt">${RM_esc(b.name)}</div><div class="rteam">재시 ${RM_fmt(b.start)}~${RM_fmt(b.end)}</div></div>`;
      else if(b.kind==="temp") html+=`<div class="rblk temp ${b.conflict?"conflict":""}" style="${pos}"><div class="rt">${RM_esc(b.name)}</div><div class="rteam">[${RM_esc(b.teacher)}T] <span class="rtype" style="background:#fde68a">시험기간 ${RM_esc(b.type)}</span>${b.suggested?'<span class="rtype" style="background:#fee2e2">방 미확정</span>':''}</div><div class="rteam">${RM_fmt(b.start)}~${RM_fmt(b.end)}</div></div>`;
      else { const col=SUBJ_COLOR[b.subj]||"#e5e7eb", role=b.role?`<span class="rtype" style="background:#fde68a">${b.role}</span>`:"", ovd=b.overridden?`<span class="rtype" style="background:#bae6fd">이날만 지정</span>`:""; html+=`<div class="rblk ${b.conflict?"conflict":""}${b.off?" off":""}" style="${pos};background:${col}"><div class="rt">${RM_esc(b.name)}</div><div class="rteam">[${RM_esc(b.teacher)}T] <span class="rtype">${b.type}</span>${role}${ovd}</div><div class="rteam">${RM_fmt(b.start)}~${RM_fmt(b.end)}</div></div>`; }
    });
    html+=`</div>`;
  });
  html+=`</div></div>`;
  return html;
}
/* 독립 페이지(exam-period.html 등)용 그리드 CSS — admin.html 은 자기 CSS 를 쓴다 */
const DAOL_ROOM_GRID_CSS = `
.day-title{text-align:center;font-size:22px;font-weight:800;padding:14px;background:linear-gradient(90deg,#fff7ed,#ffedd5)}
.day-note{padding:8px 14px;font-size:12.5px;color:#7c2d12;background:#fffbeb;border-bottom:1px solid #fde68a}
.rgrid{display:grid;min-width:820px;background:#fff}
.rg-head{font-weight:800;font-size:12.5px;text-align:center;padding:9px 4px;border-left:1px solid #e5e7eb;border-bottom:2px solid #374151;background:#f8fafc}
.rg-head.b대치{background:#efe7dd}
.rg-body{position:relative;border-left:1px solid #e5e7eb}
.rg-timecol{position:relative;border-left:none}
.rg-time{position:absolute;left:0;right:0;text-align:right;padding-right:6px;font-size:11px;color:#6b7280;transform:translateY(-6px)}
.rg-line{position:absolute;left:0;right:0;border-top:1px solid #eef0f3}
.rblk{position:absolute;left:2px;right:2px;border-radius:7px;padding:4px 6px;font-size:11px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.12);border:1px solid rgba(0,0,0,.06)}
.rblk .rt{font-weight:800;font-size:11.5px;line-height:1.15}
.rblk .rteam{font-size:10px;opacity:.85}
.rblk .rtype{display:inline-block;font-size:9px;font-weight:800;border-radius:3px;padding:0 3px;background:rgba(255,255,255,.55)}
.rblk.conflict{outline:2px solid #dc2626;outline-offset:-2px}
.rblk.temp{border:2px dashed #d97706!important;background:repeating-linear-gradient(135deg,#fef3c7 0 6px,#fde68a 6px 12px)!important}
.rblk.temp.conflict{border-color:#dc2626!important}
.rblk.off{opacity:.38;filter:grayscale(.6)}
.rblk.off .rt::after{content:" · 휴강";color:#b91c1c;font-weight:900}
`;
