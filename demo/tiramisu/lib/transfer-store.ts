/**
 * Cross-page File transfer store.
 * Works because Next.js SPA navigation preserves the JS runtime —
 * File objects survive in the module-level Map without serialization.
 *
 * NOTE: We don't delete entries on consume — the analyze page may
 * re-read during HMR or React re-renders. Each tab has its own
 * JS runtime, so there's no cross-tab interference.
 */

export interface TransferData {
  prompt: string;
  files: File[];
  reportTheme: string;
  presetId: string | null;
}

const pending = new Map<string, TransferData>();

export function storeTransfer(data: TransferData): string {
  const id = crypto.randomUUID();
  pending.set(id, data);
  return id;
}

export function consumeTransfer(id: string): TransferData | undefined {
  return pending.get(id);
}
