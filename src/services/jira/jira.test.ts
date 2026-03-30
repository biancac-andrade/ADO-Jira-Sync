/**
 * Unit tests: date formatting and Jira key extraction (no API calls).
 */

import { formatBrasilia, extractJiraKey, extractJiraKeyFromPayload } from './index';

describe('jira', () => {
  describe('formatBrasilia', () => {
    it('returns "—" when isoDate is undefined', () => {
      expect(formatBrasilia(undefined)).toBe('—');
    });

    it('returns "—" when isoDate is empty string', () => {
      expect(formatBrasilia('')).toBe('—');
    });

    it('formats ISO date to pt-BR (America/Sao_Paulo)', () => {
      const result = formatBrasilia('2024-01-15T14:30:00.000Z');
      expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
      expect(result).toMatch(/\d{2}:\d{2}/);
    });
  });

  describe('extractJiraKey', () => {
    it('extracts key from title with brackets [PROJ-123]', () => {
      expect(extractJiraKey('[BEESEDI-11] Minha tarefa')).toBe('BEESEDI-11');
    });

    it('extracts key from title without brackets', () => {
      expect(extractJiraKey('BEESEDI-12 Implementar feature')).toBe('BEESEDI-12');
    });

    it('returns null when no key found', () => {
      expect(extractJiraKey('Title without key')).toBeNull();
      expect(extractJiraKey('')).toBeNull();
      expect(extractJiraKey(undefined)).toBeNull();
    });

    it('returns first key when multiple keys present', () => {
      expect(extractJiraKey('[HEY-1] e [HEY-2]')).toBe('HEY-1');
    });
  });

  describe('extractJiraKeyFromPayload', () => {
    it('extracts key from object with title', () => {
      expect(extractJiraKeyFromPayload({ resource: { title: '[BEESEDI-11] PR' } })).toBe(
        'BEESEDI-11'
      );
    });

    it('extracts key from nested object (any field)', () => {
      expect(extractJiraKeyFromPayload({ sourceBranch: 'refs/heads/feature/JIRA-99' })).toBe(
        'JIRA-99'
      );
    });

    it('returns null when no key in object', () => {
      expect(extractJiraKeyFromPayload({ foo: 'bar' })).toBeNull();
    });

    it('returns null on serialization error', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(extractJiraKeyFromPayload(circular)).toBeNull();
    });
  });

  describe('addJiraComment (with fetch mock)', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
      jest.resetModules();
      process.env.JIRA_BASE_URL = 'https://test.atlassian.net';
      process.env.JIRA_USER_EMAIL = 'test@test.com';
      process.env.JIRA_API_TOKEN = 'token';
      fetchMock = jest.fn();
      (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    });

    it('returns true when POST comment returns ok', async () => {
      fetchMock.mockResolvedValue({ ok: true });
      const { addJiraComment } = require('./index');
      expect(await addJiraComment('X-1', 'texto')).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test.atlassian.net/rest/api/3/issue/X-1/comment',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('returns false when credentials are missing', async () => {
      jest.resetModules();
      delete process.env.JIRA_BASE_URL;
      const { addJiraComment } = require('./index');
      expect(await addJiraComment('X-1', 'texto')).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns false when POST returns not-ok', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400, text: () => Promise.resolve('bad') });
      const { addJiraComment } = require('./index');
      expect(await addJiraComment('X-1', 'texto')).toBe(false);
    });

    it('retries on 5xx and succeeds on second call (covers fetchWithRetry retry path)', async () => {
      jest.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('error') })
        .mockResolvedValueOnce({ ok: true });
      const { addJiraComment } = require('./index');
      const promise = addJiraComment('X-1', 'texto');
      await jest.advanceTimersByTimeAsync(2000);
      await expect(promise).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });

  describe('setJiraStatus (with fetch mock)', () => {
    let fetchMock: jest.Mock;

    beforeEach(() => {
      jest.resetModules();
      process.env.JIRA_BASE_URL = 'https://test.atlassian.net';
      process.env.JIRA_USER_EMAIL = 'test@test.com';
      process.env.JIRA_API_TOKEN = 'token';
      fetchMock = jest.fn();
      (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    });

    it('returns true when GET transitions and POST transition return ok', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ transitions: [{ id: '1', name: 'Code Review' }] }),
        })
        .mockResolvedValueOnce({ ok: true });
      const { setJiraStatus } = require('./index');
      expect(await setJiraStatus('X-1', 'Code Review')).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('returns false when credentials are missing', async () => {
      jest.resetModules();
      delete process.env.JIRA_BASE_URL;
      const { setJiraStatus } = require('./index');
      expect(await setJiraStatus('X-1', 'Code Review')).toBe(false);
    });

    it('returns false when GET transitions fails', async () => {
      fetchMock.mockResolvedValue({ ok: false, text: () => Promise.resolve('err') });
      const { setJiraStatus } = require('./index');
      expect(await setJiraStatus('X-1', 'Code Review')).toBe(false);
    });

    it('returns false when transition not found (log with names)', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ transitions: [{ id: '2', name: 'Done' }] }),
      });
      const log = jest.fn();
      const { setJiraStatus } = require('./index');
      expect(await setJiraStatus('X-1', 'Code Review', log)).toBe(false);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('Transition not found'),
        'Code Review',
        expect.any(String),
        expect.any(String)
      );
    });

    it('returns false when POST transition fails', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ transitions: [{ id: '1', name: 'Code Review' }] }),
        })
        .mockResolvedValueOnce({ ok: false, text: () => Promise.resolve('err') });
      const { setJiraStatus } = require('./index');
      expect(await setJiraStatus('X-1', 'Code Review')).toBe(false);
    });
  });
});
