import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";

async function ensureAdmin(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!accessToken) {
    return { response: NextResponse.json({ error: "Немає токена доступу." }, { status: 401 }) };
  }

  const scopedClient = createUserScopedClient(accessToken);
  const {
    data: { user },
  } = await scopedClient.auth.getUser();

  const { data: profile } = await scopedClient.from("profiles").select("role").eq("id", user?.id).maybeSingle();

  if (profile?.role !== "admin") {
    return { response: NextResponse.json({ error: "Доступ лише для адміністратора." }, { status: 403 }) };
  }

  return { user };
}

export async function POST(request: NextRequest) {
  const auth = await ensureAdmin(request);
  if ("response" in auth) {
    return auth.response;
  }

  const body = (await request.json()) as {
    employeeId: string;
    deviceCode?: string;
  };

  const { error } = await adminSupabase
    .from("employee_settings")
    .update({
      pin_code: null,
      fingerprint_id: null,
      rfid_card_uid: null,
      terminal_access_enabled: false,
      terminal_profile: "esp32_rfid",
      enrollment_status: "pending_pin",
      enrollment_device_code: body.deviceCode || null,
      enrollment_pending_pin: null,
      enrollment_pending_rfid_uid: null,
      enrollment_requested_at: new Date().toISOString(),
      enrollment_updated_at: new Date().toISOString(),
    })
    .eq("employee_id", body.employeeId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ message: "ESP32 enroll перезапущено." });
}
