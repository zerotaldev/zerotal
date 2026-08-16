/**
 * `schema` — the model layer as the ORM understands it.
 *
 * Read from the `@column` metadata the models registered at import time, not
 * from the database and not from the migration files. That is deliberate: it is
 * the schema the *code* declares, which is the one an agent writing a query or a
 * migration has to agree with.
 */
import type { ArchTool, ToolOutcome } from "../mcp/types.ts";
import type { SchemaModel, SchemaReport } from "../probe/topics.ts";
import type { ToolContext } from "./context.ts";

export function schemaTool(ctx: ToolContext): ArchTool {
  return {
    name: "schema",
    title: "Model schema",
    description:
      "The database schema this app's models declare: table, primary key, timestamps, soft " +
      "deletes, and every column with its type, nullability and indexes. Read from the models' " +
      "own decorator metadata, so it is what the code says rather than what the database " +
      "currently holds. Check it before writing a query, a factory, or a migration.",
    inputSchema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          description: "Only models whose table name contains this. Omit for all.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        total: { type: "number" },
        note: { type: "string", description: "Why the list is empty, when it is." },
        models: {
          type: "array",
          items: {
            type: "object",
            properties: {
              table: { type: "string" },
              primaryKey: { type: "string" },
              timestamps: { type: "boolean" },
              softDeletes: { type: "boolean" },
              columns: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    type: { type: "string" },
                    nullable: { type: "boolean" },
                    primary: { type: "boolean" },
                    unique: { type: "boolean" },
                    indexed: { type: "boolean" },
                  },
                  required: ["name", "type", "nullable", "primary", "unique", "indexed"],
                },
              },
            },
            required: ["table", "primaryKey", "timestamps", "softDeletes", "columns"],
          },
        },
      },
      required: ["total", "models"],
    },

    async run(args, signal): Promise<ToolOutcome> {
      const result = await ctx.probe.run("schema", signal);
      if (!result.ok) return { text: result.message, failed: true };

      const report = result.data as SchemaReport;
      const wanted = typeof args["table"] === "string" ? args["table"].toLowerCase() : undefined;
      const models =
        wanted === undefined
          ? report.models
          : report.models.filter((model) => model.table.toLowerCase().includes(wanted));

      const data = {
        total: models.length,
        models,
        ...(report.note !== undefined ? { note: report.note } : {}),
      };

      if (models.length === 0) {
        return {
          text:
            report.note ??
            `No model matches "${args["table"] as string}". Tables: ` +
              report.models.map((model) => model.table).join(", "),
          data,
        };
      }

      return { text: models.map(renderModel).join("\n\n"), data };
    },
  };
}

function renderModel(model: SchemaModel): string {
  const traits = [
    `primary key: ${model.primaryKey}`,
    model.timestamps ? "timestamps" : "no timestamps",
    ...(model.softDeletes ? ["soft deletes"] : []),
  ];

  const columns = model.columns.map((column) => {
    const flags = [
      column.primary ? "primary" : "",
      column.nullable ? "nullable" : "not null",
      column.unique ? "unique" : "",
      column.indexed ? "indexed" : "",
    ].filter(Boolean);
    return `  ${column.name}: ${column.type}  (${flags.join(", ")})`;
  });

  return `${model.table}  [${traits.join(", ")}]\n${columns.join("\n")}`;
}
