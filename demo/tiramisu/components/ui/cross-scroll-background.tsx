import { cn } from "@/lib/utils";

const H_ROWS: { y: string; text: string; dur: string; rev?: boolean }[] = [
  {
    y: "9%",
    text: "analyze · predict · cluster · model · regression · correlation · feature · variance · entropy · gradient · residual · outlier · normalization · imputation · ",
    dur: "32s",
  },
  {
    y: "28%",
    text: "DataFrame · fit · transform · encode · normalize · impute · split · train · validate · evaluate · deploy · infer · pipeline · hyperopt · ",
    dur: "46s",
    rev: true,
  },
  {
    y: "52%",
    text: "0.952 · r²=0.87 · p<0.001 · μ=0.43 · σ=1.2 · n=1024 · k=5 · α=0.01 · AUC=0.94 · F1=0.89 · RMSE=0.12 · MAE=0.08 · ",
    dur: "24s",
  },
  {
    y: "74%",
    text: "sklearn · pandas · numpy · scipy · statsmodels · xgboost · lightgbm · seaborn · plotly · tensorflow · pytorch · keras · ",
    dur: "38s",
    rev: true,
  },
  {
    y: "91%",
    text: "EDA · cleaning · visualization · testing · SQL · features · summary · inference · pipeline · report · describe · groupby · pivot · merge · ",
    dur: "50s",
  },
];

const V_COLS: { x: string; items: string[]; dur: string; rev?: boolean }[] = [
  {
    x: "4%",
    items: ["analyze","predict","cluster","model","regress","encode","scale","fit","transform","deploy","evaluate","pipeline","feature","entropy"],
    dur: "22s",
  },
  {
    x: "22%",
    items: ["DataFrame","Series","ndarray","tensor","matrix","vector","index","column","dtype","shape","loc","iloc","groupby","merge"],
    dur: "34s",
    rev: true,
  },
  {
    x: "78%",
    items: ["0.952","r²=0.87","p<0.001","μ=0.43","σ=1.2","n=1024","k=5","α=0.01","AUC=0.94","F1=0.89","RMSE","MAE","precision","recall"],
    dur: "19s",
  },
  {
    x: "96%",
    items: ["sklearn","pandas","numpy","scipy","xgboost","keras","torch","seaborn","plotly","statsmodels","lightgbm","catboost","prophet","optuna"],
    dur: "29s",
    rev: true,
  },
];

export function CrossScrollBackground({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-0 -z-10 overflow-hidden text-foreground opacity-[0.045]",
        className
      )}
    >
      {/* Horizontal scrolling rows */}
      {H_ROWS.map((row, i) => (
        <div
          key={`h${i}`}
          className="absolute left-0 right-0 overflow-hidden"
          style={{ top: row.y, height: "1.2rem" }}
        >
          <div
            className="flex whitespace-nowrap font-mono text-xs tracking-widest"
            style={{
              animation: `${row.rev ? "scroll-right" : "scroll-left"} ${row.dur} linear infinite`,
              width: "max-content",
            }}
          >
            <span>{row.text}</span>
            <span>{row.text}</span>
          </div>
        </div>
      ))}

      {/* Vertical scrolling columns */}
      {V_COLS.map((col, i) => (
        <div
          key={`v${i}`}
          className="absolute top-0 bottom-0 overflow-hidden"
          style={{ left: col.x, width: "5rem" }}
        >
          <div
            className="flex flex-col font-mono text-[0.6rem] tracking-widest leading-loose"
            style={{
              animation: `${col.rev ? "scroll-down" : "scroll-up"} ${col.dur} linear infinite`,
              width: "max-content",
            }}
          >
            {[...col.items, ...col.items].map((item, j) => (
              <span key={j} className="py-1">
                {item}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
