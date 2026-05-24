import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/admin-server";
import { authorizeTerminal } from "@/lib/terminal-device";
import { enrollmentPrompt } from "@/lib/terminal-enrollment";

type EnrollmentRow = {
  employee_id: string;
  pin_code: string | null;
  fingerprint_id: number | null;
  rfid_card_uid: string | null;
  terminal_profile: string;
  enrollment_status: string;
  enrollment_device_code: string | null;
  enrollment_requested_at: string | null;
  profiles:
    | {
        full_name: string;
        is_active: boolean;
      }
    | Array<{
        full_name: string;
        is_active: boolean;
      }>
    | null;
};

function relationFirst<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { deviceCode: string };
  const deviceSecret = request.headers.get("x-terminal-secret");

  const auth = await authorizeTerminal(body.deviceCode, deviceSecret);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const activeStatuses = ["pending_pin", "confirm_pin", "scan_card_first", "scan_card_second", "scan_fingerprint"];

  const { data: rows, error } = await adminSupabase
    .from("employee_settings")
    .select(
      "employee_id, pin_code, fingerprint_id, rfid_card_uid, terminal_profile, enrollment_status, enrollment_device_code, enrollment_requested_at, profiles!employee_settings_employee_id_fkey(full_name,is_active)"
    )
    .eq("terminal_profile", "esp32_rfid")
    .in("enrollment_status", activeStatuses)
    .order("enrollment_requested_at", { ascending: true, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const queue = ((rows ?? []) as EnrollmentRow[]).filter((row) => {
    const profile = relationFirst(row.profiles);
    if (!profile?.is_active) return false;
    return !row.enrollment_device_code || row.enrollment_device_code === body.deviceCode;
  });

  const current = queue[0];
  if (!current) {
    return NextResponse.json({
      active: false,
      prompt: enrollmentPrompt("idle"),
    });
  }

  if (!current.enrollment_device_code) {
    await adminSupabase
      .from("employee_settings")
      .update({
        enrollment_device_code: body.deviceCode,
        enrollment_updated_at: new Date().toISOString(),
      })
      .eq("employee_id", current.employee_id);
  }

  const profile = relationFirst(current.profiles);
  const prompt = enrollmentPrompt(current.enrollment_status as any);

  return NextResponse.json({
    active: true,
    employeeId: current.employee_id,
    fullName: profile?.full_name ?? "Працівник",
    status: current.enrollment_status,
    fingerprintId: current.fingerprint_id,
    rfidUid: current.rfid_card_uid,
    terminalProfile: current.terminal_profile,
    prompt,
  });
}
