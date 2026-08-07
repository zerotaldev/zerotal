export default {
  url: ":memory:",
};

export function validate(config: Record<string, unknown>): void {
  if (!config["url"]) throw new Error("database.url is required");
}
