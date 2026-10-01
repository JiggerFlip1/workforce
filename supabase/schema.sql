-- Jigger Flip workforce management schema for Supabase/Postgres.
-- Safe to run repeatedly: types are guarded, tables use IF NOT EXISTS,
-- policies are recreated, and the 4C worksite is inserted once.

create extension if not exists pgcrypto;

do $$ begin create type public.user_role as enum ('admin','manager','employee'); exception when duplicate_object then null; end $$;
do $$ begin create type public.attendance_type as enum ('clock_in','clock_out'); exception when duplicate_object then null; end $$;
do $$ begin create type public.attendance_verification as enum ('verified','outside_radius','location_unavailable','manual_review'); exception when duplicate_object then null; end $$;
do $$ begin create type public.request_status as enum ('pending','approved','rejected'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique, full_name text not null, date_of_birth date,
  role public.user_role not null default 'employee', status text not null default 'active',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.sensitive_employee_data (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  identity_number_ciphertext text, bank_account_ciphertext text,
  identity_last4 text, bank_account_last4 text, updated_at timestamptz not null default now()
);
create table if not exists public.worksites (
  id uuid primary key default gen_random_uuid(), name text not null, address text not null,
  latitude numeric(9,6) not null, longitude numeric(9,6) not null,
  radius_meters integer not null default 50 check (radius_meters > 0), active boolean not null default true
);
create table if not exists public.shift_templates (
  id uuid primary key default gen_random_uuid(), name text not null, start_time time not null,
  end_time time not null, crosses_midnight boolean not null default false,
  worksite_id uuid references public.worksites(id), active boolean not null default true,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
  work_date date not null, start_time time not null, end_time time not null,
  crosses_midnight boolean not null default false, worksite_id uuid references public.worksites(id),
  template_id uuid references public.shift_templates(id), status text not null default 'draft',
  created_by uuid references public.profiles(id), unique (employee_id, work_date)
);
create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
  shift_id uuid references public.shifts(id), attendance_type public.attendance_type not null,
  recorded_at timestamptz not null default now(), latitude numeric(9,6), longitude numeric(9,6),
  accuracy_meters numeric(8,2), distance_from_worksite_meters numeric(8,2),
  verification public.attendance_verification not null, device_label text, created_at timestamptz not null default now()
);
create table if not exists public.attendance_requests (
  id uuid primary key default gen_random_uuid(), employee_id uuid not null references public.profiles(id),
  request_type text not null default 'missing_punch', requested_at timestamptz not null, reason text not null,
  status public.request_status not null default 'pending', reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id),
  action text not null, target_table text not null, target_id uuid,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

insert into public.worksites (name,address,latitude,longitude,radius_meters)
select '4C 工作室','大角嘴合桃街 2 號福星工廠大廈 4C 室',22.3225694,114.1629615,50
where not exists (select 1 from public.worksites where name='4C 工作室' and address='大角嘴合桃街 2 號福星工廠大廈 4C 室');

alter table public.profiles enable row level security;
alter table public.sensitive_employee_data enable row level security;
alter table public.worksites enable row level security;
alter table public.shift_templates enable row level security;
alter table public.shifts enable row level security;
alter table public.attendance_logs enable row level security;
alter table public.attendance_requests enable row level security;
alter table public.audit_logs enable row level security;

create or replace function public.current_user_role() returns public.user_role
language sql stable security definer set search_path=public as $$
  select role from public.profiles where id=auth.uid() limit 1
$$;
revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;
grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id=auth.uid() or public.current_user_role() in ('admin','manager'));
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert to authenticated with check (id=auth.uid() and role='employee');
drop policy if exists profiles_admin_insert on public.profiles;
create policy profiles_admin_insert on public.profiles for insert to authenticated with check (public.current_user_role()='admin');
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated using (public.current_user_role()='admin');

drop policy if exists sensitive_admin_all on public.sensitive_employee_data;
create policy sensitive_admin_all on public.sensitive_employee_data for all to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
drop policy if exists worksites_select on public.worksites;
create policy worksites_select on public.worksites for select to authenticated using (true);
drop policy if exists worksites_admin_write on public.worksites;
create policy worksites_admin_write on public.worksites for all to authenticated using (public.current_user_role()='admin') with check (public.current_user_role()='admin');
drop policy if exists shift_templates_select on public.shift_templates;
create policy shift_templates_select on public.shift_templates for select to authenticated using (true);
drop policy if exists shift_templates_management on public.shift_templates;
create policy shift_templates_management on public.shift_templates for all to authenticated using (public.current_user_role() in ('admin','manager')) with check (public.current_user_role() in ('admin','manager'));

drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts for select to authenticated using (employee_id=auth.uid() or public.current_user_role() in ('admin','manager'));
drop policy if exists shifts_management on public.shifts;
create policy shifts_management on public.shifts for all to authenticated using (public.current_user_role() in ('admin','manager')) with check (public.current_user_role() in ('admin','manager'));
drop policy if exists attendance_logs_select on public.attendance_logs;
create policy attendance_logs_select on public.attendance_logs for select to authenticated using (employee_id=auth.uid() or public.current_user_role() in ('admin','manager'));
drop policy if exists attendance_logs_self_insert on public.attendance_logs;
create policy attendance_logs_self_insert on public.attendance_logs for insert to authenticated with check (employee_id=auth.uid());
drop policy if exists attendance_logs_management on public.attendance_logs;
create policy attendance_logs_management on public.attendance_logs for all to authenticated using (public.current_user_role() in ('admin','manager')) with check (public.current_user_role() in ('admin','manager'));

drop policy if exists attendance_requests_select on public.attendance_requests;
create policy attendance_requests_select on public.attendance_requests for select to authenticated using (employee_id=auth.uid() or public.current_user_role() in ('admin','manager'));
drop policy if exists attendance_requests_self_insert on public.attendance_requests;
create policy attendance_requests_self_insert on public.attendance_requests for insert to authenticated with check (employee_id=auth.uid() and status='pending' and reviewed_by is null and reviewed_at is null);
drop policy if exists attendance_requests_review on public.attendance_requests;
create policy attendance_requests_review on public.attendance_requests for update to authenticated using (public.current_user_role() in ('admin','manager')) with check (public.current_user_role() in ('admin','manager'));
drop policy if exists audit_logs_admin_select on public.audit_logs;
create policy audit_logs_admin_select on public.audit_logs for select to authenticated using (public.current_user_role()='admin');
drop policy if exists audit_logs_actor_insert on public.audit_logs;
create policy audit_logs_actor_insert on public.audit_logs for insert to authenticated with check (actor_id=auth.uid());

alter default privileges in schema public grant select,insert,update,delete on tables to authenticated;
