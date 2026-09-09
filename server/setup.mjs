import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool, tx } from "./db.mjs";
import { hashPassword } from "./security.mjs";
import { defaultRules } from "./scoring.mjs";
await tx(async (c) => {
  await c.query("SELECT pg_advisory_xact_lock(738190)");
  await c.query(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  if (process.argv.includes("--bootstrap")) {
    const email = process.env.OWNER_EMAIL?.toLowerCase();
    if (!email) throw Error("Set OWNER_EMAIL");
    if ((await c.query("SELECT 1 FROM users WHERE email=$1", [email])).rowCount)
      return;
    const password = process.env.OWNER_PASSWORD;
    if (!password || password.length < 12)
      throw Error("Set OWNER_PASSWORD (12+ characters) for initial bootstrap");
    const team = randomUUID(),
      user = randomUUID(),
      board = randomUUID();
    await c.query("INSERT INTO teams(id,name,rules) VALUES($1,$2,$3)", [
      team,
      process.env.TEAM_NAME || "Studio Collective",
      JSON.stringify(defaultRules),
    ]);
    await c.query("INSERT INTO users VALUES($1,$2,$3,$4)", [
      user,
      email,
      "Владелец",
      hashPassword(password),
    ]);
    await c.query("INSERT INTO members VALUES($1,$2,'owner')", [team, user]);
    await c.query("INSERT INTO boards VALUES($1,$2,$3)", [
      board,
      team,
      "Основная воронка",
    ]);
    for (const [i, name] of [
      "Новые",
      "Оценка",
      "Отклик отправлен",
      "Переговоры",
      "В работе",
      "Закрыто",
    ].entries())
      await c.query("INSERT INTO stages VALUES($1,$2,$3,$4,$5)", [
        randomUUID(),
        team,
        board,
        name,
        i,
      ]);
    await c.query(
      "INSERT INTO connections(id,team_id,owner_id,connector,name) VALUES($1,$2,$3,'mock','Mock Studio')",
      [randomUUID(), team, user],
    );
    console.log("Owner and team initialized. Mock source enabled.");
  }
});
await pool.end();
console.log("Database ready");
