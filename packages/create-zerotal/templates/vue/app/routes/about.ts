import { Inertia } from "@zerotal/inertia";

export const GET = async () => {
  return Inertia.render("about", {
    title: "About",
  });
};
