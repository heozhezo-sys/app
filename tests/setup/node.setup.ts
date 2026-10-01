/**
 * Setup for the `node` test project (logic, repositories, migrations, services).
 *
 * Deliberately minimal: these tests exercise real code against a real SQLite engine,
 * so there is nothing to mock here. Mocking the database would defeat the purpose.
 */

// Node's `node:sqlite` is flagged experimental and prints a warning on import.
// The API is stable for our usage; silence only the notice, not real warnings.
const originalWarn = process.emitWarning.bind(process);
process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : String((warning as Error)?.message ?? '');
  if (text.includes('SQLite is an experimental feature')) return;
  return Reflect.apply(originalWarn, process, [warning, ...rest] as never);
}) as typeof process.emitWarning;

jest.setTimeout(20_000);

export {};
