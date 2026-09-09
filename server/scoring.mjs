export const defaultRules = [
  {
    label: "React / Next.js",
    field: "skills",
    op: "contains",
    value: "react",
    points: 30,
  },
  {
    label: "Бюджет от $2 000",
    field: "budget",
    op: "gte",
    value: 2000,
    currency: "USD",
    points: 30,
  },
  {
    label: "Менее 20 откликов",
    field: "responses",
    op: "lte",
    value: 20,
    points: 20,
  },
  {
    label: "Фиксированная оплата",
    field: "payment_type",
    op: "equals",
    value: "fixed",
    points: 20,
  },
];
export function matches(item, r) {
  const v = item[r.field];
  if (v == null) return false;
  if (r.field === "budget" && r.currency && item.currency !== r.currency)
    return false;
  switch (r.op) {
    case "contains":
      return (Array.isArray(v) ? v.join(" ") : String(v))
        .toLowerCase()
        .includes(String(r.value).toLowerCase());
    case "equals":
      return String(v).toLowerCase() === String(r.value).toLowerCase();
    case "gte":
      return Number.isFinite(Number(v)) && Number(v) >= Number(r.value);
    case "lte":
      return Number.isFinite(Number(v)) && Number(v) <= Number(r.value);
    default:
      return false;
  }
}
export function score(item, rules) {
  const breakdown = rules.map((r) => ({
    label: r.label,
    matched: matches(item, r),
    points: matches(item, r) ? r.points : 0,
    exclude: !!r.exclude,
    missing: item[r.field] == null,
  }));
  return {
    score: Math.max(
      0,
      Math.min(
        100,
        breakdown.reduce((s, r) => s + r.points, 0),
      ),
    ),
    excluded: breakdown.some((r) => r.exclude && r.matched),
    breakdown,
  };
}
export function similarity(a, b) {
  const words = (s) =>
    new Set(
      String(s)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const x = words(a),
    y = words(b);
  const union = new Set([...x, ...y]);
  return union.size ? [...x].filter((v) => y.has(v)).length / union.size : 0;
}
