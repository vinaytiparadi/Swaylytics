export default function AnalyzeLoading() {
  return (
    <div className="relative flex h-[100dvh] items-center justify-center bg-background overflow-hidden">
      <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03] dark:opacity-[0.06] bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] mix-blend-overlay" />
      <div className="flex flex-col items-center gap-4 z-10">
        <div className="w-8 h-8 border border-primary/20 border-t-primary rounded-full animate-spin" />
        <div className="font-mono text-[10px] text-primary uppercase tracking-[0.3em] font-medium drop-shadow-[0_0_10px_rgba(var(--primary),0.3)]">
          Initializing Session
        </div>
      </div>
    </div>
  );
}
