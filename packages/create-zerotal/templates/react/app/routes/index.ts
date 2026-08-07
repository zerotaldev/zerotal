import { Inertia } from "@zerotal/inertia";

// GET / — the landing page. Whatever this route passes as the second argument
// arrives in resources/js/pages/home.tsx as React props.
export const GET = async () => {
  return Inertia.render("home", {
    title: "Everything in one TypeScript app",
    message:
      "Routes, pages, validation and data access share one language and one process — served by Bun.",
  });
};
