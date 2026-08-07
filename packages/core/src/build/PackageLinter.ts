/**
 * Lints monorepo packages against the framework's conventions — provider
 * location and metadata, config-factory shape, test presence, packaging, and
 * error-base discipline — producing a structured report of violations.
 */

/** How serious a lint violation is. */
export type Severity = 'high' | 'medium' | 'low';

/** A single rule violation found in a package. */
export interface Violation { rule: string; message: string; severity: Severity; }
/** The full set of violations found in one package. */
export interface PackageReport { package: string; violations: Violation[]; }

interface PackageFiles {
  source: Map<string, string>;
  packageJson: Record<string, unknown> | null;
  packageJsonRaw: string | null;
}

async function _readPackage(absoluteDir: string): Promise<PackageFiles> {
  const source = new Map<string, string>();
  try {
    const glob = new Bun.Glob('src/**/*.{ts,tsx}');
    for await (const relativePath of glob.scan({ cwd: absoluteDir, onlyFiles: true })) {
      try { source.set(relativePath.replace(/\\/g, '/'), await Bun.file(`${absoluteDir}/${relativePath}`).text()); } catch {}
    }
  } catch {}
  let packageJson: Record<string, unknown> | null = null;
  let packageJsonRaw: string | null = null;
  try {
    packageJsonRaw = await Bun.file(`${absoluteDir}/package.json`).text();
    packageJson = JSON.parse(packageJsonRaw) as Record<string, unknown>;
  } catch {}
  return { source, packageJson, packageJsonRaw };
}

function _isProviderPath(relativePath: string): boolean { return /Provider\.tsx?$/.test(relativePath); }

function _checkProviderLocation(files: PackageFiles): Violation[] {
  const providers = [...files.source.keys()].filter(_isProviderPath);
  if (providers.length === 0) return [];
  const violations: Violation[] = [];
  for (const path of providers) if (!path.startsWith('src/provider/')) violations.push({ rule: 'provider-location', severity: 'high', message: `provider '${path}' must live at src/provider/` });
  return violations;
}

function _checkProviderMetadata(files: PackageFiles): Violation[] {
  const providers = [...files.source.entries()].filter(([path]) => _isProviderPath(path));
  if (providers.length === 0) return [];
  const violations: Violation[] = [];
  for (const [path, content] of providers) {
    const registersBinding = /container\.(singleton|value|bind)\s*\(/.test(content);
    if (registersBinding && !/static\s+(override\s+)?provides\b/.test(content)) violations.push({ rule: 'provider-provides', severity: 'medium', message: `${path}: registers a binding but is missing 'static provides'` });
    if (!/static\s+(override\s+)?environments\b/.test(content)) violations.push({ rule: 'provider-environments', severity: 'medium', message: `${path}: missing 'static environments'` });
  }
  return violations;
}

function _checkConfigFactory(files: PackageFiles): Violation[] {
  const config = files.source.get('src/config.ts');
  if (!config) return [];
  const violations: Violation[] = [];
  const match =
    config.match(/export\s+function\s+([A-Za-z_]\w*)Config\s*(?:<[^>]*>)?\s*\(([^)]*)\)/) ??
    config.match(/export\s+const\s+([A-Za-z_]\w*)Config\s*=\s*(?:<[^>]*>)?\s*\(([^)]*)\)/);
  if (!match) { violations.push({ rule: 'config-factory', severity: 'medium', message: `src/config.ts: no '<Name>Config(...)' factory found` }); return violations; }
  const [, namePrefix, params] = match;
  const factoryName = `${namePrefix}Config`;
  if (!/^[A-Z]/.test(factoryName)) violations.push({ rule: 'config-casing', severity: 'high', message: `config factory '${factoryName}' must be PascalCase` });
  if (!/Partial\s*</.test(params ?? '')) violations.push({ rule: 'config-partial', severity: 'high', message: `config factory '${factoryName}' parameter must be Partial<...Shape>` });
  return violations;
}

function _checkConfigDeepMerge(files: PackageFiles): Violation[] {
  const config = files.source.get('src/config.ts');
  if (!config) return [];
  // Only applies when the file actually defines a <Name>Config factory.
  const hasFactory =
    /export\s+function\s+[A-Za-z_]\w*Config\s*(?:<[^>]*>)?\s*\(/.test(config) ||
    /export\s+const\s+[A-Za-z_]\w*Config\s*=/.test(config);
  if (!hasFactory) return [];
  if (!/\bdeepMerge\s*\(/.test(config))
    return [{ rule: 'config-deepmerge', severity: 'medium', message: `src/config.ts: the config factory must merge with deepMerge(defaults, options)` }];
  return [];
}

function _checkTests(files: PackageFiles): Violation[] {
  const hasTest = [...files.source.keys()].some((path) => /\.test\.tsx?$/.test(path));
  return hasTest ? [] : [{ rule: 'tests', severity: 'high', message: 'package ships no *.test.ts(x) files' }];
}

function _checkPackaging(files: PackageFiles): Violation[] {
  const packageJson = files.packageJson;
  if (!packageJson) return [{ rule: 'package-json', severity: 'high', message: 'missing or invalid package.json' }];
  const violations: Violation[] = [];
  if (packageJson['type'] !== 'module') violations.push({ rule: 'esm', severity: 'medium', message: `package.json "type" must be "module"` });
  if (!packageJson['exports'] && !packageJson['main'] && !packageJson['bin']) violations.push({ rule: 'exports', severity: 'medium', message: 'package.json must define "exports" or "main"' });
  return violations;
}

function _checkErrorDiscipline(files: PackageFiles, packageName: string): Violation[] {
  const violations: Violation[] = [];
  for (const [path, content] of files.source) {
    if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) continue;
    if (packageName === '@zerotal/core' && path.endsWith('errors/ZerotalError.ts')) continue;
    // Client-bundle code can't import the server-only ZerotalError; it defines its
    // own native-Error base (e.g. FlowClientError) for the CSP-safe runtime.
    if (/(^|\/)client\//.test(path)) continue;
    if (/\bclass\s+\w+\s+extends\s+Error\b/.test(content)) violations.push({ rule: 'error-base', severity: 'medium', message: `${path}: error classes must extend ZerotalError, not Error` });
  }
  return violations;
}

/** Lint every package under `packagesDir` and return a report per package. */
export async function lintPackages(packagesDir: string): Promise<PackageReport[]> {
  const reports: PackageReport[] = [];
  let entries: string[];
  try {
    const glob = new Bun.Glob('*/package.json');
    entries = [];
    for await (const relativePath of glob.scan({ cwd: packagesDir, onlyFiles: true })) entries.push(relativePath.replace(/\\/g, '/').split('/')[0]!);
  } catch { return reports; }
  entries.sort();
  for (const dir of entries) {
    const absoluteDir = `${packagesDir}/${dir}`;
    const files = await _readPackage(absoluteDir);
    const packageName = (files.packageJson?.['name'] as string | undefined) ?? `@zerotal/${dir}`;
    const violations: Violation[] = [
      ..._checkProviderLocation(files),
      ..._checkProviderMetadata(files),
      ..._checkConfigFactory(files),
      ..._checkConfigDeepMerge(files),
      ..._checkTests(files),
      ..._checkPackaging(files),
      ..._checkErrorDiscipline(files, packageName),
    ];
    reports.push({ package: packageName, violations });
  }
  return reports;
}

/** Total the violation count across all package reports. */
export function countViolations(reports: PackageReport[]): number {
  return reports.reduce((total, report) => total + report.violations.length, 0);
}
