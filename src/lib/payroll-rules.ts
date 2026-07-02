import { adminSupabase } from "@/lib/admin-server";
import type { PayrollMode } from "@/lib/payroll-mode";

export type PayrollCompanySettings = {
  nightShiftEnabled: boolean;
  nightShiftStart: string;
  nightShiftEnd: string;
  nightShiftMultiplier: number;
  overtimeEnabled: boolean;
  overtimeDailyThresholdMinutes: number;
  overtimeMultiplier: number;
};

export type EmployeeOvertimePolicy = {
  employeeId: string;
  weekday: number;
  overtimeEnabled: boolean;
  overtimeMultiplier: number;
};

export type BreakPolicy = {
  id: string;
  title: string;
  breakType: "paid" | "unpaid";
  durationMinutes: number;
  autoApply: boolean;
  isRequired: boolean;
  deductFromPayroll: boolean;
  triggerAfterMinutes: number | null;
  breakStartTime: string | null;
  breakEndTime: string | null;
  isActive: boolean;
};

export type ShiftCompensation = {
  payableMinutes: number;
  unpaidBreakMinutes: number;
  nightMinutes: number;
  overtimeMinutes: number;
  baseAmount: number;
  nightExtraAmount: number;
  overtimeExtraAmount: number;
  grossAmount: number;
};

export type DailyShiftCompensationInput = {
  shiftId: string;
  employeeId: string;
  shiftDate: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  hourlyRate: number;
};

function numeric(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export const STANDARD_WORKDAY_HOURS = 9;

function isoWeekday(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  const weekday = date.getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function countWeekdaysMondayToFridayInMonth(dateValue: string) {
  const date = new Date(`${dateValue.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 0;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const cursor = new Date(Date.UTC(year, month, 1));
  const nextMonth = new Date(Date.UTC(year, month + 1, 1));

  let count = 0;
  while (cursor.getTime() < nextMonth.getTime()) {
    const weekday = cursor.getUTCDay();
    if (weekday >= 1 && weekday <= 5) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function calculateHourlyRateFromMonthlyBase(monthlyBase: number, dateValue: string, standardDayHours = STANDARD_WORKDAY_HOURS) {
  const base = numeric(monthlyBase);
  const businessDays = countWeekdaysMondayToFridayInMonth(dateValue);
  const hours = numeric(standardDayHours);
  if (base <= 0 || businessDays <= 0 || hours <= 0) return 0;
  return base / businessDays / hours;
}

function formatBusinessDate(value: Date | string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kiev",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(typeof value === "string" ? new Date(value) : value);
}

function businessMinutesOfDay(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kiev",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function splitShiftAcrossBusinessDates(startedAt: string, endedAt: string, totalMinutes: number) {
  const startDate = formatBusinessDate(startedAt);
  const endDate = formatBusinessDate(endedAt);

  if (startDate === endDate) {
    return [{ date: startDate, rawMinutes: totalMinutes, startedAt }];
  }

  const firstDayMinutes = Math.max(0, Math.min(totalMinutes, 1440 - businessMinutesOfDay(startedAt)));
  const secondDayMinutes = Math.max(0, totalMinutes - firstDayMinutes);

  return [
    { date: startDate, rawMinutes: firstDayMinutes, startedAt },
    { date: endDate, rawMinutes: secondDayMinutes, startedAt: endedAt },
  ].filter((segment) => segment.rawMinutes > 0);
}

function allocateMinutesProportionally(totalMinutes: number, segments: Array<{ rawMinutes: number }>) {
  const rawTotal = segments.reduce((sum, segment) => sum + segment.rawMinutes, 0);
  if (totalMinutes <= 0 || rawTotal <= 0) {
    return segments.map(() => 0);
  }

  const allocations = segments.map((segment) => Math.floor((totalMinutes * segment.rawMinutes) / rawTotal));
  let remainder = totalMinutes - allocations.reduce((sum, value) => sum + value, 0);

  const order = segments
    .map((segment, index) => ({ index, rawMinutes: segment.rawMinutes }))
    .sort((a, b) => b.rawMinutes - a.rawMinutes);

  for (const item of order) {
    if (remainder <= 0) break;
    allocations[item.index] += 1;
    remainder -= 1;
  }

  return allocations;
}

function parseTimeToMinutes(value: string | null | undefined) {
  if (!value || !/^\d{2}:\d{2}/.test(value)) return null;
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function overlapMinutes(startA: Date, endA: Date, startB: Date, endB: Date) {
  const start = Math.max(startA.getTime(), startB.getTime());
  const end = Math.min(endA.getTime(), endB.getTime());
  if (end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function buildWindowForDate(date: Date, startMinutes: number, endMinutes: number) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setMinutes(startMinutes);

  const end = new Date(date);
  end.setHours(0, 0, 0, 0);
  end.setMinutes(endMinutes);

  if (endMinutes <= startMinutes) {
    end.setDate(end.getDate() + 1);
  }

  return { start, end };
}

function enumerateShiftDays(start: Date, end: Date) {
  const days: Date[] = [];
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const limit = new Date(end);
  limit.setHours(0, 0, 0, 0);

  while (current.getTime() <= limit.getTime()) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return days;
}

function getShiftEnd(startedAt: string, endedAt: string | null, durationMinutes: number) {
  const start = new Date(startedAt);
  if (endedAt) {
    return new Date(endedAt);
  }
  return new Date(start.getTime() + durationMinutes * 60000);
}

export async function loadPayrollRules(payrollMode: PayrollMode = "main") {
  const [settingsResult, breaksResult, employeeOvertimePoliciesResult] = await Promise.all([
    adminSupabase
      .from("company_settings")
      .select("night_shift_enabled, night_shift_start, night_shift_end, night_shift_multiplier, overtime_enabled, overtime_daily_threshold_minutes, overtime_multiplier")
      .eq("singleton_key", "default")
      .maybeSingle(),
    adminSupabase
      .from("company_break_policies")
      .select("id, title, break_type, duration_minutes, auto_apply, is_required, deduct_from_payroll, trigger_after_minutes, break_start_time, break_end_time, is_active")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    adminSupabase
      .from("employee_overtime_policies")
      .select("employee_id, weekday, overtime_enabled, overtime_multiplier")
      .eq("payroll_mode", payrollMode)
      .order("employee_id", { ascending: true })
      .order("weekday", { ascending: true }),
  ]);

  if (settingsResult.error) throw new Error(settingsResult.error.message);
  if (breaksResult.error) throw new Error(breaksResult.error.message);
  if (employeeOvertimePoliciesResult.error) throw new Error(employeeOvertimePoliciesResult.error.message);

  const settings: PayrollCompanySettings = {
    nightShiftEnabled: Boolean(settingsResult.data?.night_shift_enabled),
    nightShiftStart: String(settingsResult.data?.night_shift_start ?? "22:00"),
    nightShiftEnd: String(settingsResult.data?.night_shift_end ?? "06:00"),
    nightShiftMultiplier: Math.max(1, numeric(settingsResult.data?.night_shift_multiplier) || 1),
    overtimeEnabled: Boolean(settingsResult.data?.overtime_enabled ?? true),
    overtimeDailyThresholdMinutes: Math.max(0, Math.floor(numeric(settingsResult.data?.overtime_daily_threshold_minutes) || 540)),
    overtimeMultiplier: [1.25, 1.5].includes(numeric(settingsResult.data?.overtime_multiplier))
      ? numeric(settingsResult.data?.overtime_multiplier)
      : 1.25,
  };

  const breakPolicies: BreakPolicy[] = (breaksResult.data ?? []).map((row: any) => ({
    id: String(row.id),
    title: String(row.title ?? "Перерва"),
    breakType: row.break_type === "paid" ? "paid" : "unpaid",
    durationMinutes: Math.max(0, numeric(row.duration_minutes)),
    autoApply: Boolean(row.auto_apply),
    isRequired: Boolean(row.is_required),
    deductFromPayroll: Boolean(row.deduct_from_payroll),
    triggerAfterMinutes: row.trigger_after_minutes == null ? null : Math.max(0, numeric(row.trigger_after_minutes)),
    breakStartTime: row.break_start_time ? String(row.break_start_time).slice(0, 5) : null,
    breakEndTime: row.break_end_time ? String(row.break_end_time).slice(0, 5) : null,
    isActive: Boolean(row.is_active),
  }));

  const employeeOvertimePolicies: EmployeeOvertimePolicy[] = (employeeOvertimePoliciesResult.data ?? []).map(
    (row: any) => ({
      employeeId: String(row.employee_id),
      weekday: Math.min(7, Math.max(1, numeric(row.weekday))),
      overtimeEnabled: Boolean(row.overtime_enabled),
      overtimeMultiplier: [1.25, 1.5].includes(numeric(row.overtime_multiplier))
        ? numeric(row.overtime_multiplier)
        : 1.25,
    })
  );

  return { settings, breakPolicies, employeeOvertimePolicies };
}

export function resolveOvertimeSettings(args: {
  employeeId: string;
  shiftDate: string;
  settings: PayrollCompanySettings;
  employeeOvertimePolicies: EmployeeOvertimePolicy[];
}) {
  const weekday = isoWeekday(args.shiftDate);
  const override = args.employeeOvertimePolicies.find(
    (policy) => policy.employeeId === args.employeeId && policy.weekday === weekday
  );

  if (!override) {
    return {
      enabled: args.settings.overtimeEnabled,
      thresholdMinutes: args.settings.overtimeDailyThresholdMinutes,
      multiplier: args.settings.overtimeMultiplier,
      source: "default" as const,
    };
  }

  return {
    enabled: override.overtimeEnabled,
    thresholdMinutes: 540,
    multiplier: override.overtimeMultiplier,
    source: "employee" as const,
  };
}

export function calculateShiftCompensation(input: {
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  hourlyRate: number;
  settings: PayrollCompanySettings;
  breakPolicies: BreakPolicy[];
}) {
  const startedAt = new Date(input.startedAt);
  const endedAt = getShiftEnd(input.startedAt, input.endedAt, input.durationMinutes);
  const totalMinutes = Math.max(0, Math.floor(input.durationMinutes));

  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || totalMinutes <= 0) {
    return {
      payableMinutes: 0,
      unpaidBreakMinutes: 0,
      nightMinutes: 0,
      overtimeMinutes: 0,
      baseAmount: 0,
      nightExtraAmount: 0,
      overtimeExtraAmount: 0,
      grossAmount: 0,
    } satisfies ShiftCompensation;
  }

  let unpaidBreakMinutes = 0;
  const shiftDays = enumerateShiftDays(startedAt, endedAt);

  for (const policy of input.breakPolicies) {
    if (!policy.isActive) continue;
    if (!policy.autoApply) continue;
    if (policy.breakType !== "unpaid") continue;
    if (!policy.deductFromPayroll) continue;
    if (policy.triggerAfterMinutes != null && totalMinutes < policy.triggerAfterMinutes) continue;

    const breakStartMinutes = parseTimeToMinutes(policy.breakStartTime);
    const breakEndMinutes = parseTimeToMinutes(policy.breakEndTime);

    if (breakStartMinutes != null && breakEndMinutes != null) {
      let overlapped = 0;
      for (const day of shiftDays) {
        const window = buildWindowForDate(day, breakStartMinutes, breakEndMinutes);
        overlapped += overlapMinutes(startedAt, endedAt, window.start, window.end);
      }
      unpaidBreakMinutes += overlapped;
      continue;
    }

    unpaidBreakMinutes += Math.max(0, policy.durationMinutes);
  }

  unpaidBreakMinutes = Math.min(totalMinutes, unpaidBreakMinutes);
  const payableMinutes = Math.max(0, totalMinutes - unpaidBreakMinutes);

  let nightMinutes = 0;
  if (input.settings.nightShiftEnabled) {
    const nightStartMinutes = parseTimeToMinutes(input.settings.nightShiftStart);
    const nightEndMinutes = parseTimeToMinutes(input.settings.nightShiftEnd);
    if (nightStartMinutes != null && nightEndMinutes != null) {
      for (const day of shiftDays) {
        const window = buildWindowForDate(day, nightStartMinutes, nightEndMinutes);
        nightMinutes += overlapMinutes(startedAt, endedAt, window.start, window.end);
      }
      nightMinutes = Math.min(payableMinutes, nightMinutes);
    }
  }

  const baseAmount = (payableMinutes / 60) * input.hourlyRate;
  const nightExtraAmount =
    input.settings.nightShiftEnabled && input.settings.nightShiftMultiplier > 1
      ? (nightMinutes / 60) * input.hourlyRate * (input.settings.nightShiftMultiplier - 1)
      : 0;

  return {
    payableMinutes,
    unpaidBreakMinutes,
    nightMinutes,
    overtimeMinutes: 0,
    baseAmount: roundMoney(baseAmount),
    nightExtraAmount: roundMoney(nightExtraAmount),
    overtimeExtraAmount: 0,
    grossAmount: roundMoney(baseAmount + nightExtraAmount),
  } satisfies ShiftCompensation;
}

export function calculateDailyShiftCompensations(input: {
  shifts: DailyShiftCompensationInput[];
  settings: PayrollCompanySettings;
  breakPolicies: BreakPolicy[];
  overtimePolicyResolver?: (businessDate: string) => {
    enabled: boolean;
    thresholdMinutes: number;
    multiplier: number;
  };
}) {
  const baseRows = input.shifts
    .map((shift) => ({
      ...shift,
      compensation: calculateShiftCompensation({
        startedAt: shift.startedAt,
        endedAt: shift.endedAt,
        durationMinutes: shift.durationMinutes,
        hourlyRate: shift.hourlyRate,
        settings: input.settings,
        breakPolicies: input.breakPolicies,
      }),
    }))
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  const shiftResults = new Map(
    baseRows.map((row) => [
      row.shiftId,
      {
        ...row.compensation,
        grossAmount: roundMoney(row.compensation.baseAmount + row.compensation.nightExtraAmount),
      } satisfies ShiftCompensation,
    ])
  );

  const segmentsByBusinessDate = new Map<
    string,
    Array<{ shiftId: string; startedAt: string; payableMinutes: number; hourlyRate: number }>
  >();

  for (const row of baseRows) {
    if (row.compensation.payableMinutes <= 0) continue;
    const endedAt = row.endedAt ?? new Date(new Date(row.startedAt).getTime() + row.durationMinutes * 60000).toISOString();
    const segments = splitShiftAcrossBusinessDates(row.startedAt, endedAt, row.durationMinutes);
    const allocatedPayable = allocateMinutesProportionally(row.compensation.payableMinutes, segments);

    segments.forEach((segment, index) => {
      const list = segmentsByBusinessDate.get(segment.date) ?? [];
      list.push({
        shiftId: row.shiftId,
        startedAt: segment.startedAt,
        payableMinutes: allocatedPayable[index] ?? 0,
        hourlyRate: row.hourlyRate,
      });
      segmentsByBusinessDate.set(segment.date, list);
    });
  }

  for (const [businessDate, segments] of segmentsByBusinessDate.entries()) {
    const overtimePolicy =
      input.overtimePolicyResolver?.(businessDate) ?? {
        enabled: input.settings.overtimeEnabled,
        thresholdMinutes: input.settings.overtimeDailyThresholdMinutes,
        multiplier: input.settings.overtimeMultiplier,
      };

    if (!overtimePolicy.enabled) continue;

    const thresholdMinutes = Math.max(0, Math.floor(overtimePolicy.thresholdMinutes));
    const multiplier = [1.25, 1.5].includes(overtimePolicy.multiplier) ? overtimePolicy.multiplier : 1.25;
    let cumulativeMinutes = 0;

    for (const segment of [...segments].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())) {
      const regularBeforeSegment = Math.min(cumulativeMinutes, thresholdMinutes);
      const regularCapacity = Math.max(0, thresholdMinutes - regularBeforeSegment);
      const overtimeMinutes = Math.max(0, segment.payableMinutes - regularCapacity);
      cumulativeMinutes += segment.payableMinutes;
      if (overtimeMinutes <= 0) continue;

      const result = shiftResults.get(segment.shiftId);
      if (!result) continue;

      const overtimeExtraAmount = (overtimeMinutes / 60) * segment.hourlyRate * (multiplier - 1);
      result.overtimeMinutes += overtimeMinutes;
      result.overtimeExtraAmount = roundMoney(result.overtimeExtraAmount + overtimeExtraAmount);
      result.grossAmount = roundMoney(result.baseAmount + result.nightExtraAmount + result.overtimeExtraAmount);
      shiftResults.set(segment.shiftId, result);
    }
  }

  return shiftResults;
}
