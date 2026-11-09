/**
 * Evita processar o mesmo evento duas vezes (ex.: retry do Azure).
 * Chave: eventType + runId + state + jiraKey. TTL padrão 1 hora.
 */

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hora

interface Entry {
  expiresAt: number;
}

const store = new Map<string, Entry>();

const ttlMs = Number(process.env.WEBHOOK_DEDUP_TTL_MS) || DEFAULT_TTL_MS;

function prune(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

/** Retorna true se já processamos este evento (duplicata). */
export function isDuplicate(eventType: string, runId: string, state: string, jiraKey: string): boolean {
  prune();
  const key = `${eventType}:${runId}:${state}:${jiraKey}`;
  const entry = store.get(key);
  if (entry && entry.expiresAt > Date.now()) return true;
  return false;
}

/** Marca o evento como processado. */
export function markProcessed(eventType: string, runId: string, state: string, jiraKey: string): void {
  prune();
  const key = `${eventType}:${runId}:${state}:${jiraKey}`;
  store.set(key, { expiresAt: Date.now() + ttlMs });
}
