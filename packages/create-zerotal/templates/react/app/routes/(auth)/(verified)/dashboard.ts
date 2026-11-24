import { Inertia } from "@zerotal/inertia";
import { Auth } from "zerotal/auth";

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

  return Inertia.render("dashboard", {
    title: "Dashboard",
    greeting: `${timeOfDay(new Date().getHours())}, ${firstName}`,
  });
};
