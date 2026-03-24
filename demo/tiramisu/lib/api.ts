import { BACKEND_URL } from "./config";

export async function uploadFiles(
  sessionId: string,
  files: File[]
): Promise<void> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  const res = await fetch(
    `${BACKEND_URL}/workspace/upload?session_id=${sessionId}`,
    { method: "POST", body: formData }
  );
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

export function startChatStream(
  sessionId: string,
  messages: { role: string; content: string }[],
  workspace: string[],
  signal: AbortSignal
): Promise<Response> {
  return fetch(`${BACKEND_URL}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "DeepAnalyze-8B",
      provider: "local",
      temperature: 0.4,
      messages,
      workspace,
      stream: true,
      session_id: sessionId,
    }),
  });
}

export async function stopGeneration(sessionId: string): Promise<void> {
  await fetch(`${BACKEND_URL}/chat/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export interface WorkspaceFile {
  name: string;
  path: string;
  size: number;
  is_generated?: boolean;
}

export async function fetchWorkspaceFiles(
  sessionId: string
): Promise<WorkspaceFile[]> {
  const res = await fetch(
    `${BACKEND_URL}/workspace/files?session_id=${sessionId}`
  );
  const data = await res.json();
  return data.files || [];
}

export function getDownloadUrl(sessionId: string, path: string): string {
  return `${BACKEND_URL}/workspace/download?session_id=${sessionId}&path=${encodeURIComponent(path)}`;
}

export function getPreviewUrl(sessionId: string, path: string): string {
  return `${BACKEND_URL}/workspace/preview?session_id=${sessionId}&path=${encodeURIComponent(path)}`;
}

export async function clearWorkspace(sessionId: string): Promise<void> {
  await fetch(`${BACKEND_URL}/workspace/clear?session_id=${sessionId}`, {
    method: "DELETE",
  });
}
