"use client"

import { cn } from "@/lib/utils"
import React, { useEffect, useRef, useState } from "react"

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip border",
        "border-border bg-card text-card-foreground rounded-xl",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
  className?: string
}

// React.memo + ref-based innerHTML so parent re-renders (scroll, state)
// never touch the highlighted DOM → browser text selection stays intact.
const CodeBlockCode = React.memo(function CodeBlockCode({
  code,
  language = "tsx",
  theme = "github-light",
  className,
}: CodeBlockCodeProps) {
  const shikiRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const el = shikiRef.current
    if (!el) return

    if (!code) {
      el.innerHTML = "<pre><code></code></pre>"
      setReady(true)
      return
    }

    let cancelled = false
    import("shiki").then(({ codeToHtml }) =>
      codeToHtml(code, { lang: language, theme })
    ).then((html) => {
      if (cancelled) return
      el.innerHTML = html.replace(/ tabindex="0"/g, "")
      setReady(true)
    })
    return () => { cancelled = true }
  }, [code, language, theme])

  const classes = cn(
    "w-full overflow-x-auto text-[14px] [&>pre]:px-4 [&>pre]:py-4 select-text",
    className
  )

  return (
    <>
      {/* Ref-only div for shiki — React never reconciles its children */}
      <div ref={shikiRef} className={classes} style={ready ? undefined : { display: "none" }} />
      {/* React-managed fallback, hidden once shiki is ready */}
      {!ready && (
        <div className={classes}>
          <pre><code>{code}</code></pre>
        </div>
      )}
    </>
  )
})

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }
