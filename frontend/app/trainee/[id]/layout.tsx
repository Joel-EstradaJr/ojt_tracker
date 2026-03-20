"use client";

import { useState } from "react";
import Sidebar from "@/app/trainee/components/Sidebar";

export default function TraineeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ display: "grid", gridTemplateColumns: `${collapsed ? "84px" : "272px"} minmax(0, 1fr)`, minHeight: "100dvh", background: "var(--bg)" }}>
      <Sidebar traineeId={params.id} collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <main style={{ minWidth: 0 }}>{children}</main>
    </div>
  );
}
