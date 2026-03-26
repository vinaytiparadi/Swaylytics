/**
 * Cross-page transfer store with sessionStorage fallback.
 *
 * Primary: module-level Map (preserves File objects across SPA navigation).
 * Fallback: sessionStorage (survives HMR / page reloads, but without File
 * objects since they can't be serialized). When recovering from
 * sessionStorage the returned `files` array is empty — the caller should
 * skip re-uploading because the backend workspace already has them.
 */

export interface TransferData {
  prompt: string;
  files: File[];
  reportTheme: string;
  presetId: string | null;
}

const pending = new Map<string, TransferData>();

const SS_PREFIX = "transfer:";

export function storeTransfer(data: TransferData): string {
  const id = crypto.randomUUID();
  pending.set(id, data);

  // Persist text-only fields to sessionStorage for recovery
  try {
    sessionStorage.setItem(
      SS_PREFIX + id,
      JSON.stringify({
        prompt: data.prompt,
        reportTheme: data.reportTheme,
        presetId: data.presetId,
      })
    );
  } catch {
    /* quota or SSR — non-critical */
  }

  return id;
}

export function consumeTransfer(id: string): TransferData | undefined {
  // Fast path: in-memory Map (has File objects)
  const mem = pending.get(id);
  if (mem) return mem;

  // Fallback: recover from sessionStorage (no File objects)
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + id);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        prompt: parsed.prompt,
        files: [],
        reportTheme: parsed.reportTheme,
        presetId: parsed.presetId ?? null,
      };
    }
  } catch {
    /* SSR or parse error */
  }

  return undefined;
}
