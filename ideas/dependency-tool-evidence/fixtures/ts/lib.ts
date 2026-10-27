export function target() { return 1; }
export class Worker { run() { return target(); } }
export function register(cb: () => number) { return cb; }
