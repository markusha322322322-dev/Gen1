import { processOne } from "./queue.mjs";
import { pool } from "./db.mjs";
let stop = false;
process.on("SIGTERM", () => {
  stop = true;
});
process.on("SIGINT", () => {
  stop = true;
});
console.log("Signal worker started");
while (!stop) {
  try {
    if (!(await processOne())) await new Promise((r) => setTimeout(r, 1000));
  } catch (e) {
    console.error("Worker database error:", e.message);
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await pool.end();
