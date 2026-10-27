import { target as alias, Worker, register } from "./lib.js";
import { target as other } from "./other.js";
import { viaBarrel } from "./barrel.js";
alias();
export function caller() {
  alias();
  other();
  viaBarrel();
  const worker = new Worker();
  worker.run();
  register(alias);
}
export function shadow(alias: () => number) { return alias(); }
export async function lazy() { const m = await import("./lib.js"); return m.target(); }
