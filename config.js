/* ===== 다올105 시간표 앱 설정 ===== */

/* (1) Supabase 연결 — 실시간 중앙저장 (이 두 값은 공개되어도 안전한 공개용 키입니다) */
window.DAOL_CONFIG = {
  url: "https://sqogiblaagmmkpwwodgf.supabase.co",
  anonKey: "sb_publishable_JJMJVY4pC9zL25xHDf91Kg_meLV8iwT"
};

/* (2) 강사 명부는 보안을 위해 이 파일에 두지 않습니다.
   - 강사 입력 페이지: 링크의 토큰으로 DB(teachers)에서 "본인 1명"만 조회
   - 운영자 대시보드: DB(teachers)에서 전체 조회
   아래 배열은 Supabase 미연결(데모) 시 폴백 전용이며 비워둡니다. */
window.DAOL_TEACHERS = [];

/* (3) 교재비 구간 — 교육청 고지 교습비 체계
   학원법상 교재비를 별도로 수납할 수 없어, 교재비는 교습비에 포함해 신고·게시한다.
   고지 교습비 = 수강료 + 교재비. 조정가 난립을 막기 위해 아래 8개 구간만 선택 가능.
   ※ 이 배열을 고치면 강사 입력 페이지·전체 관리·수강료 탭의 선택지가 함께 바뀐다. */
window.DAOL_MATERIAL_TIERS = [9000, 19000, 29000, 39000, 49000, 59000, 69000, 79000];

/* 교재비 <select> 옵션 생성. 구 단가(구간 밖 값)는 지우지 않고 경고를 달아 남긴다 —
   말없이 0으로 바뀌면 청구액이 조용히 틀어지기 때문. */
window.daolMaterialOptions = function (v) {
  const T = window.DAOL_MATERIAL_TIERS;
  const cur = (v === "" || v == null) ? null : Number(String(v).replace(/[^0-9]/g, "")) || null;
  let h = `<option value=""${cur == null ? " selected" : ""}>없음</option>`;
  h += T.map(t => `<option value="${t}"${cur === t ? " selected" : ""}>${t.toLocaleString()}원</option>`).join("");
  if (cur != null && !T.includes(cur)) h += `<option value="${cur}" selected>⚠ ${cur.toLocaleString()}원 (구 단가 — 변경 필요)</option>`;
  return h;
};
/* (4) 학원 유인물 사용비 — 강사 교재비와 별개로 학원이 청구하는 자체 제작물 실비.
   교재 사용량이 많은 반(예: 황웅 선생님 반)은 강사 교재비 + 학원 유인물비가 함께 붙는다.
   구간은 교재비와 동일하게 쓰고 기본값만 9,000원. */
window.DAOL_HANDOUT_DEFAULT = 9000;
/* 부과 가능 범위 — 자체 제작 인쇄물이 실제로 나가는 '고등 영어'에 한정.
   다른 과목·학교급은 출판 교재만으로 진행하므로 칸 자체를 잠근다. */
window.daolHandoutAllowed = function (c) {
  const div = c && (c.division || "");
  const subj = c && (c.subject || "");
  return div === "고등" && subj === "영어";
};
window.daolHandoutOptions = function (v) {
  const T = window.DAOL_MATERIAL_TIERS;
  const cur = (v === "" || v == null) ? null : Number(String(v).replace(/[^0-9]/g, "")) || null;
  let h = `<option value=""${cur == null ? " selected" : ""}>없음</option>`;
  h += T.map(t => `<option value="${t}"${cur === t ? " selected" : ""}>${t.toLocaleString()}원${t === window.DAOL_HANDOUT_DEFAULT ? " (기본)" : ""}</option>`).join("");
  if (cur != null && !T.includes(cur)) h += `<option value="${cur}" selected>⚠ ${cur.toLocaleString()}원 (구 단가 — 변경 필요)</option>`;
  return h;
};
/* 고지·청구 금액 = 수강료 + 강사 교재비 + 학원 유인물비 */
window.daolTotalFee = (tuition, material, handout) =>
  (Number(tuition) || 0) + (Number(material) || 0) + (Number(handout) || 0);
/* 잠긴 칸 표시 — 고등 영어가 아니면 '해당 없음'으로 고정 */
window.daolHandoutCell = function (c, cls) {
  if (!window.daolHandoutAllowed(c))
    return `<select class="${cls} off" data-k="handout_fee" disabled title="유인물 사용비는 고등 영어 강좌에만 부과합니다"><option>해당 없음</option></select>`;
  return `<select class="${cls}" data-k="handout_fee">${window.daolHandoutOptions(c.handout_fee)}</select>`;
};

/* 0·빈값은 '없음'으로 본다(구 단가 경고 대상 아님) */
window.daolIsLegacyMaterial = function (v) {
  const n = (v === "" || v == null) ? null : (Number(String(v).replace(/[^0-9]/g, "")) || null);
  return n != null && !window.DAOL_MATERIAL_TIERS.includes(n);
};


/* ===== 월간 강의계획 스냅샷 =====
   courses.monthly_plans = {"2026-09":{audience,content,textbook,session_notes}, "2026-10":{...}}

   왜 필요한가
     강좌 카드(대상·수업 내용·교재)는 칸이 하나뿐이라 강사가 다음 달 계획을 저장하면
     지난달 내용이 사라진다. 그러면 상담용 자료와 과목 안내 페이지가 "지금 무슨 달 기준인지"
     알 수 없다. 월별로 스냅샷을 쌓아 두고, 학부모에게 나가는 화면은 항상 가장 최근 달을 쓴다.
     10월 계획이 올라오면 그 순간부터 10월 내용이 나간다 — 따로 손댈 것이 없다.

   컬럼이 아직 없는 DB에서도 그냥 통과한다(스냅샷이 없으면 강좌의 현재 값을 그대로 쓴다). */
window.DaolPlan = (function () {
  var FIELDS = ["audience", "content", "textbook", "session_notes"];
  function parse(v) {
    if (!v) return null;
    if (typeof v === "string") { try { return JSON.parse(v || "{}"); } catch (e) { return null; } }
    return v;
  }
  function latestKey(mp) {
    var ks = Object.keys(mp || {}).filter(function (k) { return /^\d{4}-\d{2}$/.test(k); });
    if (!ks.length) return null;
    ks.sort();
    return ks[ks.length - 1];
  }
  function snapshot(c) {
    var o = {};
    FIELDS.forEach(function (f) { o[f] = (c && c[f] != null) ? c[f] : ""; });
    return o;
  }
  function apply(c) {
    var mp = parse(c && c.monthly_plans);
    var k = latestKey(mp);
    if (!k) return c;
    var snap = mp[k] || {}, out = {}, used = false;
    for (var p in c) out[p] = c[p];
    FIELDS.forEach(function (f) {
      if (snap[f] != null && String(snap[f]).trim() !== "") { out[f] = snap[f]; used = true; }
    });
    if (used) out._plan_month = k;
    return out;
  }
  return {
    FIELDS: FIELDS, latestKey: latestKey, snapshot: snapshot, apply: apply,
    applyAll: function (rows) { return (rows || []).map(apply); },
    keyOf: function (y, m) { return y + "-" + (m < 10 ? "0" + m : "" + m); }
  };
})();
