import { Seeder } from "zerotal/orm";
import { Hash } from "zerotal/auth";
import { User } from "@app/models/User";
import { Project, type ProjectStatus } from "@app/models/Project";

/** The demo account `bun zt db:seed` creates. Shown in the README. */
export const DEMO_EMAIL = "demo@example.com";
export const DEMO_PASSWORD = "password";

/**
 * A demo user with a handful of projects, so the app has something to show on its
 * first run. Deterministic on purpose: a reseed gives the same data, not new noise.
 *
 *   bun zt db:seed        # or: bun run seed
 *
 * Sign in as demo@example.com / password. Never run this against production — the
 * password is in the README.
 */
export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    if (await User.query().where("email", DEMO_EMAIL).first()) return;

    const demo = new User();
    demo.name = "Demo User";
    demo.email = DEMO_EMAIL;
    demo.password = await Hash.make(DEMO_PASSWORD);
    demo.role = "user";
    demo.emailVerifiedAt = new Date();
    await demo.save();

    const projects: [string, string, ProjectStatus][] = [
      ["Website relaunch", "New marketing site, built on the component set.", "active"],
      ["Mobile onboarding", "Shorter sign-up on phones: three screens down to one.", "active"],
      ["Billing migration", "Move invoices to the new provider before renewal.", "planning"],
      ["Status page", "Public uptime and incident history.", "completed"],
      ["Search", "Find projects by name and description.", "completed"],
      ["Team invitations", "Invite colleagues by email, with roles.", "planning"],
      ["Audit log", "Who changed what, and when.", "planning"],
      ["Dark mode", "Light, dark, or whatever the device prefers.", "completed"],
      ["Weekly digest", "A Monday email summarising last week's changes.", "active"],
      ["API tokens", "Personal access tokens for scripts.", "planning"],
      ["Data export", "Download everything as CSV.", "active"],
      ["Accessibility review", "Keyboard paths and screen-reader labels, page by page.", "active"],
    ];

    for (const [name, description, status] of projects) {
      const project = new Project();
      project.userId = demo.id;
      project.name = name;
      project.description = description;
      project.status = status;
      await project.save();
    }
  }
}
