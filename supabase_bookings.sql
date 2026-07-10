-- ============================================================
-- 다올105 상담 예약(booking.html) 저장 — Supabase SQL Editor에서 실행
-- 예약자 PII(이름·전화)는 anon이 못 읽고, 슬롯 시간만 공개(booked_slots 뷰)로 노출.
-- ============================================================
create table if not exists public.bookings (
  id             uuid primary key default gen_random_uuid(),
  slot_date      date not null,
  slot_time      text not null,
  arrive_time    text,
  student_name   text,
  phone          text,
  school         text,
  grade          text,
  subjects       text,
  level_test_min int,
  status         text default '신규',
  synced         boolean default false,   -- 워처가 노션 등록·원장SMS 후 true
  created_at     timestamptz default now()
);

-- 슬롯 중복예약 방지(같은 날짜·시각 1건)
create unique index if not exists bookings_slot_uniq on public.bookings (slot_date, slot_time);

-- 공개 조회용 뷰: 슬롯 시간만(예약자 정보 제외)
create or replace view public.booked_slots as
  select slot_date, slot_time from public.bookings;

-- RLS: 예약 넣기(insert)만 허용, 테이블 직접 읽기는 차단 → PII 보호
alter table public.bookings enable row level security;
drop policy if exists bookings_ins on public.bookings;
create policy bookings_ins on public.bookings for insert with check (true);
-- (select 정책을 안 만들면 anon은 bookings 테이블을 못 읽음)

grant usage on schema public to anon;
grant insert on public.bookings to anon;
grant select on public.booked_slots to anon;

-- 워처(PC, service_role)가 읽어 노션 등록 → 실시간 반영은 아래로 구독 가능
alter publication supabase_realtime add table public.bookings;
