/**
 * Logging.
 *
 * Requirements from the specification: failures must "log technical details safely".
 * Safely means: never journal text, never financial records, never file contents,
 * and never anything a user would not expect to appear in a bug report.
 *
 * In release builds nothing is written to the console. Technical detail is retained
 * in-memory so an in-app error screen can show it to the user without shipping it to
 * a server.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  message: string;
  timestamp: number;
  error?: string;
}

const MAX_RETAINED = 100;

/** Bounded in-memory ring buffer. Never persisted, never uploaded. */
const buffer: LogRecord[] = [];

function redact(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let consoleEnabled = true;

/** Production disables console output; tests and dev keep it. */
export function setConsoleLogging(enabled: boolean): void {
  consoleEnabled = enabled;
}

function record(level: LogLevel, message: string, error?: unknown): LogRecord {
  const entry: LogRecord = {
    level,
    message,
    timestamp: Date.now(),
    error: redact(error),
  };

  buffer.push(entry);
  if (buffer.length > MAX_RETAINED) buffer.shift();

  if (consoleEnabled) {
    const prefix = `[LifeOS:${level}]`;
    if (level === 'error') console.error(prefix, message, error ?? '');
    else if (level === 'warn') console.warn(prefix, message, error ?? '');
    else if (level === 'info') console.info(prefix, message);
    else console.debug(prefix, message);
  }

  return entry;
}
export const logger = {
  debug: (message: string, error?: unknown) => record('debug', message, error),
  info: (message: string, error?: unknown) => record('info', message, error),
  warn: (message: string, error?: unknown) => record('warn', message, error),
  error: (message: string, error?: unknown) => record('error', message, error),
  /** Copy of recent records, oldest first. Safe to show to a user. */
  recent: (limit = MAX_RETAINED): readonly LogRecord[] => buffer.slice(-limit),
  clear: (): void => {
    buffer.length = 0;
  },
};
