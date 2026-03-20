"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const menuItems = [
  { href: "/admin/user-management", label: "User Management" },
  { href: "/admin/trainee-management", label: "Trainee Management" },
] as const;

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: collapsed ? 76 : 248,
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
            <h2 style={{ fontSize: "0.98rem", marginBottom: 0 }}>Admin</h2>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Navigation</p>
          </div>
        )}
        <button className="btn btn-outline" onClick={onToggle} style={{ padding: "0.35rem 0.5rem", minWidth: 36 }} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? ">" : "<"}
        </button>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.4rem" }}>
        {menuItems.map((item) => {
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
              <span aria-hidden="true">{item.label.startsWith("User") ? "U" : "T"}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
