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
