import { Seeder } from "zerotal/orm";
import { Hash } from "zerotal/auth";
import { User } from "@app/models/User";
import { Setting } from "@app/models/Setting";
import { Product } from "@app/models/Product";

/**
 * Demo data, so the panel has something to show on the first run.
 *
 * Deterministic on purpose — a reseed produces the same catalogue rather than
 * noise. Run it with `bun run seed`.
 */
export class DatabaseSeeder extends Seeder {
  async run(): Promise<void> {
    await User.create({
      name: "Admin",
      email: "admin@example.com",
      password: await Hash.make("password"),
      roles: ["admin"],
    });

    await Setting.create({
      siteName: "{{name}}",
      supportEmail: "support@example.com",
      ordersOpen: true,
    });

    const names = [
      "Desk Lamp",
      "Mechanical Keyboard",
      "USB-C Hub",
      "Standing Desk",
      "Monitor Arm",
      "Laptop Stand",
    ];
    const statuses = ["active", "active", "draft", "discontinued"];

    for (const [i, name] of names.entries()) {
      await Product.create({
        name,
        sku: `SKU-${String(1000 + i)}`,
        description: `A dependable ${name.toLowerCase()} for everyday work.`,
        price: 1999 + i * 1500,
        stock: i % 5 === 0 ? 4 : 12 + i * 3,
        status: statuses[i % statuses.length]!,
        featured: i % 3 === 0,
      });
    }
  }
}
