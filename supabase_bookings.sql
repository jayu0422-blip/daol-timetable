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
  -- 상담원서(구 탈리 항목)
  birth          date,
  gender         text,
  address        text,
  other_academy  text,
  reason         text,
  target_school  text,
  consent        boolean default false,   -- 개인정보 수집·이용 동의
  signature      text,                    -- 서명 이미지(data URL)
  status         text default '신규',
  synced         boolean default false,   -- 워처가 노션 등록·원장SMS 후 true
  created_at     timestamptz default now()
);

-- (이미 테이블을 만든 뒤 다시 실행하는 경우를 위한 컬럼 보강 — 신규 실행이면 무해)
alter table public.bookings add column if not exists birth date;
alter table public.bookings add column if not exists gender text;
alter table public.bookings add column if not exists address text;
alter table public.bookings add column if not exists other_academy text;
alter table public.bookings add column if not exists reason text;
alter table public.bookings add column if not exists target_school text;
alter table public.bookings add column if not exists consent boolean default false;
alter table public.bookings add column if not exists signature text;

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

-- ============================================================
-- 상담전 학생정보 입력(student.html) 저장 — 성적·타학원 이력 (탈리 obA70O 대체)
-- ============================================================
create table if not exists public.student_info (
  id               uuid primary key default gen_random_uuid(),
  student_name     text,
  phone            text,
  grade            text,
  other_academy    text,
  scores           jsonb,        -- {"중학교 3학년 1학기": {"국어":"A","수학":"B"}, ...}
  elective_social  text,         -- 사탐 선택(고2·3)
  elective_science text,         -- 과탐 선택(고2·3)
  consent          boolean default false,
  synced           boolean default false,
  created_at       timestamptz default now()
);
alter table public.student_info enable row level security;
drop policy if exists student_info_ins on public.student_info;
create policy student_info_ins on public.student_info for insert with check (true);
-- (select 정책 없음 = anon은 못 읽음, PII 보호. 워처는 service_role로 읽음)
grant insert on public.student_info to anon;

-- 워처(PC, service_role)가 읽어 노션 등록 → 실시간 반영은 아래로 구독 가능
alter publication supabase_realtime add table public.bookings;
