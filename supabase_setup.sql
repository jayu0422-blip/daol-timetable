-- ============================================================
-- 다올105 시간표 앱 — Supabase 초기 설정 SQL
-- 사용법: Supabase 대시보드 → 좌측 [SQL Editor] → New query → 아래 전체 붙여넣기 → Run
-- ============================================================

-- 1) 강좌 테이블
create table if not exists public.courses (
  id            uuid primary key default gen_random_uuid(),
  teacher       text not null,
  division      text,                 -- 중등 / 고등
  grade         text,                 -- 중1 중2 중3 중등공통 고1 고2 고3/수능
  subject       text,                 -- 국어 영어 수학 과학 ...
  course_name   text,
  schedule_text text,                 -- 시간 (자유 텍스트, 여러 줄)
  target_school text default '공통',  -- 공통 / 미사고 / 미강고 ...
  audience      text,                 -- 강좌 대상
  content       text,                 -- 강좌 내용·특징·목표
  course_type   text default '정규',  -- 정규 / 특강
  sort_order    int  default 0,
  updated_at    timestamptz default now()
);

-- 2) 강사 테이블 (제출 현황)
create table if not exists public.teachers (
  name         text primary key,
  subject      text,
  token        text unique,
  submitted_at timestamptz,
  course_count int default 0
);

-- 3) 강사 명부 시드 (config.js 와 동일 토큰)
insert into public.teachers (name, subject, token) values
  ('황웅','영어','a5e2a628'),
  ('민귀홍','영어','464af7f0'),
  ('김영하','국어','aff9ae35'),
  ('이정관','국어','65b0e3ad'),
  ('임결','수학','c211bc44'),
  ('유용권','수학','f712867b'),
  ('윤재영','영어','47276347')
on conflict (name) do nothing;

-- 4) 접근 정책 (내부용 — anon 키로 읽기/쓰기 허용)
alter table public.courses  enable row level security;
alter table public.teachers enable row level security;

drop policy if exists courses_all  on public.courses;
drop policy if exists teachers_all on public.teachers;

create policy courses_all  on public.courses  for all using (true) with check (true);
create policy teachers_all on public.teachers for all using (true) with check (true);

-- 실시간 반영용
alter publication supabase_realtime add table public.courses;
