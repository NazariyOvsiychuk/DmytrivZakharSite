import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SoftFly ESP32 Workforce",
  description: "Admin-only workforce and payroll platform for ESP32 terminals with RFID and fingerprint enrollment.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <body>{children}</body>
    </html>
  );
}
