/**
 * Cross-page transfer store with sessionStorage fallback.
 *
 * Primary: module-level Map (preserves File objects across SPA navigation).
 * Fallback: sessionStorage (survives HMR / page reloads, but without File
 * objects since they can't be serialized). When recovering from
 * sessionStorage the returned `files` array is empty — the caller should
 * skip re-uploading because the backend workspace already has them.
 */

export type EngineType = "deepanalyze" | "gemini";

export interface TransferData {
  prompt: string;
  files: File[];
  reportTheme: string;
  presetId: string | null;
  planRouterEnabled: boolean;
  engine: EngineType;
}

const pending = new Map<string, TransferData>();

const SS_PREFIX = "transfer:";

/** Wipe only stale transfer entries — leave snapshots and sessions intact
 *  so that previous analyses survive when starting a new one in the same tab. */
function cleanupStaleTransfers(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(SS_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* noop */
  }
}

export function storeTransfer(data: TransferData): string {
  cleanupStaleTransfers();
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
        planRouterEnabled: data.planRouterEnabled,
        engine: data.engine,
      })
    );
  } catch {
    /* quota or SSR — non-critical */
  }

  return id;
}

const ACTIVE_SESSION_KEY = "active_session_id";

/** Save the active session ID so it can be stopped on refresh. */
export function setActiveSession(sessionId: string): void {
  try {
    sessionStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
  } catch {
    /* noop */
  }
}

/** Pop the active session ID (returns it and removes from storage). */
export function popActiveSession(): string | null {
  try {
    const id = sessionStorage.getItem(ACTIVE_SESSION_KEY);
    if (id) sessionStorage.removeItem(ACTIVE_SESSION_KEY);
    return id;
  } catch {
    return null;
  }
}

export function consumeTransfer(id: string): TransferData | undefined {
  // Fast path: in-memory Map (has File objects)
  const mem = pending.get(id);
  if (mem) {
    pending.delete(id);
    // Keep sessionStorage entry alive for reload recovery
    return mem;
  }

  // Fallback: recover from sessionStorage (no File objects)
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + id);
    if (raw) {
      // Keep entry — don't delete, so future reloads can also recover
      const parsed = JSON.parse(raw);
      return {
        prompt: parsed.prompt,
        files: [],
        reportTheme: parsed.reportTheme,
        presetId: parsed.presetId ?? null,
        planRouterEnabled: parsed.planRouterEnabled ?? false,
        engine: parsed.engine ?? "deepanalyze",
      };
    }
  } catch {
    /* SSR or parse error */
  }

  return undefined;
}

/** Explicitly remove a transfer entry (used on "Clear workspace"). */
export function clearTransfer(id: string): void {
  pending.delete(id);
  try {
    sessionStorage.removeItem(SS_PREFIX + id);
  } catch {
    /* noop */
  }
}
