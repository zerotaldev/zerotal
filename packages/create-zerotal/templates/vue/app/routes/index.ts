import { Inertia } from "@zerotal/inertia";

export const GET = async () => {
  return Inertia.render("home", {
    title: "Welcome to Zerotal Vue!",
    message: "This is a sample page for your Zerotal Vue application.",
  });
};
