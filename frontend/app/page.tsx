"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/api";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const session = await getSession();
        if (cancelled) return;

        if (!session.authenticated) {
          router.replace("/login");
          return;
        }

        if (session.role === "admin") {
          router.replace("/admin/trainee-management");
          return;
        }

        if (session.role === "trainee" && session.traineeId) {
          router.replace(`/trainee/${session.traineeId}/dashboard`);
          return;
        }

        router.replace("/login");
      } catch {
        if (!cancelled) router.replace("/login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return <div className="container" />;
}
