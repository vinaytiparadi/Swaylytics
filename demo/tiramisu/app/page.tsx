"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { DitheringBackground } from "@/components/ui/dithering-background";
import { StaticBackground } from "@/components/ui/static-background";
import { TextScramble } from "@/components/ui/text-scrammble";
import { ThemeToggle } from "@/components/theme-toggle";
import { PromptInputEnhanced } from "@/components/prompt-input-enhanced";
import { PresetSelector } from "@/components/preset-selector";
import { storeTransfer, type EngineType } from "@/lib/transfer-store";
import { Zap, ZapOff } from "lucide-react";

const ease = [0.22, 1, 0.36, 1] as const;

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reportTheme, setReportTheme] = useState("literature");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [planRouterEnabled, setPlanRouterEnabled] = useState(false);
  const [engine, setEngine] = useState<EngineType>("deepanalyze");
  const [dynamicBgEnabled, setDynamicBgEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    setMounted(true);
    const storedPlan = localStorage.getItem("planRouterEnabled");
    if (storedPlan === "true") setPlanRouterEnabled(true);

    const storedEngine = localStorage.getItem("engine");
    if (storedEngine === "gemini") setEngine("gemini");

    const storedBg = localStorage.getItem("dynamicBgEnabled");
    if (storedBg === "true") setDynamicBgEnabled(true);
  }, []);

  useEffect(() => {
    localStorage.setItem("planRouterEnabled", String(planRouterEnabled));
  }, [planRouterEnabled]);

  useEffect(() => {
    localStorage.setItem("engine", engine);
  }, [engine]);

  useEffect(() => {
    localStorage.setItem("dynamicBgEnabled", String(dynamicBgEnabled));
  }, [dynamicBgEnabled]);

  const handlePresetSelect = (presetId: string, promptText: string) => {
    setSelectedPresetId(presetId);
    setInput(promptText);
  };

  const handleAnalyze = () => {
    if (!input.trim() || files.length === 0) return;
    const tid = storeTransfer({
      prompt: input.trim(),
      files,
      reportTheme,
      presetId: selectedPresetId,
      planRouterEnabled: engine === "gemini" ? false : planRouterEnabled,
      engine,
    });
    router.push(`/analyze?tid=${tid}`);
  };

  return (
    <main className="relative min-h-[100dvh] w-full flex flex-col bg-background text-foreground overflow-x-hidden selection:bg-primary/20">

      {/* Background Ambience */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <AnimatePresence mode="wait">
          {dynamicBgEnabled ? (
            <motion.div
              key="dynamic-bg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1 }}
              className="absolute inset-0 opacity-40 dark:opacity-60 saturate-50 mix-blend-luminosity dark:mix-blend-screen"
            >
              <DitheringBackground />
            </motion.div>
          ) : (
            <motion.div
              key="static-bg"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1 }}
              className="absolute inset-0"
            >
              <StaticBackground />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="absolute top-[10%] left-[10%] w-[60vw] h-[60vw] md:w-[40vw] md:h-[40vw] bg-primary/10 rounded-full blur-[80px] md:blur-[120px] mix-blend-normal" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[70vw] h-[50vw] bg-[#E5A84B]/10 dark:bg-[#F5C76A]/10 rounded-full blur-[100px] md:blur-[140px]" />
        <div className="absolute inset-0 z-0 opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] mix-blend-overlay" />
      </div>

      {/* Extreme Minimal Universal Header */}
      <div className="absolute top-4 sm:top-6 right-4 sm:right-8 z-40 flex items-center gap-0.5 sm:gap-1 pointer-events-auto">
        <button
          onClick={() => setDynamicBgEnabled(!dynamicBgEnabled)}
          className="flex items-center justify-center size-8 text-muted-foreground/70 hover:text-foreground transition-all duration-200 border border-border/20 hover:border-primary/40 hover:bg-primary/5"
          title={dynamicBgEnabled ? "Disable Dynamic Background" : "Enable Dynamic Background"}
        >
          {dynamicBgEnabled ? <Zap className="size-4" /> : <ZapOff className="size-4" />}
        </button>
        <ThemeToggle />
      </div>

      {/* Main Centered Hero */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-8 sm:pb-16 min-h-[500px]">

        {/* Typography */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="w-full flex flex-col items-center text-center mb-4 sm:mb-8"
        >
          <div className="px-4 py-1 rounded-none border border-primary/30 bg-primary/5 backdrop-blur-sm shadow-sm">
            <TextScramble
              phrases={[
                "Autonomous Data Science",
                "Upload. Analyze. Discover.",
                "Generate Instant Insights"
              ]}
              pauseMs={3500}
              loop
              autoStart
              textClass="font-mono text-[8px] sm:text-[10px] uppercase tracking-[0.25em] text-primary font-semibold"
              dudClass="text-primary/30"
            />
          </div>

          <div className="flex flex-col items-center mt-6 sm:mt-8">
            <h1 className="font-display font-medium text-7xl sm:text-[7rem] md:text-[9rem] tracking-tighter leading-[0.85] text-foreground lowercase relative z-10 flex items-center justify-center">
              <span className="relative inline-block group">
                <span className="absolute -inset-6 bg-primary/20 blur-3xl rounded-full opacity-0 sm:opacity-100 transition-opacity duration-1000 group-hover:opacity-60 mix-blend-screen" />
                <span className="relative text-primary italic font-bold pr-1">sway</span>
              </span>
              <span className="text-foreground/90 ml-[-0.05em]">lytics</span>
              <span className="text-primary ml-1 translate-y-1">.</span>
            </h1>

            <div className="mt-6 sm:mt-8 flex items-center justify-center relative z-20">
              <div className="group flex items-center gap-3 sm:gap-5 text-[10px] sm:text-[11px] font-mono uppercase tracking-[0.3em] text-muted-foreground/30 hover:text-muted-foreground/70 transition-colors duration-700 cursor-default">
                <span className="flex items-center gap-2">
                  <span className="italic text-primary/40 group-hover:text-primary/70 lowercase tracking-widest transition-colors duration-700">swayatta</span>
                  <span className="opacity-30">/</span>
                  <span className="opacity-80">autonomous</span>
                </span>
                <span className="w-4 sm:w-12 h-[1px] bg-gradient-to-r from-transparent via-muted-foreground/20 to-transparent" />
                <span className="flex items-center gap-2">
                  <span className="italic text-foreground/40 group-hover:text-foreground/70 lowercase tracking-widest transition-colors duration-700">lytics</span>
                  <span className="opacity-30">/</span>
                  <span className="opacity-80">analytics</span>
                </span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Elevated Input Card w/ Ambient Pedestal */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-3xl"
        >
          {/* Glowing Pedestal Line */}
          <div className="absolute -inset-x-4 -bottom-4 sm:-bottom-6 flex justify-center pointer-events-none">
            <div className="w-1/2 h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
            <div className="absolute top-0 w-2/3 h-10 bg-primary/15 blur-2xl" />
          </div>

          <div className="relative z-10 drop-shadow-xl">
            <PromptInputEnhanced
              input={input}
              onInputChange={setInput}
              files={files}
              onFilesChange={setFiles}
              reportTheme={reportTheme}
              onReportThemeChange={setReportTheme}
              planRouterEnabled={planRouterEnabled}
              onPlanRouterEnabledChange={setPlanRouterEnabled}
              engine={engine}
              onEngineChange={setEngine}
              isLoading={false}
              onSubmit={handleAnalyze}
            />
          </div>
        </motion.div>

        {/* Preset Selector */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-8 sm:mt-12 w-full max-w-3xl flex justify-center"
        >
          <PresetSelector
            selectedId={selectedPresetId}
            onSelect={handlePresetSelect}
          />
        </motion.div>

      </div>
    </main>
  );
}
