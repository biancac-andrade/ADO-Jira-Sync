import type { InvocationContext, HttpRequest, WebhookPayload } from '../types';

jest.mock('../services/jira/jira');
jest.mock('../services/pipeline-payload/pipeline-payload');
jest.mock('../services/deduplication/deduplication');
jest.mock('../services/azure-devops/azure-devops');
jest.mock('../services/repository-filter/repository-filter');

import { webhook } from './webhook.handler';
import * as jira from '../services/jira/jira';
import * as pipelinePayload from '../services/pipeline-payload/pipeline-payload';
import * as deduplication from '../services/deduplication/deduplication';
import * as azureDevOps from '../services/azure-devops/azure-devops';
import * as repositoryFilter from '../services/repository-filter/repository-filter';

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
      eventType: 'git.pullrequest.created',
      resource: {
        title: '[BEESEDI-11] Meu PR',
        repository: { name: 'meu-repo' },
        sourceBranch: 'refs/heads/feature/BEESEDI-11',
        status: 'active',
        isDraft: false,
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
    process.env.FINAL_PIPELINE_TRANSITION_ENABLED = 'false';
    process.env.JIRA_STATUS_CODE_REVIEW = 'Code Review';
    mockRepoFilter.isRepoAllowed.mockReturnValue(true);
    mockRepoFilter.getRepoName.mockReturnValue('meu-repo');
    mockJira.extractJiraKey.mockReturnValue('BEESEDI-11');
    mockJira.extractJiraKeyFromPayload.mockReturnValue(null);
    mockJira.setJiraStatus.mockImplementation(async (_key, _status, logFn) => {
      if (typeof logFn === 'function') logFn('[jira]');
      return true;
    });
    mockJira.addJiraComment.mockResolvedValue(true);
    mockJira.clearIssueFields = jest.fn().mockResolvedValue(true);
    mockJira.formatBrasilia.mockReturnValue('15/01/2024, 11:30');
    delete process.env.JIRA_FIELDS_CLEAR_ON_REWORK;
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
          eventType: 'git.pullrequest.created',
          resource: {
            title: '[X-1] PR',
            repository: { name: 'r' },
            status: 'active',
            isDraft: false,
          },
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
        'Code Review',
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

  describe('git.pullrequest events', () => {
    it('created: calls setJiraStatus (Ready / legacy Code Review) and returns 200', async () => {
      const req = createRequest();
      await webhook(context, req);
      expect(mockJira.setJiraStatus).toHaveBeenCalledWith(
        'BEESEDI-11',
        'Code Review',
        expect.any(Function)
      );
      expect(context.res?.status).toBe(200);
      expect(context.res?.body).toMatchObject({
        jiraKey: 'BEESEDI-11',
        message: expect.stringContaining('Transition:'),
      });
    });

    it('updated sem sinais: skip (200, sem transição)', async () => {
      const req = createRequest({
        body: {
          eventType: 'git.pullrequest.updated',
          resource: {
            title: '[BEESEDI-11] Meu PR',
            repository: { name: 'meu-repo' },
            sourceBranch: 'refs/heads/feature/BEESEDI-11',
            status: 'active',
            isDraft: false,
            reviewers: [],
          },
        },
      });
      await webhook(context, req);
      expect(mockJira.setJiraStatus).not.toHaveBeenCalled();
      expect(context.res?.status).toBe(200);
      expect(String((context.res?.body as { message?: string })?.message)).toContain('sem merge');
    });

    it('updated completed: skip (Ready to Merge Main só na pipeline)', async () => {
      const req = createRequest({
        body: {
          eventType: 'git.pullrequest.updated',
          resource: {
            title: '[BEESEDI-11] Meu PR',
            repository: { name: 'meu-repo' },
            status: 'completed',
            isDraft: false,
          },
        },
      });
      await webhook(context, req);
      expect(mockJira.setJiraStatus).not.toHaveBeenCalled();
      expect(context.res?.status).toBe(200);
      expect(String((context.res?.body as { message?: string })?.message)).toContain('pipeline');
    });

    it('updated rework: limpa campos Jira quando JIRA_FIELDS_CLEAR_ON_REWORK está definido', async () => {
      process.env.JIRA_FIELDS_CLEAR_ON_REWORK = 'customfield_10001,customfield_10002';
      const req = createRequest({
        body: {
          eventType: 'git.pullrequest.updated',
          resource: {
            title: '[BEESEDI-11] Meu PR',
            repository: { name: 'meu-repo' },
            status: 'active',
            isDraft: false,
            reviewers: [{ id: 'rev-1', vote: -10 }],
          },
        },
      });
      await webhook(context, req);
      expect(mockJira.clearIssueFields).toHaveBeenCalledWith(
        'BEESEDI-11',
        ['customfield_10001', 'customfield_10002'],
        expect.any(Function)
      );
    });

    it('returns 500 when setJiraStatus fails (created)', async () => {
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

    it('Running: não envia comentário no Jira (só ao completar)', async () => {
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue('JIRA-1');
      const req = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: { ...baseResource, state: 'Running' },
        },
      });
      await webhook(context, req);
      expect(mockJira.addJiraComment).not.toHaveBeenCalled();
      expect(mockDedup.markProcessed).toHaveBeenCalled();
      expect(context.res?.status).toBe(200);
    });

    it('Completed: um bloco com Horário início, fim e resultado', async () => {
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue('JIRA-1');
      const req = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: { ...baseResource, state: 'Completed', result: 'succeeded' },
        },
      });
      await webhook(context, req);
      expect(mockJira.addJiraComment).toHaveBeenCalledTimes(1);
      expect(mockJira.addJiraComment).toHaveBeenCalledWith(
        'JIRA-1',
        expect.stringMatching(/Pipeline \(Azure DevOps\)[\s\S]*Horário início:[\s\S]*Horário fim:/)
      );
      expect(mockDedup.markProcessed).toHaveBeenCalled();
      expect(context.res?.status).toBe(200);
    });

    it('Running então Completed: só um comentário no fim', async () => {
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue('JIRA-1');
      const reqRunning = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: { ...baseResource, state: 'Running' },
        },
      });
      await webhook(context, reqRunning);
      expect(mockJira.addJiraComment).not.toHaveBeenCalled();
      const reqDone = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: { ...baseResource, state: 'Completed', result: 'succeeded' },
        },
      });
      await webhook(context, reqDone);
      expect(mockJira.addJiraComment).toHaveBeenCalledWith(
        'JIRA-1',
        expect.stringMatching(/Horário início:[\s\S]*Horário fim:/)
      );
    });

    it('returns 500 when addJiraComment fails e transição final desligada', async () => {
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
      expect(context.res).toEqual({
        status: 500,
        body: { error: 'Jira comment failed' },
      });
    });

    it('Ready to Merge Main: comentário falhou → 500 e não transiciona', async () => {
      process.env.FINAL_PIPELINE_TRANSITION_ENABLED = 'true';
      process.env.JIRA_STATUS_READY_MERGE_MAIN = 'Ready to Merge Main';
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue('JIRA-1');
      mockJira.addJiraComment.mockResolvedValue(false);
      mockJira.setJiraStatus.mockResolvedValue(true);
      const req = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: {
            ...baseResource,
            state: 'Completed',
            result: 'succeeded',
            sourceBranch: 'refs/heads/main',
          },
        },
      });
      await webhook(context, req);
      expect(mockJira.setJiraStatus).not.toHaveBeenCalled();
      expect(context.res?.status).toBe(500);
      expect(context.res?.body).toMatchObject({
        error: expect.stringContaining('Ready to Merge Main'),
      });
    });

    it('Ready to Merge Main: comentário ok → transição + 200', async () => {
      process.env.FINAL_PIPELINE_TRANSITION_ENABLED = 'true';
      process.env.JIRA_STATUS_READY_MERGE_MAIN = 'Ready to Merge Main';
      mockJira.extractJiraKey.mockReturnValue(null);
      mockJira.extractJiraKeyFromPayload.mockReturnValue('JIRA-1');
      mockJira.addJiraComment.mockResolvedValue(true);
      mockJira.setJiraStatus.mockResolvedValue(true);
      const req = createRequest({
        body: {
          eventType: 'ms.vss-pipelines.run-state-changed-event',
          resource: {
            ...baseResource,
            state: 'Completed',
            result: 'succeeded',
            sourceBranch: 'refs/heads/main',
          },
        },
      });
      await webhook(context, req);
      expect(mockJira.setJiraStatus).toHaveBeenCalledWith(
        'JIRA-1',
        'Ready to Merge Main',
        expect.any(Function)
      );
      expect(context.res?.status).toBe(200);
      expect(context.res?.body).toMatchObject({
        message: expect.stringContaining('Ready to Merge Main'),
      });
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
        expect.stringContaining('Horário início')
      );
      expect(context.res?.status).toBe(200);
    });
  });
});
