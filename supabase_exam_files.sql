-- 기출문제 드라이브 색인 표 (2026-09-26)
-- 파일 자체는 구글드라이브(G:\내 드라이브\다올105\기출문제)에 두고,
-- 이 표에는 "어디에 무슨 파일이 있는지"만 넣는다. 원본 시험지는 학교 저작물이라 웹에 공개하지 않는다.
-- 채우는 쪽: PC 자동화 exam_index.py (드라이브 폴더를 훑어 넣음)
-- 읽는 쪽  : admin.html 「기출문제」 탭

create table if not exists public.exam_files (
  id         text primary key,          -- 경로 해시(같은 파일은 항상 같은 값)
  school     text not null,             -- 미사고 · 미사강변고 · 은가람중 …
  grade      text,                      -- 고1 · 중3 …
  term       text,                      -- 2026-2학기-중간 …
  subject    text,                      -- 국어 · 영어 · 수학 …
  kind       text,                      -- 문제 · 답지 · 해설 · 분석
  name       text not null,             -- 파일 이름
  rel_path   text not null,             -- 기출문제 폴더 기준 상대 경로
  size_kb    int,
  mtime      timestamptz,
  updated_at timestamptz default now()
);

create index if not exists exam_files_school_idx on public.exam_files (school, grade, term);
create index if not exists exam_files_name_idx   on public.exam_files (name);

alter table public.exam_files enable row level security;
drop policy if exists exam_files_read  on public.exam_files;
drop policy if exists exam_files_write on public.exam_files;
drop policy if exists exam_files_upd   on public.exam_files;
drop policy if exists exam_files_del   on public.exam_files;
create policy exam_files_read  on public.exam_files for select using (true);
create policy exam_files_write on public.exam_files for insert with check (true);
create policy exam_files_upd   on public.exam_files for update using (true) with check (true);
create policy exam_files_del   on public.exam_files for delete using (true);

grant usage on schema public to anon;
grant select, insert, update, delete on public.exam_files to anon;

-- 확인
-- select school, count(*) from public.exam_files group by school order by 2 desc;
