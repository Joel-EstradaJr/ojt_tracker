"use client";

import { useState } from "react";
import Sidebar from "./components/Sidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ display: "grid", gridTemplateColumns: `${collapsed ? "76px" : "248px"} minmax(0, 1fr)`, minHeight: "100dvh", background: "var(--bg)" }}>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <main style={{ minWidth: 0 }}>{children}</main>
    </div>
  );
}
