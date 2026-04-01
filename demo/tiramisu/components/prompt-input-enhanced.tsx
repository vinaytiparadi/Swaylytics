"use client";

import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { Button } from "@/components/ui/button";
import { ThemeSelector } from "@/components/theme-selector";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ArrowUp,
  Paperclip,
  Mic,
  Square,
  X,
  Sparkles,
  ChevronDown,
  Zap,
  Package,
  Check,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { EngineType } from "@/lib/transfer-store";

interface PromptInputEnhancedProps {
  input: string;
  onInputChange: (value: string) => void;
  files: File[];
  onFilesChange: (files: File[]) => void;
  reportTheme: string;
  onReportThemeChange: (theme: string) => void;
  planRouterEnabled: boolean;
  onPlanRouterEnabledChange: (enabled: boolean) => void;
  engine: EngineType;
  onEngineChange: (engine: EngineType) => void;
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
  engine,
  onEngineChange,
  isLoading,
  onSubmit,
}: PromptInputEnhancedProps) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [enginePopoverOpen, setEnginePopoverOpen] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
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
      className="w-full flex flex-col gap-1 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none ring-0"
    >
      {/* Attached Files Above Input */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-0">
          {files.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-2 py-1 bg-primary/5 border border-primary/20 text-primary font-mono text-[8px] uppercase tracking-widest backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
            >
              <Paperclip className="size-2.5" />
              <span className="max-w-[140px] truncate">{file.name}</span>
              <button
                onClick={() => handleRemoveFile(index)}
                className="hover:text-destructive transition-colors ml-1"
              >
                <X className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Flowing Input */}
      <div className="relative group w-full">
        <div className="absolute left-0 top-[14px] sm:top-[20px] md:top-[24px] w-1 h-5 sm:h-7 md:h-8 bg-primary/40 hidden sm:block opacity-50 group-focus-within:opacity-100 transition-opacity rounded-full" />
        <PromptInputTextarea
          placeholder="what shall we discover today?"
          className="dark:bg-transparent !text-xl sm:!text-2xl md:!text-3xl !font-display !font-medium !tracking-tight placeholder:text-muted-foreground/30 !min-h-[50px] sm:!min-h-[70px] !pl-0 sm:!pl-6 !pr-0 !pt-[12px] sm:!pt-[16px] md:!pt-[20px] !pb-4 focus-visible:!ring-0 transition-all focus:placeholder:opacity-0 caret-primary w-full"
        />
      </div>

      {/* Structural Bottom Actions */}
      <PromptInputActions className="flex flex-wrap items-center justify-between border-t border-border/40 pt-3 mt-1 gap-y-3">
        {/* Left: Operations */}
        <div className="flex items-center flex-wrap gap-0.5 sm:gap-1 flex-shrink-0">
          <PromptInputAction tooltip="Attach Dataset [CSV, PDF, etc]">
            <label
              htmlFor="file-upload"
              className="group flex size-9 sm:size-10 cursor-pointer items-center justify-center border border-border/20 bg-secondary/30 hover:bg-secondary/60 transition-all rounded-none flex-shrink-0"
            >
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />
              <Paperclip className="text-primary size-3.5 sm:size-4" />
            </label>
          </PromptInputAction>

          <div className="w-px h-6 bg-border/40 mx-px sm:mx-0.5" />

          <ThemeSelector
            value={reportTheme}
            onValueChange={onReportThemeChange}
          />

          <div className="w-px h-6 bg-border/40 mx-px sm:mx-0.5" />

          {/* Engine Selector + Plan/Route Fused Group */}
          <div className="flex items-center gap-0 flex-shrink-0">
            <Popover open={enginePopoverOpen} onOpenChange={setEnginePopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    "flex items-center gap-2 h-9 sm:h-10 px-3 sm:px-3.5 border transition-all rounded-none group relative",
                    engine === "gemini"
                      ? "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                      : "border-border/20 bg-secondary/30 text-foreground hover:bg-secondary/60",
                    engine === "deepanalyze" && "border-r-0"
                  )}
                  onClick={(e) => e.stopPropagation()}
                  title={engine === "gemini" ? "Engine: Gemini 3 Flash (API)" : "Engine: DeepAnalyze-8B (Local)"}
                >
                  {engine === "gemini" ? (
                    <Zap className="size-3.5 text-blue-500 shrink-0" />
                  ) : (
                    <Package className="size-3.5 text-primary shrink-0" />
                  )}
                  <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.15em] font-bold">
                    {engine === "gemini" ? "Gemini" : "DeepAnalyze"}
                  </span>
                  <ChevronDown className={cn("size-2.5 opacity-40 group-hover:opacity-100 transition-transform", enginePopoverOpen && "rotate-180")} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-48 rounded-none border border-border bg-popover/95 backdrop-blur-md p-1.5 shadow-xl"
                align="start"
                side="top"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="px-3 pb-2 pt-1 font-mono text-[9px] uppercase tracking-[0.25em] text-muted-foreground/80 border-b border-border/30 mb-1">
                  Select_Engine
                </p>
                <div className="space-y-0.5">
                  <button
                    onClick={() => { onEngineChange("deepanalyze"); setEnginePopoverOpen(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors flex items-center gap-2.5 border-l-2 border-transparent hover:bg-accent hover:text-accent-foreground hover:border-primary",
                      engine === "deepanalyze" && "bg-accent/50 text-foreground border-primary font-bold"
                    )}
                  >
                    <Package className="size-3.5 text-primary" />
                    DeepAnalyze-8B
                    {engine === "deepanalyze" && <Check className="size-3 ml-auto text-muted-foreground" />}
                  </button>
                  <button
                    onClick={() => { onEngineChange("gemini"); setEnginePopoverOpen(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-[10px] font-mono uppercase tracking-widest transition-colors flex items-center gap-2.5 border-l-2 border-transparent hover:bg-accent hover:text-accent-foreground hover:border-blue-500",
                      engine === "gemini" && "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500 font-bold"
                    )}
                  >
                    <Zap className="size-3.5 text-blue-500" />
                    Gemini 3 Flash
                    {engine === "gemini" && <Check className="size-3 ml-auto text-muted-foreground" />}
                  </button>
                </div>
              </PopoverContent>
            </Popover>

            {/* Plan + Route — attached to DeepAnalyze with NO gap */}
            {engine === "deepanalyze" && (
              <PromptInputAction tooltip={planRouterEnabled ? "Plan + Router: ON" : "Plan + Router: OFF"}>
                <button
                  onClick={(e) => { e.stopPropagation(); onPlanRouterEnabledChange(!planRouterEnabled); }}
                  className={cn(
                    "flex items-center justify-center size-9 sm:size-10 border transition-all rounded-none",
                    planRouterEnabled
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                      : "border-border/20 bg-secondary/30 text-foreground hover:bg-secondary/60"
                  )}
                >
                  <Sparkles className={cn("size-3.5 sm:size-4", planRouterEnabled ? "text-amber-500" : "text-muted-foreground/60")} />
                </button>
              </PromptInputAction>
            )}
          </div>
        </div>

        {/* Right: Execute */}
        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0 ml-auto sm:ml-0">
          <PromptInputAction tooltip="Voice Command [Inactive]">
            <button
              className="size-9 sm:size-10 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors border border-transparent hover:border-border/20 rounded-none flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <Mic className="size-3.5 sm:size-4" />
            </button>
          </PromptInputAction>

          <PromptInputAction
            tooltip={isLoading ? "Halt Synthesis" : "Execute Analysis"}
          >
            <Button
              variant="default"
              size="sm"
              className="h-9 sm:h-10 rounded-none px-4 sm:px-6 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.3em] bg-foreground text-background hover:bg-primary hover:text-primary-foreground transition-all shadow-lg shadow-primary/10 whitespace-nowrap"
              onClick={onSubmit}
            >
              {isLoading ? (
                <div className="flex items-center gap-2.5">
                  <Square className="size-3.5 fill-current" />
                  <span>Halt</span>
                </div>
              ) : (
                <div className="flex items-center gap-2.5">
                  <span className="mt-0.5">Execute</span>
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
