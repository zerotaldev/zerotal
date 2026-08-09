import { html } from "zerotal";
import { Layout } from "./_layout.ts";
import { ZEROTAL_VERSION_SHORT } from "../version.ts";

// ── Landing page ──────────────────────────────────────────────────────────────

// All icons: viewBox="0 0 20 20", stroke-based, class on SVG element for sizing + color
const CARDS: { title: string; slug: string; desc: string; icon: string }[] = [
  {
    title: "Core",
    slug: "application",
    desc: "App, container, providers, conventions",
    // Hexagon with center dot and 3 spokes — CPU/processor
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L17 6v8l-7 4-7-4V6z"/><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/><line x1="10" y1="2" x2="10" y2="8"/><line x1="17" y1="14" x2="11.73" y2="11"/><line x1="3" y1="14" x2="8.27" y2="11"/></svg>`,
  },
  {
    title: "ORM",
    slug: "orm",
    desc: "Active Record, migrations, query builder",
    // Classic 3-tier database cylinder
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="10" cy="5" rx="6.5" ry="2"/><path d="M3.5 5v10c0 1.1 2.91 2 6.5 2s6.5-.9 6.5-2V5"/><path d="M3.5 9c0 1.1 2.91 2 6.5 2s6.5-.9 6.5-2"/><path d="M3.5 13c0 1.1 2.91 2 6.5 2s6.5-.9 6.5-2"/></svg>`,
  },
  {
    title: "Carbon",
    slug: "carbon",
    desc: "Immutable date-time powered by Temporal",
    // Clock face with hour and minute hands
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><polyline points="10,5 10,10 13.5,12.5"/></svg>`,
  },
  {
    title: "Authentication",
    slug: "authentication",
    desc: "Sessions, login, API tokens, 2FA",
    // Padlock with shackle and keyhole
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="9.5" width="12" height="8.5" rx="1.5"/><path d="M7 9.5V7a3 3 0 0 1 6 0v2.5"/><circle cx="10" cy="13.5" r="1.25" fill="currentColor" stroke="none"/><line x1="10" y1="13.5" x2="10" y2="16"/></svg>`,
  },
  {
    title: "Roles & 2FA",
    slug: "roles-and-2fa",
    desc: "RBAC, TOTP two-factor authentication",
    // Shield with check mark inside
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L4 5v5c0 4 2.67 7.5 6 8.5 3.33-1 6-4.5 6-8.5V5z"/><polyline points="7,10 9.5,12.5 14,8"/></svg>`,
  },
  {
    title: "Social Login",
    slug: "social",
    desc: "OAuth2: GitHub, Google, Apple",
    // 3 nodes connected by edges — OAuth graph / social graph
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="3.5" r="2"/><circle cx="3" cy="16" r="2"/><circle cx="17" cy="16" r="2"/><line x1="8.27" y1="5.08" x2="4.73" y2="14.08"/><line x1="11.73" y1="5.08" x2="15.27" y2="14.08"/><line x1="5" y1="16" x2="15" y2="16"/></svg>`,
  },
  {
    title: "Flow",
    slug: "flow",
    desc: "Server-driven reactive components",
    // EKG / heartbeat line — reactive / live
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.5,10 4.5,10 6,5 8.5,15 10.5,7 12,13 13.5,10 18.5,10"/></svg>`,
  },
  {
    title: "Notifications",
    slug: "notifications",
    desc: "Mail, SMS, Slack, and database channels",
    // Envelope with V-fold
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="16" height="12" rx="1.5"/><polyline points="2,5 10,12 18,5"/></svg>`,
  },
  {
    title: "Queue & Scheduler",
    slug: "queue",
    desc: "Background jobs and cron scheduling",
    // List lines on left + mini clock on right
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="4.5" x2="10" y2="4.5"/><line x1="2" y1="8.5" x2="9" y2="8.5"/><line x1="2" y1="12.5" x2="7" y2="12.5"/><circle cx="14.5" cy="12.5" r="4"/><polyline points="14.5,10.5 14.5,12.5 16,13.5"/></svg>`,
  },
  {
    title: "Cache",
    slug: "cache",
    desc: "Multi-driver caching layer",
    // Lightning bolt — speed / instant retrieval
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L6 11h5l-2 7 9-10h-6z"/></svg>`,
  },
  {
    title: "Storage",
    slug: "storage",
    desc: "Local, S3, and R2 file storage",
    // Folder with upload arrow
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/><line x1="10" y1="16" x2="10" y2="11"/><polyline points="8,13 10,11 12,13"/></svg>`,
  },
  {
    title: "Media Library",
    slug: "media",
    desc: "Attach files to models, with image conversions",
    // Picture frame with sun and mountains
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="16" height="12" rx="1.5"/><circle cx="6.75" cy="8.25" r="1.25"/><polyline points="3,14.5 7.5,10.5 11,13.5 13.5,11 17,14.5"/></svg>`,
  },
  {
    title: "Validation",
    slug: "validator",
    desc: "Schema-based request validation",
    // Circle with check mark — badge / certified
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7.5"/><polyline points="6.5,10.5 9,13 14,8"/></svg>`,
  },
  {
    title: "Audit Logging",
    slug: "audit",
    desc: "Model change history and manual events",
    // Magnifying glass — searching through logs
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.5" cy="8.5" r="5.5"/><line x1="12.5" y1="12.5" x2="17.5" y2="17.5"/><line x1="6" y1="8.5" x2="11" y2="8.5"/><line x1="8.5" y1="6" x2="8.5" y2="11"/></svg>`,
  },
  {
    title: "Multi-tenancy",
    slug: "tenancy",
    desc: "Tenant isolation strategies",
    // Two buildings with windows — multi-tenant/SaaS
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 18V7L8 3v15"/><path d="M8 18V10l10-4v12"/><line x1="2" y1="18" x2="18" y2="18"/><line x1="4" y1="9" x2="4" y2="11"/><line x1="4" y1="14" x2="4" y2="16"/><line x1="12" y1="12" x2="12" y2="14.5"/><line x1="15" y1="12" x2="15" y2="14.5"/></svg>`,
  },
  {
    title: "Telemetry",
    slug: "telemetry",
    desc: "Tracing, logging, and observability",
    // Rising bar chart with baseline — metrics / analytics
    icon: `<svg class="w-5 h-5 text-voltage-700 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="1.5" y1="18" x2="18.5" y2="18"/><rect x="2" y="12" width="3.5" height="6" rx="0.5"/><rect x="7.5" y="7.5" width="3.5" height="10.5" rx="0.5"/><rect x="13" y="3.5" width="3.5" height="14.5" rx="0.5"/></svg>`,
  },
];

const FEATURES = [
  {
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>`,
    title: "Bun-native",
    desc: "Built directly on Bun — native SQL client, native file system, native HTTP server. No wasted layers between your code and the metal.",
  },
  {
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
    </svg>`,
    title: "Ergonomic DX",
    desc: "Active Record ORM, fluent middleware, file-based routing, and Flow reactive components — everything designed to feel natural from day one.",
  },
  {
    icon: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
      <path stroke-linecap="round" stroke-linejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
    </svg>`,
    title: "Batteries included",
    desc: "Auth, roles, 2FA, social login, queues, cache, storage, mail, audit logging, multi-tenancy — all in one coherent package with no glue code.",
  },
];

// A realistic code snippet showing actual Zerotal patterns
const CODE_SNIPPET = `@table('posts')
export class Post extends Model.using(SoftDeletes) {
  @column()        title!:  string;
  @column('text')  body!:   string;
  @column()        slug!:   string;
  @belongsTo()     author!: User;

  static recent = Post.query().latest().limit(10);
}

export class PostController extends Controller {
  async index(http: HttpContext) {
    const posts = await Post.query()
      .with('author')
      .latest()
      .paginate();

    return http.json({ posts });
  }

  async store(http: HttpContext) {
    const data = await StorePostRequest.validate();
    const post  = await Post.create({ ...data, authorId: http.user.id });
    return redirect(\`/posts/\${post.slug}\`);
  }
}`;

function buildPage(): string {
  const cardGrid = CARDS.map(
    ({ title, slug, desc, icon }) => `
    <a href="/docs/${slug}"
       class="group flex flex-col gap-3 p-5 bg-white border border-stone-200 rounded-2xl
              hover:border-voltage-700/50 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 no-underline">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-voltage-50 flex items-center justify-center group-hover:bg-voltage-100 transition-colors">
          ${icon}
        </div>
        <span class="font-semibold text-stone-900 group-hover:text-voltage-700 transition-colors">${title}</span>
      </div>
      <p class="text-sm text-stone-500 leading-relaxed">${desc}</p>
    </a>`,
  ).join("\n");

  const features = FEATURES.map(
    ({ icon, title, desc }) => `
    <div class="flex flex-col gap-4 p-8 rounded-3xl bg-white border border-stone-100 shadow-sm hover:shadow-xl hover:border-voltage-100 transition-all duration-300">
      <div class="w-14 h-14 rounded-2xl bg-voltage-50 border border-voltage-100 text-voltage-700 flex items-center justify-center shrink-0 shadow-sm">
        ${icon}
      </div>
      <div>
        <h3 class="text-base font-semibold text-stone-900 mb-2">${title}</h3>
        <p class="text-stone-500 leading-relaxed">${desc}</p>
      </div>
    </div>`,
  ).join("\n");

  return `
    <!-- ── Hero ─────────────────────────────────────────────────────────────── -->
    <section class="not-prose relative pb-20 pt-10 mb-16 border-b border-stone-100 overflow-hidden">
      <!-- Decorative background -->
      <div class="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-voltage-50/70 via-cream to-cream"></div>
      <div class="absolute right-0 top-0 -z-10 translate-x-1/3 -translate-y-1/4 opacity-15 blur-3xl">
        <div class="w-96 h-96 bg-voltage rounded-full"></div>
      </div>
      <div class="absolute left-0 bottom-0 -z-10 -translate-x-1/2 translate-y-1/4 opacity-10 blur-3xl">
        <div class="w-64 h-64 bg-teal-deep rounded-full"></div>
      </div>

      <div class="flex flex-col items-center text-center max-w-5xl mx-auto px-4">
        <a href="/docs/getting-started" class="inline-flex items-center gap-2 mb-8 px-4 py-1.5 rounded-full bg-white border border-stone-200 text-voltage-700 text-sm font-semibold tracking-wide shadow-sm hover:border-stone-300 hover:shadow transition-all">
          <span class="relative flex h-2 w-2">
            <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-voltage opacity-75"></span>
            <span class="relative inline-flex rounded-full h-2 w-2 bg-voltage-700"></span>
          </span>
          Zerotal v${ZEROTAL_VERSION_SHORT} is now available
          <svg class="w-4 h-4 text-voltage-700" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
        </a>

        <h1 class="font-display text-4xl sm:text-6xl font-bold text-ink leading-[1.05] mb-6 tracking-[-0.03em]">
          Zero to total.<br/>
          <span class="text-transparent bg-clip-text bg-linear-to-r from-voltage-700 to-teal-deep">The full-stack framework for Bun.</span>
        </h1>

        <p class="text-lg sm:text-xl text-stone-500 max-w-2xl mb-10 leading-relaxed">
          Full-stack productivity with native Bun performance. Everything you need to build robust web applications in one cohesive package. <strong class="text-stone-700 font-semibold">No glue code required.</strong>
        </p>

        <div class="flex flex-col sm:flex-row items-center gap-4 mb-16 w-full sm:w-auto">
          <a href="/docs/getting-started"
             class="inline-flex items-center justify-center gap-2 px-8 py-4 bg-ink text-cream font-semibold text-base rounded-lg
                    hover:bg-ink-800 hover:shadow-lg hover:shadow-ink/25 hover:-translate-y-0.5 transition-all w-full sm:w-auto no-underline">
            Get Started
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
              <path fill-rule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clip-rule="evenodd" />
            </svg>
          </a>
          <a href="https://github.com/zerotaldev/zerotal" target="_blank" rel="noopener"
             class="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-stone-700 font-semibold text-base rounded-lg
                    border-2 border-stone-200 hover:border-stone-300 hover:bg-stone-50 hover:shadow-sm transition-all w-full sm:w-auto no-underline">
            <svg viewBox="0 0 16 16" class="w-5 h-5 fill-current" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
                       0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                       -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
                       .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
                       -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0
                       1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82
                       1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
                       1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
            </svg>
            Star on GitHub
          </a>
        </div>

        <!-- Quick start command -->
        <div class="inline-flex items-center gap-4 px-6 py-4 bg-ink-800 shadow-xl shadow-stone-300/40 rounded-2xl text-base sm:text-lg font-mono text-cream border border-ink-600">
          <span class="text-voltage select-none">$</span>
          <span id="qs-cmd" class="text-white font-semibold tracking-tight">bun create zerotal my-app</span>
          <button id="qs-copy" onclick="
            navigator.clipboard.writeText('bun create zerotal my-app').then(() => {
              const icon = this.querySelector('svg');
              const originalPath = icon.innerHTML;
              icon.classList.add('text-green-400');
              icon.innerHTML = '<path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'2\\' d=\\'M5 13l4 4L19 7\\'></path>';
              setTimeout(() => { 
                icon.innerHTML = originalPath; 
                icon.classList.remove('text-green-400'); 
              }, 2000);
            });
          " class="p-2 -mr-2 rounded-xl hover:bg-white/10 text-ash hover:text-cream transition-colors cursor-pointer select-none"
             title="Copy to clipboard">
             <svg class="w-5 h-5 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
          </button>
        </div>
      </div>
    </section>

    <!-- ── Stats / Trust ──────────────────────────────────────────────────────── -->
    <section class="not-prose mb-20 pb-20 border-b border-stone-100">
      <div class="max-w-5xl mx-auto px-4 text-center">
        <p class="text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-stone-400 mb-10">What's in the box</p>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div class="p-4">
            <div class="text-3xl sm:text-4xl font-semibold text-stone-900 mb-2 tracking-tight">24</div>
            <div class="text-sm sm:text-base text-stone-500 font-medium">First-party packages</div>
          </div>
          <div class="p-4">
            <div class="text-3xl sm:text-4xl font-semibold text-stone-900 mb-2 tracking-tight">5,670</div>
            <div class="text-sm sm:text-base text-stone-500 font-medium">Tests passing</div>
          </div>
          <div class="p-4">
            <div class="text-3xl sm:text-4xl font-semibold text-stone-900 mb-2 tracking-tight">100%</div>
            <div class="text-sm sm:text-base text-stone-500 font-medium">TypeScript, no build step</div>
          </div>
          <div class="p-4">
            <div class="text-3xl sm:text-4xl font-semibold text-stone-900 mb-2 tracking-tight">1</div>
            <div class="text-sm sm:text-base text-stone-500 font-medium">Runtime to install — Bun</div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── Feature pillars ────────────────────────────────────────────────────── -->
    <section class="not-prose mb-24 max-w-6xl mx-auto px-4">
      <div class="text-center mb-16">
        <h2 class="font-display text-2xl sm:text-3xl font-semibold text-ink mb-4 tracking-[-0.03em]">Everything you need to ship faster</h2>
        <p class="text-base sm:text-lg text-stone-500 max-w-2xl mx-auto leading-relaxed">Focus on building your product, not stitching together libraries. Zerotal gives you a cohesive ecosystem out of the box.</p>
      </div>
      <div class="grid md:grid-cols-3 gap-8">
        ${features}
      </div>
    </section>

    <!-- ── Code preview ───────────────────────────────────────────────────────── -->
    <section class="not-prose mb-24 bg-stone-50 -mx-4 sm:-mx-8 px-4 sm:px-8 py-20 rounded-[3rem] border border-stone-100 overflow-hidden relative">
      <div class="absolute inset-0 bg-[linear-gradient(to_right,#f1f5f9_1px,transparent_1px),linear-gradient(to_bottom,#f1f5f9_1px,transparent_1px)] bg-size-[4rem_4rem] mask-[radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]"></div>
      <div class="max-w-4xl mx-auto relative z-10">
        <div class="text-center mb-12">
          <h2 class="font-display text-2xl sm:text-3xl font-semibold text-ink mb-4 tracking-[-0.03em]">Beautiful, expressive code</h2>
          <p class="text-base sm:text-lg text-stone-500 max-w-2xl mx-auto leading-relaxed">Zerotal provides elegant APIs that make writing business logic a joy, without sacrificing type safety or performance.</p>
        </div>
        <div class="rounded-xl overflow-hidden shadow-2xl shadow-stone-300/50 border border-ink-600 bg-ink-800">
          <div class="flex items-center px-4 py-3 bg-ink-800 border-b border-ink-600">
            <span class="text-xs text-ash font-mono">app/models/Post.ts</span>
          </div>
          <pre class="m-0! p-6! sm:p-8! bg-transparent! text-sm sm:text-base overflow-x-auto"><code class="language-typescript text-cream">${CODE_SNIPPET}</code></pre>
        </div>
      </div>
    </section>

    <!-- ── Package grid ───────────────────────────────────────────────────────── -->
    <section class="not-prose mb-24 max-w-6xl mx-auto px-4">
      <div class="text-center mb-16">
        <h2 class="font-display text-2xl sm:text-3xl font-semibold text-ink mb-4 tracking-[-0.03em]">Batteries absolutely included</h2>
        <p class="text-base sm:text-lg text-stone-500 max-w-2xl mx-auto leading-relaxed">Explore the rich ecosystem of first-party packages designed specifically for Zerotal. Perfectly integrated, incredibly powerful.</p>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        ${cardGrid}
      </div>
    </section>

    <!-- ── CTA ────────────────────────────────────────────────────────────────── -->
    <section class="not-prose mb-12 max-w-5xl mx-auto px-4">
      <div class="bg-ink rounded-[2.5rem] p-10 sm:p-20 text-center relative overflow-hidden shadow-2xl shadow-ink/20">
        <!-- Abstract shapes -->
        <div class="absolute top-0 right-0 -mt-20 -mr-20 w-80 h-80 bg-voltage opacity-10 rounded-full blur-3xl pointer-events-none"></div>
        <div class="absolute bottom-0 left-0 -mb-20 -ml-20 w-80 h-80 bg-teal-deep opacity-10 rounded-full blur-3xl pointer-events-none"></div>

        <h2 class="font-display text-2xl sm:text-4xl font-semibold text-cream mb-6 relative z-10 tracking-[-0.03em] leading-tight">Ready to build your<br/>next big idea?</h2>
        <p class="text-cream/70 text-base sm:text-lg mb-10 max-w-2xl mx-auto relative z-10 leading-relaxed font-medium">One command scaffolds a working app — routing, models, auth, and a frontend of your choosing. Read the guide and ship something today.</p>

        <a href="/docs/getting-started" class="inline-flex items-center justify-center gap-3 px-10 py-5 bg-voltage text-ink font-semibold text-base rounded-xl hover:bg-voltage-700 hover:shadow-xl hover:scale-105 transition-all relative z-10 no-underline">
          Read the Documentation
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
        </a>
      </div>
    </section>
  `;
}

export function GET() {
  html(
    Layout({
      content: buildPage(),
      title: "Zerotal — Full-stack framework for Bun",
      sidebar: false,
    }),
  );
}
