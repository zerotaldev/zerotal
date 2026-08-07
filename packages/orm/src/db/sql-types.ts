/**
 * The shape of a Bun SQL connection as this ORM uses it: a callable tagged-template
 * that runs a query, plus `begin()` for transactions and `end()` to close.
 *
 * Exported (rather than an ambient global) so consumers that pull this package's
 * source into their type program resolve it through the import graph.
 */
export interface SQLInstance {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  begin<T>(fn: (tx: SQLInstance) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}
