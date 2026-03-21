"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Trainee, LogEntry } from "@/types";
import { calculateExpectedEndDate } from "@/lib/ph-holidays";
import { fetchLogs, fetchTrainee, getSession, logout } from "@/lib/api";

export function useTraineePageData() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [trainee, setTrainee] = useState<Trainee | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [totalOvertime, setTotalOvertime] = useState(0);
  const [totalOffsetUsed, setTotalOffsetUsed] = useState(0);
  const [availableOffset, setAvailableOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [viewerRole, setViewerRole] = useState<"admin" | "trainee" | null>(null);
  const [activeUserLabel, setActiveUserLabel] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [t, logsRes] = await Promise.all([fetchTrainee(id), fetchLogs(id)]);
      setTrainee(t);
      setLogs(logsRes.logs);
      setTotalHours(logsRes.totalHours);
      setTotalOvertime(logsRes.totalOvertime);
      setTotalOffsetUsed(logsRes.totalOffsetUsed);
      setAvailableOffset(logsRes.availableOffset);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const scheduleAutoLock = useCallback((expiresAt?: number) => {
    if (!expiresAt) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      router.replace("/login");
      setTrainee(null);
      setLogs([]);
      return;
    }
    const timer = setTimeout(() => {
      router.replace("/login");
      setTrainee(null);
      setLogs([]);
    }, remaining);
    return timer;
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        const session = await getSession();
        if (cancelled) return;

        if (!session.authenticated) {
          router.replace("/login");
          return;
        }

        setViewerRole(session.role === "admin" ? "admin" : "trainee");

        const displayName = session.currentUser?.displayName || "Trainee";
        const email = session.currentUser?.email;
        setActiveUserLabel(email ? `${displayName}` : displayName);

        if (session.role === "trainee") {
          if (!session.traineeId) {
            router.replace("/login");
            return;
          }

          if (session.requiresPendingEmailVerification) {
            router.replace("/login");
            return;
          }

          if (session.traineeId !== id) {
            router.replace(`/trainee/${session.traineeId}/dashboard`);
            return;
          }
        }

        expiryTimer = scheduleAutoLock(session.expiresAt ?? undefined);
        loadData();
      } catch {
        if (!cancelled) router.replace("/login");
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();

    return () => {
      cancelled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, [id, loadData, router, scheduleAutoLock]);

  useEffect(() => {
    const onBackupImportComplete = () => {
      void loadData();
    };

    window.addEventListener("backup-import-complete", onBackupImportComplete);
    return () => {
      window.removeEventListener("backup-import-complete", onBackupImportComplete);
    };
  }, [loadData]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch {
      // ignore and redirect
    }
    setTrainee(null);
    setLogs([]);
    router.replace("/login");
  }, [router]);

  const summary = useMemo(() => {
    if (!trainee) {
      return { remaining: 0, percent: 0, expectedEndDate: null as Date | null };
    }
    const requiredMinutes = trainee.requiredHours * 60;
    const remaining = Math.max(0, requiredMinutes - totalHours);
    const percent = requiredMinutes > 0 ? Math.min(100, Math.round((totalHours / requiredMinutes) * 100)) : 0;
    const expectedEndDate = remaining > 0
      ? calculateExpectedEndDate(remaining / 60, undefined, trainee.workSchedule)
      : null;
    return { remaining, percent, expectedEndDate };
  }, [trainee, totalHours]);

  return {
    id,
    trainee,
    logs,
    totalHours,
    totalOvertime,
    totalOffsetUsed,
    availableOffset,
    loading,
    authChecking,
    viewerRole,
    activeUserLabel,
    loadData,
    handleLogout,
    ...summary,
  };
}
