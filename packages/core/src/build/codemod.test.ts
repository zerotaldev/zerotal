import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rm } from 'node:fs/promises';
import { addImport, addToDefaultArrayExport, registerProvider } from './codemod.ts';

const BOOT = `import { AppProvider } from "../app/providers/AppProvider.ts";
import { DatabaseProvider } from "@zerotal/orm";

export default [
  AppProvider,
  DatabaseProvider,
];
`;

describe('addImport', () => {
  it('inserts after the last import and dedupes', () => {
    const out = addImport(BOOT, 'import { X } from "./x.ts";');
    expect(out).toContain('import { X } from "./x.ts";');
    expect(out.indexOf('import { X }')).toBeGreaterThan(out.indexOf('@zerotal/orm'));
    expect(addImport(out, 'import { X } from "./x.ts";')).toBe(out); // idempotent
  });
});

describe('addToDefaultArrayExport', () => {
  it('appends preserving indentation, idempotently', () => {
    const out = addToDefaultArrayExport(BOOT, 'FooProvider');
    expect(out).toMatch(/  DatabaseProvider,\n  FooProvider,\n\];/);
    expect(addToDefaultArrayExport(out, 'FooProvider')).toBe(out);
  });
});

describe('registerProvider', () => {
  const TMP = `./.tmp-boot-${Date.now()}`;
  const path = `${TMP}/providers.ts`;
  beforeEach(() => Bun.write(path, BOOT));
  afterEach(() => rm(TMP, { recursive: true, force: true }).catch(() => {}));

  it('adds the import + array entry and is idempotent', async () => {
    expect(await registerProvider({ className: 'FooProvider', importPath: '../app/providers/FooProvider.ts', bootstrapPath: path })).toBe('added');
    const src = await Bun.file(path).text();
    expect(src).toContain('import { FooProvider } from "../app/providers/FooProvider.ts";');
    expect(src).toMatch(/  FooProvider,\n\];/);
    expect(await registerProvider({ className: 'FooProvider', importPath: '../app/providers/FooProvider.ts', bootstrapPath: path })).toBe('exists');
  });

  it('reports missing when there is no bootstrap file', async () => {
    expect(await registerProvider({ className: 'X', importPath: './x.ts', bootstrapPath: './nope/providers.ts' })).toBe('missing');
  });
});
