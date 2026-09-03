-- ============================================================
--  다올105 월간 일정표 + 상담 예약 — 한 번에 실행
--  Supabase SQL Editor 에 이 파일 전체를 붙여넣고 Run 한 번.
--  여러 번 실행해도 안전합니다(기존 데이터는 건드리지 않습니다).
--
--  [1/2] ops_calendar  근무자·상담 예외·방학·신규생 첫등원·인수인계
--  [2/2] bookings 확장  상담 예약(학생 이름·학부모 연락처)
-- ============================================================


-- ###########################################################
-- ###  [1/2] ops_calendar
-- ###########################################################

-- ============================================================
-- 다올105 운영 월간 일정표 (admin.html 대시보드) — Supabase SQL Editor에서 실행
--
--  https://supabase.com/dashboard/project/sqogiblaagmmkpwwodgf/sql/new
--
-- 한 테이블에 여섯 종류를 담는다. kind 로 구분한다.
--   staff      당일 근무자          → who
--   consult    그날만의 상담 시각 예외 → slots ("22:00,21:00"). 비워 두면 요일 규칙대로
--   vacation   방학 구간            → body 에 종료일. 월~목 상담이 이 기간에는 닫힌다
--   newstudent 신규생 첫등원        → student, room, pay_due, amount, told_fee, told_room, pay_done
--   handover   인수인계 메모        → body, done
--   memo       그 밖의 메모         → body
--
-- 신규생 첫등원 항목이 이 표의 핵심이다. 첫날 수강료 안내와 강의실 안내가 빠지면
-- 그대로 미납·헤매는 사고로 이어진다. 그래서 안내 여부를 각각 따로 체크하고,
-- 첫 납부 예정일이 지났는데 확인이 안 됐으면 대시보드 맨 위에 빨간 경보로 남긴다.
--
-- ※ 상담 예약(학생 이름·전화)은 여기가 아니라 bookings 표에 들어간다.
--    전화번호를 anon 이 못 읽게 잠가 두어야 하기 때문. supabase_consult.sql 참고.
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
  room       text,                          -- 안내할 강의실 (newstudent)
  pay_due    date,                          -- 첫 납부 예정일 (newstudent)
  amount     int,                           -- 첫 납부 금액
  pay_done   boolean default false,         -- 입금 확인
  told_fee   boolean default false,         -- 수강료 안내 완료
  told_room  boolean default false,         -- 강의실 안내 완료
  body       text,                          -- 인수인계·메모 본문
  done       boolean default false,         -- 인수인계 처리 완료
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- (이미 만든 뒤 다시 실행하는 경우 — 신규 실행이면 무해)
alter table public.ops_calendar add column if not exists room      text;
alter table public.ops_calendar add column if not exists told_fee  boolean default false;
alter table public.ops_calendar add column if not exists told_room boolean default false;

-- 상태 값은 여섯 가지만 (오타로 조용히 안 보이는 항목이 생기지 않게)
alter table public.ops_calendar drop constraint if exists ops_calendar_kind_chk;
alter table public.ops_calendar add constraint ops_calendar_kind_chk
  check (kind in ('staff','consult','vacation','newstudent','handover','memo'));

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


-- ###########################################################
-- ###  [2/2] bookings 확장 + booked_slots 뷰
-- ###########################################################

-- ============================================================
-- 다올105 상담 예약 — 데스크(admin.html)에서도 잡을 수 있게 확장
--   https://supabase.com/dashboard/project/sqogiblaagmmkpwwodgf/sql/new
--
-- 왜 새 표를 안 만들고 기존 bookings 를 쓰는가
--   여기에는 학생 이름과 학부모 전화번호가 들어간다. bookings 는 이미
--   "anon 은 넣을 수만 있고 못 읽는다"로 잠겨 있어서 전화번호가 새지 않는다.
--   새 표를 만들면 그 보호를 처음부터 다시 세워야 하고, 노션·원장 알림을 돌리는
--   booking_sync.py 도 두 벌이 된다. 그래서 이 표를 그대로 쓰고 칸만 늘린다.
--
-- 데스크 화면은 아래 booked_slots 뷰로만 읽는다 — 전화번호·주소·서명은 뷰에 없다.
-- ============================================================

-- ── 1) 칸 늘리기 ────────────────────────────────────────────
alter table public.bookings add column if not exists division   text;      -- 중등 / 고등
alter table public.bookings add column if not exists source     text default 'web';  -- web(학부모) / desk(데스크)
alter table public.bookings add column if not exists confirmed  boolean default false; -- 원장이 상담확정을 눌렀는가
alter table public.bookings add column if not exists prep_sent  boolean default false; -- 학부모 준비물 문자 발송 완료
alter table public.bookings add column if not exists canceled   boolean default false;
alter table public.bookings add column if not exists desk_memo  text;

-- ── 2) 슬롯 중복 방지 — 취소된 건은 자리를 돌려준다 ──────────
drop index if exists bookings_slot_uniq;
create unique index if not exists bookings_slot_uniq
  on public.bookings (slot_date, slot_time) where canceled = false;

create index if not exists bookings_date_idx on public.bookings (slot_date);

-- ── 3) 공개 조회용 뷰 ───────────────────────────────────────
-- 전화번호·생년월일·주소·서명은 넣지 않는다. 데스크가 상담 준비에 쓰는 것만 연다.
-- (연락처가 필요하면 노션 「신규상담」에서 본다 — 그쪽은 로그인이 걸려 있다.)
drop view if exists public.booked_slots;
create view public.booked_slots as
  select id, slot_date, slot_time, arrive_time, student_name,
         school, grade, division, subjects, level_test_min,
         source, confirmed, prep_sent, canceled, desk_memo, created_at
    from public.bookings
   where canceled = false;

-- ── 4) 권한 ─────────────────────────────────────────────────
alter table public.bookings enable row level security;

drop policy if exists bookings_ins on public.bookings;
create policy bookings_ins on public.bookings for insert with check (true);

-- 데스크가 상담을 확정·취소·메모할 수 있어야 한다. 단 이름·전화 같은 본문은 못 고치게
-- 컬럼 단위로만 연다(아래 grant). RLS 는 컬럼을 못 가리므로 grant 로 막는 것이 핵심이다.
drop policy if exists bookings_upd on public.bookings;
create policy bookings_upd on public.bookings for update using (true) with check (true);

grant usage  on schema public to anon;
grant insert on public.bookings to anon;
grant update (confirmed, canceled, desk_memo, prep_sent) on public.bookings to anon;
grant select on public.booked_slots to anon;
-- ※ bookings 자체에는 select 권한을 주지 않는다 → anon 은 전화번호를 못 읽는다.

-- 확인
select 'bookings 확장 완료' as status,
       count(*) filter (where canceled = false) as 유효예약,
       count(*) filter (where confirmed)        as 확정건
  from public.bookings;
