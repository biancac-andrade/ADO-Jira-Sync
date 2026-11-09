/**
 * Prevents processing the same event twice (e.g. Azure retry).
 * Key: eventType + runId + state + jiraKey. TTL configurable via WEBHOOK_DEDUP_TTL_MS.
 */

const TTL_MS = Number(process.env.WEBHOOK_DEDUP_TTL_MS) || 60 * 60 * 1000;

interface DedupEntry {
  expiresAt: number;
}

const store = new Map<string, DedupEntry>();

function prune(): void {
  const now = Date.now();
  for (const [k, entry] of store.entries()) {
    if (entry.expiresAt <= now) store.delete(k);
  }
}

export function isDuplicate(
  eventType: string,
  runId: string,
  state: string,
  jiraKey: string
): boolean {
  prune();
  const key = `${eventType}:${runId}:${state}:${jiraKey}`;
  const entry = store.get(key);
  return (entry?.expiresAt ?? 0) > Date.now();
}

export function markProcessed(
  eventType: string,
  runId: string,
  state: string,
  jiraKey: string
): void {
  const key = `${eventType}:${runId}:${state}:${jiraKey}`;
  store.set(key, { expiresAt: Date.now() + TTL_MS });
}
