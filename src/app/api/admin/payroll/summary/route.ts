import { NextRequest, NextResponse } from "next/server";
import { createUserScopedClient } from "@/lib/admin-server";
import { buildPayrollSummary } from "@/lib/payroll-admin";
import { normalizePayrollMode } from "@/lib/payroll-mode";

export async function POST(request: NextRequest) {
  const accessToken = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!accessToken) {
    return NextResponse.json({ error: "Немає токена доступу." }, { status: 401 });
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
    return NextResponse.json({ error: "Доступ лише для адміністратора." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { periodStart?: string; periodEnd?: string; payrollMode?: string };
  const periodStart = String(body.periodStart || "");
  const periodEnd = String(body.periodEnd || "");

  if (!periodStart || !periodEnd) {
    return NextResponse.json({ error: "Потрібні periodStart та periodEnd." }, { status: 400 });
  }

  try {
    const payrollMode = normalizePayrollMode(body.payrollMode);
    const summary = await buildPayrollSummary(periodStart, periodEnd, payrollMode);
    return NextResponse.json({
      periodStart,
      periodEnd,
      payrollMode,
      rows: summary.rows,
      totals: summary.totals,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не вдалося побудувати зарплатне зведення." },
      { status: 400 }
    );
  }
}
