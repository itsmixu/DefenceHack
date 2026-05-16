/**
 * Collab session API — leader/follower per open file.
 *
 * The first session to open a given file becomes the leader; later sessions
 * are followers receiving the leader's edits over SSE.
 */
export type CollabRole = 'leader' | 'follower';

export interface CollabSessionInfo {
  session_id: string;
  display_name: string;
  role: CollabRole;
  joined_at: number;
}

export interface CollabSnapshot {
  file_id: string;
  leader_session_id: string | null;
  follower_count: number;
  sessions: CollabSessionInfo[];
}

export interface CollabJoinResponse {
  session_id: string;
  snapshot: CollabSnapshot;
}

export type CollabEvent =
  | { type: 'roster'; snapshot: CollabSnapshot }
  | { type: 'edit'; from: string; patch: Record<string, unknown>; ts: number };

const BASE = '/api/collab/files';

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export const collabApi = {
  join: (fileId: string) =>
    postJson<CollabJoinResponse>(`${BASE}/${fileId}/join`, {}),
  leave: (fileId: string, sessionId: string) =>
    postJson<void>(`${BASE}/${fileId}/leave`, { session_id: sessionId }),
  heartbeat: (fileId: string, sessionId: string) =>
    postJson<CollabSnapshot>(`${BASE}/${fileId}/heartbeat`, { session_id: sessionId }),
  takeover: (fileId: string, sessionId: string) =>
    postJson<CollabSnapshot>(`${BASE}/${fileId}/takeover`, { session_id: sessionId }),
  broadcast: (fileId: string, sessionId: string, patch: Record<string, unknown>) =>
    postJson<{ delivered_to: number }>(`${BASE}/${fileId}/broadcast`, {
      session_id: sessionId,
      patch,
    }),
  streamUrl: (fileId: string, sessionId: string) =>
    `${BASE}/${fileId}/stream?session_id=${encodeURIComponent(sessionId)}`,
};
