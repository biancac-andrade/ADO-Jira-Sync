import type { AzureResource } from '../../types';
import { getRunId, getRunUrl, getPipelineName, getBranch } from './pipeline-payload';

describe('pipeline-payload', () => {
  describe('getRunId', () => {
    it('uses resource.id when present', () => {
      expect(getRunId({ id: 123 } as AzureResource)).toBe('123');
    });

    it('uses resource.runId when id is missing', () => {
      expect(getRunId({ runId: 456 } as AzureResource)).toBe('456');
    });

    it('uses resource.run.id when id and runId are missing', () => {
      expect(getRunId({ run: { id: 789 } } as AzureResource)).toBe('789');
    });

    it('uses resource.buildId as fallback', () => {
      expect(getRunId({ buildId: 999 } as AzureResource)).toBe('999');
    });

    it('returns string with "unknown-" prefix when nothing is present', () => {
      const result = getRunId({} as AzureResource);
      expect(result).toMatch(/^unknown-\d+$/);
    });
  });

  describe('getRunUrl', () => {
    it('returns _links.web.href when present', () => {
      expect(getRunUrl({ _links: { web: { href: 'https://dev.azure.com/run/1' } } } as AzureResource)).toBe(
        'https://dev.azure.com/run/1'
      );
    });

    it('returns resource.url when _links is missing', () => {
      expect(getRunUrl({ url: 'https://dev.azure.com/run/2' } as AzureResource)).toBe(
        'https://dev.azure.com/run/2'
      );
    });

    it('uses run._links.web.href when available', () => {
      expect(
        getRunUrl({
          run: { _links: { web: { href: 'https://dev.azure.com/run/3' } } },
        } as AzureResource)
      ).toBe('https://dev.azure.com/run/3');
    });

    it('returns undefined when no URL', () => {
      expect(getRunUrl({} as AzureResource)).toBeUndefined();
    });
  });

  describe('getPipelineName', () => {
    it('returns resource.name when it is a string', () => {
      expect(getPipelineName({ name: 'My Pipeline' } as AzureResource)).toBe('My Pipeline');
    });

    it('returns resource.pipeline.name when name is not a string', () => {
      expect(getPipelineName({ pipeline: { name: 'Other Pipeline' } } as AzureResource)).toBe(
        'Other Pipeline'
      );
    });

    it('returns undefined when no name', () => {
      expect(getPipelineName({} as AzureResource)).toBeUndefined();
    });

    it('uses run.pipeline.name (YAML / run-state-changed)', () => {
      expect(
        getPipelineName({
          run: { pipeline: { name: 'weebhooksAutomation' } },
        } as AzureResource)
      ).toBe('weebhooksAutomation');
    });
  });

  describe('getBranch', () => {
    it('strips refs/heads/ prefix from sourceBranch', () => {
      expect(getBranch({ sourceBranch: 'refs/heads/feature/JIRA-1' } as AzureResource)).toBe(
        'feature/JIRA-1'
      );
    });

    it('uses run.sourceBranch when sourceBranch is missing', () => {
      expect(getBranch({ run: { sourceBranch: 'refs/heads/main' } } as AzureResource)).toBe('main');
    });

    it('uses sourceRefName when sourceBranch is missing', () => {
      expect(getBranch({ sourceRefName: 'refs/heads/main' } as AzureResource)).toBe('main');
    });

    it('returns undefined when no branch', () => {
      expect(getBranch({} as AzureResource)).toBeUndefined();
    });

    it('uses run.resources.repositories[0].refName when sourceBranch missing', () => {
      expect(
        getBranch({
          run: {
            resources: {
              repositories: [{ refName: 'refs/heads/main' }],
            },
          },
        } as unknown as AzureResource)
      ).toBe('main');
    });
  });
});
