import type { PlayerConfig } from "./types.js";

export const vlcPlayer: PlayerConfig = {
  name: "vlc",
  bin: "vlc",
  buildArgs(stream, title) {
    const args = [stream.url, `--meta-title=${title}`];
    if (stream.referer) {
      args.push(`--http-referrer=${stream.referer}`);
    }
    return args;
  },
};

/** Headless VLC (no GUI) — useful on servers and as an mpv-less fallback. */
export const cvlcPlayer: PlayerConfig = {
  name: "cvlc",
  bin: "cvlc",
  buildArgs(stream, title) {
    const args = [stream.url, `--meta-title=${title}`, "--play-and-exit"];
    if (stream.referer) {
      args.push(`--http-referrer=${stream.referer}`);
    }
    return args;
  },
};

/** IINA — macOS only. */
export const iinaPlayer: PlayerConfig = {
  name: "iina",
  bin: "iina",
  buildArgs(stream, _title) {
    return ["--no-stdin", stream.url];
  },
};
