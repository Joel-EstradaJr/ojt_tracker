"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchEntitySuggestions } from "@/lib/api";
import { CanonicalEntitySuggestion } from "@/types";

type Props = {
  entityType: "school" | "company";
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
};

export default function CanonicalAutocompleteInput({
  entityType,
  label,
  value,
  onChange,
  placeholder,
  required,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<CanonicalEntitySuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  const trimmedValue = useMemo(() => value.trim(), [value]);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    debounceRef.current = window.setTimeout(async () => {
      try {
        setLoading(true);
        const res = await fetchEntitySuggestions(entityType, trimmedValue);
        setItems(res.items);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [entityType, trimmedValue]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const selectItem = (name: string) => {
    onChange(name);
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <div className="form-group" ref={rootRef} style={{ position: "relative" }}>
      <label>{label}{required ? " *" : ""}</label>
      <input
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        onKeyDown={(event) => {
          if (!open || items.length === 0) return;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((prev) => (prev + 1 >= items.length ? 0 : prev + 1));
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
          }

          if (event.key === "Enter" && activeIndex >= 0) {
            event.preventDefault();
            selectItem(items[activeIndex].name);
          }

          if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />

      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
            left: 0,
            right: 0,
            top: "calc(100% + 4px)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            maxHeight: "200px",
            overflowY: "auto",
            boxShadow: "0 10px 20px rgba(0, 0, 0, 0.08)",
          }}
        >
          {loading && (
            <div style={{ padding: "0.6rem 0.7rem", color: "var(--text-muted)", fontSize: "0.82rem" }}>
              Loading suggestions...
            </div>
          )}

          {!loading && items.length === 0 && (
            <div style={{ padding: "0.6rem 0.7rem", color: "var(--text-muted)", fontSize: "0.82rem" }}>
              No matches. Press enter to keep your own value.
            </div>
          )}

          {!loading && items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectItem(item.name)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                textAlign: "left",
                border: "none",
                background: activeIndex === index ? "var(--bg-subtle)" : "transparent",
                padding: "0.6rem 0.7rem",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: "0.86rem" }}>{item.name}</span>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{item.usageCount}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
