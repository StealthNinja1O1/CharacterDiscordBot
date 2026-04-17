/**
 * Simple timestamped logger.
 * Format: [YYYY-MM-DD HH:mm:ss.SSS] LEVEL  Message
 */

const LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
type LogLevel = (typeof LEVELS)[number];

const minLevel: LogLevel = (process.env.LOG_LEVEL?.toUpperCase() as LogLevel) || "INFO";

function shouldLog(level: LogLevel): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(minLevel);
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function formatMessage(level: LogLevel, ...args: unknown[]): string {
  const msg = args
    .map((a) => (typeof a === "string" ? a : a instanceof Error ? `${a.message}\n${a.stack}` : JSON.stringify(a)))
    .join(" ");
  return `[${timestamp()}] ${level.padEnd(5)} ${msg}`;
}

export const log = {
  debug: (...args: unknown[]) => {
    if (shouldLog("DEBUG")) process.stdout.write(formatMessage("DEBUG", ...args) + "\n");
  },
  info: (...args: unknown[]) => {
    if (shouldLog("INFO")) process.stdout.write(formatMessage("INFO", ...args) + "\n");
  },
  warn: (...args: unknown[]) => {
    if (shouldLog("WARN")) process.stderr.write(formatMessage("WARN", ...args) + "\n");
  },
  error: (...args: unknown[]) => {
    if (shouldLog("ERROR")) process.stderr.write(formatMessage("ERROR", ...args) + "\n");
  },
};
