"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { consumeTransfer, type TransferData } from "@/lib/transfer-store";
import { stopGeneration } from "@/lib/api";
import { AnalyzePage, type SessionSnapshot } from "@/components/analyze-page";

function AnalyzeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [transfer, setTransfer] = useState<TransferData | null>(null);
  const [recoverySnapshot, setRecoverySnapshot] = useState<SessionSnapshot | null>(null);
  const consumedRef = useRef(false);

  const tid = searchParams.get("tid");

  // Persist sessionId by tid so the same backend workspace survives reloads
  const [sessionId] = useState(() => {
    if (!tid) return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const key = `session:${tid}`;
    try {
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;
    } catch { /* noop */ }
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try { sessionStorage.setItem(key, id); } catch { /* noop */ }
    return id;
  });

  useEffect(() => {
    // Guard against React Strict Mode double-invocation
    if (consumedRef.current) return;

    // Redirect to landing — don't stop any backend stream; other sessions
    // may still be legitimately running.
    const redirectToHome = () => {
      router.replace("/");
    };

    if (!tid) {
      redirectToHome();
      return;
    }

    // Check for a session snapshot (completed or mid-stream; survives reloads/HMR)
    try {
      const raw = sessionStorage.getItem(`snapshot:${sessionId}`);
      if (raw) {
        const snap: SessionSnapshot = JSON.parse(raw);
        consumedRef.current = true;
        // If snapshot was mid-stream, stop the backend stream (our SSE connection is gone)
        if (snap.phase === "streaming") {
          stopGeneration(sessionId).catch(() => {});
        }
        setTransfer({ prompt: snap.prompt, files: [], reportTheme: snap.reportTheme, presetId: snap.presetId, planRouterEnabled: snap.planRouterEnabled ?? false, engine: snap.engine ?? "deepanalyze" });
        setRecoverySnapshot(snap);
        return;
      }
    } catch { /* noop */ }

    // Normal path: consume transfer data
    const data = consumeTransfer(tid);
    if (!data) {
      // No transfer and no snapshot — stop any stale stream and redirect
      redirectToHome();
      return;
    }
    consumedRef.current = true;
    setTransfer(data);
  }, [searchParams, router, tid, sessionId]);

  if (!transfer) {
    return (
      <div className="relative flex h-[100dvh] items-center justify-center bg-background overflow-hidden">
        <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03] dark:opacity-[0.06] bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] mix-blend-overlay" />
        <div className="flex flex-col items-center gap-4 z-10">
          <div className="w-8 h-8 border border-primary/20 border-t-primary rounded-full animate-spin" />
          <div className="font-mono text-[10px] text-primary uppercase tracking-[0.3em] font-medium drop-shadow-[0_0_10px_rgba(var(--primary),0.3)]">
            Initializing Session
          </div>
        </div>
      </div>
    );
  }

  return (
    <AnalyzePage
      prompt={transfer.prompt}
      files={transfer.files}
      reportTheme={transfer.reportTheme}
      presetId={transfer.presetId}
      planningEnabled={transfer.planRouterEnabled}
      routerEnabled={transfer.planRouterEnabled}
      engine={transfer.engine}
      sessionId={sessionId}
      recoverySnapshot={recoverySnapshot}
    />
  );
}

export default function AnalyzeRoute() {
  return (
    <Suspense
      fallback={
        <div className="relative flex h-[100dvh] items-center justify-center bg-background overflow-hidden">
          <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03] dark:opacity-[0.06] bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] mix-blend-overlay" />
          <div className="flex flex-col items-center gap-4 z-10">
            <div className="w-8 h-8 border border-primary/20 border-t-primary rounded-full animate-spin" />
            <div className="font-mono text-[10px] text-primary uppercase tracking-[0.3em] font-medium">
              Loading Route
            </div>
          </div>
        </div>
      }
    >
      <AnalyzeContent />
    </Suspense>
  );
}
