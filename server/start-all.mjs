import { spawn } from "node:child_process";

const processes = new Set();
let stopping = false;

function start(args, tracked = true) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: process.env,
  });

  if (tracked) {
    processes.add(child);

    child.on("exit", (code, signal) => {
      processes.delete(child);

      if (!stopping) {
        console.error(
          `${args.join(" ")} stopped: code=${code}, signal=${signal}`,
        );
        shutdown(code || 1);
      }
    });
  }

  return child;
}

function waitFor(child) {
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Bootstrap failed with code ${code}`));
    });

    child.on("error", reject);
  });
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of processes) {
    child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(code), 5000);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

await waitFor(start(["server/setup.mjs", "--bootstrap"], false));

console.log("Starting Signal services");

start(["server/worker.mjs"]);
start(["server/scheduler.mjs"]);
start(["server/http.mjs"]);