-- Review before running on a dedicated trial database.
begin;

create table public.eigo_pre_approvals (
  curriculum_commit text not null check (curriculum_commit ~ '^[0-9a-f]{40}$'),
  unit_key text not null check (unit_key ~ '^[1-7]-[1-5]$'),
  approved_by uuid not null,
  approved_name text not null,
  approved_at timestamptz not null,
  primary key (curriculum_commit, unit_key)
);

create table public.eigo_pre_progress (
  curriculum_commit text not null check (curriculum_commit ~ '^[0-9a-f]{40}$'),
  learner_id uuid not null,
  unit_key text not null check (unit_key ~ '^[1-7]-[1-5]$'),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  revision integer not null check (revision >= 1),
  primary key (curriculum_commit, learner_id, unit_key)
);

create table public.eigo_pre_sessions (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null,
  role text not null check (role in ('teacher', 'student')),
  expires_at timestamptz not null
);

alter table public.eigo_pre_approvals enable row level security;
alter table public.eigo_pre_progress enable row level security;
alter table public.eigo_pre_sessions enable row level security;

revoke all on public.eigo_pre_approvals, public.eigo_pre_progress, public.eigo_pre_sessions
  from public, anon, authenticated, service_role;
grant select, insert on public.eigo_pre_approvals to service_role;
grant select, insert, update on public.eigo_pre_progress to service_role;
grant select, insert, delete on public.eigo_pre_sessions to service_role;

commit;
