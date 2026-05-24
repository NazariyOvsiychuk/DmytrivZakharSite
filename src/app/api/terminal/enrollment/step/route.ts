import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/admin-server";
import { authorizeTerminal } from "@/lib/terminal-device";
import { enrollmentPrompt, normalizeRfidUid } from "@/lib/terminal-enrollment";

type EmployeeSettingsRow = {
  employee_id: string;
  pin_code: string | null;
  fingerprint_id: number | null;
  rfid_card_uid: string | null;
  terminal_access_enabled: boolean;
  terminal_profile: string;
  enrollment_method: string;
  require_rfid: boolean;
  require_fingerprint: boolean;
  enrollment_status: string;
  enrollment_device_code: string | null;
  enrollment_pending_pin: string | null;
  enrollment_pending_rfid_uid: string | null;
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

async function pinTaken(employeeId: string, pinCode: string) {
  const { data } = await adminSupabase
    .from("employee_settings")
    .select("employee_id")
    .eq("pin_code", pinCode)
    .neq("employee_id", employeeId)
    .limit(1);
  return Boolean(data?.length);
}

async function rfidTaken(employeeId: string, rfidUid: string) {
  const { data } = await adminSupabase
    .from("employee_settings")
    .select("employee_id")
    .eq("rfid_card_uid", rfidUid)
    .neq("employee_id", employeeId)
    .limit(1);
  return Boolean(data?.length);
}

async function fingerprintTaken(employeeId: string, fingerprintId: number) {
  const { data } = await adminSupabase
    .from("employee_settings")
    .select("employee_id")
    .eq("fingerprint_id", fingerprintId)
    .neq("employee_id", employeeId)
    .limit(1);
  return Boolean(data?.length);
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    deviceCode: string;
    employeeId: string;
    action: "submit_pin" | "submit_pin_confirm" | "scan_card" | "scan_card_confirm" | "submit_fingerprint" | "cancel";
    pinCode?: string;
    rfidUid?: string;
    fingerprintId?: number;
  };
  const deviceSecret = request.headers.get("x-terminal-secret");

  const auth = await authorizeTerminal(body.deviceCode, deviceSecret);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { data: row, error } = await adminSupabase
    .from("employee_settings")
    .select(
      "employee_id, pin_code, fingerprint_id, rfid_card_uid, terminal_access_enabled, terminal_profile, enrollment_method, require_rfid, require_fingerprint, enrollment_status, enrollment_device_code, enrollment_pending_pin, enrollment_pending_rfid_uid, profiles!employee_settings_employee_id_fkey(full_name,is_active)"
    )
    .eq("employee_id", body.employeeId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Працівника не знайдено для enroll." }, { status: 404 });
  }

  const settings = row as EmployeeSettingsRow;
  const profile = relationFirst(settings.profiles);

  if (settings.terminal_profile !== "esp32_rfid") {
    return NextResponse.json({ error: "Цей працівник не налаштований для ESP32 + RFID." }, { status: 400 });
  }

  if (settings.enrollment_device_code && settings.enrollment_device_code !== body.deviceCode) {
    return NextResponse.json({ error: "Enroll уже закріплений за іншим терміналом." }, { status: 409 });
  }

  if (!profile?.is_active) {
    return NextResponse.json({ error: "Працівник неактивний." }, { status: 400 });
  }

  if (body.action === "cancel") {
    const nextStatus = "cancelled";
    await adminSupabase
      .from("employee_settings")
      .update({
        enrollment_status: nextStatus,
        enrollment_pending_pin: null,
        enrollment_pending_rfid_uid: null,
        enrollment_updated_at: new Date().toISOString(),
      })
      .eq("employee_id", body.employeeId);

    return NextResponse.json({
      ok: true,
      employeeId: body.employeeId,
      fullName: profile.full_name,
      status: nextStatus,
      prompt: enrollmentPrompt(nextStatus),
    });
  }

  let patch: Record<string, unknown> | null = null;
  let nextStatus = settings.enrollment_status;
  let errorMessage: string | null = null;

  if (settings.enrollment_status === "pending_pin" && body.action === "submit_pin") {
    const pinCode = String(body.pinCode ?? "").trim();
    if (!/^\d{5}$/.test(pinCode)) {
      errorMessage = "PIN має містити рівно 5 цифр.";
    } else if (await pinTaken(body.employeeId, pinCode)) {
      errorMessage = "Цей PIN уже використовується.";
    } else {
      nextStatus = "confirm_pin";
      patch = {
        enrollment_pending_pin: pinCode,
      };
    }
  } else if (settings.enrollment_status === "confirm_pin" && body.action === "submit_pin_confirm") {
    const pinCode = String(body.pinCode ?? "").trim();
    if (pinCode !== settings.enrollment_pending_pin) {
      errorMessage = "Підтвердження PIN не збігається.";
    } else {
      nextStatus = settings.require_rfid ? "scan_card_first" : settings.require_fingerprint ? "scan_fingerprint" : "completed";
      patch = {
        pin_code: pinCode,
        enrollment_pending_pin: null,
        terminal_access_enabled: !settings.require_rfid && !settings.require_fingerprint,
      };
    }
  } else if (settings.enrollment_status === "scan_card_first" && body.action === "scan_card") {
    const rfidUid = normalizeRfidUid(body.rfidUid);
    if (!rfidUid) {
      errorMessage = "RFID UID порожній.";
    } else if (await rfidTaken(body.employeeId, rfidUid)) {
      errorMessage = "Ця картка вже прив’язана до іншого працівника.";
    } else {
      nextStatus = "scan_card_second";
      patch = {
        enrollment_pending_rfid_uid: rfidUid,
      };
    }
  } else if (settings.enrollment_status === "scan_card_second" && body.action === "scan_card_confirm") {
    const rfidUid = normalizeRfidUid(body.rfidUid);
    if (!rfidUid || rfidUid !== settings.enrollment_pending_rfid_uid) {
      errorMessage = "Потрібно прикласти ту саму картку вдруге.";
    } else {
      nextStatus = settings.require_fingerprint ? "scan_fingerprint" : "completed";
      patch = {
        rfid_card_uid: rfidUid,
        enrollment_pending_rfid_uid: null,
        terminal_access_enabled: !settings.require_fingerprint,
      };
    }
  } else if (settings.enrollment_status === "scan_fingerprint" && body.action === "submit_fingerprint") {
    const fingerprintId = Number(body.fingerprintId);
    if (!Number.isInteger(fingerprintId) || fingerprintId < 0) {
      errorMessage = "Fingerprint ID має бути цілим невід’ємним числом.";
    } else if (await fingerprintTaken(body.employeeId, fingerprintId)) {
      errorMessage = "Цей Fingerprint ID уже використовується.";
    } else {
      nextStatus = "completed";
      patch = {
        fingerprint_id: fingerprintId,
        terminal_access_enabled: true,
      };
    }
  } else {
    errorMessage = "Некоректний крок enroll.";
  }

  if (errorMessage) {
    return NextResponse.json({ error: errorMessage }, { status: 400 });
  }

  const updatePayload = {
    ...(patch ?? {}),
    enrollment_status: nextStatus,
    enrollment_device_code: body.deviceCode,
    enrollment_updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await adminSupabase
    .from("employee_settings")
    .update(updatePayload)
    .eq("employee_id", body.employeeId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    employeeId: body.employeeId,
    fullName: profile?.full_name ?? "Працівник",
    status: nextStatus,
    prompt: enrollmentPrompt(nextStatus as any),
  });
}
