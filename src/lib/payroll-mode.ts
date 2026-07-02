export type PayrollMode = "main" | "test";

export function normalizePayrollMode(value: unknown): PayrollMode {
  return value === "test" ? "test" : "main";
}

export function payrollModeLabel(mode: PayrollMode) {
  return mode === "test" ? "Тестовий" : "Основний";
}
