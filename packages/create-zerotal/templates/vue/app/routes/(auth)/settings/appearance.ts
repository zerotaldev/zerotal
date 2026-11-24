import { Inertia } from "@zerotal/inertia";

// GET /settings/appearance — light, dark or system. The choice is kept in the browser,
// so there is nothing for the server to save.
export const GET = async () => {
  return Inertia.render("settings/appearance", { title: "Appearance" });
};
