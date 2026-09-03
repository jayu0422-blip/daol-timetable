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
