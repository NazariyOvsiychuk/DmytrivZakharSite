import { AuthGuard } from "@/components/auth-guard";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="center-shell login-shell">
      <AuthGuard allowGuest>
        <section className="login-grid">
          <article className="panel login-copy">
            <p className="eyebrow">Internal Access</p>
            <h1>Secure entry for administrators only</h1>
            <p className="lead">
              This version is built for ESP32 terminals with RFID and fingerprint enrollment. Employees do not use website logins here.
            </p>
            <div className="schedule-table">
              <div className="table-row stack">
                <strong>For administrators</strong>
                <span>People management, ESP32 enrollment, schedule control, analytics and payroll.</span>
              </div>
            </div>
          </article>
          <LoginForm />
        </section>
      </AuthGuard>
    </main>
  );
}
