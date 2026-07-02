import { PayrollAdminPage } from "@/components/payroll-admin";
import { normalizePayrollMode } from "@/lib/payroll-mode";

export default function AdminPayrollPage({ searchParams }: { searchParams?: { mode?: string } }) {
  return <PayrollAdminPage initialMode={normalizePayrollMode(searchParams?.mode)} />;
}
