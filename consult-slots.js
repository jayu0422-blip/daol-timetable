/* ===== 다올105 상담 가용 시간 — 단 하나의 원본 =====
 *
 * 이 파일만 고치면 두 화면이 함께 바뀐다.
 *   · booking.html  학부모가 직접 신청하는 예약 페이지
 *   · ops-cal.js    admin.html 대시보드 월간 일정표(원장·데스크)
 * 예전에는 두 곳이 각자 시각을 들고 있어서, 달력에서 연 시간과 예약 페이지가 보여 주는
 * 시간이 서로 달랐다. 그 상태로 학부모가 신청하면 원장이 없는 시간에 상담이 잡힌다.
 *
 * ── 규칙 (2026-09-03 원장 확정) ────────────────────────────
 *   월·화·수·목   22:00 한 타임          ※ 학기 중에만. 여름·겨울방학이면 닫힘
 *   금            20:00 · 21:00 · 22:00
 *   토            14:00 ~ 20:00
 *   일            없음
 *   모든 타임은 정각, 1시간 단위.
 *
 * ── 도착 시각 ──────────────────────────────────────────────
 *   상담 시작 시각은 위 표대로 고정이고, 아이는 레벨테스트 때문에 먼저 온다.
 *   국어·영어·수학은 과목당 30분. 2과목이면 상담 1시간 전 도착.
 *   과학·컨설팅·관리형독서실은 테스트가 없어 상담 시각에 맞춰 오면 된다.
 */
(function () {
  "use strict";

  /* 요일별 상담 시작 시각. 0=일 … 6=토 */
  var RULE = {
    0: [],
    1: ["22:00"],
    2: ["22:00"],
    3: ["22:00"],
    4: ["22:00"],
    5: ["20:00", "21:00", "22:00"],
    6: ["14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"]
  };

  /* 방학이면 닫히는 요일 — 월·화·수·목. 금·토는 방학에도 연다. */
  var TERM_ONLY = [1, 2, 3, 4];

  /* 레벨테스트가 있는 과목과 소요 시간(분) */
  var TEST_SUBJECTS = ["국어", "영어", "수학"];
  var TEST_MIN = 30;

  /* 상담 과목·분야 — booking.html 의 선택지와 같은 목록을 쓴다 */
  var SUBJECTS = [
    { s: "국어", test: true }, { s: "영어", test: true }, { s: "수학", test: true },
    { s: "과학", test: false }, { s: "관리형독서실", test: false },
    { s: "수시컨설팅", test: false }, { s: "정시컨설팅", test: false }
  ];

  var pad = function (n) { return String(n).padStart(2, "0"); };
  var toMin = function (t) { var m = String(t).split(":"); return (+m[0]) * 60 + (+m[1] || 0); };
  var fromMin = function (x) { return pad(Math.floor(x / 60)) + ":" + pad(x % 60); };

  /* "YYYY-MM-DD" → 요일 (로컬 시간대로 해석. new Date("...") 는 UTC 로 읽혀 하루 밀린다) */
  function dowOf(isoStr) {
    var p = String(isoStr).split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]).getDay();
  }

  /* 그 날짜가 방학인가. vacations = [["2026-07-20","2026-08-16"], …] */
  function inVacation(isoStr, vacations) {
    if (!vacations || !vacations.length) return false;
    for (var i = 0; i < vacations.length; i++) {
      var v = vacations[i];
      if (!v || !v[0]) continue;
      if (isoStr >= v[0] && isoStr <= (v[1] || v[0])) return true;
    }
    return false;
  }

  /* 그 날 열리는 상담 시각 목록.
     opts.vacations  방학 구간 배열
     opts.ignoreVacation  true 면 방학이어도 규칙대로 (달력에서 예외로 열 때) */
  function forDate(isoStr, opts) {
    opts = opts || {};
    var dow = dowOf(isoStr);
    var base = RULE[dow] || [];
    if (!base.length) return [];
    if (!opts.ignoreVacation && TERM_ONLY.indexOf(dow) >= 0 && inVacation(isoStr, opts.vacations)) return [];
    return base.slice();
  }

  /* 그 요일이 방학 때문에 닫힌 건지(= 학기 중이면 열리는 날인지) */
  function closedByVacation(isoStr, vacations) {
    var dow = dowOf(isoStr);
    return (RULE[dow] || []).length > 0 && TERM_ONLY.indexOf(dow) >= 0 && inVacation(isoStr, vacations);
  }

  /* 레벨테스트 소요 분 — 과목 배열 또는 "국어,수학" 문자열 */
  function testMinutes(subjects) {
    var arr = Array.isArray(subjects) ? subjects
            : (subjects instanceof Set) ? Array.from(subjects)
            : String(subjects || "").split(",");
    var n = 0;
    arr.forEach(function (s) { if (TEST_SUBJECTS.indexOf(String(s).trim()) >= 0) n++; });
    return n * TEST_MIN;
  }

  /* 아이가 와야 하는 시각 */
  function arriveTime(time, subjects) {
    if (!time) return null;
    return fromMin(toMin(time) - testMinutes(subjects));
  }

  /* 사람이 읽는 한 줄 — "22:00 상담 · 21:00 도착 (레벨테스트 60분)" */
  function describe(time, subjects) {
    var m = testMinutes(subjects);
    if (!m) return time + " 상담 · " + time + " 도착 (레벨테스트 없음)";
    return time + " 상담 · " + arriveTime(time, subjects) + " 도착 (레벨테스트 " + m + "분)";
  }

  /* 규칙 자체를 사람 말로 — 화면에 그대로 띄운다 */
  var RULE_TEXT = "월·화·수·목 22:00 (학기 중) · 금 20:00~22:00 · 토 14:00~20:00 · 일요일 없음";

  window.DaolConsultSlots = {
    RULE: RULE, TERM_ONLY: TERM_ONLY, RULE_TEXT: RULE_TEXT,
    SUBJECTS: SUBJECTS, TEST_SUBJECTS: TEST_SUBJECTS, TEST_MIN: TEST_MIN,
    forDate: forDate, closedByVacation: closedByVacation, inVacation: inVacation,
    testMinutes: testMinutes, arriveTime: arriveTime, describe: describe,
    dowOf: dowOf, toMin: toMin, fromMin: fromMin
  };
})();
