export const PROTOCOL_VERSION = 4;

// Wire format version of the spectator stream (keyframe + event windows),
// independent of PROTOCOL_VERSION: the spectator HTTP path can change without
// touching the WebSocket protocol and vice versa. Carried in every keyframe and
// event-window body so a client re-bases or errors on a mismatch.
export const SPECTATOR_FORMAT_VERSION = 2;

export * from "./db.js";
export * from "./piece.js";
export * from "./session.js";
export * from "./country.js";
export * from "./protocol.js";
export * from "./playzone.js";
export * from "./grid.js";
export * from "./minimap.js";
export * from "./manifest.js";
export * from "./permutation.js";
export * from "./generator/edge.js";
export * from "./generator/generate.js";
export * from "./generator/validate.js";
export * from "./generator/path.js";
export * from "./generator/prng.js";
