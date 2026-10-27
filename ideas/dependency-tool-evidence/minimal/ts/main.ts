export async function lazy() { const m = await import("./lib.js"); return m.target(); }
