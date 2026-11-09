/**
 * Persiste eventos de pipeline (início/fim) para métricas e GAP.
 * Um arquivo JSONL em data/ (ou path configurável).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PipelineEvent {
  runId: string;
  state: string;
  jiraKey: string;
  timestamp: string; // ISO
  pipelineName?: string;
  branch?: string;
  result?: string;
  runUrl?: string;
  eventType: string;
}

const DEFAULT_DIR = path.join(process.cwd(), 'data');
const DEFAULT_FILE = 'pipeline-events.jsonl';

function getStorePath(): string {
  const dir = process.env.EVENT_STORE_DIR || DEFAULT_DIR;
  const file = process.env.EVENT_STORE_FILE || DEFAULT_FILE;
  return path.join(dir, file);
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Append one event per line (JSONL). */
export function appendPipelineEvent(event: PipelineEvent): void {
  if (process.env.EVENT_STORE_DISABLED === '1') return;
  try {
    const storePath = getStorePath();
    ensureDir(storePath);
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(storePath, line, 'utf8');
  } catch (e) {
    console.warn('[events-store] Falha ao persistir evento:', (e as Error).message);
  }
}
