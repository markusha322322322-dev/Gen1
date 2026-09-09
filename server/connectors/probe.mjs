import { XMLParser } from "fast-xml-parser";
import { request } from "./http.mjs";

const list = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];

function compact(value, depth = 0) {
  if (depth > 4) return "[вложенные данные]";
  if (typeof value === "string")
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value))
    return value.slice(0, 3).map((item) => compact(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([key, item]) => [key, compact(item, depth + 1)]),
    );
  return value;
}

function arrayPaths(value, path = "$", depth = 0, result = []) {
  if (depth > 5 || result.length >= 30 || !value || typeof value !== "object")
    return result;
  if (Array.isArray(value)) {
    const first = value.find((item) => item && typeof item === "object");
    result.push({
      path,
      length: value.length,
      fields: first && !Array.isArray(first) ? Object.keys(first).slice(0, 30) : [],
    });
    if (first) arrayPaths(first, `${path}[0]`, depth + 1, result);
    return result;
  }
  for (const [key, item] of Object.entries(value).slice(0, 50))
    arrayPaths(item, `${path}.${key}`, depth + 1, result);
  return result;
}

function rootFields(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).slice(0, 50)
    : [];
}

export async function probeSource(url, secret) {
  const response = await request(url, secret);
  const result = {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    content_type: response.contentType || "не указан",
    bytes: response.contentLength,
    data_type: "text",
    arrays: [],
    fields: [],
    preview: response.body.slice(0, 2000),
    suggested_connector: "json",
    suggested_array_path: null,
    openapi_endpoints: [],
  };
  if (!result.ok) return result;

  const body = response.body.trim();
  const looksJson =
    response.contentType.includes("json") || body.startsWith("{") || body.startsWith("[");
  if (looksJson) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw Error("Ответ похож на JSON, но содержит синтаксическую ошибку");
    }
    const openapi =
      parsed &&
      !Array.isArray(parsed) &&
      (typeof parsed.openapi === "string" || typeof parsed.swagger === "string");
    result.data_type = openapi ? "openapi" : "json";
    result.arrays = arrayPaths(parsed);
    result.suggested_array_path = result.arrays[0]?.path || null;
    if (openapi) {
      result.suggested_connector = null;
      const base = parsed.servers?.[0]?.url || url;
      result.openapi_endpoints = Object.entries(parsed.paths || {})
        .filter(([path, methods]) =>
          !path.includes("{") && methods && typeof methods === "object" && "get" in methods,
        )
        .slice(0, 20)
        .flatMap(([path]) => {
          try {
            return [new URL(path, base).href];
          } catch {
            return [];
          }
        });
    }
    result.fields = Array.isArray(parsed)
      ? rootFields(parsed.find((item) => item && typeof item === "object"))
      : rootFields(parsed);
    result.preview = compact(parsed);
    return result;
  }

  const looksXml =
    response.contentType.includes("xml") || response.contentType.includes("rss") || body.startsWith("<");
  if (looksXml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(body)) throw Error("XML entities запрещены");
    let parsed;
    try {
      parsed = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(body);
    } catch {
      throw Error("Ответ похож на XML, но не может быть разобран");
    }
    const entries = list(parsed.rss?.channel?.item ?? parsed.feed?.entry);
    result.data_type = entries.length ? "rss" : "xml";
    result.suggested_connector = entries.length ? "rss" : "json";
    result.arrays = entries.length
      ? [{ path: parsed.rss ? "$.rss.channel.item" : "$.feed.entry", length: entries.length, fields: rootFields(entries[0]) }]
      : arrayPaths(parsed);
    result.fields = entries.length ? rootFields(entries[0]) : rootFields(parsed);
    result.preview = compact(entries.length ? entries : parsed);
  }
  return result;
}
