import type { PlayerConfig } from "./types.js";

export const mpvPlayer: PlayerConfig = {
  name: "mpv",
  bin: "mpv",
  buildArgs(stream, title) {
    const args = [stream.url, `--title=${title}`, "--no-terminal", "--really-quiet"];
    if (stream.referer) {
      args.push(`--referrer=${stream.referer}`);
    }
    if (stream.isM3U8) {
      args.push("--demuxer-lavf-format=hls");
    }
    return args;
  },
};
