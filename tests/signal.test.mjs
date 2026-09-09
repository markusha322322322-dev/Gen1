import test, { after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db.mjs";
import { handle } from "../server/api.mjs";
import { score, defaultRules } from "../server/scoring.mjs";
import { normalize } from "../server/connectors/index.mjs";
import { hashPassword, encrypt, decrypt } from "../server/security.mjs";
import { schedule, processOne } from "../server/queue.mjs";
process.env.ENCRYPTION_KEY = "test-key-only-32-characters-long-123456";
process.env.APP_URL = "http://signal.test";
const db = new PGlite();
await db.waitReady;
const q = async (sql, args = []) => {
  if (!args.length && sql.includes(";")) {
    const r = await db.exec(sql);
    return { ...r.at(-1), rowCount: r.at(-1)?.affectedRows || 0 };
  }
  const r = await db.query(sql, args);
  return { ...r, rowCount: r.affectedRows ?? r.rows.length };
};
pool.query = q;
pool.connect = async () => ({ query: q, release() {} });
await db.exec(
  await readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
);
const team = randomUUID(),
  other = randomUUID(),
  owner = randomUUID(),
  viewer = randomUUID(),
  member = randomUUID(),
  connection = randomUUID();
await q("INSERT INTO teams VALUES($1,$2,$3)", [
  team,
  "Test studio",
  JSON.stringify(defaultRules),
]);
await q("INSERT INTO teams VALUES($1,$2,$3)", [other, "Private team", "[]"]);
for (const [id, email, role] of [
  [owner, "owner@signal.test", "owner"],
  [viewer, "viewer@signal.test", "viewer"],
  [member, "member@signal.test", "member"],
]) {
  await q("INSERT INTO users(id,email,name,password) VALUES($1,$2,$3,$4)", [
    id,
    email,
    role,
    hashPassword("test-password-123"),
  ]);
  await q("INSERT INTO members(team_id,user_id,role) VALUES($1,$2,$3)", [team, id, role]);
}
await q(
  "INSERT INTO connections(id,team_id,owner_id,connector,name) VALUES($1,$2,$3,'mock','Test mock')",
  [connection, team, owner],
);
async function call(path, method = "GET", body, cookie) {
  const res = await handle(
    new Request("http://signal.test/api/" + path, {
      method,
      headers: {
        ...(body
          ? { "Content-Type": "application/json", Origin: "http://signal.test" }
          : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  return {
    status: res.status,
    data: await res.json(),
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}
const login = async (email) =>
  (await call("auth/login", "POST", { email, password: "test-password-123" }))
    .cookie;
let oc = await login("owner@signal.test"),
  vc = await login("viewer@signal.test"),
  mc = await login("member@signal.test");
after(async () => {
  await db.close();
});
test("scoring does not fabricate unknowns or mix currencies", () => {
  assert.equal(
    score({ budget: null, responses: null, skills: [] }, defaultRules).score,
    0,
  );
  assert.equal(score({ budget: 9000, currency: "EUR" }, defaultRules).score, 0);
  assert.equal(
    score(
      {
        budget: 2000,
        currency: "USD",
        skills: ["React"],
        responses: 2,
        payment_type: "fixed",
      },
      defaultRules,
    ).score,
    100,
  );
  assert.equal(
    normalize({ title: "Test", platform: "x", external_id: "1" }).budget,
    null,
  );
  assert.equal(
    normalize({
      title: "Test",
      platform: "x",
      external_id: "1",
      url: "javascript:alert(1)",
    }).url,
    null,
  );
});
test("tokens are authenticated ciphertext", () => {
  const encrypted = encrypt("private-token");
  assert.notEqual(encrypted, "private-token");
  assert.equal(decrypt(encrypted), "private-token");
  const altered = Buffer.from(encrypted, "base64");
  altered[13] ^= 1;
  assert.throws(() => decrypt(altered.toString("base64")));
});
test("authentication is mandatory; viewer cannot mutate listings or sync", async () => {
  assert.equal((await call("listings")).status, 401);
  assert.equal((await call("me", "GET", null, oc)).status, 200);
  assert.equal((await call("sync", "POST", {}, vc)).status, 403);
  assert.equal((await call("rules", "PUT", { rules: [] }, mc)).status, 403);
});
test("queue deduplicates requests and exact source records, preserving workflow state", async () => {
  assert.equal((await call("sync", "POST", {}, oc)).status, 200);
  await call("sync", "POST", {}, oc);
  await schedule();
  assert.equal(
    (
      await q(
        "SELECT count(*)::int AS n FROM jobs WHERE status IN ('queued','running')",
      )
    ).rows[0].n,
    1,
  );
  assert.equal(await processOne(), true);
  let jobs = (await q("SELECT * FROM jobs")).rows;
  assert.equal(jobs[0].status, "done", jobs[0].error);
  let items = (await call("listings", "GET", null, oc)).data.items;
  assert.equal(items.length, 9);
  const id = items[0].id;
  await call("listings/" + id, "PATCH", { priority: "high" }, oc);
  await call("sync", "POST", {}, oc);
  await processOne();
  assert.equal(
    (await q("SELECT count(*)::int AS n FROM listings")).rows[0].n,
    9,
  );
  assert.equal(
    (await q("SELECT priority FROM listings WHERE id=$1", [id])).rows[0]
      .priority,
    "high",
  );
  assert.equal(
    (await call("duplicates", "GET", null, oc)).data.items.length,
    1,
  );
});
test("personal favorites, notes and activity persist", async () => {
  const id = (await call("listings", "GET", null, oc)).data.items[0].id;
  await call("listings/" + id + "/favorite", "POST", { value: true }, vc);
  assert.equal(
    (await call("listings?view=favorites", "GET", null, vc)).data.total,
    1,
  );
  assert.equal(
    (await call("listings?view=favorites", "GET", null, oc)).data.total,
    0,
  );
  assert.equal(
    (
      await call(
        "listings/" + id + "/notes",
        "POST",
        { body: "Follow up on scope" },
        mc,
      )
    ).status,
    200,
  );
  assert.equal(
    (await call("listings/" + id, "GET", null, oc)).data.notes.length,
    1,
  );
  assert.equal(
    (
      await call(
        "listings/" + id + "/notes",
        "POST",
        { body: "No permission" },
        vc,
      )
    ).status,
    403,
  );
});
test("tenant boundaries enforced in reads, patches and foreign keys", async () => {
  const foreignId = randomUUID(),
    foreignStage = randomUUID(),
    foreignBoard = randomUUID();
  await q("INSERT INTO boards VALUES($1,$2,$3)", [
    foreignBoard,
    other,
    "Private",
  ]);
  await q("INSERT INTO stages VALUES($1,$2,$3,$4,0)", [
    foreignStage,
    other,
    foreignBoard,
    "Private",
  ]);
  await q(
    "INSERT INTO listings(id,team_id,platform,external_id,title) VALUES($1,$2,'private','1','SECRET')",
    [foreignId, other],
  );
  assert.equal(
    (await call("listings/" + foreignId, "GET", null, oc)).status,
    404,
  );
  assert.equal(
    (await call("listings/" + foreignId, "PATCH", { archived: true }, oc))
      .status,
    404,
  );
  assert.ok(
    !(await call("listings", "GET", null, oc)).data.items.some(
      (l) => l.id === foreignId,
    ),
  );
  const id = (await call("listings", "GET", null, oc)).data.items[0].id;
  assert.equal(
    (await call("listings/" + id, "PATCH", { stage_id: foreignStage }, oc))
      .status,
    400,
  );
});
test("connections conceal secrets and owner-only settings", async () => {
  await call(
    "connections/" + connection,
    "PATCH",
    { secret: "top-secret" },
    oc,
  );
  const data = (await call("connections", "GET", null, mc)).data.items[0];
  assert.equal(data.secret, undefined);
  assert.equal(data.has_secret, true);
  assert.equal(
    (
      await call(
        "connections/" + connection,
        "PATCH",
        { secret: "replace" },
        mc,
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("connections/" + connection, "PATCH", { enabled: false }, mc))
      .status,
    403,
  );
  await call("connections/" + connection, "PATCH", { secret: "" }, oc);
});
test("invites bind email, expire, and cannot be replayed", async () => {
  const inv = await call(
    "invites",
    "POST",
    { email: "new@signal.test", role: "member" },
    oc,
  );
  assert.equal(inv.status, 200);
  const token = new URL(inv.data.url).searchParams.get("invite");
  const body = {
    token,
    email: "wrong@signal.test",
    name: "New",
    password: "new-password-123",
  };
  assert.equal((await call("auth/accept", "POST", body)).status, 400);
  body.email = "new@signal.test";
  assert.equal((await call("auth/accept", "POST", body)).status, 200);
  assert.equal((await call("auth/accept", "POST", body)).status, 400);
  assert.equal(
    (
      await call(
        "invites",
        "POST",
        { email: "x@signal.test", role: "admin" },
        mc,
      )
    ).status,
    403,
  );
});
test("server session check waits one minute and multiple tabs do not duplicate jobs", async () => {
  await q("DELETE FROM jobs");
  await q("UPDATE connections SET next_sync=now()-interval '1 minute'");
  await call("session/check", "POST", {}, oc);
  assert.equal((await q("SELECT count(*)::int AS n FROM jobs")).rows[0].n, 0);
  await q("UPDATE sessions SET created_at=now()-interval '2 minutes'");
  await call("session/check", "POST", {}, oc);
  await call("session/check", "POST", {}, oc);
  assert.equal((await q("SELECT count(*)::int AS n FROM jobs")).rows[0].n, 1);
});
test("rules rescore stored records, duplicate confirmation preserves originals", async () => {
  assert.equal(
    (
      await call(
        "rules",
        "PUT",
        {
          rules: [
            {
              label: "All mock",
              field: "platform",
              op: "equals",
              value: "mock",
              points: 75,
            },
          ],
        },
        oc,
      )
    ).status,
    200,
  );
  assert.ok(
    (await call("listings", "GET", null, oc)).data.items.every(
      (l) => l.score === 75,
    ),
  );
  const d = (await call("duplicates", "GET", null, oc)).data.items[0];
  assert.equal(
    (
      await call(
        "duplicates",
        "PATCH",
        { left_id: d.left_id, right_id: d.right_id, status: "confirmed" },
        oc,
      )
    ).status,
    200,
  );
  assert.equal((await call("listings", "GET", null, oc)).data.total, 9);
});
test("CSRF origin checks reject cross-site mutations", async () => {
  const res = await handle(
    new Request("http://signal.test/api/sync", {
      method: "POST",
      headers: { Origin: "https://evil.test", Cookie: oc },
      body: "{}",
    }),
  );
  assert.equal(res.status, 403);
});
test("board workflow persists stage, assignee and archive state", async () => {
  assert.equal(
    (
      await call(
        "boards",
        "POST",
        { name: "Delivery", stages: ["New", "Review"] },
        oc,
      )
    ).status,
    200,
  );
  const boards = (await call("boards", "GET", null, oc)).data;
  const stage = boards.stages[0];
  const id = (await call("listings", "GET", null, oc)).data.items[0].id;
  assert.equal(
    (
      await call(
        "listings/" + id,
        "PATCH",
        { stage_id: stage.id, assignee_id: member, archived: true },
        mc,
      )
    ).status,
    200,
  );
  const archived = (await call("listings?view=archive", "GET", null, oc)).data
    .items;
  assert.equal(archived.length, 1);
  assert.equal(archived[0].stage_id, stage.id);
  assert.equal(archived[0].assignee_id, member);
  assert.equal(
    (
      await call(
        "stages/" + stage.id,
        "PATCH",
        { name: "Qualified", position: 2 },
        oc,
      )
    ).status,
    200,
  );
});
test("stale leases recover and disabled sources do not execute", async () => {
  await q("DELETE FROM jobs");
  await q(
    "INSERT INTO jobs(team_id,connection_id,status,attempts,lease_until) VALUES($1,$2,'running',1,now()-interval '1 minute')",
    [team, connection],
  );
  await schedule();
  assert.equal((await q("SELECT status FROM jobs")).rows[0].status, "queued");
  await call("connections/" + connection, "PATCH", { enabled: false }, oc);
  await processOne();
  assert.equal((await q("SELECT status FROM jobs")).rows[0].status, "done");
  assert.equal(
    (await call("connections/" + connection + "/sync", "POST", {}, oc)).data
      .queued,
    false,
  );
});
test("probe rejects hosts outside the server allowlist before connecting", async () => {
  const result = await call(
    "connections/probe",
    "POST",
    { url: "https://127.0.0.1/private" },
    oc,
  );
  assert.equal(result.status, 400);
  assert.match(result.data.error, /не разрешён/);
});
test("owner creates managed accounts, hashes passwords and controls sessions", async () => {
  const created = await call(
    "accounts",
    "POST",
    { name: "Managed User", role: "member" },
    oc,
  );
  assert.equal(created.status, 201);
  assert.ok(created.data.login);
  assert.equal(created.data.password.length, 20);
  const stored = (
    await q("SELECT * FROM users WHERE login=$1", [created.data.login])
  ).rows[0];
  assert.notEqual(stored.password, created.data.password);
  const managedLogin = await call("auth/login", "POST", {
    email: created.data.login,
    password: created.data.password,
  });
  assert.equal(managedLogin.status, 200);
  assert.equal((await call("me", "GET", null, managedLogin.cookie)).status, 200);
  await call(`accounts/${stored.id}/end-sessions`, "POST", {}, oc);
  assert.equal((await call("me", "GET", null, managedLogin.cookie)).status, 401);
  const reset = await call(`accounts/${stored.id}/reset-password`, "POST", {}, oc);
  assert.equal(reset.status, 200);
  assert.equal(
    (
      await call("auth/login", "POST", {
        email: created.data.login,
        password: created.data.password,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call("auth/login", "POST", {
        email: created.data.login,
        password: reset.data.password,
      })
    ).status,
    200,
  );
  await call(`accounts/${stored.id}`, "PATCH", { blocked: true }, oc);
  assert.equal(
    (
      await call("auth/login", "POST", {
        email: created.data.login,
        password: reset.data.password,
      })
    ).status,
    403,
  );
  await call(`accounts/${stored.id}`, "PATCH", { blocked: false, role: "admin" }, oc);
  assert.equal(
    (await q("SELECT role FROM members WHERE team_id=$1 AND user_id=$2", [team, stored.id])).rows[0].role,
    "admin",
  );
});
test("source archive and deletion preserve historical listings", async () => {
  const before = (await q("SELECT count(*)::int AS n FROM listings WHERE team_id=$1", [team])).rows[0].n;
  assert.equal(
    (await call(`connections/${connection}`, "PATCH", { archived: true }, oc)).status,
    200,
  );
  let source = (await call("connections", "GET", null, oc)).data.items.find((item) => item.id === connection);
  assert.ok(source.archived_at);
  assert.equal(source.enabled, false);
  assert.equal(
    (await call(`connections/${connection}`, "PATCH", { archived: false, enabled: true, name: "Renamed source" }, oc)).status,
    200,
  );
  source = (await call("connections", "GET", null, oc)).data.items.find((item) => item.id === connection);
  assert.equal(source.archived_at, null);
  assert.equal(source.name, "Renamed source");
  assert.equal((await call(`connections/${connection}`, "DELETE", null, oc)).status, 200);
  const after = (await q("SELECT count(*)::int AS n FROM listings WHERE team_id=$1", [team])).rows[0].n;
  assert.equal(after, before);
  assert.equal((await q("SELECT count(*)::int AS n FROM connections WHERE id=$1", [connection])).rows[0].n, 0);
});
