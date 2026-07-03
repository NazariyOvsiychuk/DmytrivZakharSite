import { NextRequest, NextResponse } from "next/server";
import { adminSupabase, createUserScopedClient } from "@/lib/admin-server";

async function requireAdmin(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) return { error: NextResponse.json({ error: "Немає токена доступу." }, { status: 401 }) };

  const scopedClient = createUserScopedClient(accessToken);
  const { data: { user } } = await scopedClient.auth.getUser();
  const { data: profile } = await scopedClient.from("profiles").select("role").eq("id", user?.id).maybeSingle();

  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Доступ лише для адміністратора." }, { status: 403 }) };
  }
  return { userId: user?.id ?? null };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("error" in auth) return auth.error;

  const body = (await request.json().catch(() => ({}))) as {
    action?: "list" | "create" | "delete";
    periodStart?: string;
    periodEnd?: string;
    multiplier?: number;
    ruleId?: string;
  };

  if (body.action === "create") {
    if (!body.periodStart || !body.periodEnd || body.periodEnd < body.periodStart) {
      return NextResponse.json({ error: "Вкажи коректний період." }, { status: 400 });
    }
    const multiplier = Number(body.multiplier) === 1.5 ? 1.5 : 1.25;
    const { error } = await adminSupabase.from("payroll_overtime_period_rules").insert({
      payroll_mode: "test",
      period_start: body.periodStart,
      period_end: body.periodEnd,
      overtime_multiplier: multiplier,
      created_by: auth.userId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (body.action === "delete") {
    if (!body.ruleId) return NextResponse.json({ error: "Не вказано правило." }, { status: 400 });
    const { error } = await adminSupabase
      .from("payroll_overtime_period_rules")
      .delete()
      .eq("id", body.ruleId)
      .eq("payroll_mode", "test");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data, error } = await adminSupabase
    .from("payroll_overtime_period_rules")
    .select("id, period_start, period_end, overtime_multiplier, created_at")
    .eq("payroll_mode", "test")
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    rules: (data ?? []).map((rule) => ({
      id: String(rule.id),
      periodStart: String(rule.period_start),
      periodEnd: String(rule.period_end),
      multiplier: Number(rule.overtime_multiplier),
    })),
  });
}
