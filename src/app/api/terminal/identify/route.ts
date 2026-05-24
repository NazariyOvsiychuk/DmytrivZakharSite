import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/admin-server";
import { authorizeTerminal } from "@/lib/terminal-device";

type EmployeeIdentifyRow = {
  employee_id: string;
  fingerprint_id: number | null;
  rfid_card_uid: string | null;
  terminal_profile: string;
  terminal_access_enabled: boolean;
  profiles:
    | {
        full_name: string;
        role: string;
        is_active: boolean;
      }
    | Array<{
        full_name: string;
        role: string;
        is_active: boolean;
      }>
    | null;
};

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    deviceCode: string;
  query = pinCode ? query.eq("pin_code", pinCode) : query.eq("rfid_card_uid", rfidUid);

  const { data: employee, error } = await query.maybeSingle();

  const profile = employee?.profiles && Array.isArray(employee.profiles) ? employee.profiles[0] : employee?.profiles;
  const currentEmployee = employee as EmployeeIdentifyRow | null;
  const profile = relationFirst(currentEmployee?.profiles);

  if (error || !employee || !profile?.is_active) {
  if (error || !currentEmployee || !profile?.is_active) {
    return NextResponse.json({ error: "Працівника не знайдено." }, { status: 404 });
  }

  const { data: openShift } = await adminSupabase
    .from("shifts")
    .select("id")
    .eq("employee_id", employee.employee_id)
    .eq("employee_id", currentEmployee.employee_id)
    .eq("status", "open")
    .maybeSingle();

  return NextResponse.json({
    employeeId: employee.employee_id,
    employeeId: currentEmployee.employee_id,
    fullName: profile?.full_name,
    fingerprintId: employee.fingerprint_id,
    rfidUid: employee.rfid_card_uid,
    terminalProfile: employee.terminal_profile,
    fingerprintId: currentEmployee.fingerprint_id,
    rfidUid: currentEmployee.rfid_card_uid,
    terminalProfile: currentEmployee.terminal_profile,
    nextAction: openShift ? "finish" : "start",
  });
}
