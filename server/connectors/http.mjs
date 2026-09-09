import https from "node:https";
import { lookup } from "node:dns/promises";
import net from "node:net";
function publicV4(ip) {
  const n = ip.split(".").map(Number);
  return (
    net.isIPv4(ip) &&
    ![0, 10, 127].includes(n[0]) &&
    !(n[0] === 169 && n[1] === 254) &&
    !(n[0] === 172 && n[1] >= 16 && n[1] <= 31) &&
    !(n[0] === 192 && n[1] === 168) &&
    !(n[0] === 100 && n[1] >= 64 && n[1] <= 127) &&
    !(n[0] === 198 && [18, 19].includes(n[1])) &&
    n[0] < 224
  );
}
export async function get(url, secret) {
  const u = new URL(url);
  const allowed = (process.env.CONNECTOR_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim());
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !allowed.includes(u.hostname)
  )
    throw Error("Источник не разрешён администратором сервера");
  const records = await lookup(u.hostname, { all: true, family: 4 });
  if (!records.length || records.some((r) => !publicV4(r.address)))
    throw Error("Частные сетевые адреса запрещены");
  return new Promise((resolve, reject) => {
    const req = https.get(
      u,
      {
        lookup: (_h, _o, cb) => cb(null, records[0].address, 4),
        headers: {
          "User-Agent": "Signal/1.0",
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        timeout: 20000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(
            Error(
              `Источник вернул HTTP ${res.statusCode}; перенаправления не выполняются`,
            ),
          );
        }
        let size = 0,
          parts = [];
        res.on("data", (b) => {
          size += b.length;
          if (size > 2 * 1024 * 1024) {
            req.destroy(Error("Ответ превышает 2 МБ"));
            return;
          }
          parts.push(b);
        });
        res.on("end", () => resolve(Buffer.concat(parts).toString()));
        res.on("error", reject);
      },
    );
    req.on("timeout", () =>
      req.destroy(Error("Превышено время ожидания источника")),
    );
    req.on("error", reject);
  });
}
