"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { logout } from "@/lib/api";

interface SidebarProps {
  traineeId: string;
  collapsed: boolean;
  onToggle: () => void;
}

const menuItems = (traineeId: string) => [
  { href: `/trainee/${traineeId}/dashboard`, label: "Dashboard" },
  { href: `/trainee/${traineeId}/entry-logs`, label: "Entry Logs" },
] as const;

export default function Sidebar({ traineeId, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [logoutLoading, setLogoutLoading] = useState(false);

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await logout();
    } catch {
      // Ignore logout API failures and force redirect.
    } finally {
      setLogoutLoading(false);
      router.replace("/login");
    }
  };

  return (
    <aside
      style={{
        width: collapsed ? 84 : 272,
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        padding: "1rem 0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        transition: "width 0.2s ease",
        position: "sticky",
        top: 0,
        height: "100dvh",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", gap: "0.5rem", padding: "0 0.35rem" }}>
        {!collapsed && (
          <div>
            <h2 style={{ fontSize: "0.98rem", marginBottom: 0 }}>Trainee</h2>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Navigation</p>
          </div>
        )}
        <button
          className="btn btn-outline"
          onClick={onToggle}
          style={{ padding: "0.35rem 0.5rem", minWidth: 36 }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? ">" : "<"}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", marginTop: "0.4rem", paddingRight: "0.2rem" }}>
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {menuItems(traineeId).map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: collapsed ? "center" : "flex-start",
                  gap: "0.6rem",
                  borderRadius: "var(--radius-sm)",
                  padding: collapsed ? "0.55rem" : "0.55rem 0.7rem",
                  color: active ? "var(--primary)" : "var(--text-secondary)",
                  background: active ? "var(--primary-light)" : "transparent",
                  border: `1px solid ${active ? "var(--primary)" : "transparent"}`,
                  fontSize: "0.86rem",
                  fontWeight: active ? 600 : 500,
                }}
                title={collapsed ? item.label : undefined}
              >
                <span aria-hidden="true">{item.label.startsWith("Dashboard") ? "D" : "E"}</span>
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </div>

      <div style={{ marginTop: "auto", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
        <button
          className="btn btn-outline"
          onClick={handleLogout}
          disabled={logoutLoading}
          style={{ width: "100%", padding: collapsed ? "0.55rem" : "0.55rem 0.7rem", justifyContent: collapsed ? "center" : "flex-start" }}
          title={collapsed ? "Log Out" : undefined}
        >
          <span aria-hidden="true">⎋</span>
          {!collapsed && <span>{logoutLoading ? "Logging out..." : "Log Out"}</span>}
        </button>
      </div>
    </aside>
  );
}
