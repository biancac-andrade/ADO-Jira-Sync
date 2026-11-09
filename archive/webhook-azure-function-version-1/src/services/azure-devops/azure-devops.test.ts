/**
 * Testes unitários: getJiraKeyFromBuildCommit (com fetch mock).
 */

describe('azure-devops', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    fetchMock = jest.fn();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  it('returns key extracted from comment when PAT and resource are set', async () => {
    process.env.AZURE_DEVOPS_PAT = 'pat123';
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ comment: '[X-1] fix bug' }),
    });
    const { getJiraKeyFromBuildCommit } = require('./index');
    const resource = {
      repository: { url: 'https://dev.azure.com/org/proj/_git/repo' },
      sourceVersion: 'abc123',
    };
    expect(await getJiraKeyFromBuildCommit(resource)).toBe('X-1');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/commits/abc123'),
      expect.any(Object)
    );
  });

  it('returns null when AZURE_DEVOPS_PAT is not set', async () => {
    delete process.env.AZURE_DEVOPS_PAT;
    const { getJiraKeyFromBuildCommit } = require('./index');
    const resource = {
      repository: { url: 'https://dev.azure.com/org/proj/_git/repo' },
      sourceVersion: 'abc123',
    };
    expect(await getJiraKeyFromBuildCommit(resource)).toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when repository.url is empty', async () => {
    process.env.AZURE_DEVOPS_PAT = 'pat';
    const { getJiraKeyFromBuildCommit } = require('./index');
    const resource = { repository: {}, sourceVersion: 'abc123' };
    expect(await getJiraKeyFromBuildCommit(resource)).toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when sourceVersion and lastMergeCommit.commitId are empty', async () => {
    process.env.AZURE_DEVOPS_PAT = 'pat';
    const { getJiraKeyFromBuildCommit } = require('./index');
    const resource = { repository: { url: 'https://dev.azure.com/x' } };
    expect(await getJiraKeyFromBuildCommit(resource)).toBe(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses lastMergeCommit.commitId when sourceVersion is missing', async () => {
    process.env.AZURE_DEVOPS_PAT = 'pat';
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ comment: '[Y-2] merge' }),
    });
    const { getJiraKeyFromBuildCommit } = require('./index');
    const resource = {
      repository: { url: 'https://dev.azure.com/org/proj/_git/repo' },
      lastMergeCommit: { commitId: 'merge456' },
    };
    expect(await getJiraKeyFromBuildCommit(resource)).toBe('Y-2');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/commits/merge456'),
      expect.any(Object)
    );
  });

  it('returns null when fetch does not return ok', async () => {
    process.env.AZURE_DEVOPS_PAT = 'pat';
    fetchMock.mockResolvedValue({ ok: false });
    const { getJiraKeyFromBuildCommit } = require('./index');
    const resource = {
      repository: { url: 'https://dev.azure.com/x' },
      sourceVersion: 'abc',
    };
    expect(await getJiraKeyFromBuildCommit(resource)).toBe(null);
  });

  it('returns null when fetch throws', async () => {
    process.env.AZURE_DEVOPS_PAT = 'pat';
    fetchMock.mockRejectedValue(new Error('network'));
    const { getJiraKeyFromBuildCommit } = require('./index');
    const resource = {
      repository: { url: 'https://dev.azure.com/x' },
      sourceVersion: 'abc',
    };
    expect(await getJiraKeyFromBuildCommit(resource)).toBe(null);
  });
});
