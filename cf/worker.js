// awaker-home Worker — yeti-home 的 Cloudflare 移植版
// 原项目: https://github.com/matingod/yeti-home (MIT; 美术 CC BY-NC 4.0)
// Python gatekeeper + demo-server 的逻辑在此用 Worker JS 复刻:
// 登录(HMAC 签名 cookie gk_token) / 双身份门禁 / 生活 API(KV 持久化)
// 天气与硬件状态为虚构演示数据(与原 demo-server 一致), 口令为仓库公开演示口令 demo。
const LOGIN_HTML = /*__LOGIN_HTML__*/"";
const DEMO_PASSWORD = "demo";
const COOKIE = "gk_token";
const MAX_AGE = 30 * 86400, SESSION_AGE = 12 * 3600;
const PROFILES = {
  yeti: { name: "阿暖", nickname: "阿暖", displayName: "阿暖", tags: "虚构演示人物", avatar: "/static/pixel/avatar-yeti.png" },
  yuki: { name: "阿安", nickname: "阿安", displayName: "阿安", tags: "虚构演示人物", avatar: "/static/pixel/avatar-yuki.png" },
};
const ROLES = { yeti: "admin", yuki: "user" };
const HOUSES = {
  sample: { id: "sample", name: "阿暖与阿安的家", owners: ["yeti", "yuki"], greeting: "欢迎来串门。沙发随便坐，茶在炉子上，留言簿在书桌上，写完记得盖好笔帽。" },
};
const SEED_NOTES = {
  yeti: [{ id: "demo-note-yeti", owner: "yeti", text: "DEMO · 今天在像素小镇散步。", date: "2026-01-01", createdAt: "2026-01-01T12:00:00+08:00", updatedAt: "2026-01-01T12:00:00+08:00", revision: 1, editable: true, visibility: "public" }],
  yuki: [{ id: "demo-note-yuki", owner: "yuki", text: "DEMO · 今天在像素小镇散步。", date: "2026-01-01", createdAt: "2026-01-01T12:00:00+08:00", updatedAt: "2026-01-01T12:00:00+08:00", revision: 1, editable: true, visibility: "public" }],
};
const SEED_ANNIV = [{ id: "demo-anniversary", familyId: "demo-family", name: "示例搬家纪念日", date: "2024-04-01", revision: 1 }];
const JOBS = [{ id: "demo-job-1", name: "DEMO · 示例数据维护（不会执行）", schedule: "0 9 * * *", enabled: false, state: "paused", deliver: "local", repeat_times: 0, repeat_completed: 0, last_run_at: null, next_run_at: null, last_status: "", no_agent: false, prompt: "仅演示界面，不连接任务网关。" }];
const BANNER = '<aside class="demo-banner" role="note" style="position:fixed;pointer-events:none;left:8px;bottom:8px;max-width:calc(100vw - 16px);z-index:99999;padding:4px 10px;background:#17372a;color:#fff4d7;border:1px solid #dfbd7c;font:12px/1.6 monospace">DEMO · 人物/数据均虚构 · 口令 demo · 不连接真实服务</aside>';

const enc = new TextEncoder();
function hex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function randHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a.buffer); }
function nowSec() { return Math.floor(Date.now() / 1000); }
function shanghaiNow() { return new Date(Date.now() + 8 * 3600 * 1000); }
function isoShanghai() { return shanghaiNow().toISOString().replace("Z", "+08:00"); }
function json(data, code = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status: code, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
function htmlPage(value, code = 200, headers = {}) {
  let v = String(value).replace("<html", '<html data-demo="true"', 1);
  v = v.replace("</body>", BANNER + "</body>");
  return new Response(v, { status: code, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
function redirect(path, cookie) {
  const h = { Location: path, "Cache-Control": "no-store" };
  if (cookie) h["Set-Cookie"] = cookie;
  return new Response("", { status: 302, headers: h });
}
async function hmacSig(secret, payload) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(payload))).slice(0, 32);
}
async function makeToken(env, user, role, maxAge) {
  const payload = JSON.stringify({ u: user, r: role, e: nowSec() + maxAge, n: randHex(4) });
  return payload + "." + await hmacSig(env.GK_SECRET, payload);
}
async function checkToken(env, tok) {
  try {
    const i = tok.lastIndexOf("."); if (i < 0) return null;
    const payload = tok.slice(0, i), sig = tok.slice(i + 1);
    if (sig !== await hmacSig(env.GK_SECRET, payload)) return null;
    const d = JSON.parse(payload);
    if (!d.e || d.e < nowSec()) return null;
    if (!(d.u in PROFILES) || ROLES[d.u] !== d.r) return null;
    return d;
  } catch { return null; }
}
function actorFrom(request, env) {
  const ck = request.headers.get("Cookie") || "";
  for (const part of ck.split(";")) {
    const p = part.trim();
    if (p.startsWith(COOKIE + "=")) return checkToken(env, decodeURIComponent(p.slice(COOKIE.length + 1)));
  }
  return Promise.resolve(null);
}
function normPath(rawPath) {
  let path = rawPath;
  for (let i = 0; i < 8; i++) { const d = decodeURIComponent(path); if (d === path) break; path = d; }
  if (path.includes("%") || path.includes("\\") || [...path].some(c => c.charCodeAt(0) < 32)) return null;
  const seg = [];
  for (const s of path.split("/")) { if (s === "..") seg.pop(); else if (s && s !== ".") seg.push(s); }
  return "/" + seg.join("/");
}
function allowed(path, actor) {
  if (path === "/yeti" || path.startsWith("/yeti/")) return !!(actor && actor.r === "admin");
  if (path === "/yuki" || path.startsWith("/yuki/")) return !!actor;
  if (path.startsWith("/cron-api/")) return !!(actor && (actor.r === "admin" || path.startsWith("/cron-api/yuki/")));
  if (path === "/community" || path.startsWith("/community/")) return !!actor;
  if (path.startsWith("/api/house/")) return !!actor;
  return true;
}
function safeNext(value, who, role) {
  const fallback = "/" + who + "/";
  if (!value || value === "/" || value.length > 4096) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  const p = normPath(value.split(/[?#]/)[0]); if (!p) return fallback;
  if (p.startsWith("/login") || p.startsWith("/logout") || p.startsWith("/auth/")) return fallback;
  if (role !== "admin" && who === "yuki" && p.startsWith("/yeti")) return fallback;
  return value;
}
function loginPage(who, nextPath = "", error = "") {
  const name = PROFILES[who].name;
  const esc = s => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return LOGIN_HTML.replaceAll("{who}", name).replaceAll("{as_key}", who)
    .replaceAll("{next}", esc(encodeURIComponent(nextPath))).replaceAll("{err}", error);
}
function synthStatus() {
  return { demo: true, ts: nowSec(), version: 1, errors: [],
    hardware: { load: "0.24 0.18 0.12", cores: 8, mem_total: 32 * 1024 ** 3, mem_used: 10 * 1024 ** 3, swap_used: 0, uptime_s: 86400, cpu_temp: 42,
      gpus: [{ idx: 0, name: "DEMO GPU", uuid: "GPU-demo", mem_used: 2048, mem_total: 8192, util: 18, temp: 38, power: 45 }],
      gpu_apps: [{ uuid: "GPU-demo", name: "demo-process", mem: 2048 }], vms: [{ name: "demo-vm", state: "running" }],
      disks: [{ name: "demo-disk", dev: "demo0", temp: 34, ok: true, status: "DISK_OK" }], disk_slots_empty: 1 },
    storage: { mounts: [{ path: "DEMO storage", used: 2 * 1024 ** 4, size: 8 * 1024 ** 4, pct: 25 }], sync_action: "idle" },
    apps: Object.fromEntries(["studio", "vault", "emby", "dsm", "caddy"].map(k => [k, { up: true, code: 200, demo: true }])),
    snake: { rows: [{ label: "DEMO storage", used: 2 * 1024 ** 4, size: 8 * 1024 ** 4, pct: 25 }], cols: [{ label: "demo-disk", temp: 34 }] } };
}
function weatherFixture() {
  const n = shanghaiNow();
  const pad = x => String(x).padStart(2, "0");
  const today = `${n.getUTCFullYear()}-${pad(n.getUTCMonth() + 1)}-${pad(n.getUTCDate())}`;
  const units = { time: "iso8601", interval: "seconds", temperature_2m: "°C", apparent_temperature: "°C", is_day: "", precipitation: "mm", rain: "mm", showers: "mm", snowfall: "cm", weather_code: "wmo code", cloud_cover: "%", wind_speed_10m: "km/h", wind_direction_10m: "°" };
  const raw = { latitude: 31.23, longitude: 121.47, timezone: "Asia/Shanghai", utc_offset_seconds: 28800, current_units: units,
    current: { time: `${today}T${pad(n.getUTCHours())}:${pad(n.getUTCMinutes())}`, interval: 900, temperature_2m: 22, apparent_temperature: 22, is_day: (n.getUTCHours() >= 6 && n.getUTCHours() < 18) ? 1 : 0, precipitation: 0, rain: 0, showers: 0, snowfall: 0, weather_code: 1, cloud_cover: 20, wind_speed_10m: 5, wind_direction_10m: 90 },
    daily_units: { time: "iso8601", sunrise: "iso8601", sunset: "iso8601" }, daily: { time: [today], sunrise: [today + "T06:00"], sunset: [today + "T18:00"] } };
  return { demo: true, source: "fictional demo fixture", raw };
}
async function kvLoad(env, key, seed) {
  const v = await env.DATA.get(key, "json");
  return v === null ? structuredClone(seed) : v;
}
async function handleGet(request, env, url, path, query, actor) {
  if (path === "/whoami") return json(actor ? { user: actor.u, role: actor.r, demo: true } : { user: null, demo: true });
  if (path === "/auth/check") {
    if (!actor) return json({ error: "authentication_required" }, 401);
    const target = normPath(new URL(request.headers.get("X-Forwarded-Uri") || request.headers.get("X-Original-Uri") || "/", "http://x").pathname);
    if (!allowed(target, actor)) return json({ error: "forbidden" }, 403);
    return new Response("", { status: 200, headers: { "X-Auth-User": actor.u, "X-Auth-Role": actor.r } });
  }
  if (path === "/login") {
    const who = query.get("as") === "yuki" ? "yuki" : "yeti";
    return htmlPage(loginPage(who, query.get("next") || ""));
  }
  if (path === "/logout") return redirect("/", COOKIE + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  const hg = path.match(/^\/api\/house\/([\w-]+)$/);
  if (hg) {
    if (!actor) return json({ error: "authentication_required" }, 401);
    const h = HOUSES[hg[1]];
    if (!h) return json({ error: "not_found" }, 404);
    const msgs = await kvLoad(env, "house:" + hg[1] + ":messages", []);
    return json({ house: { id: h.id, name: h.name, greeting: h.greeting, owners: h.owners, ownerNames: h.owners.map(o => PROFILES[o].name) }, me: actor.u, messages: msgs });
  }
  if (!allowed(path, actor)) {
    if (!actor) return redirect("/login?as=" + (path.startsWith("/yuki") ? "yuki" : "yeti") + "&next=" + encodeURIComponent(path));
    return htmlPage('<html><body><h1>403 · 当前身份不能查看管理员页面</h1><a href="/yuki/">返回阿安首页</a></body></html>', 403);
  }
  if (path.startsWith("/cron-api/")) return json({ demo: true, jobs: JOBS });
  if (path === "/static/weather/home.json") return json(weatherFixture());
  if (path === "/static/site-stats-v1.json") return json({ demo: true, total_views: 1280, today_views: 24, today_visitors: 8, blocked_ips: 0, ban_status: "ok", started_at: "2026-01-01T00:00:00Z", updated_at: new Date().toISOString() });
  if (path === "/api/holidays") return json({ demo: true, source: "demo", days: [] });
  if (path === "/api/profile") return json(PROFILES);
  if (path === "/api/notes" && query.get("scope") === "public") {
    const items = [];
    for (const u of Object.keys(PROFILES)) { const ns = await kvLoad(env, "notes:" + u, SEED_NOTES[u]); items.push(...ns.filter(n => n.visibility === "public")); }
    return json({ demo: true, scope: "public", items });
  }
  if ((path.startsWith("/api/") || path.startsWith("/data/")) && !actor) return json({ error: "authentication_required" }, 401);
  if (path === "/api/notes") {
    const who = query.get("user") || actor.u;
    if (who !== actor.u) return json({ error: "forbidden" }, 403);
    return json({ demo: true, user: who, items: await kvLoad(env, "notes:" + who, SEED_NOTES[who]) });
  }
  if (path === "/api/blog-drafts") return json({ demo: true, user: actor.u, items: await kvLoad(env, "drafts:" + actor.u, []) });
  if (path === "/api/anniv") return json({ demo: true, scope: "family", items: await kvLoad(env, "anniv", SEED_ANNIV) });
  if (path === "/data/status.json" || path === "/data/live.json") return json(synthStatus());
  if (path === "/api/status") return json({ demo: true, ok: true });
  if (path.startsWith("/api/")) return json({ error: "demo_endpoint_unconfigured" }, 404);
  const resp = await env.ASSETS.fetch(request);
  const ct = resp.headers.get("Content-Type") || "";
  if (resp.status === 200 && ct.includes("text/html")) {
    const text = await resp.text();
    return htmlPage(text, 200);
  }
  return resp;
}
async function handlePost(request, env, url, path, query) {
  const raw = await request.text();
  if (raw.length > 65536) return json({ error: "body_too_large" }, 413);
  if (path === "/login") {
    const who = query.get("as") === "yuki" ? "yuki" : "yeti";
    const form = new URLSearchParams(raw);
    if (form.get("password") !== DEMO_PASSWORD) return htmlPage(loginPage(who, "", "演示口令是 demo"), 401);
    const role = ROLES[who];
    const remember = form.get("remember") === "1";
    const token = await makeToken(env, who, role, remember ? MAX_AGE : SESSION_AGE);
    const mx = remember ? `; Max-Age=${MAX_AGE}; Expires=${new Date(Date.now() + MAX_AGE * 1000).toUTCString()}` : "";
    const nextPath = safeNext(query.get("next") || "", who, role);
    return redirect(nextPath, `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${mx}; Secure`);
  }
  const actor = await actorFrom(request, env);
  if (!actor) return json({ error: "authentication_required" }, 401);
  if (!allowed(path, actor)) return json({ error: "forbidden" }, 403);
  if (path.startsWith("/cron-api/") || path.startsWith("/yeti/server/ai-api/")) return json({ error: "demo_read_only_no_execution" }, 409);
  let payload; try { payload = JSON.parse(raw); if (typeof payload !== "object" || payload === null || Array.isArray(payload)) throw 0; } catch { return json({ error: "invalid_json" }, 400); }
    const hm = path.match(/^\/api\/house\/([\w-]+)\/messages$/);
  if (hm) {
    const h = HOUSES[hm[1]];
    if (!h) return json({ error: "not_found" }, 404);
    const key = "house:" + hm[1] + ":messages";
    const items = await kvLoad(env, key, []);
    if (payload.action === "create") {
      const text = String(payload.text || "").trim();
      if (!text || text.length > 200) return json({ error: "invalid_text" }, 400);
      items.push({ id: "m-" + randHex(4), user: actor.u, name: PROFILES[actor.u].name, text, ts: isoShanghai() });
      while (items.length > 300) items.shift();
      await env.DATA.put(key, JSON.stringify(items));
      return json({ ok: true, messages: items });
    }
    if (payload.action === "delete") {
      const i = items.findIndex(x => x.id === payload.id);
      if (i < 0) return json({ error: "not_found" }, 404);
      if (items[i].user !== actor.u && !h.owners.includes(actor.u)) return json({ error: "forbidden" }, 403);
      items.splice(i, 1);
      await env.DATA.put(key, JSON.stringify(items));
      return json({ ok: true, messages: items });
    }
    return json({ error: "unknown_action" }, 400);
  }
  if (!["/api/notes", "/api/anniv", "/api/blog-drafts"].includes(path)) return json({ error: "demo_endpoint_unconfigured" }, 404);
  const who = payload.user || actor.u;
  if (who !== actor.u) return json({ error: "forbidden" }, 403);
  const isAnniv = path === "/api/anniv", isDraft = path.endsWith("drafts");
  const key = isAnniv ? "anniv" : (isDraft ? "drafts:" + who : "notes:" + who);
  const seed = isAnniv ? SEED_ANNIV : (isDraft ? [] : SEED_NOTES[who]);
  const items = await kvLoad(env, key, seed);
  const action = payload.action;
  let item = items.find(x => x.id === payload.id) || null;
  if (action !== "create" && !item) return json({ error: "not_found" }, 404);
  if (item && payload.revision !== item.revision) return json({ error: "revision_conflict" }, 409);
  if (action === "delete") {
    items.splice(items.indexOf(item), 1);
    await env.DATA.put(key, JSON.stringify(items));
    return json({ demo: true, ok: true });
  }
  if (action === "to-draft" && path === "/api/notes") {
    const drafts = await kvLoad(env, "drafts:" + who, []);
    const draft = { id: "demo-draft-" + randHex(4), title: "示例草稿", content: item.text, date: item.date, revision: 1, updatedAt: isoShanghai() };
    drafts.push(draft);
    await env.DATA.put("drafts:" + who, JSON.stringify(drafts));
    return json({ demo: true, draft });
  }
  if (!["create", "update"].includes(action)) return json({ error: "invalid_action" }, 400);
  const allowedFields = isAnniv ? ["name", "date"] : isDraft ? ["title", "content"] : ["text", "date", "occurredAt", "visibility"];
  const values = {}; for (const k of allowedFields) if (k in payload) values[k] = payload[k];
  if (Object.values(values).some(v => !(typeof v === "string" || v === null) || (typeof v === "string" && v.length > 30000))) return json({ error: "invalid_fields" }, 400);
  if (!["public", "private"].includes(values.visibility ?? "private")) return json({ error: "invalid_visibility" }, 400);
  if (!item) {
    item = { id: "demo-" + randHex(6), owner: who, revision: 0, createdAt: isoShanghai(), editable: true, visibility: "private" };
    items.push(item);
  }
  Object.assign(item, values);
  item.revision += 1; item.updatedAt = isoShanghai();
  await env.DATA.put(key, JSON.stringify(items));
  return json({ demo: true, ok: true, item });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = normPath(url.pathname);
    if (path === null) return json({ error: "invalid_path" }, 400);
    const query = url.searchParams;
    if (request.method === "GET" || request.method === "HEAD") {
      const actor = await actorFrom(request, env);
      return handleGet(request, env, url, path, query, actor);
    }
    if (request.method === "POST") return handlePost(request, env, url, path, query);
    return json({ error: "method_not_allowed" }, 405);
  }
};
