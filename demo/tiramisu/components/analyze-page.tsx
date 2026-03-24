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
  type WorkspaceFile,
} from "@/lib/api";
import {
  parseSections,
  getPreTagContent,
  type ParsedSection,
  type SectionType,
} from "@/lib/stream-parser";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────

type Phase = "uploading" | "streaming" | "complete" | "error";

interface AnalyzePageProps {
  prompt: string;
  files: File[];
  reportTheme: string;
  presetId: string | null;
  sessionId: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
  sessionId,
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

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [followUpInput, setFollowUpInput] = useState("");
  const [followUpFiles, setFollowUpFiles] = useState<File[]>([]);
  const [workspaceFileNames, setWorkspaceFileNames] = useState<string[]>([]);
  const followUpFileInputRef = useRef<HTMLInputElement>(null);

  const pendingContentRef = useRef("");
  const displayedContentRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
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

  // ── Auto-scroll ───────────────────────────────────────────────────
  useEffect(() => {
    if (!autoScrollRef.current || !scrollContainerRef.current) return;
    scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: "smooth" });
  }, [accumulatedContent, sections, messages]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    autoScrollRef.current = atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: "smooth" });
    autoScrollRef.current = true;
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
    async (chatMessages: ChatMessage[], wsFiles: string[]) => {
      setPhase("streaming");
      const controller = new AbortController();
      abortControllerRef.current = controller;
      try {
        const response = await startChatStream(sessionId, chatMessages, wsFiles, controller.signal);
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
    let cancelled = false;
    async function run() {
      try {
        setUploadProgress(10);
        await uploadFiles(sessionId, files);
        if (cancelled) return;
        setUploadProgress(100);
        const fNames = files.map((f) => f.name);
        setWorkspaceFileNames(fNames);
        const initialMsg: ChatMessage = { role: "user", content: prompt };
        setMessages([initialMsg]);
        await startStream([initialMsg], fNames);
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
    if (followUpFiles.length > 0) {
      try {
        await uploadFiles(sessionId, followUpFiles);
        setWorkspaceFileNames((prev) => [...prev, ...followUpFiles.map((f) => f.name)]);
      } catch { /* */ }
    }
    const userMsg: ChatMessage = { role: "user", content: text || "(attached files)" };
    const assistantMsg: ChatMessage = { role: "assistant", content: accumulatedContent };
    const newMessages = [...messages, assistantMsg, userMsg];
    setMessages(newMessages);
    pendingContentRef.current = "";
    displayedContentRef.current = "";
    setAccumulatedContent("");
    setFollowUpInput("");
    setFollowUpFiles([]);
    await startStream(newMessages, workspaceFileNames);
  }, [followUpInput, followUpFiles, sessionId, accumulatedContent, messages, workspaceFileNames, startStream]);

  const handleClearWorkspace = useCallback(async () => {
    try { await clearWorkspace(sessionId); } catch { /* */ }
    router.push("/");
  }, [sessionId, router]);

  const handleFollowUpFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFollowUpFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
  };

  // ─── Section renderers ────────────────────────────────────────────

  const renderSection = (section: ParsedSection, nextSection?: ParsedSection) => {
    const isStreaming = !section.isComplete;

    // ── Thinking (Analyze / Understand) ─────────────────────────────
    if (section.type === "Analyze" || section.type === "Understand") {
      return (
        <div className="thinking-section text-[15px] leading-[1.75] whitespace-pre-wrap break-words">
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
        <div className="terminal-card overflow-hidden">
          {/* Terminal header */}
          <div className="terminal-header flex items-center gap-2 px-3.5 py-2 bg-zinc-200/80 dark:bg-zinc-800/80 border-b border-zinc-300/50 dark:border-zinc-700/50">
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-400/60 dark:bg-zinc-600/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-400/60 dark:bg-zinc-600/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-zinc-400/60 dark:bg-zinc-600/60" />
            </div>
            <div className="flex-1 flex items-center gap-2">
              <Terminal className="size-3 text-muted-foreground/50" />
              <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">{lang}</span>
            </div>
            {!isStreaming && (
              <Button variant="ghost" size="icon" className="h-5 w-5 opacity-50 hover:opacity-100 transition-opacity"
                onClick={() => handleCopy(code, section.id)}>
                {copiedId === section.id ? <Check className="size-2.5" /> : <Copy className="size-2.5" />}
              </Button>
            )}
          </div>
          {/* Code body */}
          <div className="bg-zinc-100 dark:bg-zinc-900/90">
            {isLarge || isStreaming ? (
              <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[13px] p-4 leading-[1.65]">
                <code>{code}</code>
                {isStreaming && <span className="streaming-cursor" />}
              </pre>
            ) : (
              <CodeBlockCode code={code} language={lang}
                theme={resolvedTheme === "dark" ? "github-dark" : "github-light"}
                className="text-[13px] [&>pre]:!bg-transparent" />
            )}
          </div>
        </div>
      );
    }

    // ── Execute (standalone, not attached to code) ──────────────────
    if (section.type === "Execute") {
      return (
        <div className="terminal-output-standalone rounded-lg bg-zinc-100 dark:bg-zinc-900/90 p-4 overflow-x-auto border border-zinc-200/60 dark:border-zinc-800/60">
          <pre className="font-mono text-[13px] leading-[1.65] text-foreground/85 whitespace-pre-wrap">{section.content}</pre>
        </div>
      );
    }

    // ── Answer ──────────────────────────────────────────────────────
    if (section.type === "Answer") {
      return (
        <div className="answer-block">
          <div className="text-[15px] leading-[1.8] whitespace-pre-wrap break-words">
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
    <div className="mt-2.5 bg-zinc-50 dark:bg-zinc-950/80 border border-zinc-200/60 dark:border-zinc-800/60 p-4 rounded-lg overflow-x-auto">
      <div className="flex items-center gap-1.5 mb-2.5">
        <span className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-widest">stdout</span>
      </div>
      <pre className="font-mono text-[13px] leading-[1.65] text-foreground/85 whitespace-pre-wrap">{section.content}</pre>
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
    <motion.div key={key} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end mb-6">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/8 dark:bg-primary/12 border border-primary/10 px-4 py-3">
        <p className="text-[15px] leading-[1.7] whitespace-pre-wrap">{content}</p>
        {fileNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {fileNames.map((name, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full bg-primary/8 px-2.5 py-0.5 text-[10.5px] text-primary font-medium">
                <Paperclip className="size-2.5" />{name}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );

  // ─── Build section groups (Code + Execute pairs) ──────────────────
  const sectionElements: React.ReactNode[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const next = sections[i + 1];
    const meta = SECTION_META[section.type];
    const isStreaming = !section.isComplete;

    // Skip Execute sections that are attached to a Code section above
    if (section.type === "Execute" && i > 0 && sections[i - 1].type === "Code" && sections[i - 1].isComplete) {
      continue; // Already rendered as attached output
    }

    const isCodeWithOutput = section.type === "Code" && section.isComplete && next?.type === "Execute" && next.isComplete;

    sectionElements.push(
      <motion.div
        key={section.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="section-row"
      >
        {/* Section type indicator: line → dot → label → line (no line through label) */}
        <div className="section-indicator">
          <div className="indicator-line-segment" style={{ height: 8 }} />
          <div className="indicator-dot" style={{ backgroundColor: meta.color }} />
          <span className="indicator-label" style={{ color: meta.color }}>{meta.label}</span>
          <div className="indicator-line-segment flex-1" />
        </div>

        {/* Section content */}
        <div className="section-content">
          {renderSection(section, next)}
          {isCodeWithOutput && renderAttachedOutput(next!)}
        </div>
      </motion.div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-4 sm:px-6 h-11 border-b border-border/30 bg-background/90 backdrop-blur-xl z-50">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={() => router.push("/")}>
            <ArrowLeft className="size-3.5" />
          </Button>
          <span className="font-display font-bold text-[15px] tracking-tight" style={{
            background: "var(--brand-gradient)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>Autolytics</span>
          {phase === "streaming" && (
            <span className="ml-2 inline-flex items-center gap-1.5 text-[10px] text-primary font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              analyzing
            </span>
          )}
        </div>
        <ThemeToggle />
      </header>

      {/* Scroll area */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 pt-6 pb-2">

          {renderUserBubble(prompt, files.map((f) => f.name), "initial")}

          {phase === "uploading" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="size-5 text-primary animate-spin" />
              <TextShimmer className="text-[15px] font-display">Uploading {files.length} file{files.length > 1 ? "s" : ""}...</TextShimmer>
              <div className="w-36 h-px rounded-full bg-muted overflow-hidden">
                <motion.div className="h-full bg-primary rounded-full" initial={{ width: "0%" }} animate={{ width: `${uploadProgress}%` }} />
              </div>
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

          {preTagContent && (phase === "streaming" || phase === "complete") && (
            <div className="text-[15px] text-muted-foreground whitespace-pre-wrap mt-2 mb-4">{preTagContent}</div>
          )}

          {phase === "streaming" && sections.length === 0 && !preTagContent && (
            <div className="flex items-center justify-center py-8">
              <TextShimmer className="text-[15px] font-display">Thinking...</TextShimmer>
            </div>
          )}

          {/* Timeline spine + sections */}
          <div className="sections-timeline">
            {sectionElements}
          </div>

          {/* Artifacts strip */}
          {phase === "complete" && dedupedArtifacts.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mt-6 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-px flex-1 bg-border/60" />
                <span className="text-[10px] font-display text-muted-foreground/60 tracking-wide">generated files</span>
                <div className="h-px flex-1 bg-border/60" />
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {dedupedArtifacts.map((file, i) => {
                  const Icon = getFileIcon(file.name);
                  const url = getDownloadUrl(sessionId, file.path);
                  const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp"].some((ext) => file.name.endsWith(ext));
                  return (
                    <motion.a key={i} href={url} target="_blank" rel="noopener noreferrer"
                      initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
                      className="flex-shrink-0 w-40 rounded-lg border bg-card/60 hover:bg-card hover:border-primary/30 transition-all p-3 group">
                      {isImage ? (
                        <div className="w-full h-[72px] rounded-md overflow-hidden bg-muted mb-2">
                          <img src={url} alt={file.name} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-full h-[72px] rounded-md bg-muted flex items-center justify-center mb-2">
                          <Icon className="size-5 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <p className="text-[11px] font-medium truncate flex-1">{file.name}</p>
                        <Download className="size-3 text-muted-foreground/40 group-hover:text-primary transition-colors flex-shrink-0" />
                      </div>
                      {file.size > 0 && <p className="text-[9px] text-muted-foreground/50 mt-0.5">{(file.size / 1024).toFixed(0)} KB</p>}
                    </motion.a>
                  );
                })}
              </div>
            </motion.div>
          )}

          {messages.slice(1).filter((m) => m.role === "user").map((m, i) => (
            <div key={`followup-${i}`} className="mt-6">{renderUserBubble(m.content, [], `followup-${i}`)}</div>
          ))}

          <div className="h-24" />
        </div>
      </div>

      {/* Scroll-to-bottom */}
      <div className="fixed bottom-36 right-6 z-40">
        <Button variant="outline" size="icon"
          className={cn("h-8 w-8 rounded-full shadow-md bg-card transition-all duration-200",
            showScrollBtn ? "opacity-100 translate-y-0 scale-100" : "opacity-0 pointer-events-none translate-y-2 scale-95")}
          onClick={scrollToBottom}>
          <ArrowDown className="size-3.5" />
        </Button>
      </div>

      {/* Bottom chat bar */}
      <div className="sticky bottom-0 z-50 border-t border-border/30 bg-background/85 backdrop-blur-xl px-4 py-2.5">
        <div className="mx-auto max-w-3xl">
          <input ref={followUpFileInputRef} type="file" multiple className="hidden" onChange={handleFollowUpFileChange} />
          <PromptInput value={followUpInput} onValueChange={setFollowUpInput}
            isLoading={phase === "streaming"} onSubmit={phase === "streaming" ? handleStop : handleSendFollowUp}
            disabled={phase === "uploading"} className="border-border/50 bg-background/80 backdrop-blur-sm shadow-lg shadow-primary/[0.04]">
            {followUpFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-2 pt-2">
                {followUpFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-sm">
                    <Paperclip className="size-3" />
                    <span className="max-w-[120px] truncate">{file.name}</span>
                    <button onClick={() => setFollowUpFiles((prev) => prev.filter((_, j) => j !== i))} className="hover:text-destructive">
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <PromptInputTextarea placeholder={phase === "streaming" ? "Analyzing..." : "Continue the conversation..."} className="text-base dark:bg-transparent" />
            <PromptInputActions className="flex items-center justify-between gap-2 px-2 pb-1 pt-2">
              <div className="flex items-center gap-1">
                <PromptInputAction tooltip="Attach files">
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full"
                    onClick={(e) => { e.stopPropagation(); followUpFileInputRef.current?.click(); }}>
                    <Paperclip className="size-4 text-muted-foreground" />
                  </Button>
                </PromptInputAction>
                <PromptInputAction tooltip="Clear workspace & restart">
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full"
                    onClick={(e) => { e.stopPropagation(); handleClearWorkspace(); }}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </PromptInputAction>
              </div>
              <PromptInputAction tooltip={phase === "streaming" ? "Stop" : "Send"}>
                <Button variant="default" size="icon" className="h-8 w-8 rounded-full"
                  onClick={phase === "streaming" ? handleStop : handleSendFollowUp}>
                  {phase === "streaming" ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
                </Button>
              </PromptInputAction>
            </PromptInputActions>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
