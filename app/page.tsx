"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Archive,
  Bookmark,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Filter,
  Layers,
  LayoutGrid,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Users,
  X,
  Zap,
  GripVertical,
  Radio,
  Menu,
  MoreVertical,
  Pencil,
  Trash2,
  Shield,
  KeyRound,
  Lock,
  Unlock,
  Power,
  Globe2,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Toaster, toast } from "sonner";
type Data = Record<string, any>;
async function api(path: string, method = "GET", body?: unknown) {
  const res = await fetch("/api/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok)
    throw Object.assign(Error(data.error || "Ошибка запроса"), {
      status: res.status,
    });
  return data;
}
const labels: Data = {
  feed: "Лента объявлений",
  boards: "Воронки",
  favorites: "Избранное",
  archive: "Архив",
  connections: "Источники",
  rules: "Правила оценки",
  team: "Команда",
  duplicates: "Возможные дубли",
  activity: "История действий",
};
const roleNames: Data = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Участник",
  viewer: "Наблюдатель",
};
const nav = [
  ["feed", LayoutGrid],
  ["boards", Layers],
  ["favorites", Bookmark],
  ["archive", Archive],
  ["duplicates", Copy],
] as const;
const date = (d: string) =>
  d
    ? new Date(d).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Нет данных";
function money(l: Data) {
  if (l.budget == null) return "Бюджет не указан";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Number(l.budget))} ${l.currency || ""}${l.payment_type === "hourly" ? " / час" : ""}`;
}
function Choice({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (s: string) => void;
  options: [string, string][];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      disabled={disabled}
      value={value || "_none"}
      onValueChange={(v) => onChange(v === "_none" ? "" : v)}
    >
      <SelectTrigger aria-label={label} className="choice">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, t]) => (
          <SelectItem key={v || "_none"} value={v || "_none"}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export default function App() {
  const [me, setMe] = useState<Data | null>(null),
    [starting, setStarting] = useState(true),
    [error, setError] = useState(""),
    [view, setView] = useState("feed"),
    [items, setItems] = useState<Data[]>([]),
    [total, setTotal] = useState(0),
    [platforms, setPlatforms] = useState<string[]>([]),
    [overview, setOverview] = useState<Data>({ stats: {}, connections: {} }),
    [connections, setConnections] = useState<Data[]>([]),
    [registry, setRegistry] = useState<Data[]>([]),
    [members, setMembers] = useState<Data[]>([]),
    [boards, setBoards] = useState<Data[]>([]),
    [stages, setStages] = useState<Data[]>([]),
    [board, setBoard] = useState(""),
    [rules, setRules] = useState<Data[]>([]),
    [duplicates, setDuplicates] = useState<Data[]>([]),
    [activity, setActivity] = useState<Data[]>([]),
    [q, setQ] = useState(""),
    [source, setSource] = useState(""),
    [min, setMin] = useState("0"),
    [sort, setSort] = useState("new"),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState<Data | null>(null),
    [detail, setDetail] = useState<Data>({ notes: [], history: [] }),
    [note, setNote] = useState(""),
    [modal, setModal] = useState(""),
    [form, setForm] = useState<Data>({}),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState(""),
    [connectionTab, setConnectionTab] = useState("active"),
    [probe, setProbe] = useState<Data | null>(null),
    [moving, setMoving] = useState<Set<string>>(new Set());
  const admin = me && ["owner", "admin"].includes(me.role),
    write = me?.role !== "viewer";
  const init = useCallback(async () => {
    try {
      setMe(await api("me"));
      setError("");
    } catch (e: any) {
      if (e.status !== 401) setError(e.message);
    } finally {
      setStarting(false);
    }
  }, []);
  useEffect(() => {
    init();
    setInvite(new URLSearchParams(window.location.search).get("invite") || "");
  }, [init]);
  const refresh = useCallback(async () => {
    if (!me) return;
    try {
      const [o, c, m, b, r, d, a] = await Promise.all(
        [
          "overview",
          "connections",
          "members",
          "boards",
          "rules",
          "duplicates",
          "activity",
        ].map((p) => api(p)),
      );
      setOverview(o);
      setConnections(c.items);
      setRegistry(c.registry);
      setMembers(m.items);
      setBoards(b.boards);
      setStages(b.stages);
      setBoard((prev) => prev || b.boards[0]?.id || "");
      setRules(r.rules);
      setDuplicates(d.items);
      setActivity(a.items);
    } catch (e: any) {
      setError(e.message);
    }
  }, [me]);
  useEffect(() => {
    refresh();
    if (!me) return;
    const timer = setInterval(() => {
      Promise.all([api("overview"), api("connections")])
        .then(([o, c]) => {
          setOverview(o);
          setConnections(c.items);
        })
        .catch(() => {});
    }, 15000);
    const check = setTimeout(
      () => api("session/check", "POST", {}).catch(() => {}),
      60000,
    );
    return () => {
      clearInterval(timer);
      clearTimeout(check);
    };
  }, [me, refresh]);
  const feed = useCallback(
    async (append = false) => {
      if (!me) return;
      setLoading(true);
      try {
        const data = await api(
          "listings?" +
            new URLSearchParams({
              q,
              view,
              source,
              min,
              sort,
              offset: String(append ? items.length : 0),
            }),
        );
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setTotal(data.total);
        setPlatforms(data.platforms || []);
        setError("");
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [me, q, view, source, min, sort, items.length],
  );
  useEffect(() => {
    if (!me) return;
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api(
          "listings?" + new URLSearchParams({ q, view, source, min, sort }),
        );
        if (active) {
          setItems(data.items);
          setTotal(data.total);
          setPlatforms(data.platforms || []);
          setError("");
        }
      } catch (e: any) {
        if (active) setError(e.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [me, q, view, source, min, sort, overview]);
  async function action(
    path: string,
    method: string,
    data: unknown,
    msg = "Сохранено",
  ) {
    setBusy(true);
    try {
      const r = await api(path, method, data);
      toast.success(msg);
      await refresh();
      await feed();
      return r;
    } catch (e: any) {
      toast.error(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function openListing(l: Data) {
    setSelected(l);
    setDetail({ notes: [], history: [] });
    try {
      setDetail(await api("listings/" + l.id));
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function patch(l: Data, p: Data) {
    const result = await action("listings/" + l.id, "PATCH", p);
    if (result)
      setSelected((prev) => (prev?.id === l.id ? { ...prev, ...p } : prev));
  }
  async function moveListing(l: Data, stage_id: string | null) {
    if ((l.stage_id || null) === stage_id || moving.has(l.id)) return;
    const previousStage = l.stage_id || null;
    setItems((current) =>
      current.map((item) => (item.id === l.id ? { ...item, stage_id } : item)),
    );
    setSelected((current) =>
      current?.id === l.id ? { ...current, stage_id } : current,
    );
    setMoving((current) => new Set(current).add(l.id));
    try {
      await api("listings/" + l.id, "PATCH", { stage_id });
    } catch (e: any) {
      setItems((current) =>
        current.map((item) =>
          item.id === l.id ? { ...item, stage_id: previousStage } : item,
        ),
      );
      setSelected((current) =>
        current?.id === l.id
          ? { ...current, stage_id: previousStage }
          : current,
      );
      toast.error(`Перемещение отменено: ${e.message}`);
    } finally {
      setMoving((current) => {
        const next = new Set(current);
        next.delete(l.id);
        return next;
      });
    }
  }
  function show(kind: string, defaults: Data = {}) {
    setForm(defaults);
    setModal(kind);
  }
  const change = (key: string, value: any) =>
    setForm((f) => ({ ...f, [key]: value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let result: any;
    switch (modal) {
      case "invite":
        result = await action("invites", "POST", form, "Приглашение создано");
        if (result) {
          setForm({ ...form, url: result.url });
          return;
        }
        break;
      case "connection":
        result = await action("connections", "POST", {
          ...form,
          interval_minutes: Number(form.interval_minutes),
        });
        break;
      case "editConnection": {
        const payload: Data = {
          name: form.name,
          connector: form.connector,
          url: form.url,
          platform: form.platform || "",
          array_path: form.array_path || undefined,
          interval_minutes: Number(form.interval_minutes),
        };
        if (form.secret) payload.secret = form.secret;
        result = await action("connections/" + form.id, "PATCH", payload, "Источник обновлён");
        break;
      }
      case "probe":
        setBusy(true);
        try {
          result = await api("connections/probe", "POST", {
            url: form.url,
            ...(form.secret ? { secret: form.secret } : {}),
          });
          setProbe(result);
          toast.success("Проверка завершена");
        } catch (e: any) {
          toast.error(e.message);
        } finally {
          setBusy(false);
        }
        return;
      case "account":
        result = await action("accounts", "POST", form, "Аккаунт создан");
        if (result) {
          setForm({ login: result.login, password: result.password, credentialKind: "account" });
          setModal("credentials");
          return;
        }
        break;
      case "board":
        result = await action("boards", "POST", {
          name: form.name,
          stages: form.stages
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean),
        });
        break;
      case "stage":
        result = await action("stages", "POST", {
          board_id: board,
          name: form.name,
          position: stages.filter((s) => s.board_id === board).length,
        });
        break;
      case "editStage":
        result = await action("stages/" + form.id, "PATCH", {
          name: form.name,
          position: Number(form.position),
        });
        break;
      case "module":
        result = await action("modules", "POST", form);
        break;
    }
    if (result) setModal("");
  }
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (invite) {
        await api("auth/accept", "POST", { ...f, token: invite });
        setInvite("");
        window.history.replaceState(null, "", "/");
      }
      await api("auth/login", "POST", { email: f.email, password: f.password });
      await init();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (starting)
    return (
      <div className="loading-screen">
        <span className="brand">
          SIGNAL<span>↗</span>
        </span>
        <p>Подключение к рабочему пространству…</p>
      </div>
    );
  if (!me)
    return (
      <div className="auth">
        <div className="auth-story">
          <span className="brand">
            SIGNAL<span>↗</span>
          </span>
          <div>
            <div className="eyebrow">FREELANCE WORKSPACE / 01</div>
            <h1>
              МЕНЬШЕ ШУМА.
              <br />
              БОЛЬШЕ
              <br />
              <em>ВОЗМОЖНОСТЕЙ.</em>
            </h1>
            <p>
              Объявления, решения и команда.
              <br />В одном рабочем пространстве.
            </p>
          </div>
          <div className="auth-bottom">
            СОБИРАЙТЕ. ОЦЕНИВАЙТЕ. ДЕЙСТВУЙТЕ. <ArrowUpRight />
          </div>
        </div>
        <div className="auth-form">
          <div className="eyebrow">ДОСТУП ПО ПРИГЛАШЕНИЮ</div>
          <h2>{invite ? "Присоединиться к команде" : "С возвращением."}</h2>
          <p>
            {invite
              ? "Укажите email из приглашения. Если у вас уже есть аккаунт, используйте его пароль."
              : "Войдите, чтобы продолжить работу с объявлениями."}
          </p>
          <form onSubmit={login}>
            {invite && (
              <Field label="Ваше имя">
                <input name="name" required autoComplete="name" />
              </Field>
            )}
            <Field label="Email или логин">
              <input
                name="email"
                type={invite ? "email" : "text"}
                autoComplete="email"
                required
                placeholder="name@studio.com"
              />
            </Field>
            <Field label="Пароль">
              <input
                name="password"
                type="password"
                autoComplete={invite ? "new-password" : "current-password"}
                minLength={invite ? 12 : 1}
                maxLength={128}
                required
              />
            </Field>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="button lime full" disabled={busy}>
              {busy
                ? "Подождите…"
                : invite
                  ? "Присоединиться"
                  : "Войти в пространство"}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="auth-help">
            Нет доступа? Попросите владельца команды прислать приглашение.
          </div>
        </div>
      </div>
    );
  function Card({ l, compact = false }: { l: Data; compact?: boolean }) {
    return (
      <article
        className={
          "listing " + (compact ? "compact " : "") + (moving.has(l.id) ? "saving-move" : "")
        }
        draggable={write && view === "boards"}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", l.id)}
      >
        <div className="listing-top">
          <span className="platform">
            <span className="platform-icon">
              {l.platform === "mock"
                ? "M"
                : l.platform.slice(0, 1).toUpperCase()}
            </span>
            {l.platform === "mock" ? "Mock Studio" : l.platform}
            <span className="source-kind">
              {l.platform === "mock" ? "ДЕМО" : "ИСТОЧНИК"}
            </span>
          </span>
          <span className="muted small">{date(l.published_at)}</span>
          <button
            className={"icon-button bookmark " + (l.favorite ? "saved" : "")}
            aria-label={l.favorite ? "Убрать из избранного" : "В избранное"}
            onClick={() =>
              action(
                "listings/" + l.id + "/favorite",
                "POST",
                { value: !l.favorite },
                l.favorite ? "Удалено из избранного" : "Добавлено в избранное",
              )
            }
          >
            <Bookmark size={18} fill={l.favorite ? "currentColor" : "none"} />
          </button>
        </div>
        <div className="listing-main">
          <div className="listing-copy">
            <button className="title-link" onClick={() => openListing(l)}>
              {l.title}
            </button>
            <p className="description">
              {l.description || "Описание не указано"}
            </p>
            <div className="tags">
              {l.skills.map((s: string) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          </div>
          <div className="listing-numbers">
            <b>{money(l)}</b>
            <span
              className={"score " + (l.score >= 70 ? "strong" : "")}
              title="Открыть объяснение оценки"
              onClick={() => openListing(l)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && openListing(l)}
            >
              {l.score}
              <small>/100</small>
              <ArrowUpRight size={15} />
            </span>
          </div>
        </div>
        <div className="listing-bottom">
          <span>{l.geography || "География не указана"}</span>
          <span>
            {l.responses == null
              ? "Отклики: нет данных"
              : l.responses + " откликов"}
          </span>
          {l.excluded && <span className="excluded">Исключено правилом</span>}
          {l.priority === "high" && (
            <span className="high">Высокий приоритет</span>
          )}
          <span className="listing-stage">
            {l.assignee || l.stage_name || "Не назначено"}
          </span>
          <button className="text-button" onClick={() => openListing(l)}>
            Открыть <ArrowUpRight size={14} />
          </button>
        </div>
      </article>
    );
  }
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "224px" } as React.CSSProperties}
    >
      <Toaster position="bottom-right" richColors />
      <Sidebar className="signal-sidebar">
        <SidebarHeader>
          <div className="brand">
            SIGNAL<span>↗</span>
          </div>
          <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
          <div className="team-badge">
            <span>{me.team.slice(0, 2).toUpperCase()}</span>
            <div>
              {me.team}
              <small>Командный доступ</small>
            </div>
          </div>
          {me.teams?.length > 1 && (
            <Choice
              label="Команда"
              value={me.team_id}
              options={me.teams.map((t: Data) => [t.id, t.name])}
              onChange={async (id) => {
                await api("auth/switch", "POST", { team_id: id });
                window.location.reload();
              }}
            />
          )}
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-label">ОБЪЯВЛЕНИЯ</div>
          <SidebarMenu>
            {nav.map(([key, Icon]) => (
              <SidebarMenuItem key={key}>
                <SidebarMenuButton
                  isActive={view === key}
                  onClick={() => setView(key)}
                  className="nav-button"
                >
                  <Icon />
                  <span>{labels[key]}</span>
                  {key === "feed" && <b>{overview.stats.total || 0}</b>}
                  {key === "duplicates" &&
                    duplicates.filter((d) => d.status === "pending").length >
                      0 && (
                      <b>
                        {
                          duplicates.filter((d) => d.status === "pending")
                            .length
                        }
                      </b>
                    )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="nav-label second">УПРАВЛЕНИЕ</div>
          <SidebarMenu>
            {(
              [
                ["connections", Radio],
                ["rules", SlidersHorizontal],
                ["team", Users],
                ["activity", Activity],
              ] as const
            ).map(([key, Icon]) => (
              <SidebarMenuItem key={key}>
                <SidebarMenuButton
                  isActive={view === key}
                  onClick={() => setView(key)}
                  className="nav-button"
                >
                  <Icon />
                  <span>{labels[key]}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="sidebar-note">
            <div>
              <Zap size={17} />
              <span>ТОЧНОСТЬ В ПРИОРИТЕТЕ</span>
            </div>
            <p>
              Каждый балл объясним.
              <br />
              Решение — за вашей командой.
            </p>
            <button onClick={() => setView("rules")}>
              Настроить оценку <ArrowUpRight size={16} />
            </button>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <div className="profile">
            <span className="avatar">{me.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <b>{me.name}</b>
              <small>{roleNames[me.role]}</small>
            </div>
            <button
              className="icon-button"
              aria-label="Выйти"
              onClick={async () => {
                await api("auth/logout", "POST", {});
                setMe(null);
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>
      <main className="app-main">
        <header className="topbar">
          <div>
            <SidebarTrigger className="mobile-menu" />
            <span className="muted">Рабочее пространство</span>
            <ChevronRight size={14} />
            <b>{labels[view]}</b>
          </div>
          <div>
            <span className="live-indicator" />{" "}
            {overview.connections.active || 0} источников активно
            <span className="top-date">
              {new Date().toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </header>
        <div className="page">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "feed"
                  ? "ОБЗОР ВОЗМОЖНОСТЕЙ"
                  : "STUDIO / " + labels[view].toUpperCase()}
              </div>
              <h1>{labels[view]}</h1>
            </div>
            {["feed", "favorites", "archive", "boards"].includes(view) ? (
              <button
                disabled={busy || !write}
                className="button dark"
                onClick={() =>
                  action(
                    "sync",
                    "POST",
                    {},
                    "Синхронизация поставлена в очередь",
                  )
                }
              >
                <RefreshCw size={16} className={busy ? "spin" : ""} />
                Обновить источники
              </button>
            ) : view === "connections" && write ? (
              <button
                className="button dark"
                onClick={() =>
                  show("connection", {
                    connector: "mock",
                    name: "Mock Studio",
                    interval_minutes: 15,
                  })
                }
              >
                <Plus size={17} />
                Подключить источник
              </button>
            ) : view === "team" && admin ? (
              <button
                className="button dark"
                onClick={() => show("invite", { role: "member" })}
              >
                <Plus size={17} />
                Пригласить участника
              </button>
            ) : null}
          </div>
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button
                onClick={() => {
                  refresh();
                  feed();
                }}
              >
                Повторить
              </button>
            </div>
          )}
          {["feed", "favorites", "archive", "boards"].includes(view) && (
            <>
              <div className="stats-grid">
                {[
                  [
                    "Всего объявлений",
                    overview.stats.total,
                    "В рабочем пространстве",
                  ],
                  [
                    "Высокое соответствие",
                    overview.stats.strong,
                    "Оценка от 70 баллов",
                  ],
                  [
                    "В воронках",
                    overview.stats.pipeline,
                    "В обработке команды",
                  ],
                  [
                    "Новые за 24 часа",
                    overview.stats.today,
                    "По времени получения",
                  ],
                ].map(([name, value, caption], i) => (
                  <div
                    className={"stat " + (i === 1 ? "highlight" : "")}
                    key={name}
                  >
                    <div>
                      {name}
                      <ArrowUpRight size={16} />
                    </div>
                    <strong>{value ?? "—"}</strong>
                    <small>{caption}</small>
                  </div>
                ))}
              </div>
              <div className="filterbar">
                <div className="searchbox">
                  <Search size={18} />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Поиск по названию, описанию, навыкам"
                    aria-label="Поиск объявлений"
                  />
                  {q && (
                    <button
                      aria-label="Очистить поиск"
                      onClick={() => setQ("")}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
                <Choice
                  label="Источник"
                  value={source}
                  onChange={setSource}
                  options={[
                    ["", "Все источники"],
                    ...platforms.map(
                      (p) =>
                        [p, p === "mock" ? "Mock Studio" : p] as [
                          string,
                          string,
                        ],
                    ),
                  ]}
                />
                <Choice
                  label="Минимальная оценка"
                  value={min}
                  onChange={setMin}
                  options={[
                    ["0", "Любая оценка"],
                    ["70", "От 70 баллов"],
                    ["90", "От 90 баллов"],
                  ]}
                />
                <Choice
                  label="Сортировка"
                  value={sort}
                  onChange={setSort}
                  options={[
                    ["new", "Сначала новые"],
                    ["score", "По оценке"],
                    ["budget", "По валюте и бюджету"],
                  ]}
                />
              </div>
            </>
          )}
          {["feed", "favorites", "archive"].includes(view) && (
            <div className="feed-layout">
              <section>
                <div className="section-heading">
                  <div>
                    <b>{view === "feed" ? "Все объявления" : labels[view]}</b>
                    <span className="count">{total}</span>
                    {loading && <RefreshCw size={14} className="spin" />}
                  </div>
                  <span className="muted small">
                    {sort === "new"
                      ? "По дате публикации"
                      : "По выбранному порядку"}{" "}
                    <ArrowDown size={13} />
                  </span>
                </div>
                <div className="feed-list">
                  {items.map((l) => (
                    <Card key={l.id} l={l} />
                  ))}
                  {!items.length && !loading && (
                    <div className="empty">
                      <Search size={32} />
                      <h3>
                        {q || source || min !== "0"
                          ? "Ничего не найдено"
                          : "Пока нет объявлений"}
                      </h3>
                      <p>
                        {q || source || min !== "0"
                          ? "Измените поиск или фильтры."
                          : "Запустите синхронизацию подключённого источника."}
                      </p>
                    </div>
                  )}
                </div>
                {items.length < total && (
                  <button
                    className="button full load-more"
                    disabled={loading}
                    onClick={() => feed(true)}
                  >
                    Загрузить ещё ({total - items.length})
                  </button>
                )}
              </section>
              <aside className="right-rail">
                <div className="rail-panel">
                  <div className="rail-title">
                    <span>ВАШ ФОКУС</span>
                    <SlidersHorizontal size={17} />
                  </div>
                  <h3>
                    Хорошие проекты.
                    <br />
                    По вашим правилам.
                  </h3>
                  <p>Оценка показывает соответствие критериям команды.</p>
                  <div className="rule-preview">
                    {rules.slice(0, 4).map((r, i) => (
                      <div key={i}>
                        <span>{r.label}</span>
                        <b>
                          {r.points > 0 ? "+" : ""}
                          {r.points}
                        </b>
                      </div>
                    ))}
                  </div>
                  <button
                    className="text-button full"
                    onClick={() => setView("rules")}
                  >
                    Все правила <ArrowUpRight size={17} />
                  </button>
                </div>
                <div className="rail-panel">
                  <div className="rail-title">
                    <span>ИСТОЧНИКИ</span>
                    <Radio size={17} />
                  </div>
                  {connections.map((c) => (
                    <div key={c.id} className="source-row">
                      <span
                        className={
                          "status-dot " +
                          (c.error ? "bad" : !c.enabled ? "off" : "")
                        }
                      />
                      <div>
                        <b>{c.name}</b>
                        <small>
                          {c.error
                            ? "Ошибка синхронизации"
                            : c.enabled
                              ? c.job_status === "queued" ||
                                c.job_status === "running"
                                ? "В очереди / обработке"
                                : "Каждые " + c.interval_minutes + " мин"
                              : "Отключён"}
                        </small>
                      </div>
                      <span>{c.fetched}</span>
                    </div>
                  ))}
                  <button
                    className="text-button full"
                    onClick={() => setView("connections")}
                  >
                    Управление источниками
                    <ArrowUpRight size={17} />
                  </button>
                </div>
                <div className="rail-foot">
                  ПОСЛЕДНЯЯ СИНХРОНИЗАЦИЯ
                  <br />
                  <b>{date(overview.connections.last_sync)}</b>
                </div>
              </aside>
            </div>
          )}
          {view === "boards" && (
            <>
              <div className="section-heading">
                <Choice
                  label="Воронка"
                  value={board}
                  onChange={setBoard}
                  options={boards.map((b) => [b.id, b.name])}
                />
                <div>
                  {admin && (
                    <>
                      <button
                        className="button"
                        onClick={() =>
                          show("board", {
                            stages: "Новые, Оценка, Отклик, В работе, Закрыто",
                          })
                        }
                      >
                        <Plus size={16} />
                        Воронка
                      </button>
                      <button className="button" onClick={() => show("stage")}>
                        <Plus size={16} />
                        Этап
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="muted small board-help">
                Перенесите карточку в нужный этап. С клавиатуры — откройте
                карточку и выберите этап.
              </p>
              <div className="kanban">
                {[
                  { id: "", name: "Не распределены" },
                  ...stages.filter((s) => s.board_id === board),
                ].map((st) => (
                  <section
                    key={st.id}
                    className="kanban-column"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData("text/plain");
                      const l = items.find((l) => l.id === id);
                      if (l) moveListing(l, st.id || null);
                    }}
                  >
                    <div className="column-title">
                      <b>{st.name}</b>
                      <span>
                        {
                          items.filter((l) => (l.stage_id || "") === st.id)
                            .length
                        }
                      </span>
                      {admin && st.id && (
                        <button
                          aria-label="Настроить этап"
                          onClick={() => show("editStage", st)}
                        >
                          <Settings2 size={14} />
                        </button>
                      )}
                    </div>
                    {items
                      .filter((l) => (l.stage_id || "") === st.id)
                      .map((l) => (
                        <Card key={l.id} l={l} compact />
                      ))}
                  </section>
                ))}
              </div>
              {items.length < total && (
                <button className="button" onClick={() => feed(true)}>
                  Загрузить следующие карточки ({total - items.length})
                </button>
              )}
            </>
          )}
          {view === "connections" && (
            <>
              <div className="notice">
                <Radio size={18} />
                <span>Личные подключения, общий поток команды. Токены доступны только серверу.</span>
                {write && (
                  <button
                    className="button"
                    onClick={() => {
                      setProbe(null);
                      show("probe", { url: "", secret: "" });
                    }}
                  >
                    <Globe2 size={16} />
                    Проверить URL / API
                  </button>
                )}
              </div>
              <div className="source-tabs" role="tablist" aria-label="Состояние источников">
                {[
                  ["active", "Активные"],
                  ["disabled", "Отключённые"],
                  ["archive", "Архив"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={connectionTab === key}
                    className={connectionTab === key ? "active" : ""}
                    onClick={() => setConnectionTab(key)}
                  >
                    {label}
                    <span>
                      {connections.filter((c) =>
                        key === "archive"
                          ? !!c.archived_at
                          : key === "disabled"
                            ? !c.archived_at && !c.enabled
                            : !c.archived_at && c.enabled,
                      ).length}
                    </span>
                  </button>
                ))}
              </div>
              <div className="connection-grid">
                {connections
                  .filter((c) =>
                    connectionTab === "archive"
                      ? !!c.archived_at
                      : connectionTab === "disabled"
                        ? !c.archived_at && !c.enabled
                        : !c.archived_at && c.enabled,
                  )
                  .map((c) => (
                  <div key={c.id} className="connection-card">
                    <div className="connection-title">
                      <span className="large-source">
                        {c.connector === "mock"
                          ? "M"
                          : c.connector === "rss"
                            ? "RSS"
                            : "API"}
                      </span>
                      <div>
                        <h3>{c.name}</h3>
                        <span className="muted small">
                          {registry.find((r) => r.key === c.connector)?.label}
                        </span>
                      </div>
                      {!c.archived_at && (
                        <Switch
                          aria-label={"Подключение " + c.name}
                          disabled={!write || (c.owner_id !== me.id && !admin)}
                          checked={c.enabled}
                          onCheckedChange={(v) =>
                            action("connections/" + c.id, "PATCH", { enabled: v })
                          }
                        />
                      )}
                      {write && (c.owner_id === me.id || admin) && (
                        <details className="action-menu">
                          <summary aria-label={"Действия с источником " + c.name}>
                            <MoreVertical size={18} />
                          </summary>
                          <div>
                            {c.owner_id === me.id && (
                              <button
                                onClick={() =>
                                  show("editConnection", {
                                    id: c.id,
                                    name: c.name,
                                    connector: c.connector,
                                    url: c.config?.url || "",
                                    platform: c.config?.platform || "",
                                    array_path: c.config?.array_path || "",
                                    interval_minutes: c.interval_minutes,
                                    secret: "",
                                  })
                                }
                              >
                                <Pencil size={14} /> Редактировать
                              </button>
                            )}
                            <button
                              onClick={() =>
                                action("connections/" + c.id, "PATCH", {
                                  archived: !c.archived_at,
                                }, c.archived_at ? "Источник восстановлен" : "Источник архивирован")
                              }
                            >
                              <Archive size={14} /> {c.archived_at ? "Восстановить" : "В архив"}
                            </button>
                            <button
                              className="danger"
                              onClick={() => {
                                if (window.confirm(`Удалить источник «${c.name}»? Исторические объявления сохранятся.`))
                                  action("connections/" + c.id, "DELETE", undefined, "Источник удалён");
                              }}
                            >
                              <Trash2 size={14} /> Удалить
                            </button>
                          </div>
                        </details>
                      )}
                    </div>
                    <div
                      className={
                        "connection-status " + (c.error ? "error" : "")
                      }
                    >
                      <span
                        className={
                          "status-dot " +
                          (c.error ? "bad" : c.enabled ? "" : "off")
                        }
                      />
                      {c.archived_at
                        ? "В архиве"
                        : c.error
                        ? "Ошибка"
                        : !c.enabled
                          ? "Отключён"
                          : c.job_status === "running"
                            ? "Синхронизируется"
                            : c.job_status === "queued"
                              ? "В очереди"
                              : "Подключён"}
                    </div>
                    <dl>
                      <div>
                        <dt>Владелец</dt>
                        <dd>{c.owner}</dd>
                      </div>
                      <div>
                        <dt>Интервал</dt>
                        <dd>
                          {c.owner_id === me.id && write ? (
                            <Choice
                              label="Интервал синхронизации"
                              value={String(c.interval_minutes)}
                              options={[
                                ["10", "10 минут"],
                                ["15", "15 минут"],
                                ["20", "20 минут"],
                                ["30", "30 минут"],
                              ]}
                              onChange={(v) =>
                                action("connections/" + c.id, "PATCH", {
                                  interval_minutes: Number(v),
                                })
                              }
                            />
                          ) : (
                            c.interval_minutes + " минут"
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Последняя синхронизация</dt>
                        <dd>{date(c.last_sync)}</dd>
                      </div>
                      <div>
                        <dt>Получено / новых</dt>
                        <dd>
                          {c.fetched} / {c.inserted}
                        </dd>
                      </div>
                      <div>
                        <dt>Токен</dt>
                        <dd>{c.has_secret ? "Зашифрован" : "Не задан"}</dd>
                      </div>
                    </dl>
                    {c.error && <p className="error small">{c.error}</p>}
                    <div className="connection-actions">
                      <button
                        className="button full"
                        disabled={!write || !c.enabled || !!c.archived_at || busy}
                        onClick={() =>
                          action(
                            "connections/" + c.id + "/sync",
                            "POST",
                            {},
                            "Задача поставлена в очередь",
                          )
                        }
                      >
                        <RefreshCw size={15} />
                        Синхронизировать
                      </button>
                      {c.owner_id === me.id && write && (
                        <button
                          className="button"
                          onClick={() =>
                            show("token", { id: c.id, secret: "" })
                          }
                        >
                          Токен
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {connections.filter((c) =>
                  connectionTab === "archive"
                    ? !!c.archived_at
                    : connectionTab === "disabled"
                      ? !c.archived_at && !c.enabled
                      : !c.archived_at && c.enabled,
                ).length === 0 && (
                  <div className="empty source-empty">
                    <Radio size={28} />
                    <h3>В этом разделе источников нет</h3>
                  </div>
                )}
                <button
                  className="add-source-card"
                  disabled={!write}
                  onClick={() =>
                    show("connection", {
                      connector: "rss",
                      interval_minutes: 15,
                    })
                  }
                >
                  <Plus size={28} />
                  <h3>Новый источник</h3>
                  <p>API, RSS или серверный модуль</p>
                </button>
              </div>
              {admin && (
                <div className="module-panel">
                  <div>
                    <h3>Собственные коннекторы</h3>
                    <p>
                      Модуль предварительно размещается в каталоге modules
                      сервера. Установка в реестр доступна администраторам.
                    </p>
                  </div>
                  <button className="button" onClick={() => show("module")}>
                    Зарегистрировать модуль
                    <Plus size={16} />
                  </button>
                </div>
              )}
            </>
          )}
          {view === "rules" && (
            <>
              <div className="notice">
                <Zap size={18} />
                Баллы суммируются в диапазоне 0–100. Отсутствующие данные не
                дают баллов. Бюджеты разных валют не пересчитываются.
              </div>
              <div className="rules-editor">
                {rules.map((r, i) => (
                  <div className="rule-edit" key={i}>
                    <span className="rule-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <Field label="Название">
                      <input
                        disabled={!admin}
                        value={r.label}
                        onChange={(e) =>
                          setRules(
                            rules.map((x, j) =>
                              j === i ? { ...x, label: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Поле">
                      <Choice
                        disabled={!admin}
                        label="Поле"
                        value={r.field}
                        options={Object.entries({
                          skills: "Навыки",
                          budget: "Бюджет",
                          responses: "Отклики",
                          geography: "География",
                          payment_type: "Тип оплаты",
                          title: "Название",
                          description: "Описание",
                          platform: "Площадка",
                          currency: "Валюта",
                        })}
                        onChange={(v) =>
                          admin &&
                          setRules(
                            rules.map((x, j) =>
                              j === i ? { ...x, field: v } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Условие">
                      <Choice
                        disabled={!admin}
                        label="Условие"
                        value={r.op}
                        options={[
                          ["contains", "Содержит"],
                          ["equals", "Равно"],
                          ["gte", "Не меньше"],
                          ["lte", "Не больше"],
                        ]}
                        onChange={(v) =>
                          admin &&
                          setRules(
                            rules.map((x, j) =>
                              j === i ? { ...x, op: v } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Значение">
                      <input
                        disabled={!admin}
                        value={r.value}
                        onChange={(e) =>
                          setRules(
                            rules.map((x, j) =>
                              j === i ? { ...x, value: e.target.value } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    {r.field === "budget" && (
                      <Field label="Валюта">
                        <input
                          disabled={!admin}
                          value={r.currency || ""}
                          placeholder="USD"
                          onChange={(e) =>
                            setRules(
                              rules.map((x, j) =>
                                j === i
                                  ? {
                                      ...x,
                                      currency: e.target.value.toUpperCase(),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                      </Field>
                    )}
                    <Field label="Баллы">
                      <input
                        type="number"
                        min="-100"
                        max="100"
                        disabled={!admin}
                        value={r.points}
                        onChange={(e) =>
                          setRules(
                            rules.map((x, j) =>
                              j === i
                                ? { ...x, points: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Исключать">
                      <Switch
                        disabled={!admin}
                        checked={!!r.exclude}
                        onCheckedChange={(v) =>
                          setRules(
                            rules.map((x, j) =>
                              j === i ? { ...x, exclude: v } : x,
                            ),
                          )
                        }
                      />
                    </Field>
                    {admin && (
                      <button
                        className="icon-button"
                        aria-label="Удалить правило"
                        onClick={() =>
                          setRules(rules.filter((_, j) => j !== i))
                        }
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {admin && (
                <div className="rule-actions">
                  <button
                    className="button"
                    onClick={() =>
                      setRules([
                        ...rules,
                        {
                          label: "Новое правило",
                          field: "skills",
                          op: "contains",
                          value: "",
                          points: 10,
                        },
                      ])
                    }
                  >
                    <Plus size={17} />
                    Добавить правило
                  </button>
                  <button
                    disabled={busy}
                    className="button lime"
                    onClick={() =>
                      action(
                        "rules",
                        "PUT",
                        { rules },
                        "Правила сохранены, оценки пересчитаны",
                      )
                    }
                  >
                    Сохранить и пересчитать
                    <ArrowRight size={17} />
                  </button>
                </div>
              )}
            </>
          )}
          {view === "team" && (
            <div className="member-list">
              {me.role === "owner" && (
                <div className="owner-panel-head">
                  <div>
                    <span className="eyebrow">OWNER / УПРАВЛЯЕМЫЕ АККАУНТЫ</span>
                    <h3>Доступ команды</h3>
                    <p>Логин и временный пароль показываются один раз после создания или сброса.</p>
                  </div>
                  <button
                    className="button dark"
                    onClick={() => show("account", { name: "", role: "member" })}
                  >
                    <Shield size={16} /> Создать аккаунт
                  </button>
                </div>
              )}
              {members.map((m) => (
                <div key={m.id} className={"member-row " + (m.blocked_at ? "blocked" : "")}>
                  <span className="avatar">
                    {m.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <b>
                      {m.name}
                      {m.id === me.id ? " (вы)" : ""}
                    </b>
                    <p>{m.login ? `Логин: ${m.login}` : m.email}</p>
                    {me.role === "owner" && (
                      <small>{m.blocked_at ? "Заблокирован" : `Активных сессий: ${m.session_count || 0}`}</small>
                    )}
                  </div>
                  {me.role === "owner" && m.id !== me.id ? (
                    <Choice
                      label="Роль участника"
                      value={m.role}
                      options={[
                        ["owner", "Владелец"],
                        ["admin", "Администратор"],
                        ["member", "Участник"],
                      ]}
                      onChange={(v) =>
                        action("accounts/" + m.id, "PATCH", { role: v }, "Роль обновлена")
                      }
                    />
                  ) : (
                    <span className="role-tag">{roleNames[m.role]}</span>
                  )}
                  {me.role === "owner" && m.id !== me.id && (
                    <details className="action-menu member-actions">
                      <summary aria-label={"Управление аккаунтом " + m.name}>
                        <MoreVertical size={18} />
                      </summary>
                      <div>
                        <button
                          onClick={() =>
                            action(
                              "accounts/" + m.id,
                              "PATCH",
                              { blocked: !m.blocked_at },
                              m.blocked_at ? "Аккаунт разблокирован" : "Аккаунт заблокирован",
                            )
                          }
                        >
                          {m.blocked_at ? <Unlock size={14} /> : <Lock size={14} />}
                          {m.blocked_at ? "Разблокировать" : "Заблокировать"}
                        </button>
                        <button
                          onClick={async () => {
                            const result = await action("accounts/" + m.id + "/reset-password", "POST", {}, "Пароль сброшен");
                            if (result) {
                              setForm({ login: m.login || m.email, password: result.password, credentialKind: "reset" });
                              setModal("credentials");
                            }
                          }}
                        >
                          <KeyRound size={14} /> Сбросить пароль
                        </button>
                        <button
                          onClick={() => action("accounts/" + m.id + "/end-sessions", "POST", {}, "Сессии завершены")}
                        >
                          <Power size={14} /> Завершить сессии
                        </button>
                      </div>
                    </details>
                  )}
                </div>
              ))}
              <div className="notice">
                Наблюдатель читает объявления и сохраняет личное избранное.
                Участник обрабатывает объявления и подключает источники.
                Администратор управляет настройками; владелец — ролями.
              </div>
            </div>
          )}
          {view === "duplicates" && (
            <>
              <div className="notice">
                <Copy size={18} />
                Сходство названий от 75%. Подтверждение связывает записи и
                сохраняет обе версии.
              </div>
              {duplicates.length === 0 ? (
                <div className="empty">
                  <Check size={32} />
                  <h3>Возможных дублей пока нет</h3>
                </div>
              ) : (
                duplicates.map((d) => (
                  <div className="duplicate-card" key={d.left_id + d.right_id}>
                    <span className="duplicate-score">
                      {Math.round(d.similarity * 100)}%<small>сходство</small>
                    </span>
                    <div>
                      <b>{d.left_title}</b>
                      <p>
                        {d.left_platform} ↔ {d.right_platform}
                      </p>
                      <b>{d.right_title}</b>
                    </div>
                    {d.status === "pending" && write ? (
                      <div className="duplicate-actions">
                        <button
                          className="button lime"
                          onClick={() =>
                            action("duplicates", "PATCH", {
                              left_id: d.left_id,
                              right_id: d.right_id,
                              status: "confirmed",
                            })
                          }
                        >
                          Это дубль
                        </button>
                        <button
                          className="button"
                          onClick={() =>
                            action("duplicates", "PATCH", {
                              left_id: d.left_id,
                              right_id: d.right_id,
                              status: "dismissed",
                            })
                          }
                        >
                          Разные проекты
                        </button>
                      </div>
                    ) : (
                      <span className="role-tag">
                        {d.status === "confirmed"
                          ? "Дубль подтверждён"
                          : d.status === "dismissed"
                            ? "Разные проекты"
                            : "Ожидает решения"}
                      </span>
                    )}
                  </div>
                ))
              )}
            </>
          )}
          {view === "activity" && (
            <div className="activity-list">
              {activity.length ? (
                activity.map((a) => (
                  <div key={a.id}>
                    <span className="activity-icon">
                      <Activity size={17} />
                    </span>
                    <div>
                      <b>{a.action}</b>
                      <p>
                        {a.name || "Система"} · {date(a.created_at)}
                      </p>
                      {Object.keys(a.data).length > 0 && (
                        <code>{JSON.stringify(a.data)}</code>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  История появится после первого действия.
                </div>
              )}
            </div>
          )}
          <footer className="page-footer">
            <span>SIGNAL / WORKSPACE</span>
            <span>Возможности не должны теряться.</span>
            <ArrowUpRight size={17} />
          </footer>
        </div>
      </main>
      <Sheet open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <SheetContent className="detail-sheet">
          {selected && (
            <>
              <div className="eyebrow">
                {selected.platform.toUpperCase()} / ОБЪЯВЛЕНИЕ
              </div>
              <SheetTitle className="detail-title">{selected.title}</SheetTitle>
              <SheetDescription>
                {money(selected)} ·{" "}
                {selected.geography || "География не указана"}
              </SheetDescription>
              <Tabs defaultValue="overview">
                <TabsList className="detail-tabs">
                  <TabsTrigger value="overview">Объявление</TabsTrigger>
                  <TabsTrigger value="notes">
                    Заметки ({detail.notes.length})
                  </TabsTrigger>
                  <TabsTrigger value="history">История</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                  <div className="detail-score">
                    <b>
                      {selected.score}
                      <small>/100</small>
                    </b>
                    <span>
                      СООТВЕТСТВИЕ
                      <br />
                      ПРАВИЛАМ КОМАНДЫ
                    </span>
                  </div>
                  <div className="score-breakdown">
                    {selected.breakdown.map((r: Data, i: number) => (
                      <div key={i}>
                        <span>
                          {r.label}
                          {r.missing
                            ? " · нет данных"
                            : r.matched
                              ? ""
                              : " · не совпало"}
                        </span>
                        <b>
                          {r.points > 0 ? "+" : ""}
                          {r.points}
                        </b>
                      </div>
                    ))}
                  </div>
                  <h3>Описание проекта</h3>
                  <p className="detail-description">
                    {selected.description || "Не указано"}
                  </p>
                  <div className="tags">
                    {selected.skills.map((s: string) => (
                      <span key={s}>{s}</span>
                    ))}
                  </div>
                  <dl className="detail-meta">
                    {Object.entries({
                      Клиент: selected.client?.name,
                      Отклики: selected.responses,
                      "Тип оплаты":
                        selected.payment_type === "fixed"
                          ? "Фиксированная"
                          : selected.payment_type === "hourly"
                            ? "Почасовая"
                            : null,
                      Опубликовано: date(selected.published_at),
                      "Статус источника": selected.source_status,
                      "Внешний ID": selected.external_id,
                      "Обновлено в источнике": date(selected.source_updated_at),
                    }).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>{v ?? "Нет данных"}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="detail-fields">
                    <Field label="Этап воронки">
                      <Choice
                        disabled={!write}
                        label="Этап"
                        value={selected.stage_id || ""}
                        options={[
                          ["", "Не распределено"],
                          ...stages.map(
                            (s) =>
                              [
                                s.id,
                                (boards.find((b) => b.id === s.board_id)
                                  ?.name || "") +
                                  " / " +
                                  s.name,
                              ] as [string, string],
                          ),
                        ]}
                        onChange={(v) =>
                          write && patch(selected, { stage_id: v || null })
                        }
                      />
                    </Field>
                    <Field label="Ответственный">
                      <Choice
                        disabled={!write}
                        label="Ответственный"
                        value={selected.assignee_id || ""}
                        options={[
                          ["", "Не назначен"],
                          ...members.map(
                            (m) => [m.id, m.name] as [string, string],
                          ),
                        ]}
                        onChange={(v) =>
                          write && patch(selected, { assignee_id: v || null })
                        }
                      />
                    </Field>
                    <Field label="Приоритет">
                      <Choice
                        disabled={!write}
                        label="Приоритет"
                        value={selected.priority}
                        options={[
                          ["low", "Низкий"],
                          ["normal", "Обычный"],
                          ["high", "Высокий"],
                        ]}
                        onChange={(v) =>
                          write && patch(selected, { priority: v })
                        }
                      />
                    </Field>
                  </div>
                  <div className="detail-actions">
                    {selected.url && (
                      <a
                        href={selected.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="button dark"
                      >
                        Открыть источник
                        <ExternalLink size={16} />
                      </a>
                    )}
                    {write && (
                      <button
                        className="button"
                        onClick={() =>
                          patch(selected, { archived: !selected.archived })
                        }
                      >
                        <Archive size={16} />
                        {selected.archived ? "Восстановить" : "В архив"}
                      </button>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="notes">
                  {detail.notes.map((n: Data) => (
                    <div className="note" key={n.id}>
                      <b>{n.name}</b>
                      <small>{date(n.created_at)}</small>
                      <p>{n.body}</p>
                    </div>
                  ))}
                  {write && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (
                          await action(
                            "listings/" + selected.id + "/notes",
                            "POST",
                            { body: note },
                            "Заметка добавлена",
                          )
                        ) {
                          setNote("");
                          setDetail(await api("listings/" + selected.id));
                        }
                      }}
                    >
                      <Field label="Новая заметка">
                        <textarea
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          required
                          maxLength={10000}
                          rows={5}
                          placeholder="Контекст, вопросы клиенту, следующий шаг…"
                        />
                      </Field>
                      <button className="button lime" disabled={busy}>
                        Добавить заметку
                        <Plus size={16} />
                      </button>
                    </form>
                  )}
                </TabsContent>
                <TabsContent value="history">
                  {detail.history.map((h: Data) => (
                    <div className="note" key={h.id}>
                      <b>{h.action}</b>
                      <p>
                        {h.name} · {date(h.created_at)}
                      </p>
                      <code>{JSON.stringify(h.data)}</code>
                    </div>
                  ))}
                  {!detail.history.length && (
                    <p className="muted">Действий пока нет.</p>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={!!modal} onOpenChange={(v) => !v && setModal("")}>
        <DialogContent className="form-dialog">
          <DialogTitle>
            {
              (
                {
                  invite: "Пригласить участника",
                  connection: "Подключить источник",
                  editConnection: "Редактировать источник",
                  probe: "Проверка URL / API / RSS / OpenAPI",
                  account: "Создать аккаунт",
                  credentials: "Данные для входа",
                  board: "Новая воронка",
                  stage: "Новый этап",
                  editStage: "Настройка этапа",
                  module: "Серверный модуль",
                  token: "Обновить токен",
                } as Data
              )[modal]
            }
          </DialogTitle>
          <DialogDescription>
            {modal === "invite"
              ? "Ссылка действует 72 часа. Передайте её участнику самостоятельно."
              : modal === "connection"
                ? "Секрет сохраняется в зашифрованном виде."
                : modal === "editConnection"
                  ? "Пустое поле токена сохранит текущий секрет."
                  : modal === "probe"
                    ? "Сервер проверит адрес с allowlist и защитой от частных сетей."
                    : modal === "credentials"
                      ? "Скопируйте данные сейчас: пароль повторно не показывается."
                : "Изменения сохранятся для вашей команды."}
          </DialogDescription>
          <form
            onSubmit={
              modal === "token"
                ? async (e) => {
                    e.preventDefault();
                    if (
                      await action("connections/" + form.id, "PATCH", {
                        secret: form.secret,
                      })
                    )
                      setModal("");
                  }
                : submit
            }
          >
            {modal === "invite" ? (
              form.url ? (
                <div className="invite-result">
                  <p>Приглашение для {form.email}</p>
                  <textarea readOnly value={form.url} />
                  <button
                    type="button"
                    className="button lime"
                    onClick={() =>
                      navigator.clipboard
                        .writeText(form.url)
                        .then(() => toast.success("Ссылка скопирована"))
                        .catch(() => toast.error("Скопируйте ссылку вручную"))
                    }
                  >
                    <Copy size={16} />
                    Скопировать ссылку
                  </button>
                </div>
              ) : (
                <>
                  <Field label="Email">
                    <input
                      type="email"
                      required
                      onChange={(e) => change("email", e.target.value)}
                    />
                  </Field>
                  <Field label="Роль">
                    <Choice
                      label="Роль"
                      value={form.role}
                      onChange={(v) => change("role", v)}
                      options={
                        me.role === "owner"
                          ? [
                              ["member", "Участник"],
                              ["viewer", "Наблюдатель"],
                              ["admin", "Администратор"],
                            ]
                          : [
                              ["member", "Участник"],
                              ["viewer", "Наблюдатель"],
                            ]
                      }
                    />
                  </Field>
                </>
              )
            ) : null}
            {["board", "stage", "editStage", "connection", "editConnection"].includes(modal) && (
              <Field label="Название">
                <input
                  required
                  maxLength={200}
                  value={form.name || ""}
                  onChange={(e) => change("name", e.target.value)}
                />
              </Field>
            )}
            {modal === "board" && (
              <Field label="Этапы через запятую">
                <textarea
                  required
                  value={form.stages || ""}
                  onChange={(e) => change("stages", e.target.value)}
                />
              </Field>
            )}
            {modal === "editStage" && (
              <Field label="Позиция (начиная с 0)">
                <input
                  type="number"
                  min="0"
                  max="100"
                  required
                  value={form.position}
                  onChange={(e) => change("position", e.target.value)}
                />
              </Field>
            )}
            {["connection", "editConnection"].includes(modal) && (
              <>
                <Field label="Коннектор">
                  <Choice
                    label="Коннектор"
                    value={form.connector}
                    onChange={(v) => change("connector", v)}
                    options={registry.map((r) => [r.key, r.label])}
                  />
                </Field>
                {form.connector !== "mock" && (
                  <>
                    <Field label="URL разрешённого API / RSS">
                      <input
                        type="url"
                        required
                        value={form.url || ""}
                        onChange={(e) => change("url", e.target.value)}
                        placeholder="https://…"
                      />
                    </Field>
                    <Field label="Название площадки">
                      <input
                        value={form.platform || ""}
                        onChange={(e) => change("platform", e.target.value)}
                        placeholder="Например, studio-jobs"
                      />
                    </Field>
                    <Field label="Токен (если нужен)">
                      <input
                        type="password"
                        autoComplete="off"
                        value={form.secret || ""}
                        onChange={(e) => change("secret", e.target.value)}
                      />
                    </Field>
                  </>
                )}
                <Field label="Интервал, минуты">
                  <input
                    type="number"
                    min="10"
                    max="30"
                    required
                    value={form.interval_minutes}
                    onChange={(e) => change("interval_minutes", e.target.value)}
                  />
                </Field>
              </>
            )}
            {modal === "probe" && (
              <>
                <Field label="URL для проверки">
                  <input
                    type="url"
                    required
                    value={form.url || ""}
                    onChange={(e) => {
                      change("url", e.target.value);
                      setProbe(null);
                    }}
                    placeholder="https://example.com/feed"
                  />
                </Field>
                <Field label="Bearer-токен (если нужен)">
                  <input
                    type="password"
                    autoComplete="off"
                    value={form.secret || ""}
                    onChange={(e) => change("secret", e.target.value)}
                  />
                </Field>
                {probe && (
                  <div className="probe-result">
                    <div className="probe-summary">
                      <span className={probe.ok ? "probe-ok" : "probe-bad"}>
                        HTTP {probe.status}
                      </span>
                      <b>{String(probe.data_type).toUpperCase()}</b>
                      <span>{probe.content_type}</span>
                      <span>{probe.bytes} байт</span>
                    </div>
                    <div className="probe-section">
                      <b>Поля</b>
                      <div className="tags">
                        {(probe.fields || []).map((field: string) => <span key={field}>{field}</span>)}
                        {!probe.fields?.length && <span>не найдены</span>}
                      </div>
                    </div>
                    <div className="probe-section">
                      <b>Массивы</b>
                      {(probe.arrays || []).map((array: Data) => (
                        <p key={array.path}><code>{array.path}</code> · {array.length} элементов · {array.fields?.join(", ") || "без полей"}</p>
                      ))}
                      {!probe.arrays?.length && <p className="muted">Массивы не найдены</p>}
                    </div>
                    <div className="probe-section">
                      <b>Preview</b>
                      <pre>{typeof probe.preview === "string" ? probe.preview : JSON.stringify(probe.preview, null, 2)}</pre>
                    </div>
                    {probe.data_type === "openapi" && (
                      <div className="probe-section">
                        <b>GET endpoints из OpenAPI</b>
                        {(probe.openapi_endpoints || []).map((endpoint: string) => (
                          <button
                            type="button"
                            className="probe-endpoint"
                            key={endpoint}
                            onClick={() => {
                              setForm((current) => ({ ...current, url: endpoint }));
                              setProbe(null);
                            }}
                          >
                            Проверить {endpoint}
                          </button>
                        ))}
                        {!probe.openapi_endpoints?.length && <p className="muted">GET endpoints без обязательных path-параметров не найдены.</p>}
                      </div>
                    )}
                    {probe.ok && probe.suggested_connector && (
                      <button
                        type="button"
                        className="button lime full"
                        onClick={() => {
                          const hostname = new URL(form.url).hostname;
                          setForm({
                            connector: probe.suggested_connector,
                            name: hostname,
                            url: form.url,
                            platform: hostname,
                            array_path: probe.suggested_connector === "json" ? probe.suggested_array_path : undefined,
                            secret: form.secret || "",
                            interval_minutes: 15,
                          });
                          setModal("connection");
                          setProbe(null);
                        }}
                      >
                        Создать источник из результата <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
            {modal === "account" && (
              <>
                <Field label="Имя пользователя">
                  <input required maxLength={200} value={form.name || ""} onChange={(e) => change("name", e.target.value)} />
                </Field>
                <Field label="Роль">
                  <Choice
                    label="Роль"
                    value={form.role}
                    onChange={(value) => change("role", value)}
                    options={[
                      ["owner", "Владелец"],
                      ["admin", "Администратор"],
                      ["member", "Участник"],
                    ]}
                  />
                </Field>
              </>
            )}
            {modal === "credentials" && (
              <div className="credentials">
                <Field label="Логин">
                  <input readOnly value={form.login || ""} />
                </Field>
                <Field label="Пароль">
                  <input readOnly value={form.password || ""} />
                </Field>
                <button
                  type="button"
                  className="button lime full"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(`Логин: ${form.login}\nПароль: ${form.password}`)
                      .then(() => toast.success("Данные скопированы"))
                      .catch(() => toast.error("Скопируйте данные вручную"))
                  }
                >
                  <Copy size={16} /> Скопировать данные
                </button>
              </div>
            )}
            {modal === "token" && (
              <Field label="Новый токен; пустое поле удалит текущий">
                <input
                  type="password"
                  autoComplete="off"
                  value={form.secret || ""}
                  onChange={(e) => change("secret", e.target.value)}
                />
              </Field>
            )}
            {modal === "module" && (
              <>
                <Field label="Ключ коннектора">
                  <input
                    required
                    pattern="[a-z][a-z0-9_-]{2,40}"
                    onChange={(e) => change("key", e.target.value)}
                    placeholder="studio-api"
                  />
                </Field>
                <Field label="Название">
                  <input
                    required
                    onChange={(e) => change("label", e.target.value)}
                  />
                </Field>
                <Field label="Имя установленного файла">
                  <input
                    required
                    pattern="[a-z0-9_-]+\.mjs"
                    onChange={(e) => change("module", e.target.value)}
                    placeholder="studio.mjs"
                  />
                </Field>
              </>
            )}
            {!form.url?.includes("?invite=") && !["credentials"].includes(modal) && (
              <button className="button lime full" disabled={busy}>
                {busy
                  ? "Сохраняем…"
                  : modal === "probe"
                    ? "Проверить источник"
                  : modal === "invite"
                    ? "Создать приглашение"
                    : "Сохранить"}
                <ArrowRight size={17} />
              </button>
            )}
          </form>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
