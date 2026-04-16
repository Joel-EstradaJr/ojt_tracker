"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Sidebar from "@/app/trainee/components/Sidebar";
import AdminSidebar from "@/app/admin/components/Sidebar";
import { getSession } from "@/lib/api";

export default function TraineeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [viewerRole, setViewerRole] = useState<"admin" | "trainee" | null>(null);
  const searchParams = useSearchParams();
  const fromAdmin = searchParams.get("from") === "admin";

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const session = await getSession();
        if (!mounted) return;
        if (session.authenticated && session.role) {
          setViewerRole(session.role);
        }
      } catch {
        if (mounted) setViewerRole(null);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const useAdminSidebar = fromAdmin || viewerRole === "admin";

  return (
    <div style={{ display: "grid", gridTemplateColumns: `${collapsed ? (useAdminSidebar ? "76px" : "84px") : (useAdminSidebar ? "248px" : "272px")} minmax(0, 1fr)`, minHeight: "100dvh", background: "var(--bg)" }}>
      {useAdminSidebar ? (
        <AdminSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      ) : (
        <Sidebar traineeId={params.id} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      )}
      <main style={{ minWidth: 0 }}>{children}</main>
    </div>
  );
}
