import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { rm } from 'node:fs/promises';
import { lintPackages, countViolations } from './PackageLinter.ts';

const TMP = `./.tmp-lint-${Date.now()}`;

beforeAll(async () => {
  await Bun.write(`${TMP}/good/package.json`, JSON.stringify({
    name: '@zerotal/good', type: 'module', main: './src/index.ts',
    exports: { '.': './src/index.ts' }, dependencies: { '@zerotal/core': 'workspace:*' },
  }));
  await Bun.write(`${TMP}/good/src/index.ts`, `export const x = 1;`);
  await Bun.write(`${TMP}/good/src/config.ts`,
    `import { deepMerge } from '@zerotal/core';\n` +
    `export interface GoodConfigShape { a: number }\n` +
    `const defaults: GoodConfigShape = { a: 1 };\n` +
    `export function GoodConfig(options: Partial<GoodConfigShape> = {}): GoodConfigShape { return deepMerge(defaults, options); }`);
  await Bun.write(`${TMP}/good/src/provider/GoodProvider.ts`,
    `export class GoodProvider { static provides = ['good'] as const; static environments = ['web']; }`);
  await Bun.write(`${TMP}/good/src/good.test.ts`, `import { it, expect } from 'bun:test'; it('ok', () => expect(1).toBe(1));`);

  await Bun.write(`${TMP}/bad/package.json`, JSON.stringify({ name: '@zerotal/bad' }));
  await Bun.write(`${TMP}/bad/src/index.ts`, `export class Boom extends Error {}`);
  await Bun.write(`${TMP}/bad/src/BadProvider.ts`, `export class BadProvider { reg() { (this as any).app.container.singleton('bad', () => ({})); } }`);
  await Bun.write(`${TMP}/bad/src/config.ts`,
    `export interface BadConfigShape { a: number }\n` +
    `export function badConfig(options: BadConfigShape): BadConfigShape { return options; }`);
});

afterAll(async () => { await rm(TMP, { recursive: true, force: true }).catch(() => {}); });

describe('lintPackages()', () => {
  it('passes a fully conformant package', async () => {
    const reports = await lintPackages(TMP);
    const good = reports.find((r) => r.package === '@zerotal/good')!;
    expect(good).toBeDefined();
    expect(good.violations).toHaveLength(0);
  });

  it('flags every rule a non-conformant package breaks', async () => {
    const reports = await lintPackages(TMP);
    const bad = reports.find((r) => r.package === '@zerotal/bad')!;
    const rules = new Set(bad.violations.map((v) => v.rule));
    for (const expected of ['provider-location','provider-provides','provider-environments','config-casing','config-partial','tests','esm','exports','error-base']) {
      expect(rules.has(expected)).toBe(true);
    }
  });

  it('catches a camelCase config factory written with a generic param', async () => {
    await Bun.write(`${TMP}/gen/package.json`, JSON.stringify({ name: '@zerotal/gen', type: 'module', exports: { '.': './src/index.ts' } }));
    await Bun.write(`${TMP}/gen/src/index.ts`, `export const x = 1;`);
    await Bun.write(`${TMP}/gen/src/gen.test.ts`, `import { it, expect } from 'bun:test'; it('x', () => expect(1).toBe(1));`);
    await Bun.write(`${TMP}/gen/src/config.ts`,
      `export interface GenConfigShape { a: number }\n` +
      `export function genConfig<T extends GenConfigShape>(config: T): T { return config; }`);
    const reports = await lintPackages(TMP);
    const gen = reports.find((r) => r.package === '@zerotal/gen')!;
    const rules = new Set(gen.violations.map((v) => v.rule));
    expect(rules.has('config-casing')).toBe(true);
    expect(rules.has('config-partial')).toBe(true);
  });

  it('countViolations sums across packages', async () => {
    const reports = await lintPackages(TMP);
    expect(countViolations(reports)).toBeGreaterThan(0);
  });
});
