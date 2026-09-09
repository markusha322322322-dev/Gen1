import { sync as mock } from "./mock.mjs";
import { get } from "./http.mjs";
import { XMLParser } from "fast-xml-parser";
import { pathToFileURL } from "node:url";
import path from "node:path";
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
export async function runConnector(c, secret) {
  if (c.connector === "mock") return mock();
  if (c.connector === "json") {
    let v = JSON.parse(await get(c.config.url, secret));
    if (c.config.array_path && c.config.array_path !== "$") {
      const parts = c.config.array_path
        .replace(/^\$\.?/, "")
        .replace(/\[0\]/g, "")
        .split(".")
        .filter(Boolean);
      for (const part of parts) v = v?.[part];
    }
    if (!Array.isArray(v))
      throw Error("JSON API должен возвращать массив единой модели");
    return v;
  }
  if (c.connector === "rss") {
    const xml = await get(c.config.url, secret);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error("XML entities запрещены");
    const v = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
    }).parse(xml);
    const entries = list(v.rss?.channel?.item ?? v.feed?.entry);
    return entries.map((i) => ({
      platform: c.config.platform || new URL(c.config.url).hostname,
      external_id: String(
        i.guid?.["#text"] ??
          i.guid ??
          i.id ??
          i.link?.["@_href"] ??
          i.link ??
          "",
      ),
      url: typeof i.link === "string" ? i.link : i.link?.["@_href"],
      title: String(i.title?.["#text"] ?? i.title ?? ""),
      description: String(i.description ?? i.summary ?? ""),
      published_at: i.pubDate ?? i.published ?? null,
      source_updated_at: i.updated ?? null,
    }));
  }
  if (c.module && /^[a-z0-9_-]+\.mjs$/.test(c.module)) {
    const mod = await import(
      /* webpackIgnore: true */ pathToFileURL(path.resolve("modules", c.module))
        .href
    );
    return mod.sync({
      config: c.config,
      token: secret,
      signal: AbortSignal.timeout(25000),
    });
  }
  throw Error("Коннектор не установлен");
}
export function normalize(v) {
  if (
    !v ||
    typeof v.title !== "string" ||
    !v.title.trim() ||
    !v.external_id ||
    !v.platform
  )
    throw Error("Источник не передал title, platform или external_id");
  const date = (s) =>
    s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null;
  const number = (v) =>
    v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;
  let url = null;
  try {
    const u = new URL(v.url);
    if (["https:", "http:"].includes(u.protocol)) url = u.href;
  } catch {}
  return {
    platform: String(v.platform).slice(0, 100),
    external_id: String(v.external_id).slice(0, 500),
    url,
    title: v.title.slice(0, 500),
    description:
      v.description == null ? null : String(v.description).slice(0, 50000),
    budget: number(v.budget),
    currency: v.currency ? String(v.currency).slice(0, 10) : null,
    payment_type: ["fixed", "hourly"].includes(v.payment_type)
      ? v.payment_type
      : null,
    skills: Array.isArray(v.skills)
      ? v.skills.filter((s) => typeof s === "string").slice(0, 50)
      : [],
    client: v.client && typeof v.client === "object" ? v.client : null,
    geography: v.geography ? String(v.geography).slice(0, 200) : null,
    responses: number(v.responses),
    published_at: date(v.published_at),
    source_updated_at: date(v.source_updated_at),
    source_status: v.source_status
      ? String(v.source_status).slice(0, 50)
      : null,
  };
}
