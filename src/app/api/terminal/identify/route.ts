import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/admin-server";
import { authorizeTerminal } from "@/lib/terminal-device";

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
      "employee_id, fingerprint_id, rfid_card_uid, terminal_profile, terminal_access_enabled, profiles!employee_settings_employee_id_fkey(full_name,role,is_active)"
    )
    .eq("terminal_access_enabled", true)
    .limit(1);

  query = pinCode ? query.eq("pin_code", pinCode) : query.eq("rfid_card_uid", rfidUid);

  const { data: employee, error } = await query.maybeSingle();

  const profile = employee?.profiles && Array.isArray(employee.profiles) ? employee.profiles[0] : employee?.profiles;

  if (error || !employee || !profile?.is_active) {
    return NextResponse.json({ error: "Працівника не знайдено." }, { status: 404 });
  }

  const { data: openShift } = await adminSupabase
    .from("shifts")
    .select("id")
    .eq("employee_id", employee.employee_id)
    .eq("status", "open")
    .maybeSingle();

  return NextResponse.json({
    employeeId: employee.employee_id,
    fullName: profile?.full_name,
    fingerprintId: employee.fingerprint_id,
    rfidUid: employee.rfid_card_uid,
    terminalProfile: employee.terminal_profile,
    nextAction: openShift ? "finish" : "start",
  });
}
