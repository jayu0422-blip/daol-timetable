-- daol105 : full setup (bookings + student_info + ops_calendar). safe to re-run.

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
  birth          date,
  gender         text,
  address        text,
  other_academy  text,
  reason         text,
  target_school  text,
  consent        boolean default false,
  signature      text,
  status         text default 'new',
  synced         boolean default false,
  created_at     timestamptz default now()
);

alter table public.bookings add column if not exists birth         date;
alter table public.bookings add column if not exists gender        text;
alter table public.bookings add column if not exists address       text;
alter table public.bookings add column if not exists other_academy text;
alter table public.bookings add column if not exists reason        text;
alter table public.bookings add column if not exists target_school text;
alter table public.bookings add column if not exists consent       boolean default false;
alter table public.bookings add column if not exists signature     text;
alter table public.bookings add column if not exists division      text;
alter table public.bookings add column if not exists source        text default 'web';
alter table public.bookings add column if not exists confirmed     boolean default false;
alter table public.bookings add column if not exists prep_sent     boolean default false;
alter table public.bookings add column if not exists canceled      boolean default false;
alter table public.bookings add column if not exists desk_memo     text;

drop index if exists bookings_slot_uniq;
create unique index if not exists bookings_slot_uniq
  on public.bookings (slot_date, slot_time) where canceled = false;
create index if not exists bookings_date_idx on public.bookings (slot_date);

drop view if exists public.booked_slots;
create view public.booked_slots as
  select id, slot_date, slot_time, arrive_time, student_name,
         school, grade, division, subjects, level_test_min,
         source, confirmed, prep_sent, canceled, desk_memo, created_at
    from public.bookings
   where canceled = false;

alter table public.bookings enable row level security;
drop policy if exists bookings_ins on public.bookings;
create policy bookings_ins on public.bookings for insert with check (true);
drop policy if exists bookings_upd on public.bookings;
create policy bookings_upd on public.bookings for update using (true) with check (true);

create table if not exists public.student_info (
  id               uuid primary key default gen_random_uuid(),
  student_name     text,
  phone            text,
  grade            text,
  other_academy    text,
  scores           jsonb,
  elective_social  text,
  elective_science text,
  consent          boolean default false,
  synced           boolean default false,
  created_at       timestamptz default now()
);
alter table public.student_info enable row level security;
drop policy if exists student_info_ins on public.student_info;
create policy student_info_ins on public.student_info for insert with check (true);

create table if not exists public.ops_calendar (
  id         uuid primary key default gen_random_uuid(),
  d          date not null,
  kind       text not null,
  who        text,
  slots      text,
  student    text,
  school     text,
  grade      text,
  subjects   text,
  room       text,
  pay_due    date,
  amount     int,
  pay_done   boolean default false,
  told_fee   boolean default false,
  told_room  boolean default false,
  body       text,
  done       boolean default false,
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.ops_calendar drop constraint if exists ops_calendar_kind_chk;
alter table public.ops_calendar add constraint ops_calendar_kind_chk
  check (kind in ('staff','consult','vacation','newstudent','handover','memo'));

create unique index if not exists ops_calendar_one_per_day
  on public.ops_calendar (d, kind) where kind in ('staff','consult');
create index if not exists ops_calendar_d_idx on public.ops_calendar (d);

create or replace function public.ops_calendar_touch() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists ops_calendar_touch_trg on public.ops_calendar;
create trigger ops_calendar_touch_trg before update on public.ops_calendar
  for each row execute function public.ops_calendar_touch();

alter table public.ops_calendar enable row level security;
drop policy if exists ops_calendar_read  on public.ops_calendar;
drop policy if exists ops_calendar_write on public.ops_calendar;
drop policy if exists ops_calendar_upd   on public.ops_calendar;
drop policy if exists ops_calendar_del   on public.ops_calendar;
create policy ops_calendar_read  on public.ops_calendar for select using (true);
create policy ops_calendar_write on public.ops_calendar for insert with check (true);
create policy ops_calendar_upd   on public.ops_calendar for update using (true) with check (true);
create policy ops_calendar_del   on public.ops_calendar for delete using (true);

grant usage  on schema public to anon;
grant insert on public.bookings to anon;
grant update (confirmed, canceled, desk_memo, prep_sent) on public.bookings to anon;
grant select on public.booked_slots to anon;
grant insert on public.student_info to anon;
grant select, insert, update, delete on public.ops_calendar to anon;

select 'all ready' as status,
       (select count(*) from public.bookings)     as bookings,
       (select count(*) from public.ops_calendar) as ops_calendar;
