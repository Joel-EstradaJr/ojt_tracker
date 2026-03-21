"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BackupImportResult,
  downloadSystemBackup,
  importSystemBackup,
  verifyBackupSuperPassword,
} from "@/lib/api";
import { sha256 } from "@/lib/hash";

type Stage = "closed" | "auth" | "actions" | "import" | "result";

export default function AdminBackupFab() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("closed");
  const [password, setPassword] = useState("");
  const [hash, setHash] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [result, setResult] = useState<BackupImportResult | null>(null);
  const [refreshOnClose, setRefreshOnClose] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const open = () => {
    setStage("auth");
    setError("");
    setPassword("");
    setDryRun(false);
    setResult(null);
  };

  const close = () => {
    if (importing) return;

    if (refreshOnClose) {
      window.dispatchEvent(new CustomEvent("backup-import-complete"));
      router.refresh();
      setRefreshOnClose(false);
    }

    setStage("closed");
    setPassword("");
    setError("");
    setResult(null);
  };

  const verifyPassword = async () => {
    if (!password.trim()) {
      setError("SUPER_PASSWORD is required.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const hashed = await sha256(password);
      await verifyBackupSuperPassword(hashed);
      setHash(hashed);
      setPassword("");
      setStage("actions");
    } catch {
      setError("Invalid Super Password");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (!hash) {
      setStage("auth");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await downloadSystemBackup(hash);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to export backup.");
    } finally {
      setBusy(false);
    }
  };

  const handleImportClick = () => {
    setError("");
    setStage("import");
  };

  const handleStartImport = async (file: File) => {
    if (!hash) {
      setStage("auth");
      return;
    }

    setImporting(true);
    setBusy(true);
    setError("");

    try {
      const response = await importSystemBackup(file, hash, dryRun);
      setResult(response);
      setStage("result");
      setRefreshOnClose(!response.dryRun);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to import backup.");
    } finally {
      setBusy(false);
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <button
        type="button"
        className="admin-backup-fab"
        aria-label="System Backup and Restore"
        title="System Backup & Restore"
        onClick={open}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5" />
          <path d="M3 11v6c0 1.7 4 3 9 3" />
          <path d="M16 19l2 2 4-4" />
        </svg>
      </button>

      {stage !== "closed" && (
        <div className="admin-backup-overlay" role="dialog" aria-modal="true">
          <div className="admin-backup-modal card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h3 style={{ margin: 0, fontSize: "1rem" }}>System Backup & Restore</h3>
              <button type="button" className="btn btn-outline" onClick={close} disabled={busy || importing}>Close</button>
            </div>

            {stage === "auth" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void verifyPassword();
                }}
              >
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                  Enter SUPER_PASSWORD to continue.
                </p>
                <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                  <label>SUPER_PASSWORD</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter super password"
                    autoFocus
                  />
                </div>
                {error && <div style={{ color: "var(--danger)", fontSize: "0.84rem", marginBottom: "0.65rem" }}>{error}</div>}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? "Verifying..." : "Verify"}
                  </button>
                </div>
              </form>
            )}

            {stage === "actions" && (
              <>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                  Choose a backup action.
                </p>
                {error && <div style={{ color: "var(--danger)", fontSize: "0.84rem", marginBottom: "0.65rem" }}>{error}</div>}
                <div style={{ display: "grid", gap: "0.6rem" }}>
                  <button type="button" className="btn btn-primary" onClick={handleExport} disabled={busy}>
                    {busy ? "Exporting..." : "Export Data"}
                  </button>
                  <button type="button" className="btn btn-outline" onClick={handleImportClick} disabled={busy}>
                    Import Data
                  </button>
                </div>
              </>
            )}

            {stage === "import" && (
              <>
                <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                  Upload a backup file (.csv or .zip).
                </p>

                <div className="form-group" style={{ marginBottom: "0.65rem" }}>
                  <label>Backup File</label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.zip"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleStartImport(file);
                    }}
                    disabled={busy || importing}
                  />
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={(e) => setDryRun(e.target.checked)}
                    disabled={busy || importing}
                  />
                  Dry run mode (validate without writing data)
                </label>

                {error && <div style={{ color: "var(--danger)", fontSize: "0.84rem", marginBottom: "0.65rem" }}>{error}</div>}

                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                  <button type="button" className="btn btn-outline" onClick={() => setStage("actions")} disabled={busy || importing}>
                    Back
                  </button>
                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", alignSelf: "center" }}>Import starts after selecting a file.</span>
                </div>
              </>
            )}

            {stage === "result" && result && (
              <>
                <h4 style={{ marginBottom: "0.6rem", fontSize: "0.95rem" }}>{result.dryRun ? "Dry Run Completed" : "Import Completed"}</h4>
                <div style={{ display: "grid", gap: "0.4rem", fontSize: "0.85rem", marginBottom: "0.75rem" }}>
                  <div>Records Imported: <strong>{result.summary.imported}</strong></div>
                  <div>Records Skipped (Duplicates): <strong>{result.summary.skipped}</strong></div>
                  <div>Records Failed: <strong>{result.summary.failed}</strong></div>
                </div>

                {result.failures.length > 0 && (
                  <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", maxHeight: "180px", overflowY: "auto", padding: "0.55rem", marginBottom: "0.75rem", background: "var(--bg-subtle)" }}>
                    {result.failures.map((f, idx) => (
                      <div key={`${f.table}-${f.row}-${idx}`} style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "0.28rem" }}>
                        [{f.table}] row {f.row}: {f.reason}
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn-primary" onClick={() => setStage("actions")}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {importing && (
        <div className="admin-backup-blocker" role="status" aria-live="polite">
          <div className="card" style={{ width: "min(420px, 92vw)", textAlign: "center" }}>
            <div className="admin-backup-spinner" />
            <h3 style={{ marginTop: "0.6rem", marginBottom: "0.45rem" }}>Import in progress</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.86rem" }}>
              Please wait. Navigation is temporarily disabled while backup data is being processed.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
