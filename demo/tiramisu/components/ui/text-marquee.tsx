"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface TextMarqueeProps {
  children: React.ReactNode[];
  speed?: number;
  className?: string;
  prefix?: React.ReactNode;
  height?: number;
}

export function TextMarquee({
  children,
  speed = 1,
  className,
  prefix,
  height = 200,
}: TextMarqueeProps) {
  const count = React.Children.count(children);

  return (
    <>
      <style>
        {`
          @keyframes slide-vertical {
            to { translate: 0 var(--destination); }
          }
        `}
      </style>
      <div className={cn("flex items-center justify-center relative overflow-hidden", className)}>
        {prefix && (
          <div className="whitespace-nowrap shrink-0 mr-2">{prefix}</div>
        )}
        {/* Clip window — exact height, no extra overflow */}
        <div className="relative overflow-hidden" style={{ height: `${height}px` }}>
          <div
            className="relative"
            style={{ "--count": count, "--speed": speed } as React.CSSProperties}
          >
            {React.Children.map(children, (child, index) => (
              <div
                key={index}
                className="flex items-center justify-center whitespace-nowrap"
                style={{
                  height: `${height}px`,          /* each slot = container height */
                  "--index": index,
                  "--origin": `calc((var(--count) - var(--index)) * 100%)`,
                  "--destination": `calc((var(--index) + 1) * -100%)`,
                  "--duration": `calc(var(--speed) * ${count}s)`,
                  "--delay": `calc((var(--duration) / var(--count)) * var(--index) - var(--duration))`,
                  translate: `0 var(--origin)`,
                  animation: `slide-vertical var(--duration) var(--delay) infinite linear`,
                } as React.CSSProperties}
              >
                {child}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
