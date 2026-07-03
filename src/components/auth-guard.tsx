"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type AuthGuardProps = {
  children: React.ReactNode;
  allowedRoles?: Array<"admin" | "employee">;
  allowGuest?: boolean;
};

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = 6000): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error("AUTH_CHECK_TIMEOUT")), timeoutMs);
    }),
  ]);
}

export function AuthGuard({ children, allowedRoles, allowGuest = false }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    async function validate() {
      try {
        const {
          data: { session },
        } = await withTimeout(supabase.auth.getSession());

        if (!active) return;

        if (!session) {
          if (allowGuest) {
            setReady(true);
            return;
          }

          router.replace("/login");
          return;
        }

        const { data: profile, error: profileError } = await withTimeout(
          supabase
            .from("profiles")
            .select("role")
            .eq("id", session.user.id)
            .maybeSingle()
        );

        if (!active) return;

        if (profileError || !profile?.role) {
          await supabase.auth.signOut({ scope: "local" });
          if (allowGuest) setReady(true);
          else router.replace("/login");
          return;
        }

        if (allowedRoles && !allowedRoles.includes(profile.role)) {
          router.replace(profile.role === "admin" ? "/admin" : "/employee");
          return;
        }

        if (pathname === "/login") {
          router.replace(profile.role === "admin" ? "/admin" : "/employee");
          return;
        }

        setReady(true);
      } catch {
        if (!active) return;
        if (allowGuest) setReady(true);
        else router.replace("/login");
      }
    }

    validate();

    return () => {
      active = false;
    };
  }, [allowGuest, allowedRoles, pathname, router]);

  if (!ready) {
    return <main className="center-shell">Перевіряємо доступ...</main>;
  }

  return <>{children}</>;
}
