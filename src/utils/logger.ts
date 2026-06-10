import chalk from "chalk";

const DEBUG = process.env.MOV_CLI_DEBUG === "1";

/**
 * Lightweight logger. Everything except `info` goes to stderr so that
 * stdout stays clean for pipeable output.
 */
export const logger = {
  isDebug: DEBUG,
  debug: (...args: unknown[]): void => {
    if (DEBUG) console.error(chalk.gray("[debug]"), ...args);
  },
  info: (...args: unknown[]): void => {
    console.log(chalk.blue("[info]"), ...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(chalk.yellow("[warn]"), ...args);
  },
  error: (...args: unknown[]): void => {
    console.error(chalk.red("[error]"), ...args);
  },
};
