import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";
import { recordEmployeeCreated } from "@/lib/domain/payroll-domain";

export async function POST(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!accessToken) {
    return NextResponse.json({ error: "Немає токена доступу." }, { status: 401 });
  }

  const scopedClient = createUserScopedClient(accessToken);
  const {
    data: { user },
  } = await scopedClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Сесію не підтверджено." }, { status: 401 });
  }

  const { data: profile } = await scopedClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Доступ лише для адміністратора." }, { status: 403 });
  }

  const body = (await request.json()) as {
    fullName: string;
    email?: string;
    password?: string;
    hourlyRate: number;
    mode?: "standard" | "terminal_only";
    deviceCode?: string;
  };

  const mode = body.mode === "terminal_only" ? "terminal_only" : "standard";
  const randomPart = crypto.randomUUID();
  const generatedEmail = `terminal-${randomPart}@softfly.local`;
  const generatedPassword = `T-${randomPart}-${Date.now()}`;
  const normalizedEmail = (mode === "terminal_only" ? generatedEmail : String(body.email ?? ""))
    .trim()
    .toLowerCase();
  const password = mode === "terminal_only" ? generatedPassword : String(body.password ?? "").trim();

  if (!body.fullName?.trim()) {
    return NextResponse.json({ error: "Вкажи ім'я працівника." }, { status: 400 });
  }

  if (mode === "standard" && (!normalizedEmail || !password)) {
    return NextResponse.json({ error: "Для звичайного працівника потрібні email і пароль." }, { status: 400 });
  }

  const { data: createdUser, error: createError } = await adminSupabase.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: body.fullName,
      role: "employee",
      auth_mode: mode === "terminal_only" ? "terminal_only" : "standard",
    },
  });

  if (createError || !createdUser.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Не вдалося створити користувача." },
      { status: 400 }
    );
  }

  // `handle_new_user()` trigger should create `employee_settings`, but in real projects
  // it can be missing/migrated later. Use upsert so hourly rate is always persisted.
  const { error: settingsError } = await adminSupabase.from("employee_settings").upsert(
    {
      employee_id: createdUser.user.id,
      hourly_rate: body.hourlyRate,
      terminal_profile: mode === "terminal_only" ? "esp32_rfid" : "raspberry_pi",
      terminal_access_enabled: mode === "terminal_only" ? false : true,
      enrollment_status: mode === "terminal_only" ? "pending_pin" : "idle",
      enrollment_device_code: mode === "terminal_only" ? body.deviceCode || null : null,
      enrollment_requested_at: mode === "terminal_only" ? new Date().toISOString() : null,
      enrollment_updated_at: new Date().toISOString(),
    },
    { onConflict: "employee_id" }
  );

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 400 });
  }

  try {
    await recordEmployeeCreated({
      employeeId: createdUser.user.id,
      actorId: user.id,
      fullName: body.fullName,
      email: normalizedEmail,
      hourlyRate: body.hourlyRate,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося зафіксувати payroll-події." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    message:
      mode === "terminal_only"
        ? "Працівника створено. ESP32 enroll уже чекає на терміналі."
        : "Працівника створено.",
    employeeId: createdUser.user.id,
  });
}
