import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { query, rows, tx } from "./db.mjs";
import {
  can,
  token,
  digest,
  hashPassword,
  verifyPassword,
  encrypt,
} from "./security.mjs";
import { score } from "./scoring.mjs";
import { enqueue } from "./queue.mjs";
import { probeSource } from "./connectors/probe.mjs";
import { z } from "zod";
const email = z
  .string()
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
const password = z.string().min(12).max(128);
const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(200);
const roles = z.enum(["admin", "member", "viewer"]);
const managedRoles = z.enum(["owner", "admin", "member"]);
const rule = z.object({
  label: text,
  field: z.enum([
    "skills",
    "budget",
    "responses",
    "geography",
    "payment_type",
    "title",
    "description",
    "currency",
    "platform",
  ]),
  op: z.enum(["contains", "equals", "gte", "lte"]),
  value: z.union([z.string().max(500), z.number().finite()]),
  points: z.number().int().min(-100).max(100),
  currency: z.string().max(10).optional(),
  exclude: z.boolean().optional(),
}).superRefine((r, ctx) => {
  if (['gte', 'lte'].includes(r.op) && (r.value === '' || !Number.isFinite(Number(r.value)))) ctx.addIssue({ code: 'custom', message: 'Числовое условие требует число', path: ['value'] });
  if (r.field === 'budget' && !r.currency?.trim()) ctx.addIssue({ code: 'custom', message: 'Для сравнения бюджета укажите валюту', path: ['currency'] });
});
function fail(status, message) {
  throw Object.assign(Error(message), { status });
}
const cookie = (t) =>
  `signal_session=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === "production" && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(process.env.APP_URL || "") ? "; Secure" : ""}`;
const json = (v, status = 200, headers = {}) =>
  Response.json(v, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
async function audit(c, s, action, listing = null, data = {}) {
  await c.query(
    "INSERT INTO history(team_id,listing_id,user_id,action,data) VALUES($1,$2,$3,$4,$5)",
    [s.team_id, listing, s.user_id, action, JSON.stringify(data)],
  );
}
export async function handle(req) {
  try {
    return await route(req);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json(
        {
          error: e.issues
            .map((v) => v.path.join(".") + ": " + v.message)
            .join("; "),
        },
        400,
      );
    if (e.code === "23505")
      return json({ error: "Такая запись уже существует" }, 409);
    if (e.code === "23503")
      return json({ error: "Связанная запись недоступна" }, 400);
    if (!e.status) console.error("API failure", e.code || e.message);
    return json(
      { error: e.status ? e.message : "Внутренняя ошибка сервера" },
      e.status || 500,
    );
  }
}
async function route(req) {
  const url = new URL(req.url),
    path = url.pathname.replace(/^\/api\/?/, ""),
    method = req.method;
  let b = {};
  if (!["GET", "HEAD"].includes(method)) {
    const origin = req.headers.get("origin");
    const expected = process.env.APP_URL;
    if (origin && origin !== (expected || url.origin))
      fail(403, "Недопустимый источник запроса");
    const body = await req.text();
    if (body.length > 100000) fail(413, "Слишком большой запрос");
    try {
      b = body ? JSON.parse(body) : {};
    } catch {
      fail(400, "Некорректный JSON");
    }
  }
  if (path === "health") {
    await query("SELECT 1");
    return json({ ok: true });
  }
  if (path === "auth/login" && method === "POST") {
    const v = z
      .object({ email: z.string().trim().min(1).max(254).transform((s) => s.toLowerCase()), password: z.string().min(1).max(128) })
      .parse(b);
    const key = digest(v.email);
    const attempts = (
      await query(
        `INSERT INTO login_attempts(key,count,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN login_attempts.reset_at<now() THEN 1 ELSE login_attempts.count+1 END,reset_at=CASE WHEN login_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END RETURNING count`,
        [key],
      )
    ).rows[0].count;
    if (attempts > 20) fail(429, "Слишком много попыток. Подождите 15 минут.");
    const user = (
      await rows("SELECT * FROM users WHERE email=$1 OR login=$1", [v.email])
    )[0];
    if (!user || !verifyPassword(v.password, user.password))
      fail(401, "Неверный email или пароль");
    const membership = (
      await rows("SELECT * FROM members WHERE user_id=$1 AND blocked_at IS NULL LIMIT 1", [user.id])
    )[0];
    if (!membership) fail(403, "Доступ к команде отозван");
    const t = token();
    await query(
      "INSERT INTO sessions(token,user_id,team_id,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
      [digest(t), user.id, membership.team_id],
    );
    return json({ ok: true }, 200, { "Set-Cookie": cookie(t) });
  }
  if (path === "auth/accept" && method === "POST") {
    const v = z
      .object({ token: z.string().length(64), email, name: text, password })
      .parse(b);
    await tx(async (c) => {
      const invite = (
        await c.query(
          "SELECT * FROM invites WHERE token=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE",
          [digest(v.token)],
        )
      ).rows[0];
      if (!invite || invite.email !== v.email)
        fail(400, "Приглашение недействительно или email не совпадает");
      let user = (
        await c.query("SELECT * FROM users WHERE email=$1", [v.email])
      ).rows[0];
      if (user && !verifyPassword(v.password, user.password))
        fail(401, "Введите пароль существующей учётной записи");
      if (!user) {
        user = { id: randomUUID() };
        await c.query("INSERT INTO users(id,email,name,password) VALUES($1,$2,$3,$4)", [
          user.id,
          v.email,
          v.name,
          hashPassword(v.password),
        ]);
      }
      await c.query(
        "INSERT INTO members(team_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [invite.team_id, user.id, invite.role],
      );
      await c.query("UPDATE invites SET used_at=now() WHERE token=$1", [
        digest(v.token),
      ]);
    });
    return json({ ok: true });
  }
  const raw = req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("signal_session="))
    ?.slice(15);
  const s = raw
    ? (
        await rows(
          `SELECT s.*,u.email,u.name,u.login,m.role,t.name AS team_name FROM sessions s JOIN users u ON u.id=s.user_id JOIN members m ON m.team_id=s.team_id AND m.user_id=s.user_id AND m.blocked_at IS NULL JOIN teams t ON t.id=s.team_id WHERE s.token=$1 AND s.expires_at>now()`,
          [digest(raw)],
        )
      )[0]
    : null;
  if (!s) fail(401, "Войдите в рабочее пространство");
  const need = (a) => {
    if (!can(s.role, a)) fail(403, "Недостаточно прав");
  };
  if (path === "auth/logout" && method === "POST") {
    await query("DELETE FROM sessions WHERE token=$1", [s.token]);
    return json({ ok: true }, 200, {
      "Set-Cookie":
        "signal_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    });
  }
  if (path === "me" && method === "GET")
    return json({
      id: s.user_id,
      name: s.name,
      email: s.email,
      login: s.login,
      role: s.role,
      team: s.team_name,
      team_id: s.team_id,
      teams: await rows(
        "SELECT t.id,t.name FROM teams t JOIN members m ON m.team_id=t.id WHERE m.user_id=$1 AND m.blocked_at IS NULL ORDER BY t.name",
        [s.user_id],
      ),
    });
  if (path === "auth/switch" && method === "POST") {
    const v = z.object({ team_id: uuid }).parse(b);
    if (
      !(
        await rows("SELECT 1 FROM members WHERE team_id=$1 AND user_id=$2 AND blocked_at IS NULL", [
          v.team_id,
          s.user_id,
        ])
      ).length
    )
      fail(403, "Нет доступа к команде");
    await query(
      "UPDATE sessions SET team_id=$2,created_at=now(),checked_at=NULL WHERE token=$1",
      [s.token, v.team_id],
    );
    return json({ ok: true });
  }
  if (path === "session/check" && method === "POST") {
    await tx(async (c) => {
      const result = await c.query(
        "UPDATE sessions SET checked_at=now() WHERE token=$1 AND checked_at IS NULL AND created_at<=now()-interval '1 minute' RETURNING team_id",
        [s.token],
      );
      if (result.rowCount)
        await c.query(
          `INSERT INTO jobs(team_id,connection_id) SELECT team_id,id FROM connections WHERE team_id=$1 AND enabled AND archived_at IS NULL AND next_sync<=now() ON CONFLICT DO NOTHING`,
          [s.team_id],
        );
    });
    return json({ ok: true });
  }
  if (path === "overview" && method === "GET") {
    const stats = (
      await rows(
        `SELECT count(*) FILTER(WHERE NOT archived)::int AS total,count(*) FILTER(WHERE NOT archived AND score>=70 AND NOT excluded)::int AS strong,count(*) FILTER(WHERE stage_id IS NOT NULL AND NOT archived)::int AS pipeline,count(*) FILTER(WHERE created_at>now()-interval '24 hours')::int AS today FROM listings WHERE team_id=$1`,
        [s.team_id],
      )
    )[0];
    const conn = (
      await rows(
        "SELECT count(*) FILTER(WHERE enabled AND archived_at IS NULL)::int AS active,count(*) FILTER(WHERE archived_at IS NULL)::int AS total,max(last_sync) AS last_sync FROM connections WHERE team_id=$1",
        [s.team_id],
      )
    )[0];
    return json({ stats, connections: conn });
  }
  if (path === "listings" && method === "GET") {
    const q = (url.searchParams.get("q") || "").slice(0, 200),
      view = url.searchParams.get("view") || "feed",
      source = url.searchParams.get("source") || "",
      min = Math.max(
        0,
        Math.min(100, Number(url.searchParams.get("min")) || 0),
      ),
      sort = url.searchParams.get("sort"),
      offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const order =
      {
        score: "l.score DESC,l.created_at DESC",
        budget: "l.currency,l.budget DESC NULLS LAST",
        new: "l.published_at DESC NULLS LAST,l.created_at DESC",
      }[sort] || "l.published_at DESC NULLS LAST,l.created_at DESC";
    const where = `l.team_id=$1 AND l.archived=$2 AND ($3='' OR l.title ILIKE '%'||$3||'%' OR l.description ILIKE '%'||$3||'%' OR l.skills::text ILIKE '%'||$3||'%') AND ($4='' OR l.platform=$4) AND l.score>=$5 AND ($6<>'favorites' OR f.user_id IS NOT NULL)`;
    const args = [
      s.team_id,
      view === "archive",
      q,
      source,
      min,
      view,
      s.user_id,
    ];
    const result = await rows(
      `SELECT l.*,f.user_id IS NOT NULL AS favorite,u.name AS assignee,st.name AS stage_name,count(*) OVER()::int AS total_count FROM listings l LEFT JOIN favorites f ON f.listing_id=l.id AND f.user_id=$7 LEFT JOIN users u ON u.id=l.assignee_id LEFT JOIN stages st ON st.id=l.stage_id WHERE ${where} ORDER BY ${order} LIMIT 100 OFFSET $8`,
      [...args, offset],
    );
    return json({
      items: result,
      total: result[0]?.total_count || 0,
      platforms: (
        await rows(
          "SELECT DISTINCT platform FROM listings WHERE team_id=$1 ORDER BY platform",
          [s.team_id],
        )
      ).map((r) => r.platform),
    });
  }
  let m = path.match(/^listings\/([\w-]+)$/);
  if (m) {
    const id = uuid.parse(m[1]);
    if (
      !(
        await rows("SELECT id FROM listings WHERE team_id=$1 AND id=$2", [
          s.team_id,
          id,
        ])
      ).length
    )
      fail(404, "Объявление не найдено");
    if (method === "GET")
      return json({
        notes: await rows(
          "SELECT n.*,u.name FROM notes n JOIN users u ON u.id=n.user_id WHERE n.team_id=$1 AND n.listing_id=$2 ORDER BY n.created_at",
          [s.team_id, id],
        ),
        history: await rows(
          "SELECT h.*,u.name FROM history h LEFT JOIN users u ON u.id=h.user_id WHERE h.team_id=$1 AND h.listing_id=$2 ORDER BY h.created_at DESC LIMIT 100",
          [s.team_id, id],
        ),
      });
    if (method === "PATCH") {
      need("write");
      const v = z
        .object({
          stage_id: uuid.nullable().optional(),
          assignee_id: uuid.nullable().optional(),
          priority: z.enum(["low", "normal", "high"]).optional(),
          archived: z.boolean().optional(),
        })
        .strict()
        .parse(b);
      const keys = Object.keys(v);
      if (keys.length)
        await tx(async (c) => {
          await c.query(
            `UPDATE listings SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(",")},updated_at=now() WHERE team_id=$1 AND id=$2`,
            [s.team_id, id, ...Object.values(v)],
          );
          await audit(c, s, "Объявление обновлено", id, v);
        });
      return json({ ok: true });
    }
  }
  m = path.match(/^listings\/([\w-]+)\/(favorite|notes)$/);
  if (m && method === "POST") {
    const id = uuid.parse(m[1]);
    if (
      !(
        await rows("SELECT id FROM listings WHERE team_id=$1 AND id=$2", [
          s.team_id,
          id,
        ])
      ).length
    )
      fail(404, "Объявление не найдено");
    if (m[2] === "favorite") {
      const v = z.object({ value: z.boolean() }).parse(b);
      if (v.value)
        await query(
          "INSERT INTO favorites VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [s.team_id, id, s.user_id],
        );
      else
        await query(
          "DELETE FROM favorites WHERE team_id=$1 AND listing_id=$2 AND user_id=$3",
          [s.team_id, id, s.user_id],
        );
    } else {
      need("write");
      const v = z
        .object({ body: z.string().trim().min(1).max(10000) })
        .parse(b);
      await tx(async (c) => {
        await c.query(
          "INSERT INTO notes(id,team_id,listing_id,user_id,body) VALUES($1,$2,$3,$4,$5)",
          [randomUUID(), s.team_id, id, s.user_id, v.body],
        );
        await audit(c, s, "Добавлена заметка", id);
      });
    }
    return json({ ok: true });
  }
  if (path === "boards" && method === "GET")
    return json({
      boards: await rows(
        "SELECT * FROM boards WHERE team_id=$1 ORDER BY name",
        [s.team_id],
      ),
      stages: await rows(
        "SELECT * FROM stages WHERE team_id=$1 ORDER BY position",
        [s.team_id],
      ),
    });
  if (path === "boards" && method === "POST") {
    need("admin");
    const v = z
      .object({ name: text, stages: z.array(text).min(1).max(15) })
      .parse(b);
    await tx(async (c) => {
      const id = randomUUID();
      await c.query("INSERT INTO boards VALUES($1,$2,$3)", [
        id,
        s.team_id,
        v.name,
      ]);
      for (const [i, name] of v.stages.entries())
        await c.query("INSERT INTO stages VALUES($1,$2,$3,$4,$5)", [
          randomUUID(),
          s.team_id,
          id,
          name,
          i,
        ]);
      await audit(c, s, "Создана воронка", null, { name: v.name });
    });
    return json({ ok: true });
  }
  m = path.match(/^stages\/([\w-]+)$/);
  if (m && method === "PATCH") {
    need("admin");
    const v = z
      .object({ name: text, position: z.number().int().min(0).max(100) })
      .parse(b);
    await query(
      "UPDATE stages SET name=$3,position=$4 WHERE team_id=$1 AND id=$2",
      [s.team_id, uuid.parse(m[1]), v.name, v.position],
    );
    return json({ ok: true });
  }
  if (path === "stages" && method === "POST") {
    need("admin");
    const v = z
      .object({
        board_id: uuid,
        name: text,
        position: z.number().int().min(0).max(100),
      })
      .parse(b);
    await query("INSERT INTO stages VALUES($1,$2,$3,$4,$5)", [
      randomUUID(),
      s.team_id,
      v.board_id,
      v.name,
      v.position,
    ]);
    return json({ ok: true });
  }
  if (path === "connections" && method === "GET")
    return json({
      items: await rows(
        `SELECT c.id,c.name,c.connector,c.owner_id,u.name AS owner,c.interval_minutes,c.enabled,c.archived_at,c.last_sync,c.last_attempt,c.error,c.fetched,c.inserted,c.secret IS NOT NULL AS has_secret,CASE WHEN c.owner_id=$2 OR $3 THEN c.config ELSE '{}'::jsonb END AS config,(SELECT status FROM jobs j WHERE j.connection_id=c.id ORDER BY j.id DESC LIMIT 1) AS job_status FROM connections c JOIN users u ON u.id=c.owner_id WHERE c.team_id=$1 ORDER BY c.name`,
        [s.team_id, s.user_id, can(s.role, "admin")],
      ),
      registry: await rows(
        "SELECT key,label,kind FROM connectors ORDER BY label",
      ),
    });
  if (path === "connections/probe" && method === "POST") {
    need("write");
    const v = z
      .object({
        url: z.string().url().max(2000),
        secret: z.string().max(10000).optional(),
      })
      .strict()
      .parse(b);
    try {
      return json(await probeSource(v.url, v.secret));
    } catch (error) {
      fail(400, error.message || "Не удалось проверить источник");
    }
  }
  if (path === "connections" && method === "POST") {
    need("write");
    const v = z
      .object({
        connector: text,
        name: text,
        interval_minutes: z.number().int().min(10).max(30),
        url: z.string().url().optional(),
        platform: z.string().max(100).optional(),
        array_path: z.string().max(500).optional(),
        secret: z.string().max(10000).optional(),
      })
      .parse(b);
    await tx(async (c) => {
      await c.query(
        "INSERT INTO connections(id,team_id,owner_id,connector,name,config,secret,interval_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          s.team_id,
          s.user_id,
          v.connector,
          v.name,
          JSON.stringify({ url: v.url, platform: v.platform, array_path: v.array_path }),
          encrypt(v.secret),
          v.interval_minutes,
        ],
      );
      await audit(c, s, "Подключён источник", null, { name: v.name });
    });
    return json({ ok: true });
  }
  m = path.match(/^connections\/([\w-]+)(\/sync)?$/);
  if (m) {
    need("write");
    const id = uuid.parse(m[1]),
      c = (
        await rows("SELECT * FROM connections WHERE team_id=$1 AND id=$2", [
          s.team_id,
          id,
        ])
      )[0];
    if (!c) fail(404, "Подключение не найдено");
    if (c.owner_id !== s.user_id && !(m[2] || can(s.role, "admin")))
      fail(403, "Это индивидуальное подключение другого участника");
    if (m[2] && method === "POST") {
      const job = await enqueue({ query }, s.team_id, id, true);
      return json({ ok: true, queued: !!job });
    }
    if (method === "PATCH") {
      const v = z
        .object({
          name: text.optional(),
          connector: text.optional(),
          url: z.string().url().max(2000).optional(),
          platform: z.string().trim().max(100).optional(),
          array_path: z.string().max(500).optional(),
          enabled: z.boolean().optional(),
          archived: z.boolean().optional(),
          interval_minutes: z.number().int().min(10).max(30).optional(),
          secret: z.string().max(10000).optional(),
        })
        .strict()
        .parse(b);
      if (
        c.owner_id !== s.user_id &&
        (v.secret !== undefined ||
          v.interval_minutes !== undefined ||
          v.name !== undefined ||
          v.connector !== undefined ||
          v.url !== undefined ||
          v.platform !== undefined ||
          v.array_path !== undefined)
      )
        fail(403, "Только владелец может менять параметры");
      const config = {
        ...(c.config || {}),
        ...(v.url !== undefined ? { url: v.url } : {}),
        ...(v.platform !== undefined ? { platform: v.platform } : {}),
        ...(v.array_path !== undefined ? { array_path: v.array_path } : {}),
      };
      await tx(async (client) => {
        await client.query(
          `UPDATE connections SET
            name=COALESCE($3,name),connector=COALESCE($4,connector),
            config=$5,enabled=CASE WHEN $6 THEN false ELSE COALESCE($7,enabled) END,
            archived_at=CASE WHEN $6 THEN now() WHEN $8 THEN NULL ELSE archived_at END,
            interval_minutes=COALESCE($9,interval_minutes),
            secret=CASE WHEN $10 THEN $11 ELSE secret END
           WHERE team_id=$1 AND id=$2`,
          [s.team_id,id,v.name ?? null,v.connector ?? null,JSON.stringify(config),v.archived === true,v.enabled ?? null,v.archived === false,v.interval_minutes ?? null,v.secret !== undefined,encrypt(v.secret)],
        );
        await audit(client, s, v.archived === true ? "Источник архивирован" : "Источник изменён", null, { connection_id: id });
      });
      return json({ ok: true });
    }
    if (method === "DELETE") {
      if (c.owner_id !== s.user_id && !can(s.role, "admin"))
        fail(403, "Удалить источник может владелец подключения или администратор");
      await tx(async (client) => {
        await client.query("DELETE FROM connections WHERE team_id=$1 AND id=$2", [s.team_id, id]);
        await audit(client, s, "Источник удалён", null, { connection_id: id, name: c.name });
      });
      return json({ ok: true });
    }
  }
  if (path === "sync" && method === "POST") {
    need("write");
    await query(
      `INSERT INTO jobs(team_id,connection_id) SELECT team_id,id FROM connections WHERE team_id=$1 AND enabled AND archived_at IS NULL ON CONFLICT DO NOTHING`,
      [s.team_id],
    );
    return json({ ok: true });
  }
  if (path === "modules" && method === "GET") {
    need("admin");
    return json({
      files: (await readdir("modules")).filter((n) =>
        /^[a-z0-9_-]+\.mjs$/.test(n),
      ),
    });
  }
  if (path === "modules" && method === "POST") {
    need("admin");
    const v = z
      .object({
        key: z.string().regex(/^[a-z][a-z0-9_-]{2,40}$/),
        label: text,
        module: z.string().regex(/^[a-z0-9_-]+\.mjs$/),
      })
      .parse(b);
    if (!(await readdir("modules")).includes(v.module))
      fail(400, "Модуль должен быть установлен на сервере");
    await query("INSERT INTO connectors VALUES($1,$2,'module',$3)", [
      v.key,
      v.label,
      v.module,
    ]);
    return json({ ok: true });
  }
  if (path === "rules" && method === "GET")
    return json({
      rules: (await rows("SELECT rules FROM teams WHERE id=$1", [s.team_id]))[0]
        .rules,
    });
  if (path === "rules" && method === "PUT") {
    need("admin");
    const v = z.object({ rules: z.array(rule).max(40) }).parse(b);
    await tx(async (c) => {
      await c.query("UPDATE teams SET rules=$2 WHERE id=$1", [
        s.team_id,
        JSON.stringify(v.rules),
      ]);
      const listings = (
        await c.query("SELECT * FROM listings WHERE team_id=$1", [s.team_id])
      ).rows;
      for (const l of listings) {
        const r = score(l, v.rules);
        await c.query(
          "UPDATE listings SET score=$3,breakdown=$4,excluded=$5 WHERE team_id=$1 AND id=$2",
          [s.team_id, l.id, r.score, JSON.stringify(r.breakdown), r.excluded],
        );
      }
      await audit(c, s, "Обновлены правила оценки");
    });
    return json({ ok: true });
  }
  if (path === "members" && method === "GET")
    return json({
      items: await rows(
        "SELECT u.id,u.name,u.email,u.login,m.blocked_at,m.role,(SELECT count(*)::int FROM sessions se WHERE se.user_id=u.id AND se.team_id=m.team_id AND se.expires_at>now()) AS session_count FROM members m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 ORDER BY u.name",
        [s.team_id],
      ),
    });
  if (path === "accounts" && method === "POST") {
    need("owner");
    const v = z.object({ name: text, role: managedRoles }).strict().parse(b);
    const base = v.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 16) || "user";
    let login;
    do login = `${base}${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`;
    while ((await rows("SELECT 1 FROM users WHERE login=$1", [login])).length);
    const generatedPassword = token().slice(0, 20);
    await tx(async (c) => {
      const id = randomUUID();
      await c.query(
        "INSERT INTO users(id,email,name,password,login) VALUES($1,$2,$3,$4,$5)",
        [id, `${login}@accounts.signal.invalid`, v.name, hashPassword(generatedPassword), login],
      );
      await c.query("INSERT INTO members(team_id,user_id,role) VALUES($1,$2,$3)", [s.team_id, id, v.role]);
      await audit(c, s, "Создан управляемый аккаунт", null, { user_id: id, role: v.role });
    });
    return json({ login, password: generatedPassword }, 201);
  }
  m = path.match(/^accounts\/([\w-]+)(?:\/(reset-password|end-sessions))?$/);
  if (m) {
    need("owner");
    const userId = uuid.parse(m[1]);
    const target = (await rows("SELECT u.*,m.role FROM users u JOIN members m ON m.user_id=u.id WHERE m.team_id=$1 AND u.id=$2", [s.team_id, userId]))[0];
    if (!target) fail(404, "Пользователь не найден");
    if (userId === s.user_id) fail(400, "Для текущего владельца это действие недоступно");
    if (!m[2] && method === "PATCH") {
      const v = z.object({ role: managedRoles.optional(), blocked: z.boolean().optional() }).strict().parse(b);
      if (v.role === undefined && v.blocked === undefined) fail(400, "Нет изменений");
      await tx(async (c) => {
        if (v.role !== undefined)
          await c.query("UPDATE members SET role=$3 WHERE team_id=$1 AND user_id=$2", [s.team_id, userId, v.role]);
        if (v.blocked !== undefined) {
          await c.query("UPDATE members SET blocked_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE team_id=$1 AND user_id=$2", [s.team_id, userId, v.blocked]);
          if (v.blocked) await c.query("DELETE FROM sessions WHERE user_id=$1 AND team_id=$2", [userId, s.team_id]);
        }
        await audit(c, s, v.blocked === true ? "Аккаунт заблокирован" : "Аккаунт изменён", null, { user_id: userId, ...v });
      });
      return json({ ok: true });
    }
    if (m[2] === "reset-password" && method === "POST") {
      const generatedPassword = token().slice(0, 20);
      await tx(async (c) => {
        await c.query("UPDATE users SET password=$2 WHERE id=$1", [userId, hashPassword(generatedPassword)]);
        await c.query("DELETE FROM sessions WHERE user_id=$1", [userId]);
        await audit(c, s, "Пароль аккаунта сброшен", null, { user_id: userId });
      });
      return json({ password: generatedPassword });
    }
    if (m[2] === "end-sessions" && method === "POST") {
      await query("DELETE FROM sessions WHERE user_id=$1 AND team_id=$2", [userId, s.team_id]);
      return json({ ok: true });
    }
  }
  m = path.match(/^members\/([\w-]+)$/);
  if (m && method === "PATCH") {
    need("owner");
    const v = z.object({ role: roles }).parse(b);
    await query(
      "UPDATE members SET role=$3 WHERE team_id=$1 AND user_id=$2 AND role<>'owner'",
      [s.team_id, uuid.parse(m[1]), v.role],
    );
    return json({ ok: true });
  }
  if (path === "invites" && method === "POST") {
    need("admin");
    const v = z.object({ email, role: roles }).parse(b);
    if (v.role === "admin" && s.role !== "owner")
      fail(403, "Администратора приглашает владелец");
    const t = token();
    await query(
      "INSERT INTO invites VALUES($1,$2,$3,$4,now()+interval '3 days',NULL)",
      [digest(t), s.team_id, v.email, v.role],
    );
    return json({
      url: `${process.env.APP_URL || url.origin}/?invite=${t}`,
      expires: "72 часа",
    });
  }
  if (path === "duplicates" && method === "GET")
    return json({
      items: await rows(
        `SELECT d.*,a.title AS left_title,b.title AS right_title,a.platform AS left_platform,b.platform AS right_platform FROM duplicates d JOIN listings a ON a.id=d.left_id JOIN listings b ON b.id=d.right_id WHERE d.team_id=$1 ORDER BY (d.status='pending') DESC,d.similarity DESC LIMIT 200`,
        [s.team_id],
      ),
    });
  if (path === "duplicates" && method === "PATCH") {
    need("write");
    const v = z
      .object({
        left_id: uuid,
        right_id: uuid,
        status: z.enum(["confirmed", "dismissed"]),
      })
      .parse(b);
    await tx(async (c) => {
      const r = await c.query(
        "UPDATE duplicates SET status=$4 WHERE team_id=$1 AND left_id=$2 AND right_id=$3 RETURNING left_id",
        [s.team_id, v.left_id, v.right_id, v.status],
      );
      if (!r.rowCount) fail(404, "Пара не найдена");
      await audit(
        c,
        s,
        v.status === "confirmed" ? "Подтверждён дубль" : "Совпадение отклонено",
        v.left_id,
        { related: v.right_id },
      );
    });
    return json({ ok: true });
  }
  if (path === "activity" && method === "GET")
    return json({
      items: await rows(
        "SELECT h.*,u.name FROM history h LEFT JOIN users u ON u.id=h.user_id WHERE h.team_id=$1 ORDER BY h.created_at DESC LIMIT 100",
        [s.team_id],
      ),
    });
  fail(404, "Маршрут не найден");
}
