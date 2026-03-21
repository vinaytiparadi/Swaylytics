"use client";

import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";
import { Button } from "@/components/ui/button";
import { ThemeSelector } from "@/components/theme-selector";
import { ArrowUp, Paperclip, Mic, Square, X } from "lucide-react";
import { useRef } from "react";

interface PromptInputEnhancedProps {
  input: string;
  onInputChange: (value: string) => void;
  files: File[];
  onFilesChange: (files: File[]) => void;
  reportTheme: string;
  onReportThemeChange: (theme: string) => void;
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
      className="w-full border-foreground/20"
    >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2 pt-2">
          {files.map((file, index) => (
            <div
              key={index}
              className="bg-secondary flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <Paperclip className="size-3.5" />
              <span className="max-w-[120px] truncate">{file.name}</span>
              <button
                onClick={() => handleRemoveFile(index)}
                className="hover:bg-secondary/50 rounded-full p-0.5"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <PromptInputTextarea
        placeholder="Describe your data analysis task..."
        className="dark:bg-transparent text-base"
      />

      <PromptInputActions className="flex items-center justify-between gap-2 px-2 pb-1 pt-4">
        {/* Left: attach + theme */}
        <div className="flex items-center gap-1">
          <PromptInputAction tooltip="Attach files">
            <label
              htmlFor="file-upload"
              className="hover:bg-secondary flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors"
            >
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />
              <Paperclip className="text-muted-foreground size-4" />
            </label>
          </PromptInputAction>

          <ThemeSelector
            value={reportTheme}
            onValueChange={onReportThemeChange}
          />
        </div>

        {/* Right: voice + send */}
        <div className="flex items-center gap-1">
          <PromptInputAction tooltip="Voice input (coming soon)">
            <Button
              variant="default"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={(e) => e.stopPropagation()}
            >
              <Mic className="size-4" />
            </Button>
          </PromptInputAction>

          <PromptInputAction
            tooltip={isLoading ? "Stop generation" : "Analyze"}
          >
            <Button
              variant="default"
              size="icon"
              className="h-8 w-8 rounded-full"
              onClick={onSubmit}
            >
              {isLoading ? (
                <Square className="size-4 fill-current" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </Button>
          </PromptInputAction>
        </div>
      </PromptInputActions>
    </PromptInput>
  );
}
