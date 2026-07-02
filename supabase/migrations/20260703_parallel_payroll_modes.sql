-- Two independent payroll modes over the same employees and shifts.
-- Existing financial rows remain in the main mode; no data is deleted.

begin;

alter table public.company_settings
  add column if not exists overtime_enabled boolean not null default true,
  add column if not exists overtime_daily_threshold_minutes integer not null default 540,
  add column if not exists overtime_multiplier numeric(6,2) not null default 1.25;

create table if not exists public.employee_overtime_policies (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  payroll_mode text not null default 'test' check (payroll_mode in ('main', 'test')),
  weekday integer not null check (weekday between 1 and 7),
  overtime_enabled boolean not null default false,
  overtime_multiplier numeric(6,2) not null default 1.25 check (overtime_multiplier in (1.25, 1.50)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_payroll_rates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  payroll_mode text not null default 'test' check (payroll_mode in ('main', 'test')),
  rate_kind text not null check (rate_kind in ('hourly', 'monthly')),
  rate_amount numeric(12,2) not null check (rate_amount >= 0),
  standard_day_hours numeric(5,2) not null default 9 check (standard_day_hours > 0),
  effective_from timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists employee_payroll_rates_effective_idx
  on public.employee_payroll_rates (employee_id, payroll_mode, effective_from desc);

alter table public.employee_overtime_policies
  add column if not exists payroll_mode text not null default 'test';
alter table public.employee_overtime_policies
  drop constraint if exists employee_overtime_policies_payroll_mode_check;
alter table public.employee_overtime_policies
  add constraint employee_overtime_policies_payroll_mode_check check (payroll_mode in ('main', 'test'));
alter table public.employee_overtime_policies
  drop constraint if exists employee_overtime_policies_employee_id_weekday_key;

create unique index if not exists employee_overtime_policies_mode_weekday_uidx
  on public.employee_overtime_policies (employee_id, payroll_mode, weekday);

alter table public.payroll_periods add column if not exists payroll_mode text not null default 'main';
alter table public.pay_adjustments add column if not exists payroll_mode text not null default 'main';
alter table public.salary_payments add column if not exists payroll_mode text not null default 'main';
alter table public.financial_ledger_entries add column if not exists payroll_mode text not null default 'main';
alter table public.payroll_runs add column if not exists payroll_mode text not null default 'main';

alter table public.payroll_periods drop constraint if exists payroll_periods_payroll_mode_check;
alter table public.payroll_periods add constraint payroll_periods_payroll_mode_check check (payroll_mode in ('main', 'test'));
alter table public.pay_adjustments drop constraint if exists pay_adjustments_payroll_mode_check;
alter table public.pay_adjustments add constraint pay_adjustments_payroll_mode_check check (payroll_mode in ('main', 'test'));
alter table public.salary_payments drop constraint if exists salary_payments_payroll_mode_check;
alter table public.salary_payments add constraint salary_payments_payroll_mode_check check (payroll_mode in ('main', 'test'));
alter table public.financial_ledger_entries drop constraint if exists financial_ledger_entries_payroll_mode_check;
alter table public.financial_ledger_entries add constraint financial_ledger_entries_payroll_mode_check check (payroll_mode in ('main', 'test'));
alter table public.payroll_runs drop constraint if exists payroll_runs_payroll_mode_check;
alter table public.payroll_runs add constraint payroll_runs_payroll_mode_check check (payroll_mode in ('main', 'test'));

alter table public.payroll_periods drop constraint if exists payroll_periods_period_start_period_end_key;
create unique index if not exists payroll_periods_range_mode_uidx
  on public.payroll_periods (period_start, period_end, payroll_mode);

create index if not exists salary_payments_mode_employee_date_idx
  on public.salary_payments (payroll_mode, employee_id, payment_date desc);
create index if not exists pay_adjustments_mode_employee_date_idx
  on public.pay_adjustments (payroll_mode, employee_id, effective_date desc);
create index if not exists financial_ledger_mode_employee_date_idx
  on public.financial_ledger_entries (payroll_mode, employee_id, occurred_on desc);
create index if not exists payroll_runs_mode_period_idx
  on public.payroll_runs (payroll_mode, period_start desc, period_end desc);

alter table public.employee_payroll_rates enable row level security;
alter table public.employee_overtime_policies enable row level security;

drop policy if exists "employee payroll rates self or admin select" on public.employee_payroll_rates;
create policy "employee payroll rates self or admin select"
on public.employee_payroll_rates for select
using (employee_id = auth.uid() or public.is_admin());

drop policy if exists "employee payroll rates admin insert" on public.employee_payroll_rates;
create policy "employee payroll rates admin insert"
on public.employee_payroll_rates for insert
with check (public.is_admin());

drop policy if exists "employee overtime self or admin select" on public.employee_overtime_policies;
create policy "employee overtime self or admin select"
on public.employee_overtime_policies for select
using (employee_id = auth.uid() or public.is_admin());

drop policy if exists "employee overtime admin manage" on public.employee_overtime_policies;
create policy "employee overtime admin manage"
on public.employee_overtime_policies for all
using (public.is_admin())
with check (public.is_admin());

commit;
