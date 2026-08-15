import { describe, it, expect } from 'bun:test';
import { compareVersions, newerScaffolderVersion } from './staleness.ts';

/** A `fetch` that answers with `body`, or throws when `body` is an Error. */
function fakeFetch(body: unknown, ok = true): typeof fetch {
  return (async () => {
    if (body instanceof Error) throw body;
    return { ok, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('compareVersions', () => {
  it('orders by each numeric segment', () => {
    expect(compareVersions('1.6.3', '1.6.2')).toBeGreaterThan(0);
    expect(compareVersions('1.6.2', '1.6.3')).toBeLessThan(0);
    expect(compareVersions('1.6.2', '1.6.2')).toBe(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('ignores a pre-release suffix', () => {
    expect(compareVersions('1.6.3-rc.1', '1.6.3')).toBe(0);
  });

  it('treats a missing segment as zero', () => {
    expect(compareVersions('1.6', '1.6.0')).toBe(0);
    expect(compareVersions('1.7', '1.6.9')).toBeGreaterThan(0);
  });
});

describe('newerScaffolderVersion', () => {
  it('reports the published version when it is ahead', async () => {
    const result = await newerScaffolderVersion('1.5.0', {
      fetchImpl: fakeFetch({ version: '1.6.2' }),
    });
    expect(result).toBe('1.6.2');
  });

  it('says nothing when running the current one', async () => {
    expect(
      await newerScaffolderVersion('1.6.2', { fetchImpl: fakeFetch({ version: '1.6.2' }) }),
    ).toBeNull();
  });

  it('says nothing when running ahead of the registry', async () => {
    // A monorepo run, or a version published moments ago. Not a finding.
    expect(
      await newerScaffolderVersion('1.7.0', { fetchImpl: fakeFetch({ version: '1.6.2' }) }),
    ).toBeNull();
  });

  it('says nothing when the registry cannot be reached', async () => {
    // Offline, firewalled, or slow. No answer must never stop someone creating
    // an app, so every failure resolves to null rather than throwing.
    expect(
      await newerScaffolderVersion('1.0.0', { fetchImpl: fakeFetch(new Error('offline')) }),
    ).toBeNull();
  });

  it('says nothing on a non-OK response', async () => {
    expect(
      await newerScaffolderVersion('1.0.0', { fetchImpl: fakeFetch({ version: '9.9.9' }, false) }),
    ).toBeNull();
  });

  it('says nothing when the payload has no usable version', async () => {
    expect(
      await newerScaffolderVersion('1.0.0', { fetchImpl: fakeFetch({ version: 42 }) }),
    ).toBeNull();
    expect(await newerScaffolderVersion('1.0.0', { fetchImpl: fakeFetch({}) })).toBeNull();
  });
});
