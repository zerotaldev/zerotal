import { Inertia } from "@zerotal/inertia";
import { Auth } from "zerotal/auth";
import { Project } from "@app/models/Project";

/** "Good morning" before noon, and so on — by the server's clock. */
function timeOfDay(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// GET /dashboard — where a user lands after signing in.
export const GET = async () => {
  const user = Auth.user();
  const firstName = user.name.split(" ")[0] ?? user.name;
  const mine = () => Project.query().where("user_id", user.id);

  const [total, active, completed, recent] = await Promise.all([
    mine().count(),
    mine().where("status", "active").count(),
    mine().where("status", "completed").count(),
    mine().orderBy("updated_at", "desc").orderBy("id", "desc").limit(5).get(),
  ]);

  return Inertia.render("dashboard", {
    title: "Dashboard",
    greeting: `${timeOfDay(new Date().getHours())}, ${firstName}`,
    stats: { total: Number(total), active: Number(active), completed: Number(completed) },
    recentProjects: recent.map((project) => project.toPage()),
  });
};
