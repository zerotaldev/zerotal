import type { Database, Template } from './scaffold.ts';

/**
 * What a fresh project needs between "scaffolded" and "running".
 *
 * One list feeds both places a newcomer reads it: the "Next steps" the scaffolder prints,
 * and the "Getting started" section of the project's README. They used to be written
 * separately, and drifted: the terminal said to migrate first, the README said
 * `bun install` then `bun run dev`, and a newcomer who followed the README (the one that
 * stays around) reached a running app with no `users` table.
 */

/** One line of instructions: a command, and the comment that explains it. */
export interface FirstRunStep {
  command:  string;
  comment?: string;
}

/**
 * Templates that ship baseline migrations. Their schema is built from those migrations
 * (`synchronize` is off), so the first migrate is a required step, not a tip.
 */
const MIGRATES: ReadonlySet<Template> = new Set<Template>(['api', 'flow', 'react', 'vue']);

/** The seeded account that makes a fresh admin panel usable rather than a locked door. */
const ADMIN_LOGIN = 'admin@example.com / password';

/** Where the admin template's panel lives. */
export const ADMIN_URL = 'http://localhost:3000/admin';

/** The commands to run after install and before the dev server, in order. */
export function setupSteps(template: Template, db: Database): FirstRunStep[] {
  const steps: FirstRunStep[] = [];
  if (MIGRATES.has(template)) {
    if (db !== 'sqlite') steps.push({ command: '', comment: 'Set DATABASE_URL in .env' });
    steps.push({ command: 'bun zt migrate' });
  }
  if (template === 'admin') {
    steps.push({ command: 'bun zt db:seed', comment: `demo data + ${ADMIN_LOGIN}` });
  }
  return steps;
}

function render(step: FirstRunStep): string {
  if (step.command === '') return `# ${step.comment}`;
  return step.comment ? `${step.command}              # ${step.comment}` : step.command;
}

/** The lines the scaffolder prints under "Next steps:", `cd` first. */
export function nextStepLines(name: string, template: Template, db: Database): string[] {
  const lines = [`cd ${name}`, ...setupSteps(template, db).map(render), 'bun zt dev'];
  if (template === 'admin') lines.push(`# then open ${ADMIN_URL}`);
  return lines;
}

/** The README's "Getting started" body: the commands, then what to expect. */
export function gettingStarted(template: Template, db: Database): string {
  const commands = ['bun install', ...setupSteps(template, db).map(render), 'bun run dev'];
  const parts = ['```bash', ...commands, '```', ''];
  if (template === 'admin') {
    parts.push(`The panel is at ${ADMIN_URL}, and \`bun zt db:seed\` is what creates the account to sign in with.`, '');
  }
  parts.push(
    'The dev server prints a local URL and a network one, so you can open the app on',
    'another device on the same Wi-Fi.',
  );
  return parts.join('\n');
}
