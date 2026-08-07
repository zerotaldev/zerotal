import { describe, it, expect, afterAll } from 'bun:test';
import { rm } from 'node:fs/promises';
import { scaffoldPackage, packageNames } from './PackageScaffold.ts';
import { lintPackages } from './PackageLinter.ts';

const TMP = `./.tmp-scaffold-${Date.now()}`;
afterAll(async () => { await rm(TMP, { recursive: true, force: true }).catch(() => {}); });

describe('packageNames()', () => {
  it('normalizes to kebab token + PascalCase identifier', () => {
    expect(packageNames('sms')).toEqual({ token: 'sms', pascal: 'Sms' });
    expect(packageNames('My-Thing')).toEqual({ token: 'my-thing', pascal: 'MyThing' });
    expect(packageNames('@zerotal/i18n')).toEqual({ token: 'i18n', pascal: 'I18n' });
  });
});

describe('scaffoldPackage()', () => {
  it('produces a package that passes lint:packages with zero violations', async () => {
    const files = scaffoldPackage('sms');
    for (const [rel, content] of files) await Bun.write(`${TMP}/sms/${rel}`, content);
    const reports = await lintPackages(TMP);
    const sms = reports.find((r) => r.package === '@zerotal/sms')!;
    expect(sms).toBeDefined();
    expect(sms.violations).toEqual([]);
  });
  it('includes all canonical files', () => {
    const keys = [...scaffoldPackage('billing').keys()].sort();
    expect(keys).toEqual([
      'package.json',
      'src/Billing.test.ts',
      'src/BillingManager.ts',
      'src/config.ts',
      'src/facades/Billing.ts',
      'src/index.ts',
      'src/provider/BillingProvider.ts',
    ]);
  });
});
