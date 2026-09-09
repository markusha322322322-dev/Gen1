import { schedule } from "./queue.mjs";
import { pool } from "./db.mjs";
let stop = false;
process.on("SIGTERM", () => {
  stop = true;
});
process.on("SIGINT", () => {
  stop = true;
});
console.log("Signal scheduler started");
while (!stop) {
  try {
    await schedule();
  } catch (e) {
    console.error("Scheduler error:", e.message);
  }
  await new Promise((r) => setTimeout(r, 15000));
}
await pool.end();
