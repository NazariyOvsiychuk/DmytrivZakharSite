import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/admin-server";
import { authorizeTerminal } from "@/lib/terminal-device";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    deviceCode: string;
    employeeId: string;
    source?: string;
  };

  const deviceSecret = request.headers.get("x-terminal-secret");
  const auth = await authorizeTerminal(body.deviceCode, deviceSecret);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { data: openShift } = await adminSupabase
    .from("shifts")
    .select("id")
    .eq("employee_id", body.employeeId)
    .eq("status", "open")
    .maybeSingle();

  const { error } = await adminSupabase.rpc("register_terminal_event", {
    p_employee_id: body.employeeId,
    p_event_type: "scan",
    p_terminal_code: body.deviceCode,
    p_source: body.source || "terminal",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    message: openShift ? "Зміну завершено." : "Зміну розпочато.",
    actionApplied: openShift ? "finish" : "start",
  });
}
