/**
 * Generates the source files for a new `@zerotal/*` package — its package.json,
 * config factory, manager, service provider, facade, and a starter test — ready
 * to write to disk.
 */

/**
 * Normalise a raw package name into its kebab-case `token` (without the
 * `@zerotal/` scope) and its PascalCase form.
 */
export function packageNames(rawName: string): { token: string; pascal: string } {
  const token = rawName.trim().toLowerCase().replace(/^@zerotal\//, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const pascal = token.split('-').filter(Boolean).map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join('');
  return { token, pascal };
}

/** Build the file map (path → contents) for a new package named `rawName`. */
export function scaffoldPackage(rawName: string): Map<string, string> {
  const { token, pascal } = packageNames(rawName);
  const files = new Map<string, string>();

  files.set('package.json', JSON.stringify({
    name: `@zerotal/${token}`,
    version: '0.0.1',
    private: false,
    type: 'module',
    main: './src/index.ts',
    types: './src/index.ts',
    exports: { '.': './src/index.ts' },
    scripts: {
      build: 'bun build ./src/index.ts --outdir ./dist --target bun --format esm',
      test: 'bun test',
      typecheck: 'tsc --noEmit',
    },
    dependencies: { '@zerotal/core': 'workspace:*' },
    devDependencies: { typescript: '*' },
  }, null, 2) + '\n');

  files.set('src/index.ts',
`// @zerotal/${token} — public API barrel
export { ${pascal}Provider } from './provider/${pascal}Provider.ts';
export { ${pascal} } from './facades/${pascal}.ts';
export { ${pascal}Manager } from './${pascal}Manager.ts';
export { ${pascal}Config } from './config.ts';
export type { ${pascal}ConfigShape } from './config.ts';
`);

  files.set('src/config.ts',
`import { deepMerge } from '@zerotal/core';

export interface ${pascal}ConfigShape {
  /** Example option — replace with your package's real config. */
  enabled: boolean;
}

const defaults: ${pascal}ConfigShape = {
  enabled: true,
};

export function ${pascal}Config(options: Partial<${pascal}ConfigShape> = {}): ${pascal}ConfigShape {
  return deepMerge(defaults, options);
}
`);

  files.set(`src/${pascal}Manager.ts`,
`import type { ${pascal}ConfigShape } from './config.ts';

export class ${pascal}Manager {
  constructor(private readonly config: ${pascal}ConfigShape) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }
}
`);

  files.set(`src/provider/${pascal}Provider.ts`,
`import { ServiceProvider } from '@zerotal/core';
import type { AppEnvironment, ConfigManager } from '@zerotal/core';
import { ${pascal}Manager } from '../${pascal}Manager.ts';
import { ${pascal}Config, type ${pascal}ConfigShape } from '../config.ts';

declare module '@zerotal/core' {
  interface ContainerBindings {
    '${token}': ${pascal}Manager;
  }
}

export class ${pascal}Provider extends ServiceProvider {
  static override provides = ['${token}'] as const;
  static override environments: AppEnvironment[] = ['web', 'console', 'test', 'repl'];

  override onRegister(): void {
    this.app.container.singleton('${token}', () => {
      const config = this.app.container.makeSync('config') as ConfigManager;
      const options = config.get<Partial<${pascal}ConfigShape>>('${token}', {});
      return new ${pascal}Manager(${pascal}Config(options));
    });
  }

  override async onBooted(): Promise<void> {
    await this.app.container.make('${token}');
  }
}
`);

  files.set(`src/facades/${pascal}.ts`,
`import { createFacade } from '@zerotal/core';

export const ${pascal} = createFacade('${token}');
`);

  files.set(`src/${pascal}.test.ts`,
`import { describe, it, expect } from 'bun:test';
import { ${pascal}Manager } from './${pascal}Manager.ts';
import { ${pascal}Config } from './config.ts';

describe('${pascal}Manager', () => {
  it('reflects its config', () => {
    expect(new ${pascal}Manager(${pascal}Config()).isEnabled()).toBe(true);
    expect(new ${pascal}Manager(${pascal}Config({ enabled: false })).isEnabled()).toBe(false);
  });
});
`);

  return files;
}
