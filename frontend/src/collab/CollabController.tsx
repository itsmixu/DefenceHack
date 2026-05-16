/**
 * CollabController — mounts at the root, owns the SSE subscription for the
 * currently-active file tab.
 *
 * Behavior:
 *   - When the active tab changes, leave the previous file's session and
 *     join the new one. First browser to join becomes leader; others follow.
 *   - Subscribe to /api/collab/files/{id}/stream as an EventSource.
 *   - As a leader: when drawn features change, broadcast a `drawn_features`
 *     patch to followers.
 *   - As a follower: when an `edit` event arrives with `drawn_features`,
 *     apply it to the local useDrawnStore.
 *
 * This is the MVP scope — only drawn features are synced. Layer toggles,
 * viewport, and timeline are future extensions to the same broadcast path.
 */
import { useEffect, useRef } from 'react';
import { collabApi, type CollabEvent } from '../api/collab';
import {
  useCollabStore,
  useDrawnStore,
} from '../store';
import type { DrawnFeature } from '../api/types';

// Debounce window for broadcasting drawn-feature edits.
const BROADCAST_DEBOUNCE_MS = 250;

// Single global room — first browser to load is Alpha/leader everywhere.
// Per-file rooms are out of scope for the hackathon demo.
const GLOBAL_ROOM = '__global__';

export default function CollabController() {
  const roomId = GLOBAL_ROOM;

  // Track the file currently being subscribed to. A ref so the cleanup
  // can see the right id without re-running on every render.
  const subscribedRef = useRef<{ fileId: string; sessionId: string } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  // Suppresses the next broadcast — we're applying an incoming patch, not
  // a local edit.
  const applyingRemoteRef = useRef(false);

  // ── Join / leave on active-tab change ─────────────────────────────────────
  useEffect(() => {
    const setSession = useCollabStore.getState().setSession;
    const setRoster = useCollabStore.getState().setRoster;
    const clearCollab = useCollabStore.getState().clear;

    let cancelled = false;

    async function teardown() {
      const cur = subscribedRef.current;
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (cur) {
        // Best-effort — backend cleans up on SSE disconnect anyway.
        collabApi.leave(cur.fileId, cur.sessionId).catch(() => {});
      }
      subscribedRef.current = null;
      clearCollab();
    }

    const fileId = roomId;

    (async () => {
      await teardown();
      try {
        const { session_id, snapshot } = await collabApi.join(fileId);
        if (cancelled) {
          await collabApi.leave(fileId, session_id).catch(() => {});
          return;
        }
        subscribedRef.current = { fileId, sessionId: session_id };
        setSession(fileId, session_id);
        setRoster(
          fileId,
          snapshot.leader_session_id,
          snapshot.sessions.map((s) => ({
            sessionId: s.session_id,
            displayName: s.display_name,
            role: s.role,
            joinedAt: s.joined_at,
          })),
        );

        const es = new EventSource(collabApi.streamUrl(fileId, session_id));
        esRef.current = es;
        es.onmessage = (ev) => {
          let event: CollabEvent;
          try { event = JSON.parse(ev.data) as CollabEvent; }
          catch { return; }
          if (event.type === 'roster') {
            setRoster(
              fileId,
              event.snapshot.leader_session_id,
              event.snapshot.sessions.map((s) => ({
                sessionId: s.session_id,
                displayName: s.display_name,
                role: s.role,
                joinedAt: s.joined_at,
              })),
            );
          } else if (event.type === 'edit') {
            // Apply replays always; skip live edits from our own session.
            if (event.from === session_id && event.from !== '__replay__') return;
            const patch = event.patch as Record<string, unknown>;
            if (Array.isArray(patch.drawn_features)) {
              applyingRemoteRef.current = true;
              useDrawnStore.getState().setAll(patch.drawn_features as DrawnFeature[]);
              // Release the suppression after the store has fully propagated.
              Promise.resolve().then(() => { applyingRemoteRef.current = false; });
            }
          }
        };
        es.onerror = () => {
          // EventSource auto-retries; we don't tear down here. If the
          // backend session is gone the next heartbeat will tell us.
        };
      } catch (err) {
        console.warn('collab join failed', err);
      }
    })();

    return () => {
      cancelled = true;
      void teardown();
    };
  }, []); // global room never changes — runs once on mount

  // ── Broadcast outgoing drawn-feature edits when we're leader ───────────────
  useEffect(() => {
    let timer: number | null = null;
    const unsub = useDrawnStore.subscribe((state) => {
      if (applyingRemoteRef.current) return;
      const collab = useCollabStore.getState();
      const sub = subscribedRef.current;
      if (!sub || collab.role !== 'leader' || !collab.sessionId) return;
      // Debounce: collapse rapid edits (drag, paint) into one broadcast.
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        collabApi
          .broadcast(sub.fileId, sub.sessionId, { drawn_features: state.features })
          .catch(() => {});
      }, BROADCAST_DEBOUNCE_MS);
    });
    return () => {
      if (timer != null) window.clearTimeout(timer);
      unsub();
    };
  }, []);

  return null;
}
