import { adminSupabase } from "@/lib/admin-server";
import {
  calculateHourlyRateFromMonthlyBase,
  calculateDailyShiftCompensations,
  loadPayrollRules,
  resolveOvertimeSettings,
} from "@/lib/payroll-rules";
import type { PayrollMode } from "@/lib/payroll-mode";

export type PayrollSummaryRow = {
  employeeId: string;
  fullName: string;
  email: string;
  hourlyRate: number;
  rateBaseAmount: number;
  rateKind: "hourly" | "monthly";
  workedMinutes: number;
  grossAmount: number;
  bonusesAmount: number;
  deductionsAmount: number;
  totalDue: number;
  paidAmount: number;
  balanceAmount: number;
};

export type PayrollPaymentRow = {
  id: string;
  employeeId: string;
  fullName: string;
  paymentDate: string;
  paymentType: "advance" | "salary";
  amount: number;
  comment: string | null;
  createdAt: string;
};

export type PayrollEmployeeDetail = {
  employee: {
    id: string;
    fullName: string;
    email: string;
    hourlyRate: number;
  };
  summary: PayrollSummaryRow;
  shifts: Array<{
    id: string;
    shiftDate: string;
    startedAt: string;
    endedAt: string | null;
    durationMinutes: number;
    status: string;
  }>;
  payments: PayrollPaymentRow[];
  adjustments: Array<{
    id: string;
    effectiveDate: string;
    kind: "bonus" | "deduction";
    amount: number;
    reason: string | null;
    createdAt: string;
  }>;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function numeric(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

type RatePoint = {
  effectiveFrom: string;
  createdAt: string;
  amount: number;
  standardDayHours: number;
};

function buildShiftRate(payrollMode: PayrollMode, employeeId: string, fallbackRate: number, startedAt: string, ratesByEmployee: Map<
  string,
  RatePoint[]
>) {
  const rates = ratesByEmployee.get(employeeId) ?? [];
  let selected: RatePoint = {
    effectiveFrom: "",
    createdAt: "",
    amount: fallbackRate,
    standardDayHours: 9,
  };
  if (payrollMode === "test") {
    const targetMonth = startedAt.slice(0, 7);
    selected = rates
      .filter((candidate) => candidate.effectiveFrom.slice(0, 7) <= targetMonth)
      .sort((a, b) => {
        const monthOrder = a.effectiveFrom.slice(0, 7).localeCompare(b.effectiveFrom.slice(0, 7));
        return monthOrder || a.createdAt.localeCompare(b.createdAt);
      })
      .at(-1) ?? selected;
  } else {
    for (const candidate of rates) {
      if (candidate.effectiveFrom <= startedAt) selected = candidate;
    }
  }
  return payrollMode === "test"
    ? calculateHourlyRateFromMonthlyBase(selected.amount, startedAt, selected.standardDayHours)
    : selected.amount;
}

export async function buildPayrollSummary(periodStart: string, periodEnd: string, payrollMode: PayrollMode = "main") {
  const [rules, employeesResult, shiftsResult, paymentsResult, adjustmentsResult, rateHistoryResult, ledgerResult] = await Promise.all([
    loadPayrollRules(payrollMode),
    adminSupabase
      .from("profiles")
      .select("id, full_name, email, is_active, employee_settings(hourly_rate)")
      .eq("role", "employee")
      .eq("is_active", true)
      .order("full_name", { ascending: true }),
    adminSupabase
      .from("shifts")
      .select("id, employee_id, shift_date, started_at, ended_at, duration_minutes, status")
      .eq("status", "closed")
      .gte("shift_date", periodStart)
      .lte("shift_date", periodEnd)
      .order("started_at", { ascending: false }),
    adminSupabase
      .from("salary_payments")
      .select("id, employee_id, payment_date, payment_type, amount, comment, created_at, profiles!salary_payments_employee_id_fkey(full_name)")
      .gte("payment_date", periodStart)
      .lte("payment_date", periodEnd)
      .eq("payroll_mode", payrollMode)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false }),
    adminSupabase
      .from("pay_adjustments")
      .select("employee_id, amount, kind, reason, effective_date")
      .gte("effective_date", periodStart)
      .lte("effective_date", periodEnd)
      .eq("payroll_mode", payrollMode),
    payrollMode === "test"
      ? adminSupabase
          .from("employee_payroll_rates")
          .select("employee_id, rate_amount, standard_day_hours, effective_from, created_at")
          .eq("payroll_mode", "test")
          .eq("rate_kind", "monthly")
          .order("effective_from", { ascending: true })
          .order("created_at", { ascending: true })
      : adminSupabase
          .from("employee_hourly_rates")
          .select("employee_id, hourly_rate, effective_from")
          .order("effective_from", { ascending: true }),
    adminSupabase
      .from("financial_ledger_entries")
      .select("employee_id, entry_type, amount, occurred_on")
      .gte("occurred_on", periodStart)
      .lte("occurred_on", periodEnd)
      .eq("payroll_mode", payrollMode),
  ]);

  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (shiftsResult.error) throw new Error(shiftsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);
  if (adjustmentsResult.error) throw new Error(adjustmentsResult.error.message);
  if (rateHistoryResult.error) throw new Error(rateHistoryResult.error.message);
  if (ledgerResult.error) throw new Error(ledgerResult.error.message);

  const rows = new Map<string, PayrollSummaryRow>();
  const paymentFallbacks = new Map<string, number>();
  const adjustmentFallbacks = new Map<string, { bonuses: number; deductions: number }>();
  const ledgerAdjustmentKinds = new Set<string>();
  const fallbackRateByEmployee = new Map<string, number>();
  const ratesByEmployee = new Map<string, RatePoint[]>();

  for (const employee of employeesResult.data ?? []) {
    const mainHourlyRate = numeric(
      relationFirst(
        employee.employee_settings as Array<{ hourly_rate: number }> | { hourly_rate: number } | null
      )?.hourly_rate
    );
    fallbackRateByEmployee.set(employee.id, payrollMode === "main" ? mainHourlyRate : 0);
    rows.set(employee.id, {
      employeeId: employee.id,
      fullName: employee.full_name ?? "Працівник",
      email: employee.email ?? "",
      hourlyRate: payrollMode === "main" ? mainHourlyRate : 0,
      rateBaseAmount: payrollMode === "main" ? mainHourlyRate : 0,
      rateKind: payrollMode === "test" ? "monthly" : "hourly",
      workedMinutes: 0,
      grossAmount: 0,
      bonusesAmount: 0,
      deductionsAmount: 0,
      totalDue: 0,
      paidAmount: 0,
      balanceAmount: 0,
    });
  }

  for (const rate of rateHistoryResult.data ?? []) {
    const list = ratesByEmployee.get(rate.employee_id) ?? [];
    list.push({
      effectiveFrom: String(rate.effective_from),
      createdAt: String("created_at" in rate ? rate.created_at : rate.effective_from),
      amount: numeric("rate_amount" in rate ? rate.rate_amount : rate.hourly_rate),
      standardDayHours: numeric("standard_day_hours" in rate ? rate.standard_day_hours : 9) || 9,
    });
    ratesByEmployee.set(rate.employee_id, list);
  }

  for (const row of rows.values()) {
    const rates = ratesByEmployee.get(row.employeeId) ?? [];
    const latest = payrollMode === "test"
      ? [...rates]
          .filter((rate) => rate.effectiveFrom.slice(0, 7) <= periodEnd.slice(0, 7))
          .sort((a, b) => {
            const monthOrder = a.effectiveFrom.slice(0, 7).localeCompare(b.effectiveFrom.slice(0, 7));
            return monthOrder || a.createdAt.localeCompare(b.createdAt);
          })
          .at(-1)
      : [...rates].reverse().find((rate) => rate.effectiveFrom.slice(0, 10) <= periodEnd);
    if (latest) {
      row.rateBaseAmount = latest.amount;
      row.hourlyRate = payrollMode === "test"
        ? calculateHourlyRateFromMonthlyBase(latest.amount, periodEnd, latest.standardDayHours)
        : latest.amount;
    }
  }

  const groupedShifts = new Map<string, Array<any>>();
  for (const shift of shiftsResult.data ?? []) {
    const key = String(shift.employee_id);
    const list = groupedShifts.get(key) ?? [];
    list.push(shift);
    groupedShifts.set(key, list);
  }

  for (const shifts of groupedShifts.values()) {
    const employeeId = String(shifts[0].employee_id);
    const row = rows.get(employeeId);
    if (!row) continue;

    const compensationMap = calculateDailyShiftCompensations({
      payrollMode,
      shifts: shifts.map((shift) => {
        const minutes = Math.max(0, Math.floor(numeric(shift.duration_minutes)));
        const startedAt = String(shift.started_at);
        return {
          shiftId: String(shift.id),
          employeeId,
          shiftDate: String(shift.shift_date),
          startedAt,
          endedAt: shift.ended_at ? String(shift.ended_at) : null,
          durationMinutes: minutes,
          hourlyRate: buildShiftRate(
            payrollMode,
            employeeId,
            fallbackRateByEmployee.get(employeeId) ?? 0,
            startedAt,
            ratesByEmployee
          ),
        };
      }),
      settings: rules.settings,
      breakPolicies: rules.breakPolicies,
      overtimePolicyResolver: (businessDate) =>
        resolveOvertimeSettings({
          payrollMode,
          shiftDate: businessDate,
          settings: rules.settings,
          overtimePeriodRules: rules.overtimePeriodRules,
        }),
    });

    for (const shift of shifts) {
      const compensation = compensationMap.get(String(shift.id));
      if (!compensation) continue;
      row.workedMinutes += compensation.payableMinutes;
      row.grossAmount += compensation.grossAmount;
    }
  }

  for (const adjustment of adjustmentsResult.data ?? []) {
    if (!rows.has(adjustment.employee_id)) continue;
    const amount = Math.abs(numeric(adjustment.amount));
    const fallback = adjustmentFallbacks.get(adjustment.employee_id) ?? { bonuses: 0, deductions: 0 };
    if (adjustment.kind === "bonus") fallback.bonuses += amount;
    if (adjustment.kind === "deduction") fallback.deductions += amount;
    adjustmentFallbacks.set(adjustment.employee_id, fallback);
  }

  for (const entry of ledgerResult.data ?? []) {
    const row = rows.get(entry.employee_id);
    if (!row) continue;
    const amount = numeric(entry.amount);
    if (entry.entry_type === "bonus") {
      row.bonusesAmount += Math.abs(amount);
      ledgerAdjustmentKinds.add(`${entry.employee_id}:bonus`);
    }
    if (entry.entry_type === "penalty") {
      row.deductionsAmount += Math.abs(amount);
      ledgerAdjustmentKinds.add(`${entry.employee_id}:deduction`);
    }
    if (entry.entry_type === "advance" || entry.entry_type === "payment") {
      row.paidAmount += Math.abs(amount);
    }
  }

  for (const payment of paymentsResult.data ?? []) {
    paymentFallbacks.set(
      payment.employee_id,
      roundMoney((paymentFallbacks.get(payment.employee_id) ?? 0) + numeric(payment.amount))
    );
  }

  for (const row of rows.values()) {
    const fallback = adjustmentFallbacks.get(row.employeeId);
    if (!ledgerAdjustmentKinds.has(`${row.employeeId}:bonus`)) {
      row.bonusesAmount = fallback?.bonuses ?? 0;
    }
    if (!ledgerAdjustmentKinds.has(`${row.employeeId}:deduction`)) {
      row.deductionsAmount = fallback?.deductions ?? 0;
    }
    if (row.paidAmount === 0) {
      row.paidAmount = paymentFallbacks.get(row.employeeId) ?? 0;
    }
  }

  for (const row of rows.values()) {
    row.bonusesAmount = roundMoney(row.bonusesAmount);
    row.deductionsAmount = roundMoney(row.deductionsAmount);
    row.paidAmount = roundMoney(row.paidAmount);
    row.totalDue = roundMoney(row.grossAmount + row.bonusesAmount - row.deductionsAmount);
    row.balanceAmount = roundMoney(row.totalDue - row.paidAmount);
  }

  const payments: PayrollPaymentRow[] = (paymentsResult.data ?? []).map((payment: any) => ({
    id: String(payment.id),
    employeeId: String(payment.employee_id),
    fullName: String(payment.profiles?.full_name ?? "Працівник"),
    paymentDate: String(payment.payment_date),
    paymentType: payment.payment_type === "advance" ? "advance" : "salary",
    amount: numeric(payment.amount),
    comment: payment.comment ?? null,
    createdAt: String(payment.created_at),
  }));

  return {
    rows: Array.from(rows.values()).sort((a, b) => a.fullName.localeCompare(b.fullName)),
    payments,
    totals: {
      totalWorkedMinutes: Array.from(rows.values()).reduce((sum, row) => sum + row.workedMinutes, 0),
      totalGrossAmount: roundMoney(Array.from(rows.values()).reduce((sum, row) => sum + row.grossAmount, 0)),
      totalPaidAmount: roundMoney(Array.from(rows.values()).reduce((sum, row) => sum + row.paidAmount, 0)),
      totalBalanceAmount: roundMoney(Array.from(rows.values()).reduce((sum, row) => sum + row.balanceAmount, 0)),
    },
  };
}

export async function buildPayrollEmployeeDetail(
  employeeId: string,
  periodStart: string,
  periodEnd: string,
  payrollMode: PayrollMode = "main"
): Promise<PayrollEmployeeDetail> {
  const [rules, profileResult, shiftsResult, paymentsResult, adjustmentsResult, rateHistoryResult] = await Promise.all([
    loadPayrollRules(payrollMode),
    adminSupabase
      .from("profiles")
      .select("id, full_name, email, employee_settings(hourly_rate)")
      .eq("id", employeeId)
      .single(),
    adminSupabase
      .from("shifts")
      .select("id, shift_date, started_at, ended_at, duration_minutes, status")
      .eq("employee_id", employeeId)
      .gte("shift_date", periodStart)
      .lte("shift_date", periodEnd)
      .order("started_at", { ascending: false }),
    adminSupabase
      .from("salary_payments")
      .select("id, employee_id, payment_date, payment_type, amount, comment, created_at")
      .eq("employee_id", employeeId)
      .gte("payment_date", periodStart)
      .lte("payment_date", periodEnd)
      .eq("payroll_mode", payrollMode)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false }),
    adminSupabase
      .from("pay_adjustments")
      .select("id, effective_date, kind, amount, reason, created_at")
      .eq("employee_id", employeeId)
      .gte("effective_date", periodStart)
      .lte("effective_date", periodEnd)
      .eq("payroll_mode", payrollMode)
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false }),
    payrollMode === "test"
      ? adminSupabase
          .from("employee_payroll_rates")
          .select("employee_id, rate_amount, standard_day_hours, effective_from, created_at")
          .eq("employee_id", employeeId)
          .eq("payroll_mode", "test")
          .eq("rate_kind", "monthly")
          .order("effective_from", { ascending: true })
          .order("created_at", { ascending: true })
      : adminSupabase
          .from("employee_hourly_rates")
          .select("employee_id, hourly_rate, effective_from")
          .eq("employee_id", employeeId)
          .order("effective_from", { ascending: true }),
  ]);

  if (profileResult.error) throw new Error(profileResult.error.message);
  if (shiftsResult.error) throw new Error(shiftsResult.error.message);
  if (paymentsResult.error) throw new Error(paymentsResult.error.message);
  if (adjustmentsResult.error) throw new Error(adjustmentsResult.error.message);
  if (rateHistoryResult.error) throw new Error(rateHistoryResult.error.message);

  const summaryResult = await buildPayrollSummary(periodStart, periodEnd, payrollMode);
  const summary = summaryResult.rows.find((row) => row.employeeId === employeeId);
  if (!summary) {
    throw new Error("Працівника не знайдено у зарплатній вибірці.");
  }

  const ratesByEmployee = new Map<string, RatePoint[]>();
  for (const rate of rateHistoryResult.data ?? []) {
    const list = ratesByEmployee.get(String(rate.employee_id)) ?? [];
    list.push({
      effectiveFrom: String(rate.effective_from),
      createdAt: String("created_at" in rate ? rate.created_at : rate.effective_from),
      amount: numeric("rate_amount" in rate ? rate.rate_amount : rate.hourly_rate),
      standardDayHours: numeric("standard_day_hours" in rate ? rate.standard_day_hours : 9) || 9,
    });
    ratesByEmployee.set(String(rate.employee_id), list);
  }

  const fallbackMainHourlyRate = numeric(
    relationFirst(
      profileResult.data.employee_settings as Array<{ hourly_rate: number }> | { hourly_rate: number } | null
    )?.hourly_rate
  );

  const compensationMap = new Map<string, { payableMinutes: number }>();
  const groupedEmployeeShifts = new Map<string, Array<any>>();
  for (const shift of shiftsResult.data ?? []) {
    const key = String(employeeId);
    const list = groupedEmployeeShifts.get(key) ?? [];
    list.push(shift);
    groupedEmployeeShifts.set(key, list);
  }

  for (const shifts of groupedEmployeeShifts.values()) {
    const dailyCompensationMap = calculateDailyShiftCompensations({
      payrollMode,
      shifts: shifts.map((shift) => {
        const startedAt = String(shift.started_at);
        return {
          shiftId: String(shift.id),
          employeeId,
          shiftDate: String(shift.shift_date),
          startedAt,
          endedAt: shift.ended_at ? String(shift.ended_at) : null,
          durationMinutes: Math.max(0, Math.floor(numeric(shift.duration_minutes))),
          hourlyRate: buildShiftRate(
            payrollMode,
            employeeId,
            payrollMode === "main" ? fallbackMainHourlyRate : 0,
            startedAt,
            ratesByEmployee
          ),
        };
      }),
      settings: rules.settings,
      breakPolicies: rules.breakPolicies,
      overtimePolicyResolver: (businessDate) =>
        resolveOvertimeSettings({
          payrollMode,
          shiftDate: businessDate,
          settings: rules.settings,
          overtimePeriodRules: rules.overtimePeriodRules,
        }),
    });

    for (const [shiftId, compensation] of dailyCompensationMap.entries()) {
      compensationMap.set(shiftId, compensation);
    }
  }

  return {
    employee: {
      id: String(profileResult.data.id),
      fullName: String(profileResult.data.full_name ?? "Працівник"),
      email: String(profileResult.data.email ?? ""),
      hourlyRate:
        summary.hourlyRate || (payrollMode === "main" ? fallbackMainHourlyRate : 0),
    },
    summary,
    shifts: (shiftsResult.data ?? []).map((shift) => {
      const compensation = compensationMap.get(String(shift.id));

      return {
        id: String(shift.id),
        shiftDate: String(shift.shift_date),
        startedAt: String(shift.started_at),
        endedAt: shift.ended_at ? String(shift.ended_at) : null,
        durationMinutes: compensation?.payableMinutes ?? 0,
        status: String(shift.status),
      };
    }),
    payments: (paymentsResult.data ?? []).map((payment) => ({
      id: String(payment.id),
      employeeId: String(payment.employee_id),
      fullName: String(profileResult.data.full_name ?? "Працівник"),
      paymentDate: String(payment.payment_date),
      paymentType: payment.payment_type === "advance" ? "advance" : "salary",
      amount: numeric(payment.amount),
      comment: payment.comment ?? null,
      createdAt: String(payment.created_at),
    })),
    adjustments: (adjustmentsResult.data ?? []).map((adjustment) => ({
      id: String(adjustment.id),
      effectiveDate: String(adjustment.effective_date),
      kind: adjustment.kind === "bonus" ? "bonus" : "deduction",
      amount: numeric(adjustment.amount),
      reason: adjustment.reason ?? null,
      createdAt: String(adjustment.created_at),
    })),
  };
}
