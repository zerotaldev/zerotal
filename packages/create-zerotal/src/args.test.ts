// The scaffolder could not be scripted, and the failure mode was the bad one.
//
// It read `process.argv[2]` as the project name and asked for everything else
// through `readline`. With no TTY — CI, an agent, a pipe — no line ever arrives,
// so it did not error: it **hung**, holding the job open until something timed
// it out. `tracker-inertia` in this repo was scaffolded by calling `scaffold()`
// directly, bypassing the CLI, which is the workaround admitting the problem.

import { describe, it, expect } from 'bun:test';
import { parseArgs, resolveOptions, helpText, TEMPLATES, DEFAULT_TEMPLATE } from './args.ts';

describe('parseArgs', () => {
  it('keeps the original positional form working', () => {
    const a = parseArgs(['my-app']);
    expect(a.name).toBe('my-app');
    expect(a.yes).toBe(false);
    expect(a.install).toBe(true);
  });

  it('accepts --flag=value and --flag value alike', () => {
    expect(parseArgs(['app', '--template=react']).template).toBe('react');
    expect(parseArgs(['app', '--template', 'react']).template).toBe('react');
    expect(parseArgs(['app', '-t', 'vue']).template).toBe('vue');
  });

  it('does not swallow the next flag as a value', () => {
    // `--template --yes` is a missing value, not the template "--yes".
    const a = parseArgs(['app', '--template', '--yes']);
    expect(a.template).toBeUndefined();
    expect(a.yes).toBe(true);
  });

  it('collects unknown flags instead of ignoring them', () => {
    // A typo that is silently dropped is worse than one that is refused: the
    // question you thought you had answered gets asked again, or hangs.
    expect(parseArgs(['app', '--tempalte=api']).unknown).toEqual(['--tempalte=api']);
  });

  it('understands --no-install, -y and -h', () => {
    const a = parseArgs(['app', '--no-install', '-y', '-h']);
    expect(a.install).toBe(false);
    expect(a.yes).toBe(true);
    expect(a.help).toBe(true);
  });
});

describe('resolveOptions — with no terminal', () => {
  const NONINTERACTIVE = false;

  it('refuses rather than hangs when the name is missing', () => {
    const r = resolveOptions(parseArgs([]), NONINTERACTIVE);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('project name is required');
  });

  it('refuses rather than hangs when the template is missing', () => {
    const r = resolveOptions(parseArgs(['my-app']), NONINTERACTIVE);
    expect(r.ok).toBe(false);
    // The message has to carry the way out, because the reader is a CI log.
    expect(r.error).toContain('--template');
    expect(r.error).toContain('--yes');
  });

  it('--yes takes the defaults, so one word makes it scriptable', () => {
    const r = resolveOptions(parseArgs(['my-app', '--yes']), NONINTERACTIVE);
    expect(r.ok).toBe(true);
    expect(r.name).toBe('my-app');
    expect(r.template).toBe(DEFAULT_TEMPLATE);
    expect(r.askFor).toEqual([]);
  });

  it('a fully specified command needs no --yes', () => {
    const r = resolveOptions(parseArgs(['my-app', '--template=react', '--no-install']), NONINTERACTIVE);
    expect(r.ok).toBe(true);
    expect(r.template).toBe('react');
    expect(r.install).toBe(false);
    expect(r.askFor).toEqual([]);
  });

  it('rejects a template that does not exist, and names the ones that do', () => {
    const r = resolveOptions(parseArgs(['app', '--template=svelte']), NONINTERACTIVE);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('svelte');
    for (const t of TEMPLATES) expect(r.error).toContain(t);
  });

  it('rejects an unknown database', () => {
    const r = resolveOptions(parseArgs(['app', '--template=api', '--db=mongo']), NONINTERACTIVE);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('mongo');
  });

  it('only the api template carries a database', () => {
    const api = resolveOptions(parseArgs(['a', '--template=api', '--db=postgres']), NONINTERACTIVE);
    expect(api.db).toBe('postgres');
    // Other templates ship no database config, so the flag cannot mislead.
    const flow = resolveOptions(parseArgs(['a', '--template=flow', '--db=postgres']), NONINTERACTIVE);
    expect(flow.db).toBe('sqlite');
  });
});

describe('resolveOptions — with a terminal', () => {
  const INTERACTIVE = true;

  it('asks only for what was not supplied', () => {
    const r = resolveOptions(parseArgs(['my-app', '--template=flow']), INTERACTIVE);
    expect(r.ok).toBe(true);
    // Name and template given; flow has no database question.
    expect(r.askFor).toEqual([]);
  });

  it('asks for everything when nothing was supplied', () => {
    const r = resolveOptions(parseArgs([]), INTERACTIVE);
    expect(r.askFor).toEqual(['name', 'template', 'db']);
  });

  it('--yes skips the prompts even on a terminal', () => {
    const r = resolveOptions(parseArgs(['my-app', '--yes']), INTERACTIVE);
    expect(r.askFor).toEqual([]);
    expect(r.template).toBe(DEFAULT_TEMPLATE);
  });
});

describe('helpText', () => {
  it('documents every template and the non-interactive route', () => {
    const help = helpText();
    for (const t of TEMPLATES) expect(help).toContain(t);
    expect(help).toContain('--yes');
    expect(help).toContain('Non-interactive');
  });
});
