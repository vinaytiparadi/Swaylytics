"use client";

import { useState } from "react";
import { DitheringBackground } from "@/components/ui/dithering-background";
import { TextScramble } from "@/components/ui/text-scrammble";
import { ThemeToggle } from "@/components/theme-toggle";
import { PromptInputEnhanced } from "@/components/prompt-input-enhanced";
import { PresetSelector } from "@/components/preset-selector";
import { CUPCAKE_URL } from "@/lib/config";

export default function Home() {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [reportTheme, setReportTheme] = useState("modern");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  const handlePresetSelect = (presetId: string, promptText: string) => {
    setSelectedPresetId(presetId);
    setInput(promptText);
  };

  const handleAnalyze = () => {
    if (!input.trim() && files.length === 0) return;
    const params = new URLSearchParams();
    if (input.trim()) params.set("prompt", input.trim());
    params.set("reportTheme", reportTheme);
    if (selectedPresetId) params.set("preset", selectedPresetId);
    window.location.href = `${CUPCAKE_URL}?${params.toString()}`;
  };

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <DitheringBackground />

      <div className="absolute top-5 right-5 z-20">
        <ThemeToggle />
      </div>

      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 gap-10">

        {/* ── Hero: DeepAgent + Marquee ── */}
        <div className="w-full max-w-5xl select-none">
          <div
            className="font-display font-extrabold leading-[0.88] tracking-[-0.04em] text-[clamp(4rem,9vw,6rem)] text-center"
            style={{
              background:
                "linear-gradient(150deg, var(--foreground) 10%, color-mix(in srgb, var(--foreground) 25%, transparent) 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Autolytics
          </div>

          <div className="mt-3 flex justify-center">
            <TextScramble
              phrases={[
                'Agentic Analysis',
                'Upload. Analyze. Discover.',
                'AI-Powered Insights',
                'From Data to Decisions',
              ]}
              pauseMs={2000}
              loop
              autoStart
              textClass="font-display font-semibold tracking-[-0.02em] text-[clamp(1.4rem,2.6vw,2.0rem)] text-muted-foreground text-center"
              dudClass="text-muted-foreground/30"
            />
          </div>
        </div>

        {/* ── Prompt + Presets ── */}
        <div className="w-full max-w-3xl space-y-5">
          <PromptInputEnhanced
            input={input}
            onInputChange={setInput}
            files={files}
            onFilesChange={setFiles}
            reportTheme={reportTheme}
            onReportThemeChange={setReportTheme}
            isLoading={false}
            onSubmit={handleAnalyze}
          />
          <PresetSelector
            selectedId={selectedPresetId}
            onSelect={handlePresetSelect}
          />
        </div>

      </div>
    </main>
  );
}
