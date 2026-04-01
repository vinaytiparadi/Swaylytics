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
  const [reportTheme, setReportTheme] = useState("modern");
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
      <div className="absolute top-4 sm:top-6 right-4 sm:right-8 z-40 flex items-center gap-2 sm:gap-3">
         <button
           onClick={() => setDynamicBgEnabled(!dynamicBgEnabled)}
           className="size-10 sm:size-11 rounded-none border border-primary/20 bg-background/50 backdrop-blur-md hover:bg-primary/10 transition-colors text-muted-foreground hover:text-primary flex items-center justify-center group"
           title={dynamicBgEnabled ? "Disable Dynamic Background" : "Enable Dynamic Background"}
         >
           {dynamicBgEnabled ? <Zap className="size-4 sm:size-4.5" /> : <ZapOff className="size-4 sm:size-4.5" />}
         </button>
         <div className="pointer-events-auto">
            <ThemeToggle />
         </div>
      </div>

      {/* Main Centered Hero */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10 w-full max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-8 sm:pb-16 min-h-[500px]">
        
        {/* Typography */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className="w-full flex flex-col items-center text-center space-y-4 sm:space-y-6 mb-2 sm:mb-4"
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
           
           <h1 className="font-display font-medium text-4xl sm:text-6xl md:text-7xl lg:text-8xl tracking-tight leading-[0.95] text-foreground lowercase">
             analyze anything.<br />
             <span className="text-primary font-bold italic tracking-tighter">instantly.</span>
           </h1>
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
           className="mt-4 sm:mt-8 w-full max-w-3xl flex justify-center"
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
