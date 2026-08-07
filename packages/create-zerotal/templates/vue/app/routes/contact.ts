import { Inertia } from "@zerotal/inertia";

export const GET = async () => {
  return Inertia.render("contact", {
    title: "Contact",
  });
};
