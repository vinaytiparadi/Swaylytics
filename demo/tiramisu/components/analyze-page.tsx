"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useTheme } from "next-themes";
import {
  ArrowLeft,
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
  Terminal,
  Image as ImageIcon,
  FileSpreadsheet,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  planAnalysis,
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
import { DitheringBackground } from "@/components/ui/dithering-background";

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
  planningEnabled?: boolean;
}

interface AnalyzePageProps {
  prompt: string;
  files: File[];
  reportTheme: string;
  presetId: string | null;
  planningEnabled: boolean;
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
};

// ─── Helpers ─────────────────────────────────────────────────────────

function extractCodeLanguage(content: string): string {
  const m = content.match(/^```(\w+)/);
  return m ? m[1] : "python";
}

function stripCodeFences(content: string): string {
  return content.replace(/^```\w*\n?/, "").replace(/\n?```\s*$/, "");
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
  reportTheme,
  presetId,
  planningEnabled,
  sessionId,
  recoverySnapshot,
}: AnalyzePageProps) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  // ── State ─────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("uploading");
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

  const pendingContentRef = useRef("");
  const displayedContentRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

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

  // ── Save snapshot to sessionStorage on completion ──────────────────
  useEffect(() => {
    if (phase !== "complete") return;
    try {
      const snap: SessionSnapshot = {
        prompt, reportTheme, presetId, phase,
        accumulatedContent, completedTurns, messages, workspaceFileNames, plan,
      };
      sessionStorage.setItem(`snapshot:${sessionId}`, JSON.stringify(snap));
    } catch { /* quota — non-critical */ }
  }, [phase, sessionId, prompt, reportTheme, presetId, accumulatedContent, completedTurns, messages, workspaceFileNames, plan]);

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
        const response = await startChatStream(sessionId, chatMessages, wsFiles, controller.signal, planText);
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
    [sessionId, startRafLoop, stopRafLoop]
  );

  // ── Initial upload ────────────────────────────────────────────────
  useEffect(() => {
    // Restore from snapshot (completed session recovery)
    if (recoverySnapshot) {
      setPhase(recoverySnapshot.phase as Phase);
      setAccumulatedContent(recoverySnapshot.accumulatedContent);
      pendingContentRef.current = recoverySnapshot.accumulatedContent;
      displayedContentRef.current = recoverySnapshot.accumulatedContent;
      setMessages(recoverySnapshot.messages as ChatMessage[]);
      setCompletedTurns(recoverySnapshot.completedTurns);
      setWorkspaceFileNames(recoverySnapshot.workspaceFileNames);
      setPlan(recoverySnapshot.plan ?? null);
      setUploadProgress(100);
      // Re-fetch artifacts from backend (workspace is still intact)
      fetchWorkspaceFiles(sessionId).then((ws) => {
        setArtifacts(ws.filter((f) => f.is_generated));
      }).catch(() => {});
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

        // Planning phase: profile data + Gemini plan (only if enabled)
        let planText: string | null = null;
        if (planningEnabled) {
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
      const hasAttachedOutput = nextSection?.type === "Execute" && nextSection.isComplete;

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
         <div className="absolute inset-0 opacity-40 dark:opacity-60 saturate-50 mix-blend-luminosity dark:mix-blend-screen">
           <DitheringBackground />
         </div>
         <div className="absolute top-[10%] left-[10%] w-[60vw] h-[60vw] md:w-[40vw] md:h-[40vw] bg-primary/10 rounded-full blur-[80px] md:blur-[120px] mix-blend-normal" />
         <div className="absolute bottom-[-10%] right-[-10%] w-[70vw] h-[50vw] bg-[#E5A84B]/10 dark:bg-[#F5C76A]/10 rounded-full blur-[100px] md:blur-[140px]" />
         <div className="absolute inset-0 z-0 opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] mix-blend-overlay" />
      </div>

      {/* Extreme Minimal Pinned Header */}
      <div className="absolute top-3 sm:top-4 inset-x-4 sm:inset-x-8 z-40 pointer-events-none flex justify-between items-start">
        {/* Top Left Pinned */}
        <div className="pointer-events-auto flex flex-col gap-1">
          <span className="font-display font-medium text-lg sm:text-2xl tracking-tight text-foreground lowercase leading-none">
            analyze<span className="text-primary font-bold italic tracking-tighter">.</span>
          </span>
          <div className="flex items-center gap-1.5 mt-0.5">
             <div className="w-4 h-px bg-primary/40" />
             <span className="font-mono text-[8px] sm:text-[9px] text-muted-foreground uppercase tracking-[0.3em]">Session_Active</span>
          </div>
        </div>

        {/* Top Right Pinned */}
        <div className="pointer-events-auto flex items-start gap-4 sm:gap-6">
           <div className="hidden sm:flex flex-col items-end gap-1.5 mt-1">
             <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.2em]">System State</span>
             {phase === "streaming" || phase === "planning" ? (
               <div className="flex items-center gap-2">
                 <div className="w-1.5 h-1.5 bg-primary rounded-none animate-ping" />
                 <span className="font-mono text-[9px] text-primary uppercase tracking-[0.2em] font-bold">
                   {phase === "planning" ? "Planning" : "Synthesizing"}
                 </span>
               </div>
             ) : (
               <div className="flex items-center gap-2">
                 <div className="w-1.5 h-1.5 bg-border rounded-none" />
                 <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-[0.2em]">Idle</span>
               </div>
             )}
           </div>
           <ThemeToggle />
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative z-10 pt-10 sm:pt-12">
        
        {/* Scroll area */}
        <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 sm:px-8 md:px-12 pb-2">

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

          {/* Artifacts strip (current/live) */}
          {phase === "complete" && dedupedArtifacts.length > 0 && renderArtifactsStrip(dedupedArtifacts, "live-")}

          <div className="h-24" />
        </div>
      </div>

      {/* Bottom chat bar */}
      <div className="sticky bottom-0 z-50 bg-background/60 backdrop-blur-xl px-4 py-4 sm:py-6 relative">
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
            <PromptInputTextarea placeholder={phase === "streaming" ? "Analyzing status..." : "Continue the session..."} className="text-sm font-medium tracking-wide dark:bg-transparent min-h-[44px] px-3 pt-3" />
            <PromptInputActions className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-2">
              <div className="flex items-center gap-1">
                <PromptInputAction tooltip="Attach files">
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none border border-transparent hover:border-primary/30 hover:bg-primary/10 transition-colors"
                    onClick={(e) => { e.stopPropagation(); followUpFileInputRef.current?.click(); }}>
                    <Paperclip className="size-4 text-primary/70 hover:text-primary transition-colors" />
                  </Button>
                </PromptInputAction>
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
    </div>
  </div>
  );
}
