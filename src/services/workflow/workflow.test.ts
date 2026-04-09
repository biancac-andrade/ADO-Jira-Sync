import type { AzureResource } from '../../types';
import {
  decidePullRequestEvent,
  decideGitPush,
  shouldTransitionOnPipelineSuccess,
  loadWorkflowEnv,
  collectPrReviewers,
  getPrLifecycleState,
  getPrObject,
} from './workflow';

describe('workflow', () => {
  beforeEach(() => {
    process.env.JIRA_STATUS_CODE_REVIEW = 'Code Review';
    process.env.AZURE_DEVOPS_IGNORE_REVIEWER_IDS = '';
    process.env.FINAL_PIPELINE_NAMES = '';
    process.env.FINAL_PIPELINE_TRANSITION_ENABLED = 'true';
    delete process.env.WORKFLOW_REWORK_VOTE_MAX;
    delete process.env.WORKFLOW_APPROVE_VOTE_MIN;
  });

  describe('decidePullRequestEvent', () => {
    it('created ativa → Ready in Code Review (ou legacy)', () => {
      const r = {
        title: '[X-1] PR',
        status: 'active',
        isDraft: false,
      } as AzureResource;
      const d = decidePullRequestEvent('git.pullrequest.created', r, loadWorkflowEnv());
      expect(d).toMatchObject({ kind: 'transition', statusName: 'Code Review' });
    });

    it('created draft → In Development', () => {
      const r = { title: '[X-1] PR', status: 'active', isDraft: true } as AzureResource;
      const d = decidePullRequestEvent('git.pullrequest.created', r, loadWorkflowEnv());
      expect(d).toMatchObject({ kind: 'transition', statusName: 'In Development' });
    });

    it('created já com revisor → Code in Review', () => {
      const r = {
        title: '[X-1] PR',
        status: 'active',
        isDraft: false,
        reviewers: [{ id: 'human-1', vote: 0 }],
      } as AzureResource;
      const d = decidePullRequestEvent('git.pullrequest.created', r, loadWorkflowEnv());
      expect(d).toMatchObject({
        kind: 'transition',
        statusName: 'Code Review',
        reason: expect.stringContaining('revisor'),
      });
    });

    it('status completed (PR mergeada) → skip (Ready to Merge Main só via pipeline)', () => {
      const rStr = { title: '[X-1] PR', status: 'completed', isDraft: false } as AzureResource;
      const rNum = { title: '[X-1] PR', status: 3, isDraft: false } as unknown as AzureResource;
      const skip = { kind: 'skip' as const, reason: expect.stringContaining('pipeline') };
      expect(decidePullRequestEvent('git.pullrequest.updated', rStr, loadWorkflowEnv())).toMatchObject(
        skip
      );
      expect(decidePullRequestEvent('git.pullrequest.updated', rNum, loadWorkflowEnv())).toMatchObject(
        skip
      );
      expect(decidePullRequestEvent('git.pullrequest.merged', rStr, loadWorkflowEnv())).toMatchObject(
        skip
      );
    });

    it('getPrLifecycleState: merged event e enum numérico', () => {
      expect(getPrLifecycleState('git.pullrequest.merged', {})).toBe('completed');
      expect(getPrLifecycleState('git.pullrequest.updated', { status: 2 })).toBe('abandoned');
      expect(getPrLifecycleState('git.pullrequest.updated', { status: 3 })).toBe('completed');
    });

    it('updated com voto -10 → In Development + clearReviewerFields', () => {
      const r = {
        title: '[X-1] PR',
        status: 'active',
        isDraft: false,
        reviewers: [{ id: 'a', vote: -10 }],
      } as AzureResource;
      const d = decidePullRequestEvent('git.pullrequest.updated', r, loadWorkflowEnv());
      expect(d).toMatchObject({
        kind: 'transition',
        statusName: 'In Development',
        clearReviewerFields: true,
      });
    });

    it('revisores em pullRequest aninhado são lidos', () => {
      const r = {
        pullRequest: {
          title: '[X-1] PR',
          status: 'active',
          isDraft: false,
          reviewers: [{ id: 'b', vote: -10 }],
        },
      } as unknown as AzureResource;
      expect(collectPrReviewers(r)).toHaveLength(1);
      const d = decidePullRequestEvent('git.pullrequest.updated', r, loadWorkflowEnv());
      expect(d).toMatchObject({ kind: 'transition', clearReviewerFields: true });
    });

    it('status completed na raiz com pullRequest sem status → skip', () => {
      const r = {
        title: '[X-1] PR',
        status: 'completed',
        isDraft: false,
        pullRequest: {
          reviewers: [],
        },
      } as unknown as AzureResource;
      expect(getPrObject(r).status).toBe('completed');
      expect(decidePullRequestEvent('git.pullrequest.updated', r, loadWorkflowEnv())).toMatchObject({
        kind: 'skip',
      });
    });

    it('status na raiz (completed) prevalece sobre pullRequest interno ainda active → skip', () => {
      const r = {
        title: '[X-1] PR',
        status: 3,
        isDraft: false,
        pullRequest: {
          status: 1,
          reviewers: [],
        },
      } as unknown as AzureResource;
      expect(getPrObject(r).status).toBe(3);
      expect(decidePullRequestEvent('git.pullrequest.updated', r, loadWorkflowEnv())).toMatchObject({
        kind: 'skip',
      });
    });

    it('WORKFLOW_REWORK_VOTE_MAX altera limiar de rework', () => {
      process.env.WORKFLOW_REWORK_VOTE_MAX = '0';
      const r = {
        title: '[X-1] PR',
        status: 'active',
        isDraft: false,
        reviewers: [{ id: 'a', vote: 0 }],
      } as AzureResource;
      const d = decidePullRequestEvent('git.pullrequest.updated', r, loadWorkflowEnv());
      expect(d).toMatchObject({ kind: 'transition', statusName: 'In Development' });
      delete process.env.WORKFLOW_REWORK_VOTE_MAX;
    });

    it('updated com aprovação humana (10) → Code in Review', () => {
      const r = {
        title: '[X-1] PR',
        status: 'active',
        isDraft: false,
        reviewers: [{ id: 'human-1', vote: 10 }],
      } as AzureResource;
      const d = decidePullRequestEvent('git.pullrequest.updated', r, loadWorkflowEnv());
      expect(d).toMatchObject({ kind: 'transition', statusName: 'Code Review' });
    });

    it('updated com revisor atribuído (voto 0) → Code in Review', () => {
      const r = {
        title: '[X-1] PR',
        status: 'active',
        isDraft: false,
        reviewers: [{ id: 'human-1', vote: 0 }],
      } as AzureResource;
      const d = decidePullRequestEvent('git.pullrequest.updated', r, loadWorkflowEnv());
      expect(d).toMatchObject({
        kind: 'transition',
        statusName: 'Code Review',
        reason: 'Revisor atribuído (required/optional)',
      });
    });

    it('updated: revisores só em pullRequest aninhado + status ativo no nested → Code in Review', () => {
      const r = {
        title: '[X-1] PR',
        status: 'active',
        isDraft: false,
        pullRequest: {
          status: 1,
          reviewers: [{ id: 'human-1', vote: 0 }],
        },
      } as unknown as AzureResource;
      const d = decidePullRequestEvent('git.pullrequest.updated', r, loadWorkflowEnv());
      expect(d).toMatchObject({
        kind: 'transition',
        statusName: 'Code Review',
        reason: 'Revisor atribuído (required/optional)',
      });
    });

    it('updated só revisores ignorados → skip', () => {
      process.env.AZURE_DEVOPS_IGNORE_REVIEWER_IDS = 'auto-group-id';
      const r = {
        title: '[X-1] PR',
        status: 'active',
        isDraft: false,
        reviewers: [{ id: 'auto-group-id', vote: 0 }],
      } as AzureResource;
      const d = decidePullRequestEvent('git.pullrequest.updated', r, loadWorkflowEnv());
      expect(d.kind).toBe('skip');
      delete process.env.AZURE_DEVOPS_IGNORE_REVIEWER_IDS;
    });

  });

  describe('decideGitPush', () => {
    it('novo branch → In Development', () => {
      const r = {
        refUpdates: [
          {
            name: 'refs/heads/feature/PROJ-99-x',
            oldObjectId: '0000000000000000000000000000000000000000',
            newObjectId: 'abcd',
          },
        ],
      } as unknown as AzureResource;
      const d = decideGitPush(r, loadWorkflowEnv());
      expect(d).toMatchObject({ kind: 'transition', statusName: 'In Development' });
    });

    it('push sem novo branch → skip', () => {
      const r = {
        refUpdates: [
          {
            name: 'refs/heads/feature/PROJ-99-x',
            oldObjectId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            newObjectId: 'bbbb',
          },
        ],
      } as unknown as AzureResource;
      const d = decideGitPush(r, loadWorkflowEnv());
      expect(d.kind).toBe('skip');
    });
  });

  describe('shouldTransitionOnPipelineSuccess', () => {
    it('main + succeeded + sem filtro de nome → true', () => {
      const ok = shouldTransitionOnPipelineSuccess(
        {} as AzureResource,
        'succeeded',
        'main',
        'Deploy',
        loadWorkflowEnv()
      );
      expect(ok).toBe(true);
    });

    it('feature branch → false', () => {
      const ok = shouldTransitionOnPipelineSuccess(
        {} as AzureResource,
        'succeeded',
        'feature/x',
        'CI',
        loadWorkflowEnv()
      );
      expect(ok).toBe(false);
    });

    it('branch vazio + ALLOW_EMPTY_BRANCH + FINAL_PIPELINE_NAMES → true', () => {
      process.env.FINAL_PIPELINE_ALLOW_EMPTY_BRANCH = 'true';
      process.env.FINAL_PIPELINE_NAMES = 'ci-pipeline';
      const ok = shouldTransitionOnPipelineSuccess(
        {} as AzureResource,
        'succeeded',
        '',
        'CI-Pipeline',
        loadWorkflowEnv()
      );
      expect(ok).toBe(true);
      delete process.env.FINAL_PIPELINE_ALLOW_EMPTY_BRANCH;
      process.env.FINAL_PIPELINE_NAMES = '';
    });
  });
});
