-- A third, fully isolated payroll mode. Existing rows are not changed.
-- Test mode 2 uses an hourly rate (155 UAH/hour by default) and its own financial records.

begin;

alter table public.employee_overtime_policies
  drop constraint if exists employee_overtime_policies_payroll_mode_check;
alter table public.employee_overtime_policies
  add constraint employee_overtime_policies_payroll_mode_check check (payroll_mode in ('main', 'test', 'test_2'));

alter table public.payroll_periods drop constraint if exists payroll_periods_payroll_mode_check;
alter table public.payroll_periods add constraint payroll_periods_payroll_mode_check check (payroll_mode in ('main', 'test', 'test_2'));
alter table public.pay_adjustments drop constraint if exists pay_adjustments_payroll_mode_check;
alter table public.pay_adjustments add constraint pay_adjustments_payroll_mode_check check (payroll_mode in ('main', 'test', 'test_2'));
alter table public.salary_payments drop constraint if exists salary_payments_payroll_mode_check;
alter table public.salary_payments add constraint salary_payments_payroll_mode_check check (payroll_mode in ('main', 'test', 'test_2'));
alter table public.financial_ledger_entries drop constraint if exists financial_ledger_entries_payroll_mode_check;
alter table public.financial_ledger_entries add constraint financial_ledger_entries_payroll_mode_check check (payroll_mode in ('main', 'test', 'test_2'));
alter table public.payroll_runs drop constraint if exists payroll_runs_payroll_mode_check;
alter table public.payroll_runs add constraint payroll_runs_payroll_mode_check check (payroll_mode in ('main', 'test', 'test_2'));

alter table public.employee_payroll_rates
  drop constraint if exists employee_payroll_rates_payroll_mode_check;
alter table public.employee_payroll_rates
  add constraint employee_payroll_rates_payroll_mode_check check (payroll_mode in ('main', 'test', 'test_2'));

alter table public.payroll_overtime_period_rules
  drop constraint if exists payroll_overtime_period_rules_payroll_mode_check;
alter table public.payroll_overtime_period_rules
  add constraint payroll_overtime_period_rules_payroll_mode_check check (payroll_mode in ('main', 'test', 'test_2'));

commit;
