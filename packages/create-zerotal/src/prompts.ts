import { createInterface } from 'node:readline';

// ── ANSI helpers ──────────────────────────────────────────────────────────────

export const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  gray:   '\x1b[90m',
  white:  '\x1b[97m',
};

export function log(msg: string)  { process.stdout.write(msg + '\n'); }
export function info(msg: string) { log(`${c.green}  ✓${c.reset}  ${msg}`); }
export function warn(msg: string) { log(`${c.yellow}  ⚠${c.reset}  ${msg}`); }
export function step(msg: string) { log(`${c.cyan}  ◆${c.reset}  ${c.bold}${msg}${c.reset}`); }
export function dim(msg: string)  { log(`${c.gray}     ${msg}${c.reset}`); }

// ── Banner ────────────────────────────────────────────────────────────────────

export function printBanner(): void {
  log('');
  log(`${c.bold}${c.white}  ███████╗███████╗██████╗  ██████╗ ████████╗ █████╗ ██╗     ${c.reset}`);
  log(`${c.bold}${c.white}  ╚══███╔╝██╔════╝██╔══██╗██╔═══██╗╚══██╔══╝██╔══██╗██║     ${c.reset}`);
  log(`${c.bold}${c.cyan}    ███╔╝ █████╗  ██████╔╝██║   ██║   ██║   ███████║██║     ${c.reset}`);
  log(`${c.bold}${c.cyan}   ███╔╝  ██╔══╝  ██╔══██╗██║   ██║   ██║   ██╔══██║██║     ${c.reset}`);
  log(`${c.bold}${c.blue}  ███████╗███████╗██║  ██║╚██████╔╝   ██║   ██║  ██║███████╗${c.reset}`);
  log(`${c.bold}${c.blue}  ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚══════╝${c.reset}`);
  log('');
  log(`${c.gray}  Bun-native TypeScript framework${c.reset}`);
  log('');
}

// ── Prompt primitives ─────────────────────────────────────────────────────────

function rl(): ReturnType<typeof createInterface> {
  return createInterface({
    input:    process.stdin,
    output:   process.stdout,
    terminal: false,
  });
}

export function ask(question: string, defaultValue = ''): Promise<string> {
  return new Promise((resolve) => {
    const hint = defaultValue ? ` ${c.gray}(${defaultValue})${c.reset}` : '';
    process.stdout.write(`  ${c.cyan}?${c.reset}  ${question}${hint} `);
    const iface = rl();
    iface.once('line', (line) => {
      iface.close();
      resolve(line.trim() || defaultValue);
    });
  });
}

export function choose<T extends string>(
  question: string,
  options: Array<{ value: T; label: string; description?: string }>,
): Promise<T> {
  return new Promise((resolve) => {
    log(`  ${c.cyan}?${c.reset}  ${question}`);
    options.forEach(({ label, description }, i) => {
      const idx = `${c.gray}[${i + 1}]${c.reset}`;
      const desc = description ? ` ${c.gray}— ${description}${c.reset}` : '';
      log(`     ${idx} ${label}${desc}`);
    });
    process.stdout.write(`  ${c.gray}Enter number (default 1):${c.reset} `);

    const iface = rl();
    iface.once('line', (line) => {
      iface.close();
      const n = parseInt(line.trim(), 10);
      const idx = isNaN(n) || n < 1 || n > options.length ? 0 : n - 1;
      resolve(options[idx]!.value);
    });
  });
}
