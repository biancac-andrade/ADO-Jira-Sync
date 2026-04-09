import type { AzureResource } from '../../types';

describe('repository-filter', () => {
  describe('getRepoName', () => {
    it('returns repository.name when present', async () => {
      const { getRepoName } = await import('./repository-filter');
      const resource: AzureResource = { repository: { name: 'meu-repo' } };
      expect(getRepoName(resource)).toBe('meu-repo');
    });

    it('returns null when repository does not exist', async () => {
      const { getRepoName } = await import('./repository-filter');
      expect(getRepoName({} as AzureResource)).toBeNull();
    });

    it('returns null when repository.name is not a string', async () => {
      const { getRepoName } = await import('./repository-filter');
      expect(getRepoName({ repository: {} } as AzureResource)).toBeNull();
    });
  });

  describe('isRepoAllowed', () => {
    const resourceWithRepo = (name: string): AzureResource =>
      ({ repository: { name } }) as AzureResource;

    it('when ALLOWED_REPOS is empty, allows any repo', async () => {
      jest.resetModules();
      process.env.ALLOWED_REPOS = '';
      const { isRepoAllowed } = await import('./repository-filter');
      expect(isRepoAllowed(resourceWithRepo('qualquer-repo'))).toBe(true);
    });

    it('when ALLOWED_REPOS is set, allows only repos in the list', async () => {
      jest.resetModules();
      process.env.ALLOWED_REPOS = 'repo-a,repo-b';
      const { isRepoAllowed } = await import('./repository-filter');
      expect(isRepoAllowed(resourceWithRepo('repo-a'))).toBe(true);
      expect(isRepoAllowed(resourceWithRepo('repo-b'))).toBe(true);
      expect(isRepoAllowed(resourceWithRepo('repo-c'))).toBe(false);
    });

    it('when ALLOWED_REPOS is set and resource has no repo, allows (fallback)', async () => {
      jest.resetModules();
      process.env.ALLOWED_REPOS = 'repo-a';
      const { isRepoAllowed } = await import('./repository-filter');
      expect(isRepoAllowed({} as AzureResource)).toBe(true);
    });
  });
});
