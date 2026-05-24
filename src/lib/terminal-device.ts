import { adminSupabase } from "@/lib/admin-server";

export type AuthorizedTerminal = {
  id: string;
  deviceCode: string;
  deviceName: string;
  locationLabel: string | null;
};

export async function authorizeTerminal(deviceCode: string, deviceSecret: string | null) {
  const { data: device, error } = await adminSupabase
    .from("device_terminals")
    .select("id, device_code, device_name, location_label, secret_key, is_active")
    .eq("device_code", deviceCode)
    .maybeSingle();

  if (error || !device || !device.is_active || device.secret_key !== deviceSecret) {
    return { ok: false as const, error: "Термінал не авторизовано." };
  }

  return {
    ok: true as const,
    device: {
      id: String(device.id),
      deviceCode: String(device.device_code),
      deviceName: String(device.device_name),
      locationLabel: device.location_label ? String(device.location_label) : null,
    } satisfies AuthorizedTerminal,
  };
}
