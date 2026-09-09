import { query, tx } from "./db.mjs";
import { randomUUID } from "node:crypto";
import { decrypt } from "./security.mjs";
import { runConnector, normalize } from "./connectors/index.mjs";
import { score, similarity } from "./scoring.mjs";
export async function enqueue(c, team, id, force = false) {
  const { rows } = await c.query(
    `INSERT INTO jobs(team_id,connection_id) SELECT team_id,id FROM connections WHERE team_id=$1 AND id=$2 AND enabled AND archived_at IS NULL AND ($3 OR next_sync<=now()) ON CONFLICT DO NOTHING RETURNING id`,
    [team, id, force],
  );
  return rows[0]?.id ?? null;
}
export async function schedule() {
  await tx(async (c) => {
    await c.query(
      `UPDATE jobs SET status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'queued' END, run_at=now(), error='Worker lease expired' WHERE status='running' AND lease_until<now()`,
    );
    await c.query(
      `INSERT INTO jobs(team_id,connection_id) SELECT team_id,id FROM connections WHERE enabled AND archived_at IS NULL AND next_sync<=now() ON CONFLICT DO NOTHING`,
    );
    await c.query(
      `UPDATE sessions SET checked_at=now() WHERE checked_at IS NULL AND created_at<=now()-interval '1 minute' AND expires_at>now() RETURNING team_id`,
    );
    await c.query(
      `DELETE FROM sessions WHERE expires_at<now(); DELETE FROM login_attempts WHERE reset_at<now()-interval '1 day'; DELETE FROM jobs WHERE status IN ('done','failed') AND created_at<now()-interval '30 days'`,
    );
  });
}
export async function processOne() {
  const job = await tx(
    async (c) =>
      (
        await c.query(
          `UPDATE jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '2 minutes' WHERE id=(SELECT id FROM jobs WHERE status='queued' AND run_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
        )
      ).rows[0],
  );
  if (!job) return false;
  try {
    const {
      rows: [connection],
    } = await query(
      `SELECT c.*,r.module FROM connections c JOIN connectors r ON r.key=c.connector WHERE c.id=$1 AND c.team_id=$2`,
      [job.connection_id, job.team_id],
    );
    if (!connection?.enabled) {
      await query(`UPDATE jobs SET status='done' WHERE id=$1`, [job.id]);
      return true;
    }
    await query("UPDATE connections SET last_attempt=now() WHERE id=$1", [
      connection.id,
    ]);
    const raw = await Promise.race([
      runConnector(connection, decrypt(connection.secret)),
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(Error("Коннектор превысил лимит 30 секунд")),
          30000,
        );
        timer.unref();
      }),
    ]);
    if (!Array.isArray(raw) || raw.length > 1000)
      throw Error("Коннектор должен вернуть не более 1000 объявлений");
    const items = raw.map(normalize);
    await tx(async (c) => {
      const locked = (
        await c.query(
          "SELECT id FROM jobs WHERE id=$1 AND status='running' AND attempts=$2 FOR UPDATE",
          [job.id, job.attempts],
        )
      ).rows[0];
      if (!locked) throw Error("Lease lost");
      const active = (
        await c.query(
          "SELECT enabled FROM connections WHERE id=$1 FOR UPDATE",
          [connection.id],
        )
      ).rows[0];
      if (!active?.enabled) {
        await c.query("UPDATE jobs SET status='done' WHERE id=$1", [job.id]);
        return;
      }
      const {
        rows: [team],
      } = await c.query("SELECT rules FROM teams WHERE id=$1 FOR SHARE", [
        job.team_id,
      ]);
      let inserted = 0;
      for (const item of items) {
        const sc = score(item, team.rules);
        const fields = Object.keys(item),
          values = Object.values(item).map((v) =>
            typeof v === "object" && v !== null ? JSON.stringify(v) : v,
          );
        const cols = fields.join(",");
        const placeholders = values.map((_, i) => "$" + (i + 3)).join(",");
        const extras = values.length + 3;
        const result = await c.query(
          `INSERT INTO listings(id,team_id,${cols},score,breakdown,excluded) VALUES($1,$2,${placeholders},$${extras},$${extras + 1},$${extras + 2}) ON CONFLICT(team_id,platform,external_id) DO UPDATE SET ${fields
            .filter((f) => !["platform", "external_id"].includes(f))
            .map((f) => `${f}=EXCLUDED.${f}`)
            .join(
              ",",
            )},score=EXCLUDED.score,breakdown=EXCLUDED.breakdown,excluded=EXCLUDED.excluded,updated_at=now() RETURNING id,(xmax=0) AS inserted`,
          [
            randomUUID(),
            job.team_id,
            ...values,
            sc.score,
            JSON.stringify(sc.breakdown),
            sc.excluded,
          ],
        );
        const row = result.rows[0];
        if (row.inserted) inserted++;
        await c.query(
          "INSERT INTO listing_sources(team_id,listing_id,connection_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [job.team_id, row.id, connection.id],
        );
        if (row.inserted) {
          const others = (
            await c.query(
              "SELECT id,title FROM listings WHERE team_id=$1 AND id<>$2 ORDER BY created_at DESC LIMIT 2000",
              [job.team_id, row.id],
            )
          ).rows;
          for (const other of others) {
            const sim = similarity(item.title, other.title);
            if (sim >= 0.75) {
              const ids = [row.id, other.id].sort();
              await c.query(
                "INSERT INTO duplicates(team_id,left_id,right_id,similarity) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
                [job.team_id, ...ids, sim],
              );
            }
          }
        }
      }
      await c.query(
        `UPDATE connections SET last_sync=now(),next_sync=now()+interval_minutes*interval '1 minute',error=NULL,fetched=$2,inserted=$3 WHERE id=$1`,
        [connection.id, items.length, inserted],
      );
      await c.query(
        `UPDATE jobs SET status='done',lease_until=NULL WHERE id=$1`,
        [job.id],
      );
    });
  } catch (e) {
    await tx(async (c) => {
      const error = String(e.message).slice(0, 500);
      await c.query(
        `UPDATE jobs SET status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'queued' END,run_at=now()+interval '1 minute'*power(2,attempts),lease_until=NULL,error=$2 WHERE id=$1 AND attempts=$3 AND status='running'`,
        [job.id, error, job.attempts],
      );
      await c.query(
        `UPDATE connections SET error=$2,next_sync=now()+interval_minutes*interval '1 minute' WHERE id=$1`,
        [job.connection_id, error],
      );
    });
  }
  return true;
}
