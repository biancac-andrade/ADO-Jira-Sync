/**
 * Testes unitários do handler do webhook: validação de request, filtro de repo, eventos e respostas.
 * Services are mocked so the handler does not call Jira or Azure.
 */

import type { InvocationContext, HttpRequest, WebhookPayload } from '../types';

jest.mock('../services/jira');
jest.mock('../services/pipeline-payload');
jest.mock('../services/deduplication');
jest.mock('../services/azure-devops');
jest.mock('../services/repository-filter');

import { webhook } from './webhook.handler';
import * as jira from '../services/jira';
import * as pipelinePayload from '../services/pipeline-payload';
import * as deduplication from '../services/deduplication';
import * as azureDevOps from '../services/azure-devops';
import * as repositoryFilter from '../services/repository-filter';

const mockJira = jest.mocked(jira);
const mockPipelinePayload = jest.mocked(pipelinePayload);
const mockDedup = jest.mocked(deduplication);
const mockAzureDevOps = jest.mocked(azureDevOps);
const mockRepoFilter = jest.mocked(repositoryFilter);

function createContext(): InvocationContext {
  const res: { status?: number; body?: Record<string, unknown> } = {};
  return {
    log: jest.fn(),
    res,
  } as unknown as InvocationContext;
}

function createRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: 'POST',
    url: '/api/webhook',
    body: {
      eventType: 'git.pullrequest.updated',
      resource: {
        title: '[BEESEDI-11] Meu PR',
        repository: { name: 'meu-repo' },
        sourceBranch: 'refs/heads/feature/BEESEDI-11',
      },
    },
    ...overrides,
  } as HttpRequest;
}

describe('webhook.handler', () => {
  let context: InvocationContext;

  beforeEach(() => {
    jest.clearAllMocks();
    context = createContext();
    delete process.env.WEBHOOK_SECRET;
    mockRepoFilter.isRepoAllowed.mockReturnValue(true);
    mockRepoFilter.getRepoName.mockReturnValue('meu-repo');
    mockJira.extractJiraKey.mockReturnValue('BEESEDI-11');
    mockJira.extractJiraKeyFromPayload.mockReturnValue(null);
    mockJira.setJiraStatus.mockImplementation(async (_key, _status, logFn) => {
      if (typeof logFn === 'function') logFn('[jira]');
      return true;
    });
    mockJira.addJiraComment.mockResolvedValue(true);
    mockJira.formatBrasilia.mockReturnValue('15/01/2024, 11:30');
    mockPipelinePayload.getRunId.mockReturnValue('run-123');
    mockPipelinePayload.getRunUrl.mockReturnValue('https://dev.azure.com/run/1');
    mockPipelinePayload.getPipelineName.mockReturnValue('CI');
    mockPipelinePayload.getBranch.mockReturnValue('main');
    mockDedup.isDuplicate.mockReturnValue(false);
    mockAzureDevOps.getJiraKeyFromBuildCommit.mockResolvedValue(null);
  });

  describe('request validation', () => {
    it('returns 401 when WEBHOOK_SECRET is set and header/query do not match', async () => {
      process.env.WEBHOOK_SECRET = 'secret123';
      const req = createRequest({ headers: {}, query: {} });
      await webhook(context, req);
      expect(context.res).toEqual({ status: 401, body: { error: 'Unauthorized' } });
    });

    it('accepts when WEBHOOK_SECRET is set and x-webhook-secret header matches', async () => {
      process.env.WEBHOOK_SECRET = 'secret123';
      const req = createRequest({
        headers: { 'x-webhook-secret': 'secret123' },
        body: {
          eventType: 'git.pullrequest.updated',
          resource: { title: '[X-1] PR', repository: { name: 'r' } },
        },
      });
      mockJira.extractJiraKey.mockReturnValue('X-1');
      await webhook(context, req);
      expect(context.res?.status).toBe(200);
      expect(mockJira.setJiraStatus).toHaveBeenCalled();
    });

    it('returns 400 when body has no resource', async () => {
      const req = createRequest({ body: { eventType: 'x' } });
      await webhook(context, req);
      expect(context.res).toEqual({
        status: 400,
        body: { error: 'Expected JSON body with resource' },
      });
    });

    it('returns 400 when resource is not an object', async () => {
      const req = createRequest({
        body: { eventType: 'x', resource: null } as unknown as WebhookPayload,
      });
      await webhook(context, req);
      expect(context.res).toEqual({
        status: 400,
        body: { error: 'Expected JSON body with resource' },
      });
    });
  });

  describe('repository filter', () => {
    it('returns 200 and skips when repository is not in ALLOWED_REPOS', async () => {
      mockRepoFilter.isRepoAllowed.mockReturnValue(false);
      mockRepoFilter.getRepoName.mockReturnValue('outro-repo');
      const req = createRequest();
      await webhook(context, req);
      expect(context.res).toEqual({
        status: 200,
        body: { message: 'Repository not in ALLOWED_REPOS, skipping' },
      });
      expect(mockJira.setJiraStatus).not.toHaveBeenCalled();
    });
  });

  describe('Jira key extraction', () => {
    it('returns 200 "No Jira key" when key not found in title or branch', async () => {
      mockJira.extractJiraKey.mockReturnValue(null);
      const req = createRequest();
      await webhook(context, req);
      expect(context.res).toEqual({
        status: 200,
        body: { message: 'No Jira key in title or branch, skipping' },
      });
      expect(mockJira.setJiraStatus).not.toHaveBeenCalled();
    });

    it('uses key from title when present', async () => {
      mockJira.extractJiraKey.mockImplementation((t) =>
        t?.includes('BEESEDI') ? 'BEESEDI-11' : null
      );
      const req = createRequest();
      await webhook(context, req);
      expect(mockJira.setJiraStatus).toHaveBeenCalledWith(
        'BEESEDI-11',
        expect.any(String),
        expect.any(Function)
      );
    });
  });

  describe('build.complete event', () => {
    it('returns 200 with message about Run state changed', async () => {
      mockJira.extractJiraKey.mockReturnValue('X-1');
      const req = createRequest({
        body: {
          eventType: 'build.complete',
          resource: { title: '[X-1] Build', repository: { name: 'r' } },
        },
      });
      await webhook(context, req);
      expect(context.res).toEqual({
        status: 200,
        body: { message: 'Pipeline comments are sent via Run state changed (real time)' },
      });
      expect(mockJira.addJiraComment).not.toHaveBeenCalled();
    });
  });

  describe('git.pullrequest.updated event', () => {
    it('calls setJiraStatus and returns 200 on success', async () => {
      const req = createRequest();
      await webhook(context, req);
      expect(mockJira.setJiraStatus).toHaveBeenCalledWith(
        'BEESEDI-11',
        'Code Review',
        expect.any(Function)
      );
      expect(context.res).toEqual({
        status: 200,
        body: { message: 'Status updated for BEESEDI-11' },
      });
      expect(context.log).toHaveBeenCalledWith(
        '[webhook] Status updated successfully for',
        'BEESEDI-11'
      );
    });

    it('returns 500 when setJiraStatus fails', async () => {
      mockJira.setJiraStatus.mockResolvedValue(false);
      const req = createRequest();
      await webhook(context, req);
      expect(context.res).toEqual({
        status: 500,
        body: { error: 'Jira transition failed' },
      });
    });
  });

  describe('ms.vss-pipelines.run-state-changed-event', () => {
    const baseResource = {
      id: 1,
      repository: { name: 'r' },
      startTime: '2024-01-15T14:30:00.000Z',
      finishTime: '2024-01-15T15:00:00.000Z',
      result: 'succeeded',
    };

    it('returns 200 "Duplicate event ignored" when isDuplicate returns true', async () => {
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue('JIRA-1');
      mockDedup.isDuplicate.mockReturnValue(true);
      const req = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: { ...baseResource, state: 'Completed' },
        },
      });
      await webhook(context, req);
      expect(context.res).toEqual({ status: 200, body: { message: 'Duplicate event ignored' } });
      expect(mockJira.addJiraComment).not.toHaveBeenCalled();
    });

    it('sends "in progress" comment and returns 200 when state is Running', async () => {
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue('JIRA-1');
      const req = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: { ...baseResource, state: 'Running' },
        },
      });
      await webhook(context, req);
      expect(mockJira.addJiraComment).toHaveBeenCalledWith(
        'JIRA-1',
        expect.stringContaining('Pipeline iniciou')
      );
      expect(mockDedup.markProcessed).toHaveBeenCalled();
      expect(context.res?.status).toBe(200);
      expect(context.res?.body).toMatchObject({
        message: expect.stringContaining('Comment added'),
      });
    });

    it('sends "completed" comment and returns 200 when state is Completed', async () => {
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue('JIRA-1');
      const req = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: { ...baseResource, state: 'Completed', result: 'succeeded' },
        },
      });
      await webhook(context, req);
      expect(mockJira.addJiraComment).toHaveBeenCalledWith(
        'JIRA-1',
        expect.stringContaining('Pipeline finalizou')
      );
      expect(mockDedup.markProcessed).toHaveBeenCalled();
      expect(context.res?.status).toBe(200);
    });

    it('returns 500 when addJiraComment fails (completed)', async () => {
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue('JIRA-1');
      mockJira.addJiraComment.mockResolvedValue(false);
      const req = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: { ...baseResource, state: 'Completed' },
        },
      });
      await webhook(context, req);
      expect(context.res).toEqual({ status: 500, body: { error: 'Jira comment failed' } });
    });

    it('returns 200 "Run state event ignored" for unmapped state', async () => {
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue('JIRA-1');
      const req = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: { ...baseResource, state: 'UnknownState' },
        },
      });
      await webhook(context, req);
      expect(context.res).toEqual({
        status: 200,
        body: { message: 'Run state event ignored', state: 'UnknownState' },
      });
      expect(mockJira.addJiraComment).not.toHaveBeenCalled();
    });
  });

  describe('unknown event', () => {
    it('returns 200 "Event ignored" for unhandled eventType', async () => {
      const req = createRequest({
        body: {
          eventType: 'outro.evento',
          resource: { title: '[X-1]', repository: { name: 'r' } },
        },
      });
      await webhook(context, req);
      expect(context.res).toEqual({
        status: 200,
        body: { message: 'Event ignored', eventType: 'outro.evento' },
      });
      expect(mockJira.setJiraStatus).not.toHaveBeenCalled();
    });
  });

  describe('getJiraKeyFromBuildCommit (main branch, no key in title/branch)', () => {
    it('uses key returned by getJiraKeyFromBuildCommit on run-state-changed on main', async () => {
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue(null);
      mockAzureDevOps.getJiraKeyFromBuildCommit.mockResolvedValue('JIRA-99');
      const req = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: {
            repository: { name: 'r' },
            sourceBranch: 'refs/heads/main',
            state: 'Completed',
            result: 'succeeded',
            id: 1,
            startTime: '2024-01-15T14:30:00.000Z',
            finishTime: '2024-01-15T15:00:00.000Z',
          },
        },
      });
      await webhook(context, req);
      expect(mockAzureDevOps.getJiraKeyFromBuildCommit).toHaveBeenCalled();
      expect(mockJira.addJiraComment).toHaveBeenCalledWith(
        'JIRA-99',
        expect.stringContaining('Pipeline finalizou')
      );
      expect(context.res?.status).toBe(200);
    });
  });
});
