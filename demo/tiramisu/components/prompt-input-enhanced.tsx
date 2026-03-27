"use client";

import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { Button } from "@/components/ui/button";
import { ThemeSelector } from "@/components/theme-selector";
import { ArrowUp, Paperclip, Mic, Square, X, Sparkles } from "lucide-react";
import { useRef } from "react";

interface PromptInputEnhancedProps {
  input: string;
  onInputChange: (value: string) => void;
  files: File[];
  onFilesChange: (files: File[]) => void;
  reportTheme: string;
  onReportThemeChange: (theme: string) => void;
  planRouterEnabled: boolean;
  onPlanRouterEnabledChange: (enabled: boolean) => void;
  isLoading: boolean;
  onSubmit: () => void;
}

export function PromptInputEnhanced({
  input,
  onInputChange,
  files,
  onFilesChange,
  reportTheme,
  onReportThemeChange,
  planRouterEnabled,
  onPlanRouterEnabledChange,
  isLoading,
  onSubmit,
}: PromptInputEnhancedProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const newFiles = Array.from(event.target.files);
      onFilesChange([...files, ...newFiles]);
    }
  };

  const handleRemoveFile = (index: number) => {
    onFilesChange(files.filter((_, i) => i !== index));
    if (uploadInputRef?.current) {
      uploadInputRef.current.value = "";
    }
  };

  return (
    <PromptInput
      value={input}
      onValueChange={onInputChange}
      isLoading={isLoading}
      onSubmit={onSubmit}
      className="w-full flex flex-col gap-2 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none ring-0"
    >
      {/* Attached Files Above Input */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-3 pb-4">
          {files.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary/5 border border-primary/20 text-primary font-mono text-[9px] uppercase tracking-widest backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
            >
              <Paperclip className="size-3" />
              <span className="max-w-[140px] truncate">{file.name}</span>
              <button
                onClick={() => handleRemoveFile(index)}
                className="hover:text-destructive transition-colors ml-1"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Flowing Input */}
      <div className="relative group">
        <div className="absolute left-0 top-3 w-1 h-5 sm:h-8 bg-primary/40 hidden sm:block opacity-50 group-focus-within:opacity-100 transition-opacity" />
        <PromptInputTextarea
          placeholder="what shall we discover today?"
          className="dark:bg-transparent !text-2xl sm:!text-3xl md:!text-4xl !font-display !font-medium !tracking-tight placeholder:text-muted-foreground/30 !min-h-[50px] sm:!min-h-[70px] !pl-0 sm:!pl-6 !py-2 focus-visible:!ring-0 transition-all focus:placeholder:opacity-0 caret-primary"
        />
      </div>

      {/* Structural Bottom Actions */}
      <PromptInputActions className="flex items-center justify-between border-t border-border/40 pt-6 mt-4">
        {/* Left: Operations */}
        <div className="flex items-center gap-4 sm:gap-6">
          <PromptInputAction tooltip="Attach Dataset [CSV, PDF, etc]">
            <label
              htmlFor="file-upload"
              className="group flex cursor-pointer items-center border border-primary/40 bg-primary/10 hover:bg-primary/20 transition-all"
            >
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />
              <div className="w-10 h-10 sm:w-11 sm:h-11 bg-primary flex items-center justify-center transition-colors">
                 <Paperclip className="text-primary-foreground size-4 sm:size-4.5" />
              </div>
              <span className="px-3 sm:px-4 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.25em] text-primary font-bold mt-0.5">Attach_Data</span>
            </label>
          </PromptInputAction>
          
          <div className="w-px h-6 bg-border/40 hidden sm:block" />

          <ThemeSelector
            value={reportTheme}
            onValueChange={onReportThemeChange}
          />

          <div className="w-px h-6 bg-border/40 hidden sm:block" />

          <PromptInputAction tooltip={planRouterEnabled ? "Plan + Router: ON — Gemini plans analysis and supervises execution (error recovery + checkpoints)" : "Plan + Router: OFF — Direct analysis without Gemini supervision"}>
            <button
              onClick={(e) => { e.stopPropagation(); onPlanRouterEnabledChange(!planRouterEnabled); }}
              className={`flex items-center gap-2 px-3 h-9 border transition-all font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.15em] font-bold ${
                planRouterEnabled
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                  : "border-border/20 bg-secondary/30 text-muted-foreground hover:bg-secondary/60"
              }`}
            >
              <Sparkles className="size-3.5" />
              <span className="hidden sm:inline">Plan + Route</span>
            </button>
          </PromptInputAction>
        </div>

        {/* Right: Execute */}
        <div className="flex items-center gap-4">
          <PromptInputAction tooltip="Voice Command [Inactive]">
             <button
               className="w-9 h-9 rounded-none flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
               onClick={(e) => e.stopPropagation()}
             >
               <Mic className="size-4" />
             </button>
          </PromptInputAction>

          <PromptInputAction
            tooltip={isLoading ? "Halt Synthesis" : "Execute Analysis"}
          >
            <Button
              variant="default"
              size="sm"
              className="h-11 rounded-none px-6 sm:px-8 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.25em] bg-foreground text-background hover:bg-primary hover:text-primary-foreground transition-all"
              onClick={onSubmit}
            >
              {isLoading ? (
                <div className="flex items-center gap-2.5">
                   <Square className="size-3.5 fill-current" />
                   <span>Halt</span>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                   <span>Execute</span>
                   <ArrowUp className="size-3.5" />
                </div>
              )}
            </Button>
          </PromptInputAction>
        </div>
      </PromptInputActions>
    </PromptInput>
  );
}
