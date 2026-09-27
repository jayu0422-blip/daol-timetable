-- 수업일지 공유 저장소 (인포 + 강사 공용)
-- Supabase SQL 편집기에 붙여넣고 [Run] 한 번만 실행하면 됩니다.
-- 실행 전에는 log.html 입력이 그 브라우저에만 저장됩니다.

create table if not exists public.class_logs (
  key          text primary key,           -- 'c:<course_id>' | 'o:<날짜>:<번호>'  + 날짜로 유일
  d            date not null,              -- 수업 날짜
  teacher      text,
  course_id    uuid,
  course_name  text,
  slot         text,                        -- 시간대
  kind         text,                        -- 정 / 클 / 정클 / 보 / 휴
  open_memo    text,                        -- 학부모·학생에게 공개되는 메모
  inner_memo   text,                        -- 내부 메모
  homework     text,
  note         text,                        -- 특이사항
  done         boolean default false,       -- 작성 완료 체크
  updated_at   timestamptz default now()
);

create index if not exists class_logs_d_idx on public.class_logs (d);
create index if not exists class_logs_teacher_idx on public.class_logs (teacher);

alter table public.class_logs enable row level security;

-- 다른 표와 같은 정책(링크를 아는 사람만 접근). 필요하면 나중에 조여도 됩니다.
drop policy if exists class_logs_all on public.class_logs;
create policy class_logs_all on public.class_logs
  for all using (true) with check (true);
