/* ===== 다올105 수강료 엔진 (공유 모듈) =====
 * 학원 수강료 규칙의 단일 소스. admin/view/board 어디서 계산하든 값이 동일하도록.
 * ※ admin.html 은 현재 자체 내장 사본을 씀(라이브 안정성). 규칙 변경 시 이 파일과 함께 맞춰주세요.
 * 사용: <script src="prices.js"></script>  →  window.DaolPrice.rule(course)
 */
(function (w) {
  "use strict";

  var GRADE_ORDER = ["중1", "중2", "중3", "중등공통", "고1", "고2", "고3/수능"];
  var SUBJECT_ORDER = ["국어", "영어", "수학", "과학", "사회", "기타"];

  function parseSess(s) { var m = String(s || "").match(/총\s*(\d+)\s*회/); return m ? +m[1] : null; }
  function ggf(g) { return (/고3|수능/.test(g || "")) ? "고3" : g; }

  // 규칙 기반 수강료. admin.html 의 rulePrice 와 동일 로직.
  function rule(c) {
    var div = c.division, grade = c.grade, subj = c.subject, ctype = c.course_type,
        teacher = c.teacher, sched = c.schedule_text;
    var G = ggf(grade);
    if (ctype === "특강") {
      if (teacher === "유용권") { var s = parseSess(sched); return { sessions: s, tuition: 360000, note: "방학특강 · 기본 360,000원 · 재원생(타과목 포함) 20%할인 시 288,000원" + (s ? (" · 총 " + s + "회") : "") }; }
      if (teacher === "임결") { var s2 = c.sessions; return s2 ? { sessions: s2, tuition: s2 * 50000, note: "특강 회당 50,000원 · 총 " + s2 + "회 · [옵션] 온라인강의+현장클리닉 월 100,000원(클리닉 일정 선생님과 소통)" } : { sessions: null, tuition: null, note: "특강 기간·회차·수강료 미정 (강사 확인 대기)" }; }
      if (subj === "국어") return { sessions: 4, tuition: 290000, note: "국어특강 · 주1회 4회차 기준(방학 4회)" };
      return { sessions: null, tuition: null, note: "특강 기간·회차·수강료 미정 (강사 확인 대기)" };
    }
    if (div === "중등") { var m = { 국어: 200000, 영어: 320000, 수학: 360000, 과학: 200000 }; return (subj in m) ? { sessions: null, tuition: m[subj], note: "중등 " + subj + " 월수강료" } : { sessions: null, tuition: null, note: "중등 수강료 미지정" }; }
    if (div === "고등") {
      if (subj === "국어") { var b = { 고1: 290000, 고2: 290000, 고3: 340000 }[G]; return b ? { sessions: 4, tuition: b, note: "고등국어 회차수강료 · 주1회 4회차 기준", base: b, baseSess: 4 } : { sessions: null, tuition: null, note: "미지정" }; }
      if (subj === "영어") { if (G === "고3") return { sessions: 4, tuition: 390000, note: "고등영어 회차수강료 · 주1회 4회차(정규만, 클리닉 제외) · 최대 450,000원", base: 390000, baseSess: 4 }; return { sessions: 4, tuition: 360000, note: "고등영어 회차수강료 · 주1회 4회차(정규만, 클리닉 제외)", base: 360000, baseSess: 4 }; }
      if (subj === "수학") { var b2 = { 고1: [400000, 10], 고2: [420000, 10], 고3: [450000, 8] }[G]; if (b2) return { sessions: b2[1], tuition: b2[0], note: "고등수학 · " + b2[1] + "회차 기준 · 초과 시 동일, 미달 시 (기준액÷" + b2[1] + ")×부족회차 차감", base: b2[0], baseSess: b2[1] }; return { sessions: null, tuition: null, note: "고등수학 수강료 미지정" }; }
    }
    return { sessions: null, tuition: null, note: "수강료 미지정" };
  }

  function prorate(base, baseSess, actual) {
    if (base == null || baseSess == null || actual == null || actual === "") return null;
    actual = +actual; if (actual >= baseSess) return base;
    return base - Math.round(base / baseSess) * (baseSess - actual);
  }

  // 표시용 수강료: 저장된 값(admin에서 확정) 우선, 없으면 규칙값.
  function display(c) {
    if (c.tuition != null && c.tuition !== "") return { tuition: c.tuition, note: c.tuition_note || "", sessions: c.sessions };
    var r = rule(c);
    return { tuition: r.tuition, note: c.tuition_note || r.note, sessions: c.sessions != null ? c.sessions : r.sessions };
  }

  function won(n) { return (n == null || n === "") ? "" : Number(n).toLocaleString("ko-KR"); }

  w.DaolPrice = { rule: rule, prorate: prorate, display: display, won: won, parseSess: parseSess, ggf: ggf, GRADE_ORDER: GRADE_ORDER, SUBJECT_ORDER: SUBJECT_ORDER };
})(window);
