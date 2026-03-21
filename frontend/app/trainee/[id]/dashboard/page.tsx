"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { WorkSchedule } from "@/lib/ph-holidays";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeProvider";
import PageHeading from "@/components/PageHeading";
import ImportCSV from "@/components/ImportCSV";
import ExportFormatButton from "@/components/ExportFormatButton";
import { useTraineePageData } from "../components/useTraineePageData";
import { formatMinutes } from "@/lib/duration";
import { formatDisplayDate } from "@/lib/date";
import { downloadExport } from "@/lib/api";
import { useActionGuard } from "@/lib/useActionGuard";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function TraineeDashboardPage() {
  const { runGuarded } = useActionGuard();
  const router = useRouter();
  const {
    id,
    trainee,
    totalHours,
    totalOvertime,
    totalOffsetUsed,
    availableOffset,
    loading,
    authChecking,
    percent,
    remaining,
    expectedEndDate,
    activeUserLabel,
    viewerRole,
    loadData,
  } = useTraineePageData();
  const [exportLoading, setExportLoading] = useState<"csv" | "excel" | null>(null);

  const handleExport = async (format: "csv" | "excel") => {
    await runGuarded(`trainee-dashboard-export-${format}`, async () => {
      setExportLoading(format);
      try {
        await downloadExport(id, format);
      } finally {
        setExportLoading(null);
      }
    });
  };

  if (authChecking || loading) {
    return (
      <div className="container">
        <div className="skeleton">
          <div className="skeleton-card" style={{ height: "200px" }}>
            <div className="skeleton-line medium" />
            <div className="skeleton-line short" />
            <div className="skeleton-line" />
            <div className="skeleton-line thin" />
          </div>
        </div>
      </div>
    );
  }

  if (!trainee) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>Trainee Not Found</h3>
          <p>The trainee you are looking for does not exist or has been removed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <PageHeading
        title="Dashboard"
        subtitle="Track your profile, schedule, and progress at a glance."
        actions={(
          <>
            <ThemeToggle />
          </>
        )}
        toolbar={(
          <>
            {viewerRole === "admin" && (
              <button className="btn btn-outline" onClick={() => router.push("/admin/trainee-management")} style={{ gap: "0.35rem" }}>
                <span aria-hidden="true">←</span>
                Back to Trainee Management
              </button>
            )}
            <ExportFormatButton
              loadingFormat={exportLoading}
              title="Export Records"
              description="Choose the export format for your own records."
              formats={["csv", "excel"]}
              onSelect={(format) => {
                if (format === "pdf") return;
                return handleExport(format);
              }}
            />
            <ImportCSV traineeId={id} onImported={loadData} />
          </>
        )}
        meta={<>LOGGED IN AS: <strong style={{ color: "var(--text)" }}>{activeUserLabel || "Trainee"}</strong></>}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="card"
        style={{ marginBottom: "1.5rem", position: "relative", overflow: "hidden" }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: "var(--gradient-hero)" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.01em" }}>{trainee.displayName}</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.2rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              {trainee.companyName && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                  {trainee.companyName}
                </span>
              )}
              {trainee.companyName && <span style={{ opacity: 0.3 }}>|</span>}
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>
                {trainee.school}
              </span>
            </p>
          </div>
          {percent >= 100 ? (
            <span className="badge badge-success" style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}>OJT Complete</span>
          ) : (
            <span className="badge badge-primary" style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}>{percent}% Complete</span>
          )}
        </div>

        {trainee.supervisors && trainee.supervisors.length > 0 && (
          <div className="supervisor-block">
            <p className="sup-label">{trainee.supervisors.length === 1 ? "Supervisor" : "Supervisors"}</p>
            {trainee.supervisors.map((s) => (
              <div key={s.id} className="sup-entry">
                <strong>{s.displayName}</strong>
                {(s.email || s.contactNumber) && (
                  <span className="sup-meta">{[s.email, s.contactNumber].filter(Boolean).join(" | ")}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {trainee.workSchedule && Object.keys(trainee.workSchedule as WorkSchedule).length > 0 && (
          <div className="work-schedule-block">
            <p className="work-schedule-label">Work Schedule</p>
            <div className="work-schedule-grid">
              {Object.entries(trainee.workSchedule as WorkSchedule)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([dayNum, times]) => (
                  <div key={dayNum} className="work-schedule-item">
                    <span className="work-schedule-day">{DAY_LABELS[Number(dayNum)]}</span>
                    <span className="work-schedule-time">{times.start} - {times.end}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "0.84rem", fontWeight: 600, color: "var(--text-secondary)" }}>Progress</span>
            <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--primary)" }}>{percent}%</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>

        <div className="stat-row">
          <div className="stat-item"><div className="label">Hours Rendered</div><div className="value">{formatMinutes(totalHours)}</div></div>
          <div className="stat-item"><div className="label">Remaining Hours</div><div className="value">{formatMinutes(remaining)}</div></div>
          <div className="stat-item"><div className="label">Overtime</div><div className="value">{formatMinutes(totalOvertime)}</div></div>
          <div className="stat-item"><div className="label">Offset Used</div><div className="value">{formatMinutes(totalOffsetUsed)}</div></div>
          <div className="stat-item"><div className="label">Available Offset</div><div className="value">{formatMinutes(availableOffset)}</div></div>
        </div>

        {expectedEndDate && (
          <p style={{ marginTop: "0.75rem", fontSize: "0.84rem", color: "var(--primary)", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
            Expected End: {formatDisplayDate(expectedEndDate)}
          </p>
        )}
      </motion.div>
    </div>
  );
}
