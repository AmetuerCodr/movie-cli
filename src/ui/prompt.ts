import inquirer from "inquirer";
import type { SearchResult, Stream } from "../scraper/types.js";
import { c } from "./colors.js";

export async function promptSearch(): Promise<string> {
  const { query } = await inquirer.prompt<{ query: string }>([
    {
      type: "input",
      name: "query",
      message: "Search for a movie:",
      validate: (input: string) => (input.trim().length > 0 ? true : "Please enter a search term"),
    },
  ]);
  return query.trim();
}

export type ResultChoice = SearchResult | "back" | "quit";

export async function promptSelectResult(results: SearchResult[]): Promise<ResultChoice> {
  const choices = results.map((r, i) => ({
    name: formatResult(r, i + 1),
    value: String(i),
    short: r.title,
  }));

  const { selection } = await inquirer.prompt<{ selection: string }>([
    {
      type: "list",
      name: "selection",
      message: "Select a title:",
      loop: false,
      pageSize: Math.min(results.length + 2, 15),
      choices: [
        ...choices,
        new inquirer.Separator(),
        { name: c.dim("/  Search again"), value: "back", short: "Search again" },
        { name: c.dim("q  Quit"), value: "quit", short: "Quit" },
      ],
    },
  ]);

  if (selection === "back") return "back";
  if (selection === "quit") return "quit";
  const idx = Number(selection);
  return results[idx] ?? "back";
}

function formatResult(r: SearchResult, index: number): string {
  const num = c.dim(`[${index}]`);
  const title = c.title(r.title);
  const year = r.year ? ` ${c.year(`(${r.year})`)}` : "";
  const rating = r.rating != null ? ` ${c.rating(`★ ${r.rating.toFixed(1)}`)}` : "";
  const type = ` ${c.type(`[${r.type === "series" ? "Series" : "Movie"}]`)}`;
  return `${num} ${title}${year}${rating}${type}`;
}

export async function promptQuality(streams: Stream[]): Promise<Stream> {
  if (streams.length === 1) return streams[0] as Stream;

  const sorted = [...streams].sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality));
  const { url } = await inquirer.prompt<{ url: string }>([
    {
      type: "list",
      name: "url",
      message: "Select quality:",
      loop: false,
      choices: sorted.map((s) => ({
        name: `${c.title(labelQuality(s.quality))} ${c.dim(s.isM3U8 ? "(HLS)" : "(direct)")}`,
        value: s.url,
        short: labelQuality(s.quality),
      })),
    },
  ]);
  return sorted.find((s) => s.url === url) ?? (sorted[0] as Stream);
}

function labelQuality(q: string): string {
  return q === "unknown" ? "Auto" : q;
}

function qualityRank(q: string): number {
  const m = q.match(/(\d+)/);
  return m?.[1] ? Number(m[1]) : 0;
}

export async function promptContinue(): Promise<"search" | "quit"> {
  const { again } = await inquirer.prompt<{ again: boolean }>([
    { type: "confirm", name: "again", message: "Watch another?", default: true },
  ]);
  return again ? "search" : "quit";
}

export async function promptRetry(message: string): Promise<boolean> {
  const { retry } = await inquirer.prompt<{ retry: boolean }>([
    { type: "confirm", name: "retry", message, default: true },
  ]);
  return retry;
}
