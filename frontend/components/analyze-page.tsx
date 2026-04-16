"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { useTheme } from "next-themes";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Check,
  Paperclip,
  Loader2,
  Download,
  Square,
  Trash2,
  X,
  ImageIcon,
  FileSpreadsheet,
  FileText,
  Sparkles,
  Package,
  PanelRightOpen,
  PanelRightClose,
  Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ThemeToggle } from "@/components/theme-toggle";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { CodeBlockCode } from "@/components/ui/code-block";
import { Markdown } from "@/components/ui/markdown";
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import {
  uploadFiles,
  startChatStream,
  stopGeneration,
  clearWorkspace,
  fetchWorkspaceFiles,
  getDownloadUrl,
  getDownloadBundleUrl,
  planAnalysis,
  generateHtmlReport,
  type WorkspaceFile,
} from "@/lib/api";
import { setActiveSession, clearTransfer } from "@/lib/transfer-store";
import {
  parseSections,
  getPreTagContent,
  type ParsedSection,
  type SectionType,
} from "@/lib/stream-parser";
import { cn } from "@/lib/utils";
import { BACKEND_URL } from "@/lib/config";
import type { EngineType } from "@/lib/transfer-store";


// ─── Types ───────────────────────────────────────────────────────────

type Phase = "uploading" | "planning" | "streaming" | "complete" | "error";

export interface SessionSnapshot {
  prompt: string;
  reportTheme: string;
  presetId: string | null;
  phase: Phase;
  accumulatedContent: string;
  completedTurns: CompletedTurn[];
  messages: Array<{ role: string; content: string }>;
  workspaceFileNames: string[];
  plan?: string | null;
  planRouterEnabled?: boolean;
  engine?: EngineType;
  reportStatus?: "idle" | "generating" | "ready" | "error" | "cancelled";
  reportUrl?: string | null;
  reportFallback?: boolean;
}

interface AnalyzePageProps {
  prompt: string;
  files: File[];
  reportTheme: string;
  presetId: string | null;
  planningEnabled: boolean;
  routerEnabled: boolean;
  engine: EngineType;
  sessionId: string;
  recoverySnapshot?: SessionSnapshot | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface CompletedTurn {
  role: "user" | "assistant";
  content: string;
  artifacts?: WorkspaceFile[];
  fileNames?: string[];
}

// ─── Section config ──────────────────────────────────────────────────

const SECTION_META: Record<SectionType, { label: string; color: string }> = {
  Analyze: { label: "thinking", color: "var(--muted-foreground)" },
  Understand: { label: "thinking", color: "var(--muted-foreground)" },
  Code: { label: "code", color: "var(--primary)" },
  Execute: { label: "output", color: "var(--primary)" },
  Answer: { label: "answer", color: "var(--primary)" },
  File: { label: "files", color: "var(--primary)" },
  RouterGuidance: { label: "senior analyst", color: "var(--chart-4)" },
  Thinking: { label: "reasoning", color: "var(--muted-foreground)" },
};

const REPORT_THEMES = [
  { id: "literature", label: "Literature" },
  { id: "academic", label: "Academic" },
  { id: "surprise", label: "Surprise me" },
  { id: "dossier", label: "Old School" },
  { id: "blueprint", label: "Engineering" },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────

function extractCodeLanguage(content: string): string {
  const m = content.match(/^```(\w+)/);
  return m ? m[1] : "python";
}

function stripCodeFences(content: string): string {
  return content.trim().replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return ImageIcon;
  if (["csv", "xlsx", "xls", "tsv"].includes(ext)) return FileSpreadsheet;
  return FileText;
}

// ─── Main Component ──────────────────────────────────────────────────

export function AnalyzePage({
  prompt,
  files,
  reportTheme: initialReportTheme,
  presetId,
  planningEnabled,
  routerEnabled,
  engine,
  sessionId,
  recoverySnapshot,
}: AnalyzePageProps) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  // ── State ─────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("uploading");
  const [reportTheme, setReportTheme] = useState(initialReportTheme);
  const [errorMessage, setErrorMessage] = useState("");
  const [accumulatedContent, setAccumulatedContent] = useState("");
  const [artifacts, setArtifacts] = useState<WorkspaceFile[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [plan, setPlan] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [followUpInput, setFollowUpInput] = useState("");
  const [followUpFiles, setFollowUpFiles] = useState<File[]>([]);
  const [workspaceFileNames, setWorkspaceFileNames] = useState<string[]>([]);
  const [completedTurns, setCompletedTurns] = useState<CompletedTurn[]>([]);
  const followUpFileInputRef = useRef<HTMLInputElement>(null);
  const [themePopoverOpen, setThemePopoverOpen] = useState(false);

  const pendingContentRef = useRef("");
  const displayedContentRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // ── Report generation state ──────────────────────────────────────
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  const [reportStatus, setReportStatus] = useState<"idle" | "generating" | "ready" | "error" | "cancelled">("idle");
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportFallback, setReportFallback] = useState(false);
  const reportAbortRef = useRef<AbortController | null>(null);
  const reportGenIdRef = useRef(0);

  // ── Derived ───────────────────────────────────────────────────────
  const sections = useMemo(() => parseSections(accumulatedContent), [accumulatedContent]);
  const preTagContent = useMemo(() => getPreTagContent(accumulatedContent), [accumulatedContent]);

  // Deduplicate artifacts: prefer root-level over generated/ subfolder
  const dedupedArtifacts = useMemo(() => {
    const seen = new Map<string, WorkspaceFile>();
    for (const f of artifacts) {
      const key = f.name;
      const existing = seen.get(key);
      // Prefer the shorter path (root level, not generated/)
      if (!existing || f.path.length < existing.path.length) {
        seen.set(key, f);
      }
    }
    return Array.from(seen.values());
  }, [artifacts]);

  // Collect all artifacts from all turns + current live artifacts for the right panel
  const allArtifacts = useMemo(() => {
    const seen = new Map<string, WorkspaceFile>();
    // From completed turns
    for (const turn of completedTurns) {
      if (turn.artifacts) {
        for (const f of turn.artifacts) {
          const existing = seen.get(f.name);
          if (!existing || f.path.length < existing.path.length) seen.set(f.name, f);
        }
      }
    }
    // From current/live artifacts
    for (const f of dedupedArtifacts) {
      const existing = seen.get(f.name);
      if (!existing || f.path.length < existing.path.length) seen.set(f.name, f);
    }
    return Array.from(seen.values());
  }, [completedTurns, dedupedArtifacts]);

  // ── Auto-open right panel when analysis completes ──────────────────
  useEffect(() => {
    if (phase === "complete" && allArtifacts.length > 0) {
      setRightPanelOpen(true);
    }
  }, [phase, allArtifacts.length]);

  // ── Save snapshot to sessionStorage (on completion + periodically during streaming) ──
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Helper: write current state as a snapshot
  const writeSnapshot = useCallback(() => {
    try {
      const content = pendingContentRef.current || accumulatedContent;
      if (!content && phase === "streaming") return; // nothing to save yet
      const snap: SessionSnapshot = {
        prompt, reportTheme, presetId, phase,
        accumulatedContent: content,
        completedTurns, messages, workspaceFileNames, plan, engine,
        reportStatus,
        reportUrl,
        reportFallback,
      };
      sessionStorage.setItem(`snapshot:${sessionId}`, JSON.stringify(snap));
    } catch { /* quota — non-critical */ }
  }, [sessionId, prompt, reportTheme, presetId, accumulatedContent, completedTurns, messages, workspaceFileNames, plan, engine, reportStatus, reportUrl, reportFallback, phase]);

  // Save immediately on completion (and whenever completion-phase state changes)
  useEffect(() => {
    if (phase !== "complete") return;
    writeSnapshot();
  }, [phase, writeSnapshot]);

  // Save periodically during streaming so HMR/refresh can recover partial content
  useEffect(() => {
    if (phase !== "streaming") {
      if (snapshotTimerRef.current) { clearInterval(snapshotTimerRef.current); snapshotTimerRef.current = null; }
      return;
    }
    // Save every 3 seconds during streaming
    snapshotTimerRef.current = setInterval(() => {
      try {
        const content = pendingContentRef.current;
        if (!content) return;
        const snap: SessionSnapshot = {
          prompt, reportTheme, presetId, phase: "streaming",
          accumulatedContent: content,
          completedTurns, messages, workspaceFileNames, plan, engine,
          reportStatus: "idle",
          reportUrl: null,
        };
        sessionStorage.setItem(`snapshot:${sessionId}`, JSON.stringify(snap));
      } catch { /* quota — non-critical */ }
    }, 3000);
    return () => { if (snapshotTimerRef.current) { clearInterval(snapshotTimerRef.current); snapshotTimerRef.current = null; } };
  }, [phase, sessionId, prompt, reportTheme, presetId, completedTurns, messages, workspaceFileNames, plan, engine]);

  // ── Auto-trigger HTML report generation on completion ─────────────
  useEffect(() => {
    if (phase !== "complete" || reportStatus !== "idle") return;
    setReportStatus("generating");
    const genId = ++reportGenIdRef.current;
    const controller = new AbortController();
    reportAbortRef.current = controller;

    const fullMessages = [
      ...messages,
      { role: "assistant", content: accumulatedContent },
    ];
    const artifactPayload = dedupedArtifacts.map((a) => ({ name: a.name, path: a.path }));

    generateHtmlReport(sessionId, fullMessages, prompt, reportTheme, artifactPayload, controller.signal)
      .then((result) => {
        if (reportGenIdRef.current !== genId) return; // stale
        setReportUrl(`${BACKEND_URL}${result.view_url}`);
        setReportFallback(result.fallback ?? false);
        setReportStatus("ready");
      })
      .catch((err) => {
        if (reportGenIdRef.current !== genId) return;
        if (err instanceof Error && err.name === "AbortError") {
          // Don't reset to idle — handleCancelReport already set "cancelled"
          return;
        } else {
          setReportError(err instanceof Error ? err.message : "Report generation failed");
          setReportStatus("error");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reportStatus]);

  const handleCancelReport = useCallback(() => {
    reportAbortRef.current?.abort();
    reportAbortRef.current = null;
    reportGenIdRef.current++;
    setReportStatus("cancelled");
    setReportError(null);
  }, []);

  const handleRetryReport = useCallback(() => {
    setReportStatus("idle");
    setReportError(null);
    setReportFallback(false);
  }, []);

  const handleRegenerateReport = useCallback(() => {
    // Cancel any in-progress generation first
    reportAbortRef.current?.abort();
    reportAbortRef.current = null;
    reportGenIdRef.current++;
    setReportUrl(null);
    setReportError(null);
    setReportFallback(false);
    // Set to idle so the auto-trigger effect picks it up
    setReportStatus("idle");
  }, []);

  // ── Scroll tracking ───────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    // Use functional update to avoid unnecessary re-renders that break text selection
    setShowScrollBtn((prev) => {
      const next = !atBottom;
      return prev === next ? prev : next;
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: "smooth" });
    setShowScrollBtn(false);
  }, []);

  const handleCopy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // ── RAF loop ──────────────────────────────────────────────────────
  const startRafLoop = useCallback(() => {
    const tick = () => {
      const pending = pendingContentRef.current;
      const displayed = displayedContentRef.current;
      if (pending.length > displayed.length) {
        const diff = pending.length - displayed.length;
        const step = Math.max(1, Math.ceil(diff / 5));
        displayedContentRef.current = pending.slice(0, Math.min(displayed.length + step, pending.length));
        setAccumulatedContent(displayedContentRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRafLoop = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  // ── Stream ────────────────────────────────────────────────────────
  const startStream = useCallback(
    async (chatMessages: ChatMessage[], wsFiles: string[], planText?: string | null) => {
      setPhase("streaming");
      const controller = new AbortController();
      abortControllerRef.current = controller;
      try {
        const response = await startChatStream(sessionId, chatMessages, wsFiles, controller.signal, planText, routerEnabled, engine);
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");
        const decoder = new TextDecoder();
        startRafLoop();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of decoder.decode(value, { stream: true }).split("\n").filter((l) => l.trim())) {
            try {
              const json = JSON.parse(line);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) pendingContentRef.current += delta;
              if (json.choices?.[0]?.finish_reason === "stop") break;
            } catch { /* skip */ }
          }
        }
        stopRafLoop();
        displayedContentRef.current = pendingContentRef.current;
        setAccumulatedContent(pendingContentRef.current);
        setPhase("complete");
        try {
          const ws = await fetchWorkspaceFiles(sessionId);
          setArtifacts(ws.filter((f) => f.is_generated));
        } catch { /* non-critical */ }
      } catch (err: unknown) {
        stopRafLoop();
        if (err instanceof Error && err.name === "AbortError") {
          displayedContentRef.current = pendingContentRef.current;
          setAccumulatedContent(pendingContentRef.current);
          setPhase("complete");
        } else {
          setErrorMessage(err instanceof Error ? err.message : "Stream failed");
          setPhase("error");
        }
      }
    },
    [sessionId, startRafLoop, stopRafLoop, engine, routerEnabled]
  );

  // ── Initial upload ────────────────────────────────────────────────
  useEffect(() => {
    // Restore from snapshot (completed or interrupted session recovery)
    if (recoverySnapshot) {
      // Always restore as "complete" — even if the snapshot was mid-stream,
      // the SSE connection is gone so we show whatever was accumulated.
      setPhase("complete");
      setAccumulatedContent(recoverySnapshot.accumulatedContent);
      pendingContentRef.current = recoverySnapshot.accumulatedContent;
      displayedContentRef.current = recoverySnapshot.accumulatedContent;
      setMessages(recoverySnapshot.messages as ChatMessage[]);
      setCompletedTurns(recoverySnapshot.completedTurns);
      setWorkspaceFileNames(recoverySnapshot.workspaceFileNames);
      setPlan(recoverySnapshot.plan ?? null);
      setUploadProgress(100);
      // Restore report state — never auto-trigger on recovery.
      // "generating" becomes "cancelled" (the fetch was interrupted by refresh).
      // "idle" becomes "cancelled" too (don't auto-start report on refresh).
      const savedStatus = recoverySnapshot.reportStatus ?? "cancelled";
      const restoredStatus = (savedStatus === "generating" || savedStatus === "idle") ? "cancelled" : savedStatus;
      setReportStatus(restoredStatus);
      if (recoverySnapshot.reportUrl) setReportUrl(recoverySnapshot.reportUrl);
      if (recoverySnapshot.reportFallback) setReportFallback(true);
      // Re-fetch artifacts from backend (workspace is still intact)
      fetchWorkspaceFiles(sessionId).then((ws) => {
        setArtifacts(ws.filter((f) => f.is_generated));
      }).catch(() => { });
      return;
    }

    let cancelled = false;
    async function run() {
      try {
        let fNames: string[];
        if (files.length > 0) {
          // Normal flow: upload files first
          setUploadProgress(10);
          await uploadFiles(sessionId, files);
          if (cancelled) return;
          setUploadProgress(100);
          fNames = files.map((f) => f.name);
        } else {
          // Recovery flow (HMR / reload): files already on backend workspace
          setUploadProgress(100);
          try {
            const ws = await fetchWorkspaceFiles(sessionId);
            fNames = ws.map((f) => f.name);
          } catch {
            fNames = [];
          }
        }
        setWorkspaceFileNames(fNames);
        setActiveSession(sessionId);

        // Planning phase: profile data + Gemini plan (only if enabled, not for Gemini engine)
        let planText: string | null = null;
        if (planningEnabled && engine !== "gemini") {
          setPhase("planning");
          try {
            const planResult = await planAnalysis(sessionId, prompt, fNames);
            if (planResult.plan) planText = planResult.plan;
          } catch { /* planning failed — continue without plan */ }
          if (cancelled) return;
        }
        setPlan(planText);

        const initialMsg: ChatMessage = { role: "user", content: prompt };
        setMessages([initialMsg]);
        await startStream([initialMsg], fNames, planText);
      } catch (err: unknown) {
        if (!cancelled) { setErrorMessage(err instanceof Error ? err.message : "Upload failed"); setPhase("error"); }
      }
    }
    run();
    return () => { cancelled = true; abortControllerRef.current?.abort(); stopRafLoop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const handleStop = useCallback(async () => {
    try { await stopGeneration(sessionId); } catch { /* */ }
    abortControllerRef.current?.abort();
    stopRafLoop();
    displayedContentRef.current = pendingContentRef.current;
    setAccumulatedContent(pendingContentRef.current);
    setPhase("complete");
  }, [sessionId, stopRafLoop]);

  const handleSendFollowUp = useCallback(async () => {
    const text = followUpInput.trim();
    if (!text && followUpFiles.length === 0) return;
    const followUpFileNames = followUpFiles.map((f) => f.name);
    let updatedWsFiles = workspaceFileNames;
    if (followUpFiles.length > 0) {
      try {
        await uploadFiles(sessionId, followUpFiles);
        updatedWsFiles = [...workspaceFileNames, ...followUpFileNames];
        setWorkspaceFileNames(updatedWsFiles);
      } catch { /* */ }
    }
    const userMsg: ChatMessage = { role: "user", content: text || "(attached files)" };
    const assistantMsg: ChatMessage = { role: "assistant", content: accumulatedContent };
    const newMessages = [...messages, assistantMsg, userMsg];
    setMessages(newMessages);
    // Snapshot the completed assistant turn + new user turn for rendering history
    setCompletedTurns(prev => [
      ...prev,
      { role: "assistant", content: accumulatedContent, artifacts: [...dedupedArtifacts] },
      { role: "user", content: text || "(attached files)", fileNames: followUpFileNames },
    ]);
    pendingContentRef.current = "";
    displayedContentRef.current = "";
    setAccumulatedContent("");
    setFollowUpInput("");
    setFollowUpFiles([]);
    // Abort any in-progress report generation and reset
    reportAbortRef.current?.abort();
    reportGenIdRef.current++;
    setReportStatus("idle");
    setReportUrl(null);
    setReportError(null);
    setReportFallback(false);
    await startStream(newMessages, updatedWsFiles);
  }, [followUpInput, followUpFiles, sessionId, accumulatedContent, messages, workspaceFileNames, startStream, dedupedArtifacts]);

  const handleClearWorkspace = useCallback(async () => {
    // Stop any active streaming first
    abortControllerRef.current?.abort();
    stopRafLoop();
    try { await stopGeneration(sessionId); } catch { /* */ }
    try { await clearWorkspace(sessionId); } catch { /* */ }
    // Clean up sessionStorage entries for this session
    try {
      sessionStorage.removeItem(`snapshot:${sessionId}`);
      const tid = new URL(window.location.href).searchParams.get("tid");
      if (tid) {
        sessionStorage.removeItem(`session:${tid}`);
        clearTransfer(tid);
      }
    } catch { /* noop */ }
    router.push("/");
  }, [sessionId, router, stopRafLoop]);

  const handleFollowUpFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFollowUpFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
  };

  // ─── Section renderers ────────────────────────────────────────────

  const renderSection = (section: ParsedSection, nextSection?: ParsedSection) => {
    const isStreaming = !section.isComplete;

    // ── Gemini Thinking (reasoning trace) ───────────────────────────
    if (section.type === "Thinking") {
      return (
        <details className="group border border-blue-500/10 bg-blue-500/[0.02] overflow-hidden" open={isStreaming}>
          <summary className="cursor-pointer px-4 py-2.5 flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
            <span className="size-1.5 bg-blue-500/60 rotate-45" />
            {isStreaming ? (
              <span className="flex items-center gap-1.5">
                Reasoning
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
              </span>
            ) : (
              "Reasoning Trace"
            )}
            <span className="ml-auto text-[10px] opacity-50 group-open:hidden">click to expand</span>
          </summary>
          <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground/70 italic leading-[1.75] whitespace-pre-wrap break-words">
            {section.content}
            {isStreaming && <span className="streaming-cursor" />}
          </div>
        </details>
      );
    }

    // ── Thinking (Analyze / Understand) ─────────────────────────────
    if (section.type === "Analyze" || section.type === "Understand") {
      return (
        <div className="thinking-section text-[16px] leading-[1.75] whitespace-pre-wrap break-words">
          {section.content}
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      );
    }

    // ── Code + attached Execute ─────────────────────────────────────
    if (section.type === "Code") {
      const lang = extractCodeLanguage(section.content);
      const code = stripCodeFences(section.content).trim();
      const isLarge = code.length > 8000;
      // Check if next section is Execute (to attach it)

      return (
        <div className="terminal-card overflow-hidden border border-primary/20 bg-background shadow-md">
          {/* Terminal header */}
          <div className="terminal-header flex items-center justify-between px-4 py-2 bg-primary/5 border-b border-primary/20">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-4 bg-primary/60" />
              <span className="text-[10px] font-mono text-primary/80 uppercase tracking-[0.2em] font-bold">{lang}</span>
            </div>
            {!isStreaming && (
              <Button variant="ghost" size="icon" className="h-6 w-6 rounded-none hover:bg-primary/20 text-primary/60 hover:text-primary transition-colors"
                onClick={() => handleCopy(code, section.id)}>
                {copiedId === section.id ? <Check className="size-3" /> : <Copy className="size-3" />}
              </Button>
            )}
          </div>
          {/* Code body */}
          <div className="bg-primary/[0.02]">
            {isLarge || isStreaming ? (
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[14px] p-4 leading-[1.65]">
                <code>{code}</code>
                {isStreaming && <span className="streaming-cursor" />}
              </pre>
            ) : (
              <CodeBlockCode code={code} language={lang}
                theme={resolvedTheme === "dark" ? "vitesse-dark" : "github-light-default"}
                className="text-[14px] [&>pre]:!bg-transparent" />
            )}
          </div>
        </div>
      );
    }

    // ── Execute (standalone, not attached to code) ──────────────────
    if (section.type === "Execute") {
      return (
        <div className="terminal-output-standalone rounded-none border-l-2 border-primary/20 bg-primary/[0.03] p-4 overflow-x-auto shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-3 bg-primary/40" />
            <span className="text-[9px] font-mono text-primary/60 uppercase tracking-widest">stdout</span>
          </div>
          <pre className="font-mono text-[13px] leading-[1.65] text-foreground/85 whitespace-pre-wrap pl-3">{section.content}</pre>
        </div>
      );
    }

    // ── Answer ──────────────────────────────────────────────────────
    if (section.type === "Answer") {
      return (
        <div className="answer-block">
          <div className="text-[16px] leading-[1.75] whitespace-pre-wrap break-words">
            {section.content}
            {isStreaming && <span className="streaming-cursor" />}
          </div>
        </div>
      );
    }

    // ── Files ───────────────────────────────────────────────────────
    if (section.type === "File") return renderFileCards(section);

    // ── Router Guidance (Senior Analyst) ─────────────────────────
    if (section.type === "RouterGuidance") {
      // Strip code fences so guidance renders as plain prose, not code blocks
      const cleanContent = section.content
        .replace(/```[\w]*\n?/g, "")
        .replace(/\n?```/g, "")
        .trim();
      return (
        <div className="border-l-2 border-amber-500/40 bg-amber-500/[0.03] p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="w-1.5 h-3 bg-amber-500/60" />
            <span className="text-[9px] font-mono text-amber-600 dark:text-amber-400 uppercase tracking-widest font-semibold">
              Senior Analyst
            </span>
          </div>
          <div className="text-[14px] leading-[1.75] text-foreground/80 whitespace-pre-wrap break-words">
            {cleanContent}
            {isStreaming && <span className="streaming-cursor" />}
          </div>
        </div>
      );
    }

    return null;
  };

  // ── Render attached execute output (below code) ───────────────────
  const renderAttachedOutput = (section: ParsedSection) => (
    <div className="mt-2 text-sm">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 border border-primary/40" />
        <span className="text-[9px] font-mono text-primary/60 uppercase tracking-widest font-semibold">Execution Output</span>
      </div>
      <div className="mt-2 border border-primary/20 bg-primary/5 p-4 rounded-none shadow-inner overflow-x-auto relative">
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-primary opacity-20" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-primary opacity-20" />
        <pre className="font-mono text-[13px] leading-[1.65] text-foreground/85 whitespace-pre-wrap">{section.content}</pre>
      </div>
    </div>
  );

  const renderFileCards = (section: ParsedSection) => {
    const linkRe = /!?\[([^\]]+)\]\(([^)]+)\)/g;
    const links: { name: string; url: string; isImage: boolean }[] = [];
    let m;
    while ((m = linkRe.exec(section.content)) !== null) {
      links.push({ name: m[1], url: m[2], isImage: m[0].startsWith("!") });
    }
    // Deduplicate file links by name
    const seen = new Set<string>();
    const uniqueLinks = links.filter((l) => {
      if (seen.has(l.name)) return false;
      seen.add(l.name);
      return true;
    });
    if (!uniqueLinks.length) return <div className="text-sm text-muted-foreground whitespace-pre-wrap">{section.content}</div>;

    return (
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin">
        {uniqueLinks.map((f, i) => {
          const Icon = getFileIcon(f.name);
          // Fix path: if URL is already a full backend URL, use as-is. Otherwise build it.
          const url = f.url.startsWith("http") || f.url.startsWith("/workspace")
            ? (f.url.startsWith("/") ? `http://localhost:8200${f.url}` : f.url)
            : getDownloadUrl(sessionId, f.name);

          return (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
              className="flex-shrink-0 w-44 rounded-lg border bg-card/60 hover:bg-card hover:border-primary/30 transition-all p-3 group">
              {f.isImage ? (
                <div className="w-full h-20 rounded-md overflow-hidden bg-muted mb-2">
                  <img src={url} alt={f.name} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-full h-20 rounded-md bg-muted flex items-center justify-center mb-2">
                  <Icon className="size-6 text-muted-foreground/40" />
                </div>
              )}
              <p className="text-[11px] font-medium truncate">{f.name}</p>
            </a>
          );
        })}
      </div>
    );
  };

  const renderUserBubble = (content: string, fileNames: string[], key: string) => (
    <motion.div key={key} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex justify-end mb-10">
      <div className="max-w-[85%] sm:max-w-[75%] flex flex-col items-end">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-6 sm:w-8 h-px bg-primary/30" />
          <span className="font-mono text-[9px] text-primary uppercase tracking-[0.2em] font-bold">User</span>
        </div>
        <div className="bg-primary/5 border border-primary/20 p-4 sm:p-5 backdrop-blur-md relative shadow-sm hover:border-primary/40 transition-colors group">
          <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-primary opacity-50 group-hover:opacity-100 transition-opacity" />
          <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-primary opacity-50 group-hover:opacity-100 transition-opacity" />
          <p className="text-[14px] sm:text-[15px] leading-[1.8] whitespace-pre-wrap text-right font-medium text-foreground">{content}</p>
          {fileNames.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2 mt-4">
              {fileNames.map((name, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 border border-primary/20 bg-background/50 px-2.5 py-1 text-[10px] sm:text-[11px] font-mono text-primary/80 lowercase tracking-tight shadow-sm">
                  <Paperclip className="size-3" />{name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );

  // ─── Build section elements from parsed sections ───────────────────
  const buildSectionElements = (sectionList: ParsedSection[], keyPrefix = "") => {
    const elements: React.ReactNode[] = [];
    for (let i = 0; i < sectionList.length; i++) {
      const section = sectionList[i];
      const next = sectionList[i + 1];
      const meta = SECTION_META[section.type];

      if (section.type === "Execute" && i > 0 && sectionList[i - 1].type === "Code" && sectionList[i - 1].isComplete) {
        continue;
      }

      const isCodeWithOutput = section.type === "Code" && section.isComplete && next?.type === "Execute" && next.isComplete;

      // Thinking sections render without the timeline indicator
      if (section.type === "Thinking") {
        elements.push(
          <div
            key={`${keyPrefix}${section.id}`}
            className="animate-in fade-in slide-in-from-bottom-1 duration-300 mb-4"
          >
            {renderSection(section, next)}
          </div>
        );
        continue;
      }

      elements.push(
        <div
          key={`${keyPrefix}${section.id}`}
          className="section-row animate-in fade-in slide-in-from-bottom-1 duration-300"
        >
          <div className="section-indicator">
            <div className="indicator-line-segment" style={{ height: 8 }} />
            <div className="indicator-dot" style={{ backgroundColor: meta.color }} />
            <span className="indicator-label" style={{ color: meta.color }}>{meta.label}</span>
            <div className="indicator-line-segment flex-1" />
          </div>
          <div className="section-content">
            {renderSection(section, next)}
            {isCodeWithOutput && renderAttachedOutput(next!)}
          </div>
        </div>
      );
    }
    return elements;
  };

  const renderArtifactsStrip = (artifactsList: WorkspaceFile[], keyPrefix = "") => {
    if (artifactsList.length === 0) return null;
    // Deduplicate
    const seen = new Map<string, WorkspaceFile>();
    for (const f of artifactsList) {
      const existing = seen.get(f.name);
      if (!existing || f.path.length < existing.path.length) seen.set(f.name, f);
    }
    const deduped = Array.from(seen.values());
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mt-10 mb-6 w-full">
        <div className="flex items-center justify-between mb-4 border-b border-border/40 pb-2">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 bg-primary/80 rotate-45" />
            <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-foreground font-semibold">Artifacts_Generated</span>
          </div>
          <span className="font-mono text-[9px] text-muted-foreground mr-1">[{deduped.length}]</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
          {deduped.map((file, i) => {
            const Icon = getFileIcon(file.name);
            const url = getDownloadUrl(sessionId, file.path);
            const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((ext) => file.name.endsWith(ext));
            return (
              <motion.a key={`${keyPrefix}art-${i}`} href={url} target="_blank" rel="noopener noreferrer"
                initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
                className="flex flex-col rounded-none border border-border/50 bg-background/40 hover:bg-muted/30 hover:border-primary/40 transition-all p-3 sm:p-4 group relative overflow-hidden backdrop-blur-sm">
                <div className="absolute top-0 right-0 w-8 h-8 bg-primary/5 translate-x-4 -translate-y-4 group-hover:translate-x-2 group-hover:-translate-y-2 transition-transform rotate-45" />
                {isImage ? (
                  <div className="w-full aspect-video mb-3 overflow-hidden bg-muted/50 border border-border/30">
                    <img src={url} alt={file.name} className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500" />
                  </div>
                ) : (
                  <div className="w-full aspect-video mb-3 bg-muted/30 border border-border/30 flex items-center justify-center">
                    <Icon className="size-6 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                  </div>
                )}
                <div className="flex items-start justify-between gap-2 mt-auto">
                  <div className="flex flex-col overflow-hidden">
                    <p className="text-[12px] font-mono font-medium truncate group-hover:text-primary transition-colors">{file.name}</p>
                    {file.size > 0 && <p className="text-[9px] font-mono text-muted-foreground mt-1">{(file.size / 1024).toFixed(1)} KB</p>}
                  </div>
                  <Download className="size-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0 mt-0.5" />
                </div>
              </motion.a>
            );
          })}
        </div>
      </motion.div>
    );
  };

  // Current live stream sections
  const sectionElements = buildSectionElements(sections);

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[100dvh] w-full bg-background overflow-hidden relative">

      {/* Background Ambience */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[10%] left-[10%] w-[60vw] h-[60vw] md:w-[40vw] md:h-[40vw] bg-primary/10 rounded-full blur-[80px] md:blur-[120px] mix-blend-normal" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[70vw] h-[50vw] bg-[#E5A84B]/10 dark:bg-[#F5C76A]/10 rounded-full blur-[100px] md:blur-[140px]" />
        <div className="absolute inset-0 z-0 opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] mix-blend-overlay" />
      </div>

      {/* Main Layout: Chat + Right Panel */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative z-10">

        {/* Integrated Header Bar — occupies the top space ("green area") */}
        <div className="flex items-center justify-between px-4 sm:px-8 h-12 flex-shrink-0 z-40 bg-background/20 backdrop-blur-xl border-b border-border/5">
          {/* Top Left */}
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="font-display font-medium text-lg sm:text-xl tracking-tight text-foreground lowercase leading-none">
              <span className="text-primary italic pr-[1px]">sway</span>lytics<span className="text-primary font-bold italic tracking-tighter">.</span>
            </span>
          </div>

          {/* Top Right */}
          <div className="flex items-center gap-0.5 sm:gap-1">
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 border border-border/20 bg-background/40">
              <span className="font-mono text-[9px] text-muted-foreground/60 uppercase tracking-[0.1em] h-2.5 flex items-center">Status</span>
              {phase === "streaming" || phase === "planning" ? (
                <div className="flex items-center gap-1.5 min-w-[65px]">
                  <div className="w-1 h-1 bg-primary rounded-none animate-ping" />
                  <span className="font-mono text-[9px] text-primary uppercase tracking-[0.1em] font-bold">
                    {phase === "planning" ? "Planning" : "Synthesizing"}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 min-w-[65px]">
                  <div className="w-1 h-1 bg-border rounded-none" />
                  <span className="font-mono text-[9px] text-muted-foreground/60 uppercase tracking-[0.1em]">Idle</span>
                </div>
              )}
            </div>
            <button
              onClick={() => setRightPanelOpen((p) => !p)}
              className="hidden lg:flex items-center justify-center size-8 text-muted-foreground/70 hover:text-foreground transition-all duration-200 border border-border/20 hover:border-primary/40 hover:bg-primary/5 relative"
              title={rightPanelOpen ? "Hide files panel" : "Show files panel"}
            >
              {rightPanelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
              {!rightPanelOpen && allArtifacts.length > 0 && (
                <div className="absolute top-1.5 right-1.5 w-1 h-1 bg-primary rounded-full shadow-[0_0_4px_rgba(var(--primary),0.5)]" />
              )}
            </button>
            <ThemeToggle />
          </div>
        </div>

        <div className="flex-1 flex h-full overflow-hidden">

          {/* Left: Chat Area */}
          <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]">

            {/* Scroll area */}
            <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl px-4 sm:px-8 md:px-12 pb-0">

                {renderUserBubble(prompt, files.map((f) => f.name), "initial")}


                {phase === "uploading" && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 py-10">
                    <Loader2 className="size-5 text-primary animate-spin" />
                    <TextShimmer className="text-[16px] font-display">Uploading {files.length} file{files.length > 1 ? "s" : ""}...</TextShimmer>
                    <div className="w-36 h-px rounded-full bg-muted overflow-hidden">
                      <motion.div className="h-full bg-primary rounded-full" initial={{ width: "0%" }} animate={{ width: `${uploadProgress}%` }} />
                    </div>
                  </motion.div>
                )}

                {phase === "planning" && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 py-10">
                    <Loader2 className="size-5 text-primary animate-spin" />
                    <TextShimmer className="text-[16px] font-display">Planning analysis...</TextShimmer>
                    <p className="text-xs text-muted-foreground max-w-sm text-center">
                      Profiling your data and building an analysis strategy
                    </p>
                  </motion.div>
                )}

                {plan && (phase === "streaming" || phase === "complete") && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
                    <details className="group border border-primary/10 bg-primary/[0.02] overflow-hidden">
                      <summary className="cursor-pointer px-4 py-2.5 flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
                        <span className="size-1.5 bg-primary/60 rotate-45" />
                        Analysis Plan
                        <span className="ml-auto text-[10px] opacity-50">click to expand</span>
                      </summary>
                      <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none">
                        <Markdown components={{
                          code: ({ children }) => (
                            <code className="bg-primary-foreground rounded-sm px-1 font-mono text-sm">{children}</code>
                          ),
                          pre: ({ children }) => (
                            <pre className="bg-primary-foreground/50 rounded-md px-3 py-2 font-mono text-xs whitespace-pre-wrap overflow-x-auto">{children}</pre>
                          ),
                        }}>{plan}</Markdown>
                      </div>
                    </details>
                  </motion.div>
                )}

                {phase === "error" && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-center space-y-2">
                    <p className="text-sm text-destructive font-medium">{errorMessage}</p>
                    <p className="text-xs text-muted-foreground">Backend at <code className="px-1 py-0.5 rounded bg-muted font-mono text-[11px]">localhost:8200</code></p>
                    <div className="flex items-center justify-center gap-2 pt-1">
                      <Button variant="outline" size="sm" onClick={() => router.push("/")} className="rounded-full text-xs h-7">Back</Button>
                      <Button variant="default" size="sm" onClick={() => window.location.reload()} className="rounded-full text-xs h-7">Retry</Button>
                    </div>
                  </motion.div>
                )}

                {/* Completed conversation turns (previous assistant responses + follow-up user messages) */}
                {completedTurns.map((turn, i) => {
                  if (turn.role === "assistant") {
                    const turnSections = parseSections(turn.content);
                    const turnPreTag = getPreTagContent(turn.content);
                    return (
                      <div key={`turn-${i}`}>
                        {turnPreTag && (
                          <div className="text-[16px] leading-[1.75] text-muted-foreground whitespace-pre-wrap mt-2 mb-4">{turnPreTag}</div>
                        )}
                        <div className="sections-timeline">
                          {buildSectionElements(turnSections, `t${i}-`)}
                        </div>
                        {turn.artifacts && turn.artifacts.length > 0 && renderArtifactsStrip(turn.artifacts, `t${i}-`)}
                      </div>
                    );
                  }
                  // User turn
                  return (
                    <div key={`turn-${i}`} className="mt-6">
                      {renderUserBubble(turn.content, turn.fileNames || [], `followup-${i}`)}
                    </div>
                  );
                })}

                {/* Current live stream */}
                {preTagContent && (phase === "streaming" || phase === "complete") && (
                  <div className="text-[16px] leading-[1.75] text-muted-foreground whitespace-pre-wrap mt-2 mb-4">{preTagContent}</div>
                )}

                {phase === "streaming" && sections.length === 0 && !preTagContent && (
                  <div className="flex items-center justify-center py-8">
                    <TextShimmer className="text-[16px] font-display">Thinking...</TextShimmer>
                  </div>
                )}

                {/* Timeline spine + sections (current/live) */}
                <div className="sections-timeline">
                  {sectionElements}
                </div>

                {/* Artifacts strip (current/live) — shown inline on small screens, right panel on lg */}
                <div className="lg:hidden">
                  {phase === "complete" && dedupedArtifacts.length > 0 && renderArtifactsStrip(dedupedArtifacts, "live-")}
                </div>

                {/* Inline report indicators — only on small screens without right panel */}
                <div className="lg:hidden">
                  {phase === "complete" && reportStatus === "generating" && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                      className="mt-6 mb-2 border border-primary/20 bg-primary/[0.03] p-5 relative overflow-hidden">
                      <div className="flex items-center gap-3 mb-3">
                        <Sparkles className="size-4 text-primary animate-pulse" />
                        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-foreground font-bold">Generating_Report</span>
                      </div>
                      <div className="w-full h-[2px] bg-muted/30 overflow-hidden rounded-full">
                        <motion.div className="h-full bg-gradient-to-r from-primary/0 via-primary to-primary/0"
                          animate={{ x: ["-100%", "100%"] }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} style={{ width: "60%" }} />
                      </div>
                    </motion.div>
                  )}
                  {phase === "complete" && reportStatus === "ready" && reportUrl && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6 mb-2">
                      <button onClick={() => window.open(reportUrl, "_blank")}
                        className="w-full border border-primary/30 bg-primary/[0.04] hover:bg-primary/[0.08] p-4 text-left">
                        <div className="flex items-center gap-3">
                          <Sparkles className="size-4 text-primary" />
                          <div>
                            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary font-bold">View_Report</span>
                            {reportFallback && (
                              <p className="font-mono text-[8px] text-muted-foreground/50 mt-0.5">Fallback to Gemini 3 Flash</p>
                            )}
                          </div>
                        </div>
                      </button>
                    </motion.div>
                  )}
                </div>

                <div className="h-4" />
              </div>
            </div>

            {/* Bottom chat bar */}
            <div className="sticky bottom-0 z-50 bg-background/60 backdrop-blur-xl px-4 py-1.5 sm:py-2 relative">
              {/* Glowing Pedestal Line */}
              <div className="absolute inset-x-0 top-0 flex justify-center pointer-events-none">
                <div className="w-[80%] max-w-2xl h-[1px] bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[60%] max-w-xl h-12 bg-primary/10 blur-2xl" />
              </div>
              <div className="mx-auto max-w-3xl relative z-10">
                {/* Scroll to bottom — floats above the prompt input */}
                <div className={cn(
                  "absolute -top-10 left-1/2 -translate-x-1/2 transition-all duration-200",
                  showScrollBtn ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-2 pointer-events-none"
                )}>
                  <button
                    onClick={scrollToBottom}
                    className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-primary/70 hover:text-primary bg-background/90 border border-primary/20 hover:border-primary/50 px-4 py-1.5 shadow-sm backdrop-blur-sm transition-colors"
                  >
                    <ArrowDown className="size-3" />
                    Scroll
                  </button>
                </div>
                <input ref={followUpFileInputRef} type="file" multiple className="hidden" onChange={handleFollowUpFileChange} />
                <PromptInput value={followUpInput} onValueChange={setFollowUpInput}
                  isLoading={phase === "streaming"} onSubmit={phase === "streaming" ? handleStop : handleSendFollowUp}
                  disabled={phase === "uploading"} className="!rounded-none border border-primary/20 bg-primary/5 backdrop-blur-md shadow-2xl shadow-primary/10 relative group transition-colors hover:border-primary/40 focus-within:border-primary/60">

                  <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-primary opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-primary opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none" />

                  {followUpFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-3 pt-3">
                      {followUpFiles.map((file, i) => (
                        <div key={i} className="flex items-center gap-1.5 border border-primary/20 bg-background/50 px-2 py-1 text-[11px] font-mono shadow-sm">
                          <Paperclip className="size-3 text-primary/70" />
                          <span className="max-w-[120px] truncate">{file.name}</span>
                          <button onClick={() => setFollowUpFiles((prev) => prev.filter((_, j) => j !== i))} className="hover:text-destructive text-muted-foreground ml-1">
                            <X className="size-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <PromptInputTextarea placeholder={phase === "streaming" ? "Analyzing status..." : "Continue the session..."} className="text-sm font-medium tracking-wide dark:bg-transparent min-h-[40px] px-3 pt-2.5" />
                  <PromptInputActions className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1.5">
                    <div className="flex items-center gap-1">
                      <PromptInputAction tooltip="Attach files">
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border border-transparent hover:border-primary/30 hover:bg-primary/10 transition-colors"
                          onClick={(e) => { e.stopPropagation(); followUpFileInputRef.current?.click(); }}>
                          <Paperclip className="size-4 text-primary/70 hover:text-primary transition-colors" />
                        </Button>
                      </PromptInputAction>

                      {/* Theme selector */}
                      <Popover open={themePopoverOpen} onOpenChange={setThemePopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border border-transparent hover:border-primary/30 hover:bg-primary/10 transition-colors"
                            title={`Aesthetic: ${REPORT_THEMES.find(t => t.id === reportTheme)?.label ?? reportTheme}`}
                            onClick={(e) => e.stopPropagation()}>
                            <Palette className="size-4 text-primary/70 hover:text-primary transition-colors" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-44 rounded-none border border-border bg-popover p-1.5 shadow-xl"
                          align="start" side="top"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <p className="px-3 pb-2 pt-1 font-mono text-[8px] uppercase tracking-[0.25em] text-muted-foreground/70 border-b border-border/30 mb-1">
                            Pick_Aesthetic
                          </p>
                          {REPORT_THEMES.map((t) => (
                            <button
                              key={t.id}
                              onClick={() => { setReportTheme(t.id); setThemePopoverOpen(false); }}
                              className={cn(
                                "flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-mono uppercase tracking-wider transition-colors hover:bg-accent hover:text-accent-foreground border-l-2 border-transparent hover:border-primary",
                                t.id === reportTheme && "bg-accent/50 text-accent-foreground border-primary"
                              )}
                            >
                              <span className="flex items-center gap-1.5">
                                {t.label}
                                {t.id === "surprise" && <Sparkles className="size-2.5 text-primary/70" />}
                              </span>
                              {t.id === reportTheme && <Check className="size-3 text-muted-foreground" />}
                            </button>
                          ))}
                        </PopoverContent>
                      </Popover>

                      {/* Clever Status Shutter Pill */}
                      {phase === "complete" && (
                        <div className="relative h-8 overflow-hidden flex items-center">
                          <AnimatePresence mode="wait">
                            {reportStatus !== "generating" ? (
                              <motion.div
                                key="idle"
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.8, opacity: 0 }}
                              >
                                <PromptInputAction tooltip="Generate report">
                                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border border-transparent hover:border-primary/30 hover:bg-primary/10 transition-colors"
                                    onClick={(e) => { e.stopPropagation(); handleRegenerateReport(); }}>
                                    <FileText className="size-4 text-primary/70 hover:text-primary transition-colors" />
                                  </Button>
                                </PromptInputAction>
                              </motion.div>
                            ) : (
                              <motion.button
                                key="generating"
                                initial={{ width: 32, opacity: 0 }}
                                animate={{ width: 100, opacity: 1 }}
                                exit={{ width: 32, opacity: 0 }}
                                onClick={(e) => { e.stopPropagation(); handleCancelReport(); }}
                                className="group relative h-8 border border-primary/30 bg-primary/5 overflow-hidden transition-all duration-300 hover:border-destructive/40 hover:bg-destructive/5"
                              >
                                {/* Inner Shutter Container */}
                                <div className="flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-1/2">
                                  {/* State 1: Synthesizing */}
                                  <div className="flex items-center justify-center gap-2 h-8 px-2">
                                    <div className="flex gap-0.5 items-end h-2">
                                      {[0.4, 0.7, 0.3].map((h, i) => (
                                        <motion.div
                                          key={i}
                                          className="w-0.5 bg-primary/60"
                                          animate={{ height: ["20%", "100%", "20%"] }}
                                          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                                        />
                                      ))}
                                    </div>
                                    <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-primary/70 font-bold whitespace-nowrap">
                                      Crafting
                                    </span>
                                  </div>

                                  {/* State 2: Stop (Shutter Down) */}
                                  <div className="flex items-center justify-center gap-2 h-8 px-2 bg-destructive/10">
                                    <Square className="size-2.5 text-destructive fill-destructive/20" />
                                    <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-destructive font-bold whitespace-nowrap">
                                      Stop
                                    </span>
                                  </div>
                                </div>

                                {/* Minimal Progress Underlay */}
                                <motion.div
                                  className="absolute bottom-0 left-0 h-[1px] bg-primary/40 group-hover:bg-destructive/40"
                                  initial={{ width: "0%" }}
                                  animate={{ width: "100%" }}
                                  transition={{ duration: 15, ease: "linear" }}
                                />
                              </motion.button>
                            )}
                          </AnimatePresence>
                        </div>
                      )}

                      <PromptInputAction tooltip="Clear workspace & restart">
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border border-transparent hover:border-destructive/30 hover:bg-destructive/10 transition-colors"
                          onClick={(e) => { e.stopPropagation(); handleClearWorkspace(); }}>
                          <Trash2 className="size-4 text-muted-foreground hover:text-destructive transition-colors" />
                        </Button>
                      </PromptInputAction>
                    </div>
                    <PromptInputAction tooltip={phase === "streaming" ? "Stop" : "Send"}>
                      <Button variant="default" size="icon" className="h-8 w-8 rounded-none font-mono shadow-sm transition-all border border-transparent hover:border-primary/50 opacity-90 hover:opacity-100"
                        onClick={phase === "streaming" ? handleStop : handleSendFollowUp}>
                        {phase === "streaming" ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
                      </Button>
                    </PromptInputAction>

                  </PromptInputActions>
                </PromptInput>
              </div>
            </div>

          </div>{/* End left panel */}

          {/* ── Right Panel: Generated Files + Report ────────────────────── */}
          <AnimatePresence>
            {rightPanelOpen && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 340, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                className="hidden lg:flex flex-col h-full flex-shrink-0 overflow-hidden relative"
              >
                {/* Panel inner — fixed width so content doesn't reflow during animation */}
                <div className="flex flex-col h-full w-[340px] min-w-[340px]">

                  {/* Subtle left border glow */}
                  <div className="absolute left-0 top-0 bottom-0 w-px bg-border/40" />
                  <div className="absolute left-0 top-[20%] bottom-[20%] w-px bg-primary/20 blur-[1px]" />

                  {/* ── Top: Generated Files ───────────────────────────────── */}
                  <div className="flex-1 flex flex-col min-h-0">
                    {/* Panel Header */}
                    <div className="flex items-center justify-between px-5 py-4 flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="w-1.5 h-1.5 bg-primary rotate-45" />
                        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-foreground font-semibold">
                          Generated_Files
                        </span>
                        {allArtifacts.length > 0 && (
                          <span className="font-mono text-[9px] text-muted-foreground/60">{allArtifacts.length}</span>
                        )}
                      </div>
                    </div>

                    {/* Divider */}
                    <div className="mx-5 h-px bg-gradient-to-r from-border/60 via-border/30 to-transparent" />

                    {/* Download All */}
                    {allArtifacts.length > 0 && (
                      <div className="px-5 pt-3 pb-2 flex-shrink-0">
                        <a
                          href={getDownloadBundleUrl(sessionId)}
                          className="flex items-center justify-center gap-2.5 w-full py-2.5 border border-primary/20 bg-primary/[0.03] hover:bg-primary/[0.08] hover:border-primary/40 font-mono text-[9px] uppercase tracking-[0.25em] text-primary/70 hover:text-primary transition-all duration-200"
                        >
                          <Package className="size-3.5" />
                          Download All
                        </a>
                      </div>
                    )}

                    {/* File List */}
                    <div className="flex-1 overflow-y-auto px-4 py-2 scrollbar-thin">
                      {allArtifacts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-center px-6 pb-12">
                          <div className="size-12 border border-dashed border-border/30 flex items-center justify-center mb-4">
                            <FileText className="size-5 text-muted-foreground/20" />
                          </div>
                          <p className="font-mono text-[9px] text-muted-foreground/40 uppercase tracking-[0.2em] leading-relaxed">
                            {phase === "streaming" ? "Generating..." : "No files yet"}
                          </p>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {allArtifacts.map((file, i) => {
                            const Icon = getFileIcon(file.name);
                            const url = getDownloadUrl(sessionId, file.path);
                            const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((ext) => file.name.endsWith(ext));
                            return (
                              <motion.a
                                key={`rp-${file.name}`}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.04, duration: 0.3, ease: "easeOut" }}
                                className="group relative"
                              >
                                {isImage && (
                                  <div className="w-full aspect-[2/1] mb-0 overflow-hidden border border-border/30 bg-muted/30">
                                    <img
                                      src={url}
                                      alt={file.name}
                                      className="w-full h-full object-cover opacity-70 grayscale-[0.3] group-hover:opacity-100 group-hover:grayscale-0 transition-all duration-500"
                                    />
                                  </div>
                                )}
                                <div className={cn(
                                  "flex items-center gap-3 px-3 py-2.5 border border-border/30 bg-background/30 hover:bg-primary/[0.04] hover:border-primary/25 transition-all duration-200",
                                  isImage && "border-t-0"
                                )}>
                                  <Icon className="size-4 text-muted-foreground/40 group-hover:text-primary/60 transition-colors flex-shrink-0" />
                                  <div className="flex flex-col overflow-hidden flex-1 min-w-0">
                                    <p className="text-[11px] font-mono font-medium truncate text-foreground/80 group-hover:text-primary transition-colors">
                                      {file.name}
                                    </p>
                                    {file.size > 0 && (
                                      <p className="text-[8px] font-mono text-muted-foreground/40 mt-0.5">
                                        {file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}
                                      </p>
                                    )}
                                  </div>
                                  <Download className="size-3 text-muted-foreground/20 group-hover:text-primary/50 transition-colors flex-shrink-0" />
                                </div>
                              </motion.a>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Bottom: Report Section ─────────────────────────────── */}
                  <div className="flex-shrink-0">
                    {/* Divider */}
                    <div className="mx-5 h-px bg-gradient-to-r from-border/60 via-border/30 to-transparent" />

                    {/* Report: Generating */}
                    {reportStatus === "generating" && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="px-5 py-4"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2.5">
                            <Sparkles className="size-3.5 text-primary" />
                            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-foreground font-bold">
                              Report
                            </span>
                          </div>
                          <button
                            onClick={handleCancelReport}
                            className="font-mono text-[8px] uppercase tracking-[0.2em] text-muted-foreground/50 hover:text-destructive transition-colors"
                          >
                            Cancel
                          </button>
                        </div>

                        {/* Progress bar */}
                        <div className="w-full h-[3px] bg-muted/20 overflow-hidden mb-2.5">
                          <motion.div
                            className="h-full bg-gradient-to-r from-primary/0 via-primary/80 to-primary/0"
                            animate={{ x: ["-100%", "100%"] }}
                            transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                            style={{ width: "50%" }}
                          />
                        </div>

                        <p className="font-mono text-[8px] text-muted-foreground/40 tracking-wider">
                          {reportTheme === "surprise" ? "Surprise me" : reportTheme} aesthetic via Gemini 3.1 Pro
                        </p>
                      </motion.div>
                    )}

                    {/* Report: Ready */}
                    {reportStatus === "ready" && reportUrl && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <button
                          onClick={() => window.open(reportUrl, "_blank")}
                          className="w-full px-5 py-4 text-left cursor-pointer group relative overflow-hidden hover:bg-primary/[0.03] transition-all duration-300"
                        >
                          {/* Shine sweep */}
                          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/[0.03] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />

                          <div className="flex items-center gap-3 relative">
                            <div className="size-9 border border-primary/30 bg-primary/[0.08] flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                              <Sparkles className="size-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-mono text-[9px] uppercase tracking-[0.25em] text-primary font-bold mb-0.5">
                                View Report
                              </div>
                              <p className="text-[9px] text-muted-foreground/50 font-mono">
                                {reportFallback ? "Fallback to Gemini 3 Flash" : "Open in new tab"}
                              </p>
                            </div>
                            <ArrowUp className="size-3.5 text-primary/40 group-hover:text-primary group-hover:-translate-y-0.5 transition-all duration-200 rotate-45 flex-shrink-0" />
                          </div>
                        </button>
                      </motion.div>
                    )}

                    {/* Report: Error */}
                    {reportStatus === "error" && (
                      <div className="px-5 py-4">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-destructive/70">Error</span>
                          <button
                            onClick={handleRetryReport}
                            className="font-mono text-[8px] uppercase tracking-[0.2em] text-muted-foreground hover:text-primary transition-colors"
                          >
                            Retry
                          </button>
                        </div>
                        {reportError && (
                          <p className="text-[9px] text-muted-foreground/50 mt-1.5 font-mono truncate">{reportError}</p>
                        )}
                      </div>
                    )}

                    {/* Report: Cancelled */}
                    {reportStatus === "cancelled" && (
                      <div className="px-5 py-4">
                        <button
                          onClick={handleRetryReport}
                          className="flex items-center justify-center gap-2.5 w-full py-2.5 border border-border/30 bg-muted/[0.03] hover:bg-primary/[0.05] hover:border-primary/25 font-mono text-[9px] uppercase tracking-[0.25em] text-muted-foreground/60 hover:text-primary transition-all duration-200"
                        >
                          <Sparkles className="size-3" />
                          Generate Report
                        </button>
                      </div>
                    )}

                    {/* Report: Idle / pending */}
                    {reportStatus === "idle" && phase !== "complete" && (
                      <div className="px-5 py-4">
                        <div className="flex items-center gap-2.5 text-muted-foreground/30">
                          <Sparkles className="size-3" />
                          <span className="font-mono text-[8px] uppercase tracking-[0.25em]">Report pending</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </div>
    </div>
  );
}
