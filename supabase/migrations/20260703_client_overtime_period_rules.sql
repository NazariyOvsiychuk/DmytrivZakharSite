-- Client overtime policy: default 1.25 after 9 hours and global date-range overrides.

begin;

create table if not exists public.payroll_overtime_period_rules (
  id uuid primary key default gen_random_uuid(),
  payroll_mode text not null default 'test' check (payroll_mode in ('main', 'test')),
  period_start date not null,
  period_end date not null,
  overtime_multiplier numeric(6,2) not null check (overtime_multiplier in (1.25, 1.50)),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists payroll_overtime_period_rules_range_idx
  on public.payroll_overtime_period_rules (payroll_mode, period_start, period_end);

alter table public.payroll_overtime_period_rules enable row level security;

drop policy if exists "overtime periods admin select" on public.payroll_overtime_period_rules;
create policy "overtime periods admin select"
on public.payroll_overtime_period_rules for select
using (public.is_admin());

drop policy if exists "overtime periods admin manage" on public.payroll_overtime_period_rules;
create policy "overtime periods admin manage"
on public.payroll_overtime_period_rules for all
using (public.is_admin())
with check (public.is_admin());

commit;
