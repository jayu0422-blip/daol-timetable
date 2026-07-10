-- ============================================================
-- 다올105 시간표 앱 — 보안 강화 마이그레이션 (RPC + RLS 잠금)
-- 목적: 공개 anon 키로 누구나 시간표 삭제·강사 토큰 탈취가 가능한 구멍(RLS 전면개방)을 막는다.
-- 모델: 쓰기·민감읽기는 전부 security-definer RPC를 통해서만. 강사 인증=토큰, 운영자 인증=관리자키.
--
-- 실행 순서 (무중단):
--   [STEP 1] 지금 실행 (추가전용 — 기존 개방정책 그대로라 앱 안 깨짐)
--   → 앱(input/view/board/admin)을 RPC 버전으로 교체·배포·검증한 뒤
--   [STEP 2] 그 다음 실행 (개방정책 제거 = 잠금)
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 해당 STEP 블록 붙여넣기 → Run
-- ============================================================


-- ╔══════════════════════════════════════════════════════════╗
-- ║ STEP 1 — 추가전용 (지금 실행). 기존 동작 변화 없음.        ║
-- ╚══════════════════════════════════════════════════════════╝

create extension if not exists pgcrypto with schema extensions;

-- 1) 컬럼 추가 (요청 사이클 / 재직 / 이력)
alter table public.teachers add column if not exists requested_at timestamptz;
alter table public.teachers add column if not exists cycle_label  text;
alter table public.teachers add column if not exists active       boolean default true;
alter table public.courses  add column if not exists active       boolean default true;
alter table public.courses  add column if not exists term         text;

-- 2) 설정/로그/비밀 테이블
create table if not exists public.app_config (
  id int primary key default 1,
  current_cycle    text,
  cycle_started_at timestamptz,
  check (id = 1)
);
insert into public.app_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.send_log (
  id            uuid primary key default gen_random_uuid(),
  cycle         text,
  sent_at       timestamptz default now(),
  target_count  int,
  success_count int,
  detail        jsonb
);

create table if not exists public.app_secret (
  id int primary key default 1,
  admin_hash text,
  check (id = 1)
);
-- ▼▼▼ 관리자 비밀번호를 정하세요 (admin.html에서 이 값을 입력해야 편집 가능) ▼▼▼
insert into public.app_secret (id, admin_hash)
values (1, extensions.crypt('다올105관리자', extensions.gen_salt('bf')))
on conflict (id) do update set admin_hash = excluded.admin_hash;
-- ▲▲▲ '다올105관리자' 를 원하는 비밀번호로 바꿔서 실행하세요 ▲▲▲

-- app_secret 은 anon 이 절대 못 읽게 (RLS on, 정책 없음 = 전면 차단; RPC만 접근)
alter table public.app_secret enable row level security;
alter table public.send_log  enable row level security;
alter table public.app_config enable row level security;

-- 3) 공개 뷰: 안전 컬럼만(내부메모 audience·content·수강료 제외), 활성 강좌만
create or replace view public.board_public as
  select id, teacher, division, grade, subject, course_name, schedule_text,
         target_school, course_type, sort_order, room_overrides, term, updated_at
  from public.courses
  where active is not false;

-- ── 강사(토큰) RPC ─────────────────────────────────────────
create or replace function public.resolve_teacher(p_token text)
returns table(name text, subject text)
language sql security definer set search_path = public as $$
  select name, subject from public.teachers
  where token = p_token and coalesce(active, true);
$$;

create or replace function public.get_my_courses(p_token text)
returns setof public.courses
language sql security definer set search_path = public as $$
  select c.* from public.courses c
  join public.teachers t on t.name = c.teacher
  where t.token = p_token and coalesce(t.active, true)
  order by c.sort_order;
$$;

create or replace function public.save_courses(p_token text, p_rows jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare v_teacher text; v_active boolean; v_ids uuid[];
begin
  select name, coalesce(active, true) into v_teacher, v_active
  from public.teachers where token = p_token;
  if v_teacher is null or not v_active then
    raise exception 'invalid_or_inactive_token';
  end if;

  -- 제출된 행들의 id (없는 강좌는 이 강사 소유에서 삭제)
  select array_agg((r->>'id')::uuid) into v_ids
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where nullif(r->>'id','') is not null;

  delete from public.courses
  where teacher = v_teacher and (v_ids is null or id <> all(v_ids));

  -- upsert: 남의 강좌 id 를 가로채지 못하게(다른 강사 소유 id 는 제외)
  insert into public.courses
    (id, teacher, division, grade, subject, course_name, schedule_text,
     target_school, audience, content, course_type, sort_order, active, updated_at)
  select
    coalesce(nullif(r->>'id','')::uuid, gen_random_uuid()),
    v_teacher,
    case when left(coalesce(r->>'grade',''),1) = '중' then '중등' else '고등' end,
    r->>'grade', r->>'subject', r->>'course_name', r->>'schedule_text',
    coalesce(nullif(r->>'target_school',''), '공통'),
    r->>'audience', r->>'content',
    coalesce(nullif(r->>'course_type',''), '정규'),
    coalesce((r->>'sort_order')::int, 0), true, now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where not exists (
    select 1 from public.courses c
    where c.id = nullif(r->>'id','')::uuid and c.teacher <> v_teacher )
  on conflict (id) do update set
    teacher=excluded.teacher, division=excluded.division, grade=excluded.grade,
    subject=excluded.subject, course_name=excluded.course_name,
    schedule_text=excluded.schedule_text, target_school=excluded.target_school,
    audience=excluded.audience, content=excluded.content,
    course_type=excluded.course_type, sort_order=excluded.sort_order,
    active=true, updated_at=now();

  return (select count(*)::int from public.courses where teacher = v_teacher);
end $$;

create or replace function public.delete_course(p_token text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_teacher text;
begin
  select name into v_teacher from public.teachers
  where token = p_token and coalesce(active, true);
  if v_teacher is null then raise exception 'invalid_token'; end if;
  delete from public.courses where id = p_id and teacher = v_teacher;
end $$;

create or replace function public.mark_submitted(p_token text, p_cycle text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_teacher text;
begin
  select name into v_teacher from public.teachers
  where token = p_token and coalesce(active, true);
  if v_teacher is null then raise exception 'invalid_token'; end if;
  update public.teachers
    set submitted_at = now(),
        cycle_label  = coalesce(p_cycle, cycle_label),
        course_count = (select count(*) from public.courses where teacher = v_teacher and active is not false)
  where name = v_teacher;
end $$;

-- ── 관리자(키) RPC ─────────────────────────────────────────
create or replace function public.admin_ok(p_key text)
returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists(select 1 from public.app_secret
                where id = 1 and admin_hash = extensions.crypt(p_key, admin_hash));
$$;

create or replace function public.admin_list_teachers(p_key text)
returns table(name text, subject text, submitted_at timestamptz,
              requested_at timestamptz, cycle_label text, course_count int, active boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p_key) then raise exception 'bad_admin_key'; end if;
  return query select t.name, t.subject, t.submitted_at, t.requested_at,
                      t.cycle_label, t.course_count, coalesce(t.active,true)
               from public.teachers t order by t.subject, t.name;
end $$;

create or replace function public.admin_all_courses(p_key text)
returns setof public.courses
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p_key) then raise exception 'bad_admin_key'; end if;
  return query select * from public.courses order by sort_order;
end $$;

create or replace function public.admin_update_course(p_key text, p_id uuid, p_patch jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p_key) then raise exception 'bad_admin_key'; end if;
  update public.courses set
    tuition       = case when p_patch ? 'tuition'       then (p_patch->>'tuition')::int      else tuition end,
    tuition_note  = case when p_patch ? 'tuition_note'  then  p_patch->>'tuition_note'        else tuition_note end,
    sessions      = case when p_patch ? 'sessions'      then (p_patch->>'sessions')::int     else sessions end,
    room_overrides= case when p_patch ? 'room_overrides' then (p_patch->'room_overrides')    else room_overrides end,
    active        = case when p_patch ? 'active'        then (p_patch->>'active')::boolean   else active end,
    updated_at    = now()
  where id = p_id;
end $$;

-- 요청 사이클 시작: 대상 강사 requested_at=now, cycle_label 세팅 (+ 전역 current_cycle)
create or replace function public.admin_start_cycle(p_key text, p_cycle text, p_names text[] default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.admin_ok(p_key) then raise exception 'bad_admin_key'; end if;
  update public.teachers
    set requested_at = now(), cycle_label = p_cycle
  where coalesce(active, true) and (p_names is null or name = any(p_names));
  get diagnostics v_n = row_count;
  update public.app_config set current_cycle = p_cycle, cycle_started_at = now() where id = 1;
  return v_n;
end $$;

create or replace function public.admin_rotate_token(p_key text, p_name text)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_new text;
begin
  if not public.admin_ok(p_key) then raise exception 'bad_admin_key'; end if;
  v_new := encode(extensions.gen_random_bytes(12), 'hex');
  update public.teachers set token = v_new where name = p_name;
  return v_new;
end $$;

create or replace function public.admin_last_send(p_key text)
returns setof public.send_log
language plpgsql security definer set search_path = public as $$
begin
  if not public.admin_ok(p_key) then raise exception 'bad_admin_key'; end if;
  return query select * from public.send_log order by sent_at desc limit 5;
end $$;

-- 실행권한: anon/authenticated 가 RPC·뷰 호출 가능하게
grant usage on schema public to anon, authenticated;
grant select on public.board_public to anon, authenticated;
grant execute on function
  public.resolve_teacher(text), public.get_my_courses(text),
  public.save_courses(text, jsonb), public.delete_course(text, uuid),
  public.mark_submitted(text, text), public.admin_ok(text),
  public.admin_list_teachers(text), public.admin_all_courses(text),
  public.admin_update_course(text, uuid, jsonb), public.admin_start_cycle(text, text, text[]),
  public.admin_rotate_token(text, text), public.admin_last_send(text)
  to anon, authenticated;

-- ── STEP 1 자가검증 (아래를 함께 Run 하면 결과가 보임) ──
-- select '토큰조회', * from public.resolve_teacher('47276347');        -- 윤재영 나와야 정상
-- select '내강좌', count(*) from public.get_my_courses('47276347');    -- 6 근처
-- select '관리자키', public.admin_ok('다올105관리자');                  -- true (비번 바꿨으면 그 값)
-- select '공개뷰', count(*) from public.board_public;                   -- 33 근처


-- ╔══════════════════════════════════════════════════════════╗
-- ║ STEP 2 — 잠금 (앱을 RPC로 교체·배포·검증한 "뒤에" 실행)   ║
-- ║ 이걸 먼저 실행하면 구버전 앱이 즉시 멈춥니다. 순서 엄수!  ║
-- ╚══════════════════════════════════════════════════════════╝
-- -- 개방정책 제거
-- drop policy if exists courses_all  on public.courses;
-- drop policy if exists teachers_all on public.teachers;
--
-- -- teachers: anon 전면 차단(토큰 덤프 불가). 접근은 RPC(정의자권한)로만.
-- --   → 정책을 하나도 만들지 않으면 RLS on + 정책無 = anon 직접접근 전부 거부.
-- alter table public.teachers enable row level security;
--
-- -- courses: anon 직접 SELECT/쓰기 모두 차단. 공개 조회는 board_public 뷰로만, 쓰기는 RPC로만.
-- alter table public.courses enable row level security;
-- -- (courses_all 개방정책을 지웠고 새 정책을 안 만들면 anon 직접접근 거부. board_public 뷰는 정의자=postgres 라 RLS 우회.)
--
-- -- 실시간 구독은 anon SELECT 가 없으면 동작하지 않음 → board 는 뷰 조회 + 수동/로드시 갱신으로 전환(코드에서 처리).
--
-- -- ── STEP 2 레드-그린 검증 (브라우저 콘솔 또는 curl) ──
-- --  차단 확인: anon 키로 아래가 이제 막혀야 함(이전엔 통과)
-- --    DELETE /rest/v1/courses?id=eq.<임의>   → 401/403
-- --    GET    /rest/v1/teachers?select=token  → 401/403 또는 빈 결과
-- --  정상 확인: resolve_teacher/get_my_courses/save_courses/board_public 은 계속 동작
