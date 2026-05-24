"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseDebugConfig } from "@/lib/supabase";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setDebugInfo(null);

    const { error: authError, data } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setLoading(false);
      setError(authError.message);
      setDebugInfo(
        JSON.stringify(
          {
            source: "supabase.auth.signInWithPassword",
            message: authError.message,
            status: (authError as { status?: number }).status ?? null,
            name: authError.name,
            url: supabaseDebugConfig.url,
            publishableKeyPrefix: supabaseDebugConfig.publishableKeyPrefix,
            publishableKeyPresent: supabaseDebugConfig.publishableKeyPresent,
          },
          null,
          2
        )
      );
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profile?.role !== "admin") {
      await supabase.auth.signOut();
      setLoading(false);
      setError("У цей проєкт можуть входити лише адміністратори.");
      setDebugInfo(
        JSON.stringify(
          {
            source: "profile-role-check",
            role: profile?.role ?? null,
            userId: data.user.id,
          },
          null,
          2
        )
      );
      return;
    }

    setLoading(false);
    router.replace("/admin");
  }

  return (
    <form className="form-card" onSubmit={handleSubmit}>
      <div className="panel-head">
        <p className="eyebrow">Trusted Workspace</p>
        <h2>Вхід у систему</h2>
        <p className="hint-text">
          Це окрема адмінська система для ESP32-терміналів. Працівники входять через PIN, RFID і відбиток, а не через сайт.
        </p>
      </div>

      <label className="field">
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="admin@company.com"
          required
        />
      </label>

      <label className="field">
        <span>Пароль</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
          required
        />
      </label>

      {error ? <p className="error-text">{error}</p> : null}

      <button className="button button-primary full-width" type="submit" disabled={loading}>
        {loading ? "Входимо..." : "Увійти"}
      </button>

      <p className="hint-text">
        Самостійна реєстрація відключена. Якщо ви не адмін або не можете увійти, зверніться до власника системи.
      </p>

      <div className="panel" style={{ marginTop: 18, padding: 16 }}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">Debug</p>
            <h2>Технічна діагностика входу</h2>
          </div>
        </div>
        <div className="schedule-table">
          <div className="table-row stack">
            <strong>Supabase URL</strong>
            <span>{supabaseDebugConfig.url || "missing"}</span>
          </div>
          <div className="table-row stack">
            <strong>Publishable key</strong>
            <span>
              {supabaseDebugConfig.publishableKeyPresent
                ? `${supabaseDebugConfig.publishableKeyPrefix}...`
                : "missing"}
            </span>
          </div>
          <div className="table-row stack">
            <strong>Остання помилка</strong>
            <span>{error ?? "Ще не було помилки"}</span>
          </div>
        </div>
        {debugInfo ? (
          <pre
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              background: "rgba(15, 23, 42, 0.06)",
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              overflowX: "auto",
            }}
          >
            {debugInfo}
          </pre>
        ) : null}
      </div>
    </form>
  );
}
