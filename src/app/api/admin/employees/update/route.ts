import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";
import { recordHourlyRateChange } from "@/lib/domain/payroll-domain";

async function ensureAdmin(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");

  if (!accessToken) {
    return { response: NextResponse.json({ error: "Немає токена доступу." }, { status: 401 }) };
  }

  const scopedClient = createUserScopedClient(accessToken);
  const {
    data: { user },
  } = await scopedClient.auth.getUser();

  const { data: profile } = await scopedClient
    .from("profiles")
    .select("role")
    .eq("id", user?.id)
    .maybeSingle();

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
    fullName: string;
    email?: string;
    password?: string;
    hourlyRate: number;
    testMonthlySalary?: number;
    pinCode: string;
    fingerprintId: number | null;
    rfidUid?: string | null;
    terminalAccessEnabled: boolean;
    terminalProfile?: "raspberry_pi" | "esp32_rfid";
    enrollmentMethod?: "rfid_only" | "fingerprint_only" | "rfid_and_fingerprint";
    isActive: boolean;
    overtimePolicies?: Array<{
      weekday: number;
      overtimeEnabled: boolean;
      overtimeMultiplier: number;
    }>;
  };
  const enrollmentMethod =
    body.enrollmentMethod === "rfid_only" ||
    body.enrollmentMethod === "fingerprint_only" ||
    body.enrollmentMethod === "rfid_and_fingerprint"
      ? body.enrollmentMethod
      : "rfid_and_fingerprint";
  const requireRfid = enrollmentMethod !== "fingerprint_only";
  const requireFingerprint = enrollmentMethod !== "rfid_only";

  const { data: currentSettings } = await adminSupabase
    .from("employee_settings")
    .select("hourly_rate")
    .eq("employee_id", body.employeeId)
    .maybeSingle();

  const { data: currentTestRate } = await adminSupabase
    .from("employee_payroll_rates")
    .select("rate_amount")
    .eq("employee_id", body.employeeId)
    .eq("payroll_mode", "test")
    .eq("rate_kind", "monthly")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (body.email) {
    const normalizedEmail = String(body.email).trim().toLowerCase();
    const { error: authError } = await adminSupabase.auth.admin.updateUserById(body.employeeId, {
      email: normalizedEmail,
      email_confirm: true,
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const { error: profileEmailError } = await adminSupabase
      .from("profiles")
      .update({ email: normalizedEmail })
      .eq("id", body.employeeId);

    if (profileEmailError) {
      return NextResponse.json({ error: profileEmailError.message }, { status: 400 });
    }
  }

  if (body.password && body.password.trim()) {
    const { error: passwordError } = await adminSupabase.auth.admin.updateUserById(body.employeeId, {
      password: body.password.trim(),
    });

    if (passwordError) {
      return NextResponse.json({ error: passwordError.message }, { status: 400 });
    }
  }

  const { error: profileError } = await adminSupabase
    .from("profiles")
    .update({ full_name: body.fullName, is_active: body.isActive })
    .eq("id", body.employeeId);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  const { error: settingsError } = await adminSupabase
    .from("employee_settings")
    .upsert(
      {
        employee_id: body.employeeId,
        hourly_rate: body.hourlyRate,
        pin_code: body.pinCode || null,
        fingerprint_id: body.fingerprintId,
        rfid_card_uid: body.rfidUid ? String(body.rfidUid).trim().toUpperCase() : null,
        terminal_access_enabled: body.terminalAccessEnabled,
        terminal_profile: body.terminalProfile === "esp32_rfid" ? "esp32_rfid" : "raspberry_pi",
        enrollment_method: body.terminalProfile === "esp32_rfid" ? enrollmentMethod : "rfid_and_fingerprint",
        require_rfid: body.terminalProfile === "esp32_rfid" ? requireRfid : false,
        require_fingerprint: body.terminalProfile === "esp32_rfid" ? requireFingerprint : false,
        enrollment_updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id" }
    );

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 400 });
  }

  if (Array.isArray(body.overtimePolicies)) {
    const rows = body.overtimePolicies
      .filter((policy) => Number(policy.weekday) >= 1 && Number(policy.weekday) <= 7)
      .map((policy) => ({
        employee_id: body.employeeId,
        payroll_mode: "test",
        weekday: Math.max(1, Math.min(7, Math.floor(Number(policy.weekday)))),
        overtime_enabled: Boolean(policy.overtimeEnabled),
        overtime_multiplier: Number(policy.overtimeMultiplier) === 1.5 ? 1.5 : 1.25,
      }));

    const { error: overtimeDeleteError } = await adminSupabase
      .from("employee_overtime_policies")
      .delete()
      .eq("employee_id", body.employeeId)
      .eq("payroll_mode", "test");

    if (overtimeDeleteError) {
      return NextResponse.json({ error: overtimeDeleteError.message }, { status: 400 });
    }

    if (rows.length > 0) {
      const { error: overtimeInsertError } = await adminSupabase
        .from("employee_overtime_policies")
        .insert(rows);

      if (overtimeInsertError) {
        return NextResponse.json({ error: overtimeInsertError.message }, { status: 400 });
      }
    }
  }

  if (
    body.testMonthlySalary !== undefined &&
    Number.isFinite(Number(body.testMonthlySalary)) &&
    Number(body.testMonthlySalary) >= 0 &&
    Number(currentTestRate?.rate_amount ?? 0) !== Number(body.testMonthlySalary)
  ) {
    const { error: testRateError } = await adminSupabase.from("employee_payroll_rates").insert({
      employee_id: body.employeeId,
      payroll_mode: "test",
      rate_kind: "monthly",
      rate_amount: Math.round(Number(body.testMonthlySalary) * 100) / 100,
      standard_day_hours: 9,
      effective_from: currentTestRate ? new Date().toISOString() : "1970-01-01T00:00:00.000Z",
      created_by: auth.user?.id ?? null,
    });

    if (testRateError) {
      return NextResponse.json({ error: testRateError.message }, { status: 400 });
    }
  }

  if (Number(currentSettings?.hourly_rate ?? 0) !== Number(body.hourlyRate ?? 0)) {
    try {
      await recordHourlyRateChange({
        employeeId: body.employeeId,
        actorId: auth.user?.id ?? null,
        hourlyRate: body.hourlyRate,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Не вдалося зафіксувати зміну ставки." },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ message: "Параметри працівника оновлено." });
}
