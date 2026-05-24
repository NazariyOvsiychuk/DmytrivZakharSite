import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/admin-server";
import { authorizeTerminal } from "@/lib/terminal-device";

type EmployeeIdentifyRow = {
  employee_id: string;
  fingerprint_id: number | null;
  rfid_card_uid: string | null;
  terminal_profile: string;
  terminal_access_enabled: boolean;
  require_rfid: boolean;
  require_fingerprint: boolean;
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
    pinCode?: string;
    rfidUid?: string;
  };

  const deviceSecret = request.headers.get("x-terminal-secret");

  const auth = await authorizeTerminal(body.deviceCode, deviceSecret);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const pinCode = String(body.pinCode ?? "").trim();
  const rfidUid = String(body.rfidUid ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-F]/g, "");

  if (!pinCode && !rfidUid) {
    return NextResponse.json({ error: "Потрібен PIN або RFID UID." }, { status: 400 });
  }

  let query = adminSupabase
    .from("employee_settings")
    .select(
      "employee_id, fingerprint_id, rfid_card_uid, terminal_profile, terminal_access_enabled, require_rfid, require_fingerprint, profiles!employee_settings_employee_id_fkey(full_name,role,is_active)"
    )
    .eq("terminal_access_enabled", true)
    .limit(1);

  query = pinCode ? query.eq("pin_code", pinCode) : query.eq("rfid_card_uid", rfidUid);

  const { data: employee, error } = await query.maybeSingle();
  const currentEmployee = employee as EmployeeIdentifyRow | null;
  const profile = relationFirst(currentEmployee?.profiles);

  if (error || !currentEmployee || !profile?.is_active) {
    return NextResponse.json({ error: "Працівника не знайдено." }, { status: 404 });
  }

  const { data: openShift } = await adminSupabase
    .from("shifts")
    .select("id")
    .eq("employee_id", currentEmployee.employee_id)
    .eq("status", "open")
    .maybeSingle();

  return NextResponse.json({
    employeeId: currentEmployee.employee_id,
    fullName: profile?.full_name,
    fingerprintId: currentEmployee.fingerprint_id,
    rfidUid: currentEmployee.rfid_card_uid,
    terminalProfile: currentEmployee.terminal_profile,
    requireRfid: currentEmployee.require_rfid,
    requireFingerprint: currentEmployee.require_fingerprint,
    nextAction: openShift ? "finish" : "start",
  });
}
