export type PayrollMode = "main" | "test" | "test_2";

export const TEST_PAYROLL_MODES = ["test", "test_2"] as const;

export function isTestPayrollMode(mode: PayrollMode) {
  return mode !== "main";
}

export function isMonthlyPayrollMode(mode: PayrollMode) {
  return mode === "test";
}

export function normalizePayrollMode(value: unknown): PayrollMode {
  if (value === "test" || value === "test_2") return value;
  return "main";
}

export function payrollModeLabel(mode: PayrollMode) {
  if (mode === "test") return "Тестовий";
  if (mode === "test_2") return "Тестовий 2";
  return "Основний";
}
