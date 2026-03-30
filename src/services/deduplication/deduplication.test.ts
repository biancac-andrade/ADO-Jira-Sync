/**
 * Testes unitários: deduplicação de eventos (isDuplicate / markProcessed).
 */

import { isDuplicate, markProcessed } from './index';

describe('deduplication', () => {
  const eventType = 'run.statechanged';
  const state = 'Completed';
  const jiraKey = 'BEESEDI-11';

  it('returns false when event has not been processed yet', () => {
    const run = `run-${Date.now()}`;
    expect(isDuplicate(eventType, run, state, jiraKey)).toBe(false);
  });

  it('returns true after markProcessed for the same key', () => {
    const run = `run-${Date.now()}`;
    expect(isDuplicate(eventType, run, state, jiraKey)).toBe(false);
    markProcessed(eventType, run, state, jiraKey);
    expect(isDuplicate(eventType, run, state, jiraKey)).toBe(true);
  });

  it('treats events as different when runId changes', () => {
    const run1 = `run-${Date.now()}-a`;
    const run2 = `run-${Date.now()}-b`;
    markProcessed(eventType, run1, state, jiraKey);
    expect(isDuplicate(eventType, run2, state, jiraKey)).toBe(false);
  });

  it('treats events as different when jiraKey changes', () => {
    const run = `run-${Date.now()}`;
    markProcessed(eventType, run, state, 'BEESEDI-11');
    expect(isDuplicate(eventType, run, state, 'BEESEDI-12')).toBe(false);
  });

  it('prune removes expired entries (TTL=0)', async () => {
    jest.resetModules();
    process.env.WEBHOOK_DEDUP_TTL_MS = '1';
    const dedup = require('./index');
    dedup.markProcessed('e', 'r', 's', 'j');
    await new Promise((r) => setTimeout(r, 10));
    expect(dedup.isDuplicate('e', 'r', 's', 'j')).toBe(false);
  });
});
