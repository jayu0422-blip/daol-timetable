-- ============================================================
-- 다올105 운영 월간 일정표 (admin.html 대시보드) — Supabase SQL Editor에서 실행
--
--  https://supabase.com/dashboard/project/sqogiblaagmmkpwwodgf/sql/new
--
-- 한 테이블에 네 종류를 담는다. kind 로 구분한다.
--   staff      당일 근무자        → who
--   consult    상담 가능 시간대    → slots ("10:00,11:00,14:00")
--   newstudent 신규 등록생        → student, pay_due, amount, pay_done
--   handover   인수인계 메모       → body, done
--   memo       그 밖의 메모        → body
--
-- 신규생 항목이 이 표의 핵심이다. 등록은 됐는데 첫 납부가 빠지는 사고를 막으려고
-- pay_due(첫 납부 예정일)와 pay_done(입금 확인)을 따로 둔다.
-- 예정일이 지났는데 pay_done 이 false 면 대시보드 맨 위에 경보로 뜬다.
-- ============================================================

create table if not exists public.ops_calendar (
  id         uuid primary key default gen_random_uuid(),
  d          date not null,                 -- 이 항목이 걸리는 날짜
  kind       text not null,                 -- staff | consult | newstudent | handover | memo
  who        text,                          -- 근무자 (staff)
  slots      text,                          -- 상담 가능 시각 CSV (consult)
  student    text,                          -- 신규생 이름 (newstudent)
  school     text,
  grade      text,
  subjects   text,
  pay_due    date,                          -- 첫 납부 예정일 (newstudent)
  amount     int,                           -- 첫 납부 금액
  pay_done   boolean default false,         -- 입금 확인
  body       text,                          -- 인수인계·메모 본문
  done       boolean default false,         -- 인수인계 처리 완료
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 상태 값은 다섯 가지만 (오타로 조용히 안 보이는 항목이 생기지 않게)
alter table public.ops_calendar drop constraint if exists ops_calendar_kind_chk;
alter table public.ops_calendar add constraint ops_calendar_kind_chk
  check (kind in ('staff','consult','newstudent','handover','memo'));

-- 하루에 근무자/상담시간은 한 줄만 둔다. 신규생·인수인계는 여러 줄 가능.
create unique index if not exists ops_calendar_one_per_day
  on public.ops_calendar (d, kind) where kind in ('staff','consult');

create index if not exists ops_calendar_d_idx on public.ops_calendar (d);
create index if not exists ops_calendar_paydue_idx
  on public.ops_calendar (pay_due) where kind = 'newstudent' and pay_done = false;

-- updated_at 자동 갱신
create or replace function public.ops_calendar_touch() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists ops_calendar_touch_trg on public.ops_calendar;
create trigger ops_calendar_touch_trg before update on public.ops_calendar
  for each row execute function public.ops_calendar_touch();

-- ── 접근 권한 ────────────────────────────────────────────────
-- 이 표는 운영자 대시보드(admin.html)에서만 쓴다. admin.html 은 링크를 아는 사람만
-- 들어오는 내부 화면이고 anon 키로 붙는다. 그래서 anon 에 읽기·쓰기를 연다.
-- ※ 학부모·학생 화면(booking/view/student)은 이 표를 읽지 않는다.
-- ※ 여기에 학생 실명과 납부 금액이 들어가므로, admin.html 주소를 외부에 공유하지 말 것.
alter table public.ops_calendar enable row level security;

drop policy if exists ops_calendar_read  on public.ops_calendar;
drop policy if exists ops_calendar_write on public.ops_calendar;
drop policy if exists ops_calendar_upd   on public.ops_calendar;
drop policy if exists ops_calendar_del   on public.ops_calendar;

create policy ops_calendar_read  on public.ops_calendar for select using (true);
create policy ops_calendar_write on public.ops_calendar for insert with check (true);
create policy ops_calendar_upd   on public.ops_calendar for update using (true) with check (true);
create policy ops_calendar_del   on public.ops_calendar for delete using (true);

-- 확인
select 'ops_calendar 준비 완료' as status, count(*) as 행수 from public.ops_calendar;
