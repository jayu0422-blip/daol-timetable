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
/* 0·빈값은 '없음'으로 본다(구 단가 경고 대상 아님) */
window.daolIsLegacyMaterial = function (v) {
  const n = (v === "" || v == null) ? null : (Number(String(v).replace(/[^0-9]/g, "")) || null);
  return n != null && !window.DAOL_MATERIAL_TIERS.includes(n);
};
