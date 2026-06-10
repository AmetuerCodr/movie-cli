import chalk from "chalk";

const VERSION = "0.1.0";

// Simple two-stop gradient (blue #3b82f6 → purple #a855f7) applied per line.
const START = { r: 0x3b, g: 0x82, b: 0xf6 };
const END = { r: 0xa8, g: 0x55, b: 0xf7 };

const BANNER_LINES = [
  "  ███╗   ███╗ ██████╗ ██╗   ██╗      ██████╗██╗     ██╗",
  "  ████╗ ████║██╔═══██╗██║   ██║     ██╔════╝██║     ██║",
  "  ██╔████╔██║██║   ██║██║   ██║     ██║     ██║     ██║",
  "  ██║╚██╔╝██║██║   ██║╚██╗ ██╔╝     ██║     ██║     ██║",
  "  ██║ ╚═╝ ██║╚██████╔╝ ╚████╔╝      ╚██████╗███████╗██║",
  "  ╚═╝     ╚═╝ ╚═════╝   ╚═══╝        ╚═════╝╚══════╝╚═╝",
];

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function gradientLine(line: string, t: number): string {
  const r = lerp(START.r, END.r, t);
  const g = lerp(START.g, END.g, t);
  const b = lerp(START.b, END.b, t);
  return chalk.rgb(r, g, b)(line);
}

export function banner(): string {
  const colored = BANNER_LINES.map((line, i) =>
    gradientLine(line, BANNER_LINES.length === 1 ? 0 : i / (BANNER_LINES.length - 1)),
  ).join("\n");
  const tagline = chalk.gray(
    `  Watch movies from your terminal  ·  v${VERSION}  ·  bunx mov-cli --help`,
  );
  return `\n${colored}\n${tagline}\n`;
}

export const c = {
  title: (s: string) => chalk.bold.white(s),
  year: (s: string) => chalk.gray(s),
  rating: (s: string) => chalk.yellow(s),
  type: (s: string) => chalk.cyan(s),
  dim: (s: string) => chalk.gray(s),
  accent: (s: string) => chalk.magenta(s),
  ok: (s: string) => chalk.green(s),
};

export { VERSION };
