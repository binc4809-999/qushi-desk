const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const state = {
  region: "global",
  statusFilter: "all",
  selectedId: null,
  channel: "all",
  alertSource: "all",
  tipSide: "all",
  tipVenue: "all",
  opportunities: [],
  opportunitiesMeta: null,
  opportunitiesError: null,
  lastRun: null,
  lastRunError: null,
  market: { items: [], note: "" },
  kzz: null,
  alerts: [],
  alertsMeta: null,
  alertsError: null,
  strategies: null,
  strategiesError: null,
  diagrams: null,
  diagramsError: null,
  runners: [],
  runnersMeta: null,
  runnersError: null,
  selectedRunnerId: null,
  tips: [],
  tipsMeta: null,
  tipsError: null,
  pools: [],
  poolsMeta: null,
  poolsError: null,
  charts: { top3: [], crypto: [] },
  chartsMeta: null,
  chartsError: null,
  chartTf: {},
  meta: null,
  contact: null,
};

const chartInstances = new Map();
const HASH_ROUTE = {
  home: { view: "home", tab: "home", top: true },
  products: { view: "home", tab: "products", scroll: "products" },
  about: { view: "home", tab: "home", scroll: "about" },
  lead: { view: "home", tab: "home", scroll: "lead" },
  desk: { view: "desk", tab: "desk", scroll: "view-desk" },
  tips: { view: "desk", tab: "desk", scroll: "tips" },
  pool: { view: "desk", tab: "desk", scroll: "pool" },
  top3: { view: "desk", tab: "desk", scroll: "top3" },
  crypto: { view: "desk", tab: "desk", scroll: "crypto" },
  opps: { view: "live", tab: "live", top: true },
  live: { view: "live", tab: "live", scroll: "diagram-block" },
  backtest: { view: "live", tab: "live", scroll: "diagram-block" },
  runners: { view: "live", tab: "live", scroll: "runner-block" },
  contact: { view: "contact", tab: "contact", top: true },
};
const SIDE_LABEL = { buy: "买入", sell: "卖出", alert: "预警" };

async function loadJson(path) {
  const res = await fetch(path, { cache: "default" });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.replace("T", " ").slice(0, 19);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtShanghai(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).replace("T", " ").slice(0, 19);
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && v !== "") return v;
  }
  return "";
}

async function loadOptional(path) {
  try {
    return await loadJson(path);
  } catch (err) {
    console.warn(path, err);
    return null;
  }
}

function tickClock() {
  const el = $("#clock");
  if (!el) return;
  el.textContent = new Date().toLocaleString("zh-CN", { hour12: false });
}

function setView(name, opts = {}) {
  $$(".view").forEach((v) => v.classList.toggle("is-on", v.id === `view-${name}`));
  const tab = opts.tab || name;
  $$(".tab").forEach((t) => t.classList.toggle("is-on", t.dataset.hash === tab));
  document.body.classList.toggle("is-marketing", name === "home" || name === "contact");
  document.body.dataset.view = name;
  if (name !== "live") closeDetail({ restoreFocus: false });
  if (name === "desk") {
    requestAnimationFrame(() => chartInstances.forEach((c) => c.resize?.()));
  }
  if (opts.hash === false) return;
  if (name && location.hash !== `#${name}`) {
    history.replaceState(null, "", `#${name}`);
  }
}

function applyLocation() {
  const raw = (location.hash || "").replace("#", "") || "home";
  const route = HASH_ROUTE[raw] || HASH_ROUTE.home;
  if (!(location.hash || "").replace("#", "")) {
    history.replaceState(null, "", "#home");
  }
  setView(route.view, { hash: false, tab: route.tab });
  requestAnimationFrame(() => {
    if (route.scroll) {
      document.getElementById(route.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (route.top) window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function num(v, digits = 2, suffix = "") {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return `${Number(v).toFixed(digits)}${suffix}`;
}

function pctClass(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return n >= 0 ? "up" : "down";
}

function tipTs(t) {
  const n = Date.parse(t?.ts || "");
  return Number.isNaN(n) ? 0 : n;
}

function sortedTips() {
  return [...state.tips].sort((a, b) => tipTs(b) - tipTs(a));
}

function tipVenueGroup(t) {
  const v = String(t.venue || "").toLowerCase();
  const s = String(t.symbol || "").toUpperCase();
  if (v.includes("a股") || v.includes("cn") || /^\d{6}$/.test(String(t.symbol || ""))) return "cn";
  if (v.includes("crypto") || v.includes("加密") || v.includes("binance") || v.includes("okx") || /USDT/.test(s)) {
    return "crypto";
  }
  return "other";
}

function visibleTips() {
  return sortedTips().filter((t) => {
    if (state.tipSide !== "all" && (t.side || "alert") !== state.tipSide) return false;
    if (state.tipVenue !== "all" && tipVenueGroup(t) !== state.tipVenue) return false;
    return true;
  });
}

function tipScript(t) {
  return pick(t, "script_name", "script_id", "source") || "—";
}

function renderTicker() {
  const tips = sortedTips();
  if (tips.length) {
    const live = tips.filter((t) => t.live).slice(0, 3);
    const row = (live.length ? live : tips.slice(0, 4))
      .map((t) => `${esc(t.symbol || t.name)} · ${esc(SIDE_LABEL[t.side] || t.side)} · ${esc(tipScript(t))}`)
      .join("    ·    ");
    $("#ticker").textContent = row;
    return;
  }
  const ordered = sortedAlerts();
  const live = ordered.filter((a) => a.live).slice(0, 3);
  const row = (live.length ? live : ordered.slice(0, 3))
    .map((a) => `${esc(a.symbol)} · ${esc(pick(a, "action", "title"))}`)
    .join("    ·    ");
  $("#ticker").textContent = row || "暂无买卖点";
}

function emptyTipMessage(total, visible) {
  if (state.tipsError) return state.tipsError;
  if (!total) return "暂无买卖点。脚本写入 data/tips.json 后刷新即可。";
  if (!visible) return "该筛选下暂无买卖点。可改选「全部」。";
  return "";
}

function tipCard(t) {
  const side = t.side || "alert";
  const live = Boolean(t.live);
  const pair = [t.venue, t.symbol].filter(Boolean).join(" · ");
  const script = tipScript(t);
  const scriptId = pick(t, "script_id") || "";
  const when = fmtShanghai(t.ts);
  return `<li class="card tip-card side-${esc(side)}" data-symbol="${esc(t.symbol || "")}" tabindex="0">
    <div class="card-top">
      <div class="card-meta">
        <span class="pill ${esc(side)}">${esc(SIDE_LABEL[side] || side)}</span>
        ${pair ? `<span class="tag venue">${esc(pair)}</span>` : ""}
        <span class="pill ${live ? "live" : "sample"}">${live ? "LIVE" : "SAMPLE"}</span>
      </div>
      <time datetime="${esc(t.ts || "")}">${esc(when || "—")}（上海）</time>
    </div>
    <h2>${esc(t.name || t.symbol || "未命名")}</h2>
    ${t.message ? `<p class="card-body">${esc(t.message)}</p>` : ""}
    <p class="tip-script">脚本 <strong>${esc(script)}</strong>${scriptId && scriptId !== script ? ` · ${esc(scriptId)}` : ""}${t.price != null ? ` · 价 ${esc(t.price)}` : ""}</p>
  </li>`;
}

function renderTipTally() {
  const host = $("#tip-tally");
  if (!host) return;
  const rows = state.tips;
  const buy = rows.filter((t) => t.side === "buy").length;
  const sell = rows.filter((t) => t.side === "sell").length;
  const alert = rows.filter((t) => (t.side || "alert") === "alert").length;
  host.textContent = rows.length
    ? `当前 ${buy} 买 · ${sell} 卖 · ${alert} 预警`
    : "";
}

function renderTips() {
  renderTipTally();
  const host = $("#tip-feed");
  const stamp = $("#tips-stamp");
  if (!host) return;
  const total = state.tips.length;
  const liveN = state.tips.filter((t) => t.live).length;
  if (stamp) {
    const bits = [];
    if (state.tipsMeta?.sample || (total && !liveN)) bits.push("示例数据，脚本可覆盖");
    bits.push("每条标明脚本");
    bits.push("点一条可跳到对应 K 线");
    stamp.textContent = bits.join(" · ");
  }
  if (state.tipsError && !total) {
    host.innerHTML = `<li class="feed-msg is-error">${esc(state.tipsError)}</li>`;
    return;
  }
  const rows = visibleTips();
  const empty = emptyTipMessage(total, rows.length);
  host.innerHTML = rows.length ? rows.map(tipCard).join("") : `<li class="feed-msg">${esc(empty)}</li>`;
}

function selectedPool() {
  const list = state.pools || [];
  const sid = state.poolsMeta?.selected_id;
  return list.find((p) => p.id === sid) || list[0] || null;
}

function renderPool() {
  const body = $("#pool-body");
  const stamp = $("#pool-stamp");
  if (!body) return;
  if (state.poolsError && !state.pools.length) {
    if (stamp) stamp.textContent = "";
    body.innerHTML = msgRow(state.poolsError, true);
    return;
  }
  const pool = selectedPool();
  if (!pool) {
    if (stamp) stamp.textContent = "脚本写入 data/pools.json 后显示 scanner 池";
    body.innerHTML = msgRow("暂无选股池。scanner / scanner11 写入 data/pools.json 后刷新即可。");
    return;
  }
  const members = pool.members || [];
  const script = pick(pool, "script_name", "script_id") || "scanner";
  if (stamp) {
    const bits = [];
    if (state.poolsMeta?.sample || pool.sample) bits.push("示例数据，脚本可覆盖");
    bits.push(`脚本 ${script}`);
    if (pool.title) bits.push(pool.title);
    if (pool.as_of) bits.push(`数据 ${fmtShanghai(pool.as_of) || pool.as_of}（上海）`);
    bits.push(`${members.length} 只`);
    stamp.textContent = bits.join(" · ");
  }
  if (!members.length) {
    body.innerHTML = msgRow("该池暂无标的。");
    return;
  }
  body.innerHTML = members
    .map(
      (r) => `<tr>
        <td>${esc(r.symbol)}</td>
        <td><span class="name">${esc(r.name || r.symbol)}</span></td>
        <td>${fmtNum(r.price)}</td>
        <td class="${pctClass(Number(r.chg_pct))}">${r.chg_pct == null ? "—" : `${Number(r.chg_pct) >= 0 ? "+" : ""}${fmtNum(r.chg_pct)}%`}</td>
        <td class="${pctClass(Number(r.speed_pct))}">${r.speed_pct == null ? "—" : `${fmtNum(r.speed_pct)}%`}</td>
        <td>${fmtNum(r.volume_ratio)}</td>
        <td>${esc(r.note || "")}</td>
      </tr>`
    )
    .join("");
}

function destroyCharts() {
  chartInstances.forEach((c) => c.destroy?.());
  chartInstances.clear();
}

function chartCard(spec, kicker) {
  const id = spec.id || spec.symbol;
  const tf = state.chartTf[id] || (globalThis.DeskKline?.defaultInterval(spec) ?? spec.default_interval);
  const chips = (globalThis.DeskKline?.tfList(spec) || []).map(
    (x) => `<button type="button" class="chip${x.id === tf ? " is-on" : ""}" data-tf="${esc(x.id)}">${esc(x.label)}</button>`
  );
  const script = pick(spec, "script_name", "script_id") || "—";
  const rank = spec.rank ? `TOP${spec.rank}` : kicker;
  return `<article class="chart-card" data-chart-id="${esc(id)}" data-symbol="${esc(spec.symbol || "")}">
    <div class="chart-head">
      <div>
        ${rank ? `<p class="chart-kicker">${esc(rank)}</p>` : ""}
        <h3>${esc(spec.name || spec.symbol)}<span class="sub">${esc([spec.symbol, spec.venue].filter(Boolean).join(" · "))}</span></h3>
        <p class="chart-script">脚本 <strong>${esc(script)}</strong>${spec.message ? ` · ${esc(spec.message)}` : ""}</p>
      </div>
    </div>
    <div class="filters tf-row" role="group" aria-label="周期">${chips.join("")}</div>
    <div class="kline-host" id="kline-${esc(id)}"></div>
    <p class="chart-note">K 线为示意数据 · 标的由脚本固定 · 可拖动查看，切换周期不改标的</p>
  </article>`;
}

function mountChart(spec) {
  const id = spec.id || spec.symbol;
  const host = document.getElementById(`kline-${id}`);
  if (!host || !globalThis.DeskKline) return;
  const tf = state.chartTf[id] || DeskKline.defaultInterval(spec);
  state.chartTf[id] = tf;
  const chart = DeskKline.mount(host, { ...spec, default_interval: tf });
  chartInstances.set(id, chart);
}

function renderChartGroup(hostId, stampId, list, emptyText, kicker, stampLead) {
  const host = document.getElementById(hostId);
  const stamp = document.getElementById(stampId);
  if (!host) return;
  if (state.chartsError && !list.length) {
    if (stamp) stamp.textContent = "";
    host.innerHTML = `<p class="feed-msg is-error">${esc(state.chartsError)}</p>`;
    return;
  }
  if (stamp) {
    const bits = [];
    if (state.chartsMeta?.sample) bits.push("示例数据，脚本可覆盖");
    if (stampLead) bits.push(stampLead);
    bits.push("标的固定 · 可拖动 · 可切换周期");
    stamp.textContent = bits.join(" · ");
  }
  if (!list.length) {
    host.innerHTML = `<p class="feed-msg">${esc(emptyText)}</p>`;
    return;
  }
  host.innerHTML = list.map((spec) => chartCard(spec, kicker)).join("");
  list.forEach((spec) => mountChart(spec));
}

function renderCharts() {
  destroyCharts();
  const top3 = state.charts.top3 || [];
  const crypto = state.charts.crypto || [];
  renderChartGroup(
    "top3-charts",
    "top3-stamp",
    top3,
    "暂无 TOP3。monitor / monitor11 写入 data/charts.json 的 top3 后刷新即可。",
    "TOP3",
    "默认日线"
  );
  renderChartGroup(
    "crypto-charts",
    "crypto-stamp",
    crypto,
    "暂无加密币对。脚本写入 data/charts.json 的 crypto 后刷新即可。",
    "加密",
    "默认 30 分"
  );
}

function renderDesk() {
  renderTips();
  renderPool();
  renderCharts();
  renderHomeProof();
}

function focusChartForSymbol(symbol) {
  if (!symbol) return;
  const card = document.querySelector(`#view-desk .chart-card[data-symbol="${CSS.escape(symbol)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

function applyTips(data, fallbackError) {
  if (data && Array.isArray(data.items)) {
    state.tips = data.items;
    state.tipsMeta = data;
    state.tipsError = null;
    return;
  }
  if (!state.tips.length) {
    state.tips = [];
    state.tipsMeta = data;
    state.tipsError = fallbackError;
  }
}

function applyPools(data, fallbackError) {
  if (data && Array.isArray(data.pools)) {
    state.pools = data.pools;
    state.poolsMeta = data;
    state.poolsError = null;
    return;
  }
  if (!state.pools.length) {
    state.pools = [];
    state.poolsMeta = data;
    state.poolsError = fallbackError;
  }
}

function applyCharts(data, fallbackError) {
  if (data && (Array.isArray(data.top3) || Array.isArray(data.crypto) || Array.isArray(data.charts))) {
    state.charts = {
      top3: data.top3 || (data.charts || []).filter((c) => c.role === "top3" || c.kind === "stock"),
      crypto: data.crypto || (data.charts || []).filter((c) => c.role === "pair" || c.kind === "crypto"),
    };
    state.chartsMeta = data;
    state.chartsError = null;
    return;
  }
  if (!(state.charts.top3 || []).length && !(state.charts.crypto || []).length) {
    state.charts = { top3: [], crypto: [] };
    state.chartsMeta = data;
    state.chartsError = fallbackError;
  }
}

function oppId(o) {
  return String(o?.id || o?.name || "");
}

function rowHtml(o) {
  const id = oppId(o);
  const region = pick(o, "region_label", "region");
  const klass = pick(o, "klass_label", "klass");
  const mechanism = pick(o, "mechanism", "thesis");
  const expected = pick(o, "public_returns", "expected");
  const cost = pick(o, "main_cost", "cost");
  const status = o.status || "";
  const statusLabel = pick(o, "status_label") || status;
  const open = id && state.selectedId === id ? " is-open" : "";
  return `<tr class="opp-row${open}" data-id="${esc(id)}" tabindex="0" role="button" aria-haspopup="dialog" aria-expanded="${open ? "true" : "false"}">
        <td class="prio">${esc(o.priority)}</td>
        <td><span class="name">${esc(o.name)}</span><span class="sub">${esc(region)}${klass ? ` · ${esc(klass)}` : ""}</span></td>
        <td class="clip"><span class="clip-text">${esc(mechanism)}</span></td>
        <td>${esc(expected)}</td>
        <td>${esc(o.drawdown)}</td>
        <td class="clip"><span class="clip-text">${esc(cost)}</span></td>
        <td><span class="pill ${esc(status)}">${esc(statusLabel)}</span></td>
      </tr>`;
}

function msgRow(text, isError = false) {
  return `<tr class="msg-row${isError ? " is-error" : ""}"><td colspan="7">${esc(text)}</td></tr>`;
}

function regionOpps() {
  return state.opportunities.filter((o) => o.region === state.region);
}

function visibleOpps() {
  const rows = regionOpps();
  if (state.statusFilter === "all") return rows;
  return rows.filter((o) => o.status === state.statusFilter);
}

function emptyOppMessage(regionCount, visibleCount) {
  if (!regionCount) return "该分类暂无机会。脚本写入 data/opportunities.json 后刷新即可。";
  if (!visibleCount) return "该状态下暂无机会。可改选「全部」或其它状态。";
  return "";
}

function renderOpps() {
  const cnBlock = $("#cn-block");
  const oppBlock = $("#opp-block");
  const stamp = $("#opp-stamp");
  // 投资机会页已下线；无 DOM 时直接跳过，避免打断 boot
  if (!oppBlock && !cnBlock && !$("#opp-body")) return;

  const showCn = state.region === "cn";
  const rows = visibleOpps();
  const regionCount = regionOpps().length;

  if (state.selectedId && !rows.some((o) => oppId(o) === state.selectedId)) {
    state.selectedId = null;
  }

  if (stamp) {
    const bits = [];
    if (state.opportunitiesMeta?.sample) bits.push("示例数据，脚本可覆盖");
    if (state.opportunitiesMeta?.updated_at) bits.push(`数据 ${state.opportunitiesMeta.updated_at}`);
    bits.push("点一行看详情");
    stamp.textContent = bits.join(" · ");
  }

  if (oppBlock) oppBlock.classList.toggle("is-hidden", showCn);
  cnBlock?.classList.toggle("is-hidden", !showCn);

  if (state.opportunitiesError) {
    const html = msgRow(state.opportunitiesError, true);
    if ($("#opp-body")) $("#opp-body").innerHTML = html;
    if ($("#cn-body")) $("#cn-body").innerHTML = html;
  } else {
    const empty = emptyOppMessage(regionCount, rows.length);
    const html = rows.length ? rows.map(rowHtml).join("") : msgRow(empty);
    if (showCn) {
      if ($("#opp-body")) $("#opp-body").innerHTML = "";
      if ($("#cn-body")) $("#cn-body").innerHTML = html;
    } else if ($("#opp-body")) {
      $("#opp-body").innerHTML = html;
    }
  }

  renderDetail();
  renderMarket();
  renderQuotes();
}

function detailField(label, value, html = false) {
  if (value == null || String(value).trim() === "") return "";
  return `<div class="detail-field"><dt>${esc(label)}</dt><dd>${html ? value : esc(value)}</dd></div>`;
}

function renderDetail() {
  const host = $("#opp-detail");
  const scrim = $("#opp-scrim");
  if (!host || !scrim) return;
  const o = state.selectedId
    ? state.opportunities.find((x) => oppId(x) === state.selectedId)
    : null;
  const open = Boolean(o);
  host.classList.toggle("is-hidden", !open);
  scrim.classList.toggle("is-hidden", !open);
  host.hidden = !open;
  scrim.hidden = !open;
  document.body.classList.toggle("drawer-open", open);
  if (!open) {
    host.innerHTML = "";
    return;
  }

  const region = pick(o, "region_label", "region");
  const klass = pick(o, "klass_label", "klass");
  const mechanism = pick(o, "mechanism", "thesis");
  const expected = pick(o, "public_returns", "expected");
  const cost = pick(o, "main_cost", "cost");
  const status = o.status || "";
  const statusLabel = pick(o, "status_label") || status;
  const links = Array.isArray(o.links) ? o.links.filter((l) => l && l.url) : [];
  const linkHtml = links.length
    ? links
        .map(
          (l) =>
            `<a class="opp-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a>`
        )
        .join("")
    : "";

  host.innerHTML = `
    <div class="drawer-head">
      <div>
        <p class="drawer-kicker">${esc(o.priority || "")}${region ? ` · ${esc(region)}` : ""}${klass ? ` · ${esc(klass)}` : ""}</p>
        <h2 id="opp-detail-title">${esc(o.name)}</h2>
      </div>
      <button type="button" class="drawer-close" id="opp-detail-close" aria-label="关闭详情">关闭</button>
    </div>
    <p class="drawer-status"><span class="pill ${esc(status)}">${esc(statusLabel)}</span></p>
    <dl class="detail-dl">
      ${detailField("机制", mechanism)}
      ${detailField("公开收益", expected)}
      ${detailField("回撤", o.drawdown)}
      ${detailField("主要代价", cost)}
      ${detailField("调研备注", o.evidence)}
      ${detailField("来源", o.source)}
      ${detailField("as of", o.as_of)}
      ${linkHtml ? detailField("链接", `<span class="detail-links">${linkHtml}</span>`, true) : ""}
    </dl>`;
  $("#opp-detail-close")?.focus();
}

function closeDetail(opts = {}) {
  const id = state.selectedId;
  if (!id && $("#opp-detail")?.hidden) return;
  state.selectedId = null;
  renderDetail();
  $$(".opp-row.is-open").forEach((tr) => {
    tr.classList.remove("is-open");
    tr.setAttribute("aria-expanded", "false");
  });
  if (opts.restoreFocus !== false && id) {
    const row = document.querySelector(`#view-opps tr.opp-row[data-id="${CSS.escape(id)}"]`);
    row?.focus();
  }
}

function openDetail(id) {
  if (!id) return;
  if (state.selectedId === id) {
    closeDetail();
    return;
  }
  state.selectedId = id;
  $$(".opp-row").forEach((tr) => {
    const on = tr.dataset.id === id;
    tr.classList.toggle("is-open", on);
    tr.setAttribute("aria-expanded", on ? "true" : "false");
  });
  renderDetail();
}

const STATUS_LABEL = { success: "成功", failed: "失败", running: "运行中" };
const KIND_LABEL = {
  open: "开仓",
  close: "平仓",
  tp: "止盈",
  sl: "止损",
  monitor: "监控",
  system: "系统",
  info: "信息",
  data: "数据",
};
const CHANNEL_LABEL = { trade: "开平仓", monitor: "选股监控", system: "系统" };
const SEV_LABEL = { signal: "信号", risk: "风险", info: "信息", system: "系统" };
const STRAT_STATUS_LABEL = {
  live: "实盘",
  paused: "暂停",
  sample: "样例",
  watch: "观察",
  research: "研究",
};
const RUNNER_STATUS_LABEL = {
  running: "运行中",
  waiting: "等待",
  idle: "空闲",
  error: "异常",
  stopped: "已停",
};

function lastRunHtml() {
  const run = state.lastRun;
  if (!run) {
    const detail = state.lastRunError || "未读到 data/last_run.json";
    return { status: "unknown", html: `<span class="pl-kicker">管道</span><span class="pl-line">${esc(detail)}</span>` };
  }
  const status = String(run.status || "unknown").toLowerCase();
  const label = STATUS_LABEL[status] || status;
  const successAt = fmtShanghai(run.last_success_at);
  const finishedAt = fmtShanghai(run.finished_at || run.started_at);
  const startedAt = fmtShanghai(run.started_at);
  let timeBit = "";
  if (status === "success" && (successAt || finishedAt)) {
    timeBit = `最近成功 ${successAt || finishedAt}（上海）`;
  } else if (status === "failed") {
    timeBit = [finishedAt ? `失败于 ${finishedAt}（上海）` : "", successAt ? `上次成功 ${successAt}（上海）` : ""]
      .filter(Boolean)
      .join(" · ");
  } else if (status === "running") {
    timeBit = startedAt ? `开始于 ${startedAt}（上海）` : "运行中";
  } else if (successAt) {
    timeBit = `上次成功 ${successAt}（上海）`;
  }
  const scripts = [].concat(run.scripts || run.script || []).filter(Boolean).join(" · ");
  const summary = run.summary || "";
  const err = run.error ? `<span class="pl-error">${esc(run.error)}</span>` : "";
  const sample = run.sample ? `<span class="pl-note">示例心跳</span>` : "";
  return {
    status,
    html: [
      `<span class="pl-kicker">管道</span>`,
      `<span class="pl-status">${esc(label)}</span>`,
      timeBit ? `<span class="pl-time">${esc(timeBit)}</span>` : "",
      scripts ? `<span class="pl-scripts">${esc(scripts)}</span>` : "",
      summary ? `<span class="pl-summary">${esc(summary)}</span>` : "",
      err,
      sample,
    ].join(""),
  };
}

function renderLastRun() {
  const painted = lastRunHtml();
  $$(".js-last-run").forEach((host) => {
    host.dataset.status = painted.status;
    host.innerHTML = painted.html;
  });
}

function renderMarket() {
  const host = $("#market");
  if (!host) return;
  const groups = [
    { kind: "盘前资讯", hint: "原文在韭研公社，点链接去原站。" },
    { kind: "涨停复盘", hint: "原文含涨停简图，点链接去原站。" },
  ];
  const items = state.market.items || [];
  host.innerHTML = groups
    .map((g) => {
      const links = items
        .filter((x) => x.kind === g.kind)
        .map(
          (x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}<span>${esc(x.source)} · ${esc(x.date)}</span></a>`
        )
        .join("");
      return `<section class="market-col"><h2>${esc(g.kind)}</h2><p class="hint">${esc(g.hint)}</p>${links}</section>`;
    })
    .join("");
}

function fmtNum(v, digits = 2) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return esc(v);
  return n.toFixed(digits);
}

function renderKzz() {
  const data = state.kzz;
  const subBody = $("#kzz-subscribe");
  const appBody = $("#kzz-approved");
  if (!subBody || !appBody) return;
  if (!data) {
    subBody.innerHTML = "";
    appBody.innerHTML = "";
    return;
  }
  const stamp = $("#kzz-stamp");
  if (stamp) stamp.textContent = data.updated_at ? `更新 ${fmtTime(data.updated_at)} · 仅展示公开字段` : "";
  if (data.sources?.eastmoney) $("#kzz-em-link").href = data.sources.eastmoney;
  if (data.sources?.jisilu) $("#kzz-jsl-link").href = data.sources.jisilu;

  const subscribe = data.subscribe || [];
  subBody.innerHTML = subscribe.length
    ? subscribe
        .map(
          (r) => `<tr>
            <td><span class="name">${esc(r.bond_name)}</span><span class="sub">${esc(r.bond_code)} · 正股 ${esc(r.stock_code)}</span></td>
            <td>${esc(r.apply_code || "—")}</td>
            <td>${esc(r.apply_date || "—")}</td>
            <td>${fmtNum(r.issue_scale)}</td>
            <td>${esc(r.rating || "—")}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="5">暂无申购数据</td></tr>`;

  const approved = data.approved || [];
  appBody.innerHTML = approved.length
    ? approved
        .map(
          (r) => `<tr>
            <td><span class="name">${esc(r.bond_name || r.stock_name)}</span><span class="sub">${esc(r.bond_code || r.stock_code)} · ${esc(r.stock_name)} ${esc(r.stock_code)}</span></td>
            <td>${esc(r.progress)}</td>
            <td>${esc(r.reg_date || "—")}</td>
            <td>${fmtNum(r.issue_scale)}</td>
            <td>${esc(r.rating || "—")}</td>
            <td class="${pctClass(Number(r.stock_chg))}">${fmtNum(r.stock_price)} <span class="sub">${fmtNum(r.stock_chg, 2)}%</span></td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="6">暂无同意注册标的</td></tr>`;
}


function alertTs(a) {
  const t = Date.parse(a?.ts || "");
  return Number.isNaN(t) ? 0 : t;
}

function sortedAlerts() {
  return [...state.alerts].sort((a, b) => alertTs(b) - alertTs(a));
}

function fmtConfidence(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isNaN(n) && String(v).trim() !== "") {
    if (n >= 0 && n <= 1) return `${Math.round(n * 100)}%`;
    return String(v);
  }
  return String(v);
}

function visibleAlerts() {
  return sortedAlerts().filter((a) => {
    const channel = a.channel || "system";
    if (state.channel !== "all" && channel !== state.channel) return false;
    if (state.alertSource === "live" && !a.live) return false;
    return true;
  });
}

function emptyAlertMessage(total, visible) {
  if (state.alertsError) return state.alertsError;
  if (!total) return "暂无预警。脚本写入 data/alerts.json 后刷新即可。";
  if (!visible && state.alertSource === "live") return "暂无 LIVE 预警。SAMPLE 仍保留在「全部」，实盘推送后会出现在这里。";
  if (!visible) return "该筛选下暂无预警。可改选「全部」或其它频道。";
  return "";
}

function renderAlertHeartbeat() {
  const host = $("#alert-heartbeat");
  if (!host) return;
  if (state.alertsError && !state.alerts.length) {
    host.dataset.status = "failed";
    host.innerHTML = `<span class="pl-kicker">预警</span><span class="pl-error">${esc(state.alertsError)}</span>`;
    return;
  }
  const items = state.alerts;
  const liveN = items.filter((a) => a.live).length;
  const sampleN = items.length - liveN;
  const updated = pick(state.alertsMeta, "updated_at") || items[0]?.ts;
  const sh = fmtShanghai(updated);
  const sampleFlag = state.alertsMeta?.sample || (items.length > 0 && liveN === 0);
  host.dataset.status = liveN ? "success" : items.length ? "unknown" : "unknown";
  host.innerHTML = [
    `<span class="pl-kicker">预警</span>`,
    sh ? `<span class="pl-time">最近写入 ${esc(sh)}（上海）</span>` : `<span class="pl-line">尚无写入时间</span>`,
    `<span class="pl-scripts">LIVE ${liveN} · SAMPLE ${sampleN}</span>`,
    sampleFlag ? `<span class="pl-note">当前为 SAMPLE，等待脚本推送</span>` : "",
  ].join("");
}

function alertCard(a) {
  const live = Boolean(a.live);
  const kind = a.kind || "";
  const channel = a.channel || "system";
  const action = pick(a, "action", "title") || KIND_LABEL[kind] || "预警";
  const trigger = pick(a, "trigger", "body");
  const venue = a.venue || "";
  const symbol = a.symbol || "";
  const pair = [venue, symbol].filter(Boolean).join(" · ");
  const conf = fmtConfidence(a.confidence);
  const sev = SEV_LABEL[a.severity] || a.severity || "";
  const foot = [
    sev ? `状态 ${sev}` : "",
    conf ? `置信 ${conf}` : "",
    a.source ? a.source : "",
  ].filter(Boolean);
  return `<li class="card sev-${esc(a.severity || "info")} ${live ? "is-live" : "is-sample"}">
        <div class="card-top">
          <div class="card-meta">
            <span class="pill ${live ? "live" : "sample"}">${live ? "LIVE" : "SAMPLE"}</span>
            <span class="tag">${esc(KIND_LABEL[kind] || kind)}</span>
            <span class="tag muted">${esc(CHANNEL_LABEL[channel] || channel)}</span>
            ${pair ? `<span class="tag venue">${esc(pair)}</span>` : ""}
          </div>
          <time datetime="${esc(a.ts || "")}">${esc(fmtShanghai(a.ts) || "—")}（上海）</time>
        </div>
        <h2>${esc(action)}</h2>
        ${trigger ? `<p class="card-body">${esc(trigger)}</p>` : ""}
        ${foot.length ? `<p class="card-foot">${esc(foot.join(" · "))}</p>` : ""}
      </li>`;
}

function renderAlerts() {
  renderAlertHeartbeat();
  const stamp = $("#alert-stamp");
  const host = $("#alert-feed");
  if (!host) return;
  const total = state.alerts.length;
  const liveN = state.alerts.filter((a) => a.live).length;
  if (stamp) {
    const bits = [];
    if (state.alertsMeta?.sample || (total && !liveN)) bits.push("含 SAMPLE，不是实时成交");
    bits.push("按时间倒序");
    stamp.textContent = bits.join(" · ");
  }
  if (state.alertsError && !total) {
    host.innerHTML = `<li class="feed-msg is-error">${esc(state.alertsError)}</li>`;
    return;
  }
  const rows = visibleAlerts();
  const empty = emptyAlertMessage(total, rows.length);
  host.innerHTML = rows.length ? rows.map(alertCard).join("") : `<li class="feed-msg">${esc(empty)}</li>`;
}

function normSym(s) {
  return String(s || "").replace(/[-_/]/g, "").toUpperCase();
}

function alertMatchesStrat(a, s, venue) {
  if (!a || a.channel === "system" || a.kind === "system") return false;
  const aSym = String(a.symbol || "");
  const inst = String(s.instId || s.symbol || "");
  if (inst && (aSym === inst || normSym(aSym) === normSym(inst))) {
    return venueMatches(a, s, venue);
  }
  const name = String(s.name || "");
  if (/^[A-Z0-9]{2,6}$/i.test(name)) {
    const up = aSym.toUpperCase();
    const n = name.toUpperCase();
    if (up === n || up.startsWith(`${n}-`) || up.startsWith(`${n}USDT`) || up.startsWith(`${n}_`)) {
      return venueMatches(a, s, venue);
    }
  }
  return false;
}

function venueMatches(a, s, venue) {
  const av = String(a.venue || "").toLowerCase();
  if (!av) return true;
  const names = [s.exchange, venue.id, venue.title].filter(Boolean).map((x) => String(x).toLowerCase());
  return names.some((n) => n === av || n.includes(av) || av.includes(String(venue.id || "").toLowerCase()));
}

function lastSignalFor(s, venue) {
  const explicit = s.last_signal;
  if (explicit && (explicit.ts || explicit.title || explicit.action)) return explicit;
  return sortedAlerts().find((a) => alertMatchesStrat(a, s, venue)) || null;
}

function stratStatus(s) {
  const status = String(s.status || (s.sample ? "sample" : "")).toLowerCase();
  const label = pick(s, "status_label") || STRAT_STATUS_LABEL[status] || status || "—";
  return { status: status || "watch", label };
}

function stratNetPnl(s) {
  if (s.net_pnl != null && !Number.isNaN(Number(s.net_pnl))) return Number(s.net_pnl);
  const rows = s.by_signal || [];
  if (!rows.length) return null;
  let sum = 0;
  let any = false;
  for (const r of rows) {
    if (r.pnl == null || Number.isNaN(Number(r.pnl))) continue;
    sum += Number(r.pnl);
    any = true;
  }
  return any ? sum : null;
}

function isHighProfitStrat(s, data) {
  if (s.featured === true) return true;
  if (s.featured === false) return false;
  const minRet = data?.min_ret_pct ?? 30;
  const minPnl = data?.min_net_pnl ?? 2000;
  const ret = s.ret_pct != null ? Number(s.ret_pct) : null;
  const pnl = stratNetPnl(s);
  if (pnl != null && pnl >= minPnl) return true;
  if (ret != null && ret >= minRet) return true;
  return false;
}

function equitySvg(points, w = 520, h = 160) {
  if (!points?.length) return "";
  const vals = points.map((p) => Number(p[1]));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const pad = 12;
  const coords = points.map((p, i) => {
    const x = pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2);
    const y = h - pad - ((Number(p[1]) - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`;
  const last = vals[vals.length - 1];
  const first = vals[0];
  const up = last >= first;
  const stroke = up ? "#3d9a78" : "#c45c4a";
  const fill = up ? "rgba(61,154,120,0.18)" : "rgba(196,92,74,0.18)";
  return `<svg class="eq-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="权益曲线">
    <path d="${area}" fill="${fill}"></path>
    <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2.2"></path>
  </svg>`;
}

function barsSvg(bars) {
  if (!bars) return "";
  const rows = [
    bars.ret != null ? ["收益%", bars.ret, bars.ret >= 0] : null,
    bars.dd != null ? ["回撤%", Math.abs(bars.dd), false] : null,
    bars.winrate != null ? ["胜率%", bars.winrate, true] : null,
    bars.sharpe != null ? ["Sharpe", bars.sharpe * 100, bars.sharpe >= 0] : null,
  ].filter(Boolean);
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => Math.abs(r[1])), 1);
  return `<div class="bar-chart">${rows
    .map(([label, val, good]) => {
      const pct = Math.min(100, (Math.abs(val) / max) * 100);
      const cls = good ? "up" : "down";
      return `<div class="bar-row"><span>${esc(label)}</span><div class="bar-track"><i class="${cls}" style="width:${pct}%"></i></div><b class="${cls}">${num(val, 2)}</b></div>`;
    })
    .join("")}</div>`;
}

function signalSchematicSvg(d, w = 520, h = 168) {
  const buy = String(d.side || "buy") === "buy";
  const stroke = buy ? "#3d9a78" : "#c45c4a";
  const fill = buy ? "rgba(61,154,120,0.16)" : "rgba(196,92,74,0.16)";
  // stylized EMA + price path
  const ema = "M40,118 C120,118 160,95 220,88 C280,82 320,70 380,62 C430,56 470,52 490,50";
  const price = buy
    ? "M40,130 C110,128 150,122 190,110 C240,92 280,78 330,55 C370,40 420,34 490,28"
    : "M40,40 C110,42 150,55 200,70 C250,88 300,105 360,120 C410,132 450,140 490,145";
  const markX = 330;
  const markY = buy ? 55 : 120;
  const label = buy ? "BUY" : "SELL";
  const steps = (d.steps || []).slice(0, 4);
  const stepText = steps
    .map((s, i) => `<text x="40" y="${148 + i * 0}" opacity="0">${esc(s)}</text>`)
    .join("");
  return `<svg class="eq-svg signal-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(d.title || "信号示意")}">
    <rect x="0" y="0" width="${w}" height="${h}" fill="rgba(0,0,0,0.18)"></rect>
    <path d="${ema}" fill="none" stroke="rgba(200,180,120,0.55)" stroke-width="1.6" stroke-dasharray="5 4"></path>
    <path d="${price}" fill="none" stroke="${stroke}" stroke-width="2.4"></path>
    <circle cx="${markX}" cy="${markY}" r="7" fill="${fill}" stroke="${stroke}" stroke-width="2"></circle>
    <text x="${markX + 12}" y="${markY + 4}" fill="${stroke}" font-size="12" font-weight="600">${label} · ${esc(d.signal || "")}</text>
    <text x="40" y="24" fill="rgba(232,228,220,0.55)" font-size="11">虚线 = EMA · 实线 = 价格路径（示意）</text>
    ${stepText}
  </svg>
  <ol class="signal-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
}

function tradeSchematicSvg(d, w = 520, h = 160) {
  const entry = Number(d.entry);
  const exit = Number(d.exit);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return "";
  const long = String(d.dir || "long") === "long";
  const pad = 18;
  const midY = h / 2;
  // synthetic path: start near entry, end at exit with mild curve
  const y0 = long ? midY + 28 : midY - 28;
  const y1 = long ? (exit >= entry ? midY - 36 : midY + 36) : exit <= entry ? midY + 36 : midY - 36;
  const x0 = pad + 20;
  const x1 = w - pad - 20;
  const xm = (x0 + x1) / 2;
  const path = `M${x0},${y0} Q${xm},${(y0 + y1) / 2 - (long ? 18 : -18)} ${x1},${y1}`;
  const up = (d.pnl ?? 0) >= 0;
  const stroke = up ? "#3d9a78" : "#c45c4a";
  const buyLabel = long ? "开多" : "开空";
  const sellLabel = long ? "平多" : "平空";
  return `<svg class="eq-svg trade-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="成交示意">
    <rect x="0" y="0" width="${w}" height="${h}" fill="rgba(0,0,0,0.18)"></rect>
    <path d="${path}" fill="none" stroke="${stroke}" stroke-width="2.4"></path>
    <circle cx="${x0}" cy="${y0}" r="6" fill="#3d9a78"></circle>
    <circle cx="${x1}" cy="${y1}" r="6" fill="#c45c4a"></circle>
    <text x="${x0 + 10}" y="${y0 - 10}" fill="#3d9a78" font-size="11">${buyLabel} ${num(entry, 1)}</text>
    <text x="${Math.max(pad, x1 - 120)}" y="${y1 - 10}" fill="#c45c4a" font-size="11">${sellLabel} ${num(exit, 1)}</text>
    <text x="40" y="24" fill="rgba(232,228,220,0.55)" font-size="11">${esc(d.signal || "")} · PnL ${num(d.pnl, 1)} · ${esc(d.reason || "")}</text>
  </svg>`;
}

function diagramCard(d) {
  const bits = [];
  if (d.net_pnl != null) bits.push(`净利 ${num(d.net_pnl, 0)}`);
  if (d.ret_pct != null && d.kind !== "trade") bits.push(`收益 ${num(d.ret_pct, 2, "%")}`);
  if (d.maxdd_pct != null) bits.push(`回撤 ${num(d.maxdd_pct, 2, "%")}`);
  if (d.trades != null) bits.push(`${d.trades} 笔`);
  if (d.kind === "trade" && d.pnl != null) bits.push(`PnL ${num(d.pnl, 1)}`);
  let chart = "";
  if (d.kind === "signal") chart = signalSchematicSvg(d);
  else if (d.kind === "trade") chart = tradeSchematicSvg(d);
  else if (d.equity_curve?.length) chart = equitySvg(d.equity_curve);
  else chart = barsSvg(d.bars);
  const pill = d.kind === "signal" ? "信号示意" : d.kind === "trade" ? "样本成交" : d.venue || "回测";
  return `<article class="diagram-card kind-${esc(d.kind || "equity")}">
    <div class="diagram-top">
      <span class="pill sample">${esc(pill)}</span>
      <span class="sub">${esc(d.symbol || "")}</span>
    </div>
    <h3>${esc(d.title)}</h3>
    <p class="sub">${esc(d.subtitle || d.range || "")}</p>
    ${chart}
    ${bits.length ? `<p class="strat-metrics">${esc(bits.join(" · "))}</p>` : ""}
  </article>`;
}

function renderDiagrams() {
  const host = $("#diagram-grid");
  const stamp = $("#diagram-stamp");
  if (!host) return;
  if (state.diagramsError) {
    if (stamp) stamp.textContent = "";
    host.innerHTML = `<p class="feed-msg is-error">${esc(state.diagramsError)}</p>`;
    return;
  }
  const data = state.diagrams;
  if (!data) {
    if (stamp) stamp.textContent = "";
    host.innerHTML = `<p class="feed-msg">暂无回测图示。可写入 data/backtest-diagrams.json。</p>`;
    return;
  }
  const items = data.solo
    ? data.items || []
    : (data.items || []).filter((d) => {
        if (d.kind === "signal" || d.kind === "trade") return true;
        if (d.net_pnl != null && d.net_pnl >= (data.min_net_pnl ?? 2000)) return true;
        if (d.ret_pct != null && d.ret_pct >= (data.min_ret_pct ?? 30)) return true;
        return false;
      });
  if (stamp) {
    const bits = [];
    if (data.script) bits.push(data.script);
    else if (data.note) bits.push(String(data.note).slice(0, 24));
    if (data.updated_at) bits.push(`数据 ${fmtShanghai(data.updated_at) || String(data.updated_at).slice(0, 19)}`);
    bits.push(`${items.length} 张图示`);
    stamp.textContent = bits.join(" · ");
  }
  host.innerHTML = items.length
    ? items.map(diagramCard).join("")
    : `<p class="feed-msg">暂无达到净利门槛的图示。</p>`;
}

function bySignalTable(rows) {
  if (!rows?.length) return "";
  const body = rows
    .map(
      (r) => `<tr>
      <td>${esc(r.signal)}</td>
      <td>${r.n != null ? esc(r.n) : "—"}</td>
      <td class="${Number(r.pnl) >= 0 ? "up" : "down"}">${r.pnl != null ? num(r.pnl, 1) : "—"}</td>
      <td>${r.winrate != null ? num(r.winrate, 1, "%") : "—"}</td>
    </tr>`
    )
    .join("");
  return `<table class="bt-table"><thead><tr><th>信号</th><th>笔数</th><th>净利</th><th>胜率</th></tr></thead><tbody>${body}</tbody></table>`;
}

function reasonsLine(reasons) {
  if (!reasons || typeof reasons !== "object") return "";
  const bits = Object.entries(reasons).map(([k, v]) => `${k} ${v}`);
  return bits.length ? `<p class="strat-extra"><span class="kicker">离场结构</span> ${esc(bits.join(" · "))}</p>` : "";
}

function monthlyMini(monthly) {
  if (!monthly || typeof monthly !== "object") return "";
  const entries = Object.entries(monthly);
  if (!entries.length) return "";
  const vals = entries.map(([, v]) => Number(v));
  const max = Math.max(...vals.map(Math.abs), 1);
  const bars = entries
    .map(([k, v]) => {
      const n = Number(v);
      const h = Math.max(4, Math.round((Math.abs(n) / max) * 36));
      const cls = n >= 0 ? "up" : "down";
      return `<i class="${cls}" title="${esc(k)}: ${num(n, 1)}" style="height:${h}px"></i>`;
    })
    .join("");
  return `<div class="month-bars" aria-label="月度盈亏"><span class="kicker">月度</span><div class="month-track">${bars}</div></div>`;
}

function renderSymbol(s, venue) {
  const { status, label } = stratStatus(s);
  const venueName = s.exchange || venue.title || venue.id || "";
  const inst = s.instId || s.symbol || "";
  const rule = pick(s, "rule", "params");
  const script = s.script || "";
  const sig = lastSignalFor(s, venue);
  let sigLine = "暂无推送";
  if (sig) {
    const title = pick(sig, "action", "title") || KIND_LABEL[sig.kind] || "信号";
    const when = fmtShanghai(sig.ts);
    const liveBit = sig.live ? "LIVE" : "SAMPLE";
    sigLine = `${title}${when ? ` · ${when}（上海）` : ""} · ${liveBit}`;
  }
  const bits = [];
  const pnl = stratNetPnl(s);
  if (pnl != null) bits.push(`净利 ${num(pnl, 0)}`);
  if (s.ret_pct != null) bits.push(`收益 ${num(s.ret_pct, 2, "%")}`);
  if (s.ann_pct != null) bits.push(`年化 ${num(s.ann_pct, 2, "%")}`);
  if (s.maxdd_pct != null) bits.push(`回撤 ${num(s.maxdd_pct, 2, "%")}`);
  if (s.trades != null) bits.push(`${s.trades} 笔`);
  if (s.winrate != null) bits.push(`胜率 ${num(s.winrate, 1, "%")}`);
  if (s.payoff != null) bits.push(`盈亏比 ${num(s.payoff, 2)}`);
  if (s.pf != null) bits.push(`PF ${num(s.pf, 2)}`);
  const notes = (s.notes || []).slice(0, 3).map((n) => `<li>${esc(n)}</li>`).join("");
  return `<article class="strat-card status-${esc(status)} is-detail">
    <div class="strat-top">
      <span class="pill ${esc(status === "live" ? "live" : status === "sample" ? "sample" : status)}">${esc(label)}</span>
      <span class="tag venue">${esc([venueName, inst].filter(Boolean).join(" · "))}</span>
    </div>
    <h2>${esc(s.name)}${script ? ` · ${esc(script)}` : ""}</h2>
    ${rule ? `<p class="strat-rule">${esc(rule)}</p>` : ""}
    ${s.params && s.params !== rule ? `<p class="strat-extra"><span class="kicker">参数</span> ${esc(s.params)}</p>` : ""}
    <p class="strat-signal"><span class="kicker">最近信号</span> ${esc(sigLine)}</p>
    ${bits.length ? `<p class="strat-metrics">${esc(bits.join(" · "))}</p>` : ""}
    ${bySignalTable(s.by_signal)}
    ${reasonsLine(s.reasons)}
    ${monthlyMini(s.monthly)}
    ${notes ? `<ul class="bt-notes">${notes}</ul>` : ""}
  </article>`;
}

function renderStrats() {
  const host = $("#strat-venues");
  const stamp = $("#strat-stamp");
  if (!host) return;
  if (state.strategiesError) {
    if (stamp) stamp.textContent = "";
    host.innerHTML = `<p class="feed-msg is-error">${esc(state.strategiesError)}</p>`;
    return;
  }
  const data = state.strategies;
  if (!data) {
    if (stamp) stamp.textContent = "";
    host.innerHTML = `<p class="feed-msg">暂无策略。脚本写入 data/strategies.json 后刷新即可。</p>`;
    return;
  }
  const venues = (data.venues || [{ id: "okx", title: "OKX", symbols: data.symbols || [] }])
    .map((v) => ({
      ...v,
      symbols: data.solo
        ? v.symbols || []
        : (v.symbols || []).filter((s) => isHighProfitStrat(s, data)),
    }))
    .filter((v) => (v.symbols || []).length);
  const count = venues.reduce((n, v) => n + (v.symbols || []).length, 0);
  if (stamp) {
    const bits = [];
    if (data.filter_note) bits.push(data.filter_note);
    else if (data.sample) bits.push("示例回测，脚本可覆盖");
    if (data.updated_at) bits.push(`数据 ${fmtShanghai(data.updated_at) || data.updated_at}`);
    bits.push(`${count} 份报告`);
    stamp.textContent = bits.join(" · ");
  }
  if (!count) {
    host.innerHTML = `<p class="feed-msg">暂无达到净利门槛的回测报告。</p>`;
    return;
  }
  host.innerHTML = venues
    .map((v) => {
      const cards = (v.symbols || []).map((s) => renderSymbol(s, v)).join("");
      if (!cards) return "";
      return `<section class="venue">
        <h2>${esc(v.title || v.id || "策略")}</h2>
        ${v.lede ? `<p class="lede">${esc(v.lede)}</p>` : ""}
        <div class="strat-grid ${data.solo ? "solo" : ""}">${cards}</div>
      </section>`;
    })
    .join("");
}

function runnerId(r) {
  return String(r?.id || r?.name || r?.script || "");
}

function runnerMessage(r) {
  return pick(r, "last_message", "last_line");
}

function runnerStatus(r) {
  const status = String(r?.status || "idle").toLowerCase();
  const label = pick(r, "status_label") || RUNNER_STATUS_LABEL[status] || status;
  return { status, label };
}

function sortedRunners() {
  const rank = { running: 0, waiting: 1, error: 2, idle: 3, stopped: 4 };
  return [...state.runners].sort((a, b) => {
    const d = (rank[String(a.status || "")] ?? 9) - (rank[String(b.status || "")] ?? 9);
    if (d) return d;
    return (Date.parse(b.updated_at || "") || 0) - (Date.parse(a.updated_at || "") || 0);
  });
}

function runnerCounts() {
  const counts = { running: 0, waiting: 0, idle: 0, error: 0, stopped: 0 };
  state.runners.forEach((r) => {
    const s = String(r.status || "").toLowerCase();
    if (s in counts) counts[s] += 1;
  });
  return counts;
}

function runnerStripStatus() {
  if (state.runnersError && !state.runners.length) return "failed";
  const c = runnerCounts();
  if (c.error) return "error";
  if (c.running) return "running";
  if (c.waiting) return "waiting";
  if (c.idle) return "idle";
  if (c.stopped) return "stopped";
  return "unknown";
}

function renderRunnerStrip() {
  const hosts = $$(".js-runner-strip");
  if (!hosts.length) return;
  let html;
  let status = runnerStripStatus();
  if (state.runnersError && !state.runners.length) {
    html = `<span class="pl-kicker">脚本</span><span class="pl-error">${esc(state.runnersError)}</span>`;
  } else if (!state.runners.length) {
    html = `<span class="pl-kicker">脚本</span><span class="pl-line">暂无进程心跳。脚本调用 write_runner.heartbeat() 后会出现在实盘页。</span>`;
  } else {
    const c = runnerCounts();
    const bits = [];
    if (c.running) bits.push(`${c.running} 运行`);
    if (c.waiting) bits.push(`${c.waiting} 等待`);
    if (c.error) bits.push(`${c.error} 异常`);
    if (c.idle) bits.push(`${c.idle} 空闲`);
    if (c.stopped) bits.push(`${c.stopped} 已停`);
    const latest = sortedRunners()[0];
    const line = runnerMessage(latest);
    const sample = state.runnersMeta?.sample || state.runners.every((r) => r.sample);
    html = [
      `<span class="pl-kicker">脚本</span>`,
      `<span class="pl-status">${esc(bits.join(" · ") || `${state.runners.length} 个`)}</span>`,
      line ? `<span class="pl-summary">${esc(latest.name || latest.id)} · ${esc(line)}</span>` : "",
      sample ? `<span class="pl-note">示例心跳</span>` : "",
      `<span class="pl-note">点此看实盘页</span>`,
    ].join("");
  }
  hosts.forEach((host) => {
    host.dataset.status = status;
    host.innerHTML = html;
  });
}

function runnerCard(r) {
  const id = runnerId(r);
  const { status, label } = runnerStatus(r);
  const open = id && state.selectedRunnerId === id;
  const live = !r.sample;
  const pair = [r.venue, r.symbol].filter(Boolean).join(" · ");
  const line = runnerMessage(r);
  const when = fmtShanghai(r.updated_at);
  const started = fmtShanghai(r.started_at);
  const more = [];
  if (r.script) more.push(detailField("脚本", r.script));
  if (started) more.push(detailField("启动", `${started}（上海）`));
  if (r.notes) more.push(detailField("备注", r.notes));
  if (r.detail_url) {
    more.push(
      detailField(
        "链接",
        `<a class="opp-link" href="${esc(r.detail_url)}" target="_blank" rel="noopener noreferrer">${esc(r.detail_url)}</a>`,
        true
      )
    );
  }
  more.push(detailField("id", r.id));
  return `<article class="runner-card status-${esc(status)}${open ? " is-open" : ""}${live ? "" : " is-sample"}" data-id="${esc(id)}" tabindex="0" role="button" aria-expanded="${open ? "true" : "false"}">
    <div class="runner-top">
      <div class="card-meta">
        <span class="pill ${esc(status)}">${esc(label)}</span>
        ${pair ? `<span class="tag venue">${esc(pair)}</span>` : ""}
        <span class="pill ${live ? "live" : "sample"}">${live ? "LIVE" : "示例"}</span>
      </div>
      <time datetime="${esc(r.updated_at || "")}">${esc(when || "—")}（上海）</time>
    </div>
    <h2>${esc(r.name || r.script || id)}</h2>
    ${r.script && r.script !== r.name ? `<p class="runner-script">${esc(r.script)}</p>` : ""}
    ${line ? `<p class="runner-line">${esc(line)}</p>` : `<p class="runner-line is-empty">暂无最新一行</p>`}
    ${open && more.length ? `<dl class="detail-dl runner-more">${more.join("")}</dl>` : ""}
  </article>`;
}

function renderRunners() {
  renderRunnerStrip();
  renderHomeProof();
  const host = $("#runner-list");
  const stamp = $("#runner-stamp");
  if (!host) return;
  const total = state.runners.length;
  if (stamp) {
    const bits = [];
    if (state.runnersMeta?.sample || (total && state.runners.every((r) => r.sample))) {
      bits.push("示例心跳，脚本可覆盖");
    }
    if (state.runnersMeta?.updated_at) {
      bits.push(`数据 ${fmtShanghai(state.runnersMeta.updated_at) || state.runnersMeta.updated_at}（上海）`);
    }
    bits.push("点一张看备注");
    stamp.textContent = bits.join(" · ");
  }
  if (state.runnersError && !total) {
    host.innerHTML = `<p class="feed-msg is-error">${esc(state.runnersError)}</p>`;
    return;
  }
  if (!total) {
    host.innerHTML = `<p class="feed-msg">暂无脚本心跳。在循环里调用 publisher/write_runner.heartbeat() 后刷新即可。</p>`;
    return;
  }
  if (state.selectedRunnerId && !state.runners.some((r) => runnerId(r) === state.selectedRunnerId)) {
    state.selectedRunnerId = null;
  }
  host.innerHTML = sortedRunners().map(runnerCard).join("");
}

function toggleRunner(id) {
  if (!id) return;
  state.selectedRunnerId = state.selectedRunnerId === id ? null : id;
  renderRunners();
  const card = document.querySelector(`#runner-list .runner-card[data-id="${CSS.escape(id)}"]`);
  card?.focus();
}

function renderQuotes() {
  const host = $("#quotes-groups");
  const stamp = $("#quotes-stamp");
  const data = state.quotes;
  if (!host || !data) return;

  const show = state.region === "global";
  const block = $("#quotes-block");
  if (block) block.classList.toggle("is-hidden", !show);
  if (!show) return;

  if (stamp && data.updated_at) {
    stamp.textContent = `更新 ${fmtTime(data.updated_at)}`;
  }

  const groups = data.groups || [];
  host.innerHTML = groups
    .map((g) => {
      const rows = (g.items || [])
        .map((item) => {
          const price = item.price != null ? Number(item.price).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";
          const chg = item.chg_pct != null ? item.chg_pct : null;
          const chgStr = chg != null ? `${chg >= 0 ? "+" : ""}${Number(chg).toFixed(2)}%` : "—";
          const cls = chg == null ? "" : chg >= 0 ? "up" : "down";
          return `<tr>
            <td class="q-name">${esc(item.name)}</td>
            <td class="q-price">${price}</td>
            <td class="q-chg ${cls}">${chgStr}</td>
            <td class="q-ccy">${esc(item.currency || "")}</td>
          </tr>`;
        })
        .join("");
      return `<div class="q-group">
        <h3 class="q-group-title">${esc(g.label)}</h3>
        <table class="q-table">
          <thead><tr><th>品种</th><th>最新价</th><th>涨跌幅</th><th>单位</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    })
    .join("");
}

async function refreshQuotes() {
  try {
    const bucket = Math.floor(Date.now() / 120000);
    const data = await loadJson(`./data/quotes.json?t=${bucket}`);
    state.quotes = data;
    renderQuotes();
  } catch (err) {
    console.warn("[quotes]", err);
  }
}

async function refreshLastRun() {
  try {
    const bucket = Math.floor(Date.now() / 120000);
    state.lastRun = await loadJson(`./data/last_run.json?t=${bucket}`);
    state.lastRunError = null;
    renderLastRun();
  } catch (err) {
    console.warn("[last_run]", err);
    state.lastRunError = `心跳读取失败：${err.message}`;
    renderLastRun();
  }
}

async function refreshRunners() {
  try {
    const bucket = Math.floor(Date.now() / 60000);
    const data = await loadJson(`./data/runners.json?t=${bucket}`);
    const rows = data.runners || data.items || [];
    state.runners = Array.isArray(rows) ? rows : [];
    state.runnersMeta = data;
    state.runnersError = null;
    renderRunners();
  } catch (err) {
    console.warn("[runners]", err);
    if (!state.runners.length) {
      state.runnersError = `脚本状态加载失败：${err.message}`;
      renderRunners();
    }
  }
}

async function refreshTips() {
  try {
    const url = state.meta?.tips_url || "./data/tips.json";
    const bucket = Math.floor(Date.now() / (state.meta?.poll_ms || 30000));
    const join = url.includes("?") ? "&" : "?";
    const data = await loadJson(`${url}${join}t=${bucket}`);
    applyTips(data, "买卖点加载失败：无法读取 data/tips.json");
    renderTips();
    renderTicker();
  } catch (err) {
    console.warn("[tips]", err);
    if (!state.tips.length) {
      state.tipsError = `买卖点加载失败：${err.message}`;
      renderTips();
      renderTicker();
    }
  }
}

async function refreshPools() {
  try {
    const url = state.meta?.pools_url || "./data/pools.json";
    const bucket = Math.floor(Date.now() / 120000);
    const join = url.includes("?") ? "&" : "?";
    const data = await loadJson(`${url}${join}t=${bucket}`);
    applyPools(data, "选股池加载失败：无法读取 data/pools.json");
    renderPool();
  } catch (err) {
    console.warn("[pools]", err);
    if (!state.pools.length) {
      state.poolsError = `选股池加载失败：${err.message}`;
      renderPool();
    }
  }
}

async function refreshCharts() {
  try {
    const url = state.meta?.charts_url || "./data/charts.json";
    const bucket = Math.floor(Date.now() / 120000);
    const join = url.includes("?") ? "&" : "?";
    const data = await loadJson(`${url}${join}t=${bucket}`);
    applyCharts(data, "K 线上下文加载失败：无法读取 data/charts.json");
    renderCharts();
  } catch (err) {
    console.warn("[charts]", err);
    if (!(state.charts.top3 || []).length && !(state.charts.crypto || []).length) {
      state.chartsError = `K 线上下文加载失败：${err.message}`;
      renderCharts();
    }
  }
}

async function refreshAlerts() {
  try {
    const url = state.meta?.alerts_url || "./data/alerts.json";
    const bucket = Math.floor(Date.now() / (state.meta?.poll_ms || 30000));
    const join = url.includes("?") ? "&" : "?";
    const data = await loadJson(`${url}${join}t=${bucket}`);
    state.alerts = data.items || [];
    state.alertsMeta = data;
    state.alertsError = null;
    renderAlerts();
    renderTicker();
    renderStrats();
  } catch (err) {
    console.warn("[alerts]", err);
    if (!state.alerts.length) {
      state.alertsError = `预警加载失败：${err.message}`;
      renderAlerts();
      renderTicker();
    }
  }
}

function layoutChrome() {
  const tick = $("#ticker");
  const mast = $(".mast");
  const bottom = tick?.getBoundingClientRect().bottom || mast?.getBoundingClientRect().bottom || 0;
  document.documentElement.style.setProperty("--chrome-h", `${Math.round(bottom)}px`);
}

function markedPlaceholder(value, flag) {
  if (flag) return true;
  const s = String(value || "").trim();
  return !s || s.includes("待填写");
}

function channelCard(label, value, href, placeholder) {
  const empty = markedPlaceholder(value, placeholder);
  const text = empty ? "待填写" : String(value).trim();
  const body =
    href && !empty
      ? `<a class="contact-value" href="${esc(href)}">${esc(text)}</a>`
      : `<p class="contact-value">${empty ? `<span class="placeholder-flag">待填写</span>` : esc(text)}</p>`;
  return `<article class="channel-card"><h3>${esc(label)}</h3>${body}</article>`;
}

function contactMailto() {
  const c = state.contact || {};
  const to = c.form?.mailto || c.email || "";
  return markedPlaceholder(to) ? "" : to;
}

function renderHomeProof() {
  const host = $("#home-proof");
  if (!host) return;
  const selected = state.pools.find((p) => p.id === state.poolsMeta?.selected_id) || state.pools[0];
  const poolN = (selected?.members || []).length;
  const running = state.runners.filter((r) => String(r.status || "").toLowerCase() === "running").length;
  host.innerHTML = [
    `<li><a href="#tips">演示 · ${state.tips.length} 条信号</a></li>`,
    `<li><a href="#pool">演示 · 选股池 ${poolN} 只</a></li>`,
    `<li><a href="#live">高净利回测可阅</a></li>`,
    `<li><a href="#runners">${running} 路策略运行中</a></li>`,
  ].join("");
}

function renderContact() {
  const c = state.contact || {};
  const wechat = c.wechat || {};
  const pay = c.binance || {};
  const telPh = markedPlaceholder(c.tel, c.tel_placeholder);
  const emailPh = markedPlaceholder(c.email, c.email_placeholder);
  const wechatPh = markedPlaceholder(wechat.id, wechat.placeholder);
  if (c.lede) {
    const leadLede = $("#lead-lede");
    const contactLede = $("#contact-lede");
    if (leadLede) leadLede.textContent = c.lede;
    if (contactLede) contactLede.textContent = c.lede;
  }
  const home = $("#home-channels");
  if (home) {
    home.innerHTML = [
      channelCard("邮件", c.email || "待填写", emailPh ? "" : `mailto:${c.email}`, emailPh),
      channelCard("电话", c.tel || "待填写", telPh ? "" : c.tel_href || "", telPh),
      channelCard("微信", wechat.id || "待填写", "", wechatPh),
    ].join("");
  }
  const grid = $("#contact-grid");
  if (grid) {
    const telHref = telPh ? "" : esc(c.tel_href || "");
    const telBody = telPh
      ? `<p class="contact-value">${esc(c.tel || "待填写")}<span class="placeholder-flag">待填写</span></p>`
      : `<a class="contact-value" href="${telHref}">${esc(c.tel)}</a>`;
    const emailBody = emailPh
      ? `<p class="contact-value">${esc(c.email || "待填写")}<span class="placeholder-flag">待填写</span></p>`
      : `<a class="contact-value" href="mailto:${esc(c.email)}">${esc(c.email)}</a>`;
    const wechatHint = esc(wechat.hint || "扫二维码添加好友");
    const wechatImg = wechat.qr
      ? `<img class="wechat-qr" src="${esc(wechat.qr)}" alt="微信二维码" width="240" height="320">`
      : "";
    const payHint = `${esc(pay.hint || "")}${pay.id && !markedPlaceholder(pay.id, pay.placeholder) ? ` · ${esc(pay.id)}` : ""}`;
    const payImg = pay.qr
      ? `<img class="pay-qr" src="${esc(pay.qr)}" alt="${esc(pay.label || "币安收款码")}" width="280" height="420">`
      : `<p class="contact-value">待填写<span class="placeholder-flag">待填写</span></p>`;
    grid.innerHTML = `
      <article class="contact-card"><h2>TEL</h2>${telBody}</article>
      <article class="contact-card"><h2>GMAIL</h2>${emailBody}</article>
      <article class="contact-card contact-wechat">
        <h2>WECHAT</h2>
        <p class="hint">${wechatHint}${wechatPh ? ` <span class="placeholder-flag">待填写</span>` : ""}</p>
        ${wechatImg}
      </article>
      <article class="contact-card contact-pay">
        <h2>${esc(pay.label || "BINANCE")}</h2>
        <p class="hint">${payHint}</p>
        ${payImg}
      </article>`;
  }
  const to = contactMailto();
  $$(".js-lead-form button[type=submit]").forEach((btn) => {
    btn.disabled = !to;
  });
}

function wireLeadForms() {
  $$(".js-lead-form").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const to = contactMailto();
      if (!to) return;
      const fd = new FormData(form);
      const body = [
        `姓名：${fd.get("name") || ""}`,
        `机构：${fd.get("org") || ""}`,
        `联系方式：${fd.get("reach") || ""}`,
        `兴趣：${fd.get("interest") || ""}`,
        `备注：${fd.get("note") || ""}`,
      ].join("\n");
      const subject = state.contact?.form?.subject || "【五饼二鱼】预约定制方案";
      window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  });
}

async function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  layoutChrome();
  window.addEventListener("resize", layoutChrome);

  const [meta, opps, alerts, strats, diagrams, market, kzz, quotes, lastRun, runners, tips, pools, charts, contact] = await Promise.all([
    loadJson("./data/meta.json"),
    loadOptional("./data/opportunities.json"),
    loadOptional("./data/alerts.json"),
    loadOptional("./data/strategies.json"),
    loadOptional("./data/backtest-diagrams.json"),
    loadJson("./data/market-links.json"),
    loadJson("./data/kzz.json"),
    loadJson("./data/quotes.json").catch(() => null),
    loadOptional("./data/last_run.json"),
    loadOptional("./data/runners.json"),
    loadOptional("./data/tips.json"),
    loadOptional("./data/pools.json"),
    loadOptional("./data/charts.json"),
    loadOptional("./data/contact.json"),
  ]);
  state.meta = meta;
  state.lastRun = lastRun;
  if (!lastRun) state.lastRunError = "未读到 data/last_run.json";
  if (opps && Array.isArray(opps.items)) {
    state.opportunities = opps.items;
    state.opportunitiesMeta = opps;
    state.opportunitiesError = null;
  } else {
    state.opportunities = [];
    state.opportunitiesMeta = opps;
    state.opportunitiesError = "机会表加载失败：无法读取 data/opportunities.json";
  }
  state.market = market;
  state.kzz = kzz;
  state.quotes = quotes;
  if (alerts && Array.isArray(alerts.items)) {
    state.alerts = alerts.items;
    state.alertsMeta = alerts;
    state.alertsError = null;
  } else {
    state.alerts = [];
    state.alertsMeta = alerts;
    state.alertsError = "预警加载失败：无法读取 data/alerts.json";
  }
  if (strats && (Array.isArray(strats.venues) || Array.isArray(strats.symbols))) {
    state.strategies = strats;
    state.strategiesError = null;
  } else {
    state.strategies = null;
    state.strategiesError = "策略加载失败：无法读取 data/strategies.json";
  }
  if (diagrams && Array.isArray(diagrams.items)) {
    state.diagrams = diagrams;
    state.diagramsError = null;
  } else {
    state.diagrams = null;
    state.diagramsError = diagrams ? null : "图示加载失败：无法读取 data/backtest-diagrams.json";
  }
  if (runners && (Array.isArray(runners.runners) || Array.isArray(runners.items))) {
    state.runners = runners.runners || runners.items || [];
    state.runnersMeta = runners;
    state.runnersError = null;
  } else {
    state.runners = [];
    state.runnersMeta = runners;
    state.runnersError = "脚本状态加载失败：无法读取 data/runners.json";
  }
  applyTips(tips, "买卖点加载失败：无法读取 data/tips.json");
  applyPools(pools, "选股池加载失败：无法读取 data/pools.json");
  applyCharts(charts, "K 线上下文加载失败：无法读取 data/charts.json");
  state.contact = contact || {};
  $("#disclaimer").textContent = meta.disclaimer;
  $("#cap").textContent = "专业投资者定制台 · 静态 CDN";

  renderLastRun();
  renderDesk();
  renderOpps();
  renderQuotes();
  renderKzz();
  renderAlerts();
  renderTicker();
  renderDiagrams();
  renderStrats();
  renderRunners();
  renderContact();
  renderHomeProof();
  applyLocation();
  layoutChrome();

  window.addEventListener("hashchange", applyLocation);
  $$(".js-runner-strip").forEach((btn) => {
    btn.addEventListener("click", () => {
      location.hash = "runners";
    });
  });
  $$("#filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.region = btn.dataset.region;
      $$("#filters .chip").forEach((c) => c.classList.toggle("is-on", c === btn));
      renderOpps();
    });
  });
  $$("#status-filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.statusFilter = btn.dataset.status;
      $$("#status-filters .chip").forEach((c) => c.classList.toggle("is-on", c === btn));
      renderOpps();
    });
  });
  $("#view-opps")?.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr.opp-row");
    if (!tr) return;
    openDetail(tr.dataset.id);
  });
  $("#view-opps")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tr = e.target.closest("tr.opp-row");
    if (!tr || e.target !== tr) return;
    e.preventDefault();
    openDetail(tr.dataset.id);
  });
  $("#opp-scrim")?.addEventListener("click", () => closeDetail({ restoreFocus: false }));
  $("#opp-detail")?.addEventListener("click", (e) => {
    if (e.target.closest("#opp-detail-close")) closeDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.selectedId) closeDetail();
    else if (state.selectedRunnerId) toggleRunner(state.selectedRunnerId);
  });
  $("#runner-list")?.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const card = e.target.closest(".runner-card");
    if (!card) return;
    toggleRunner(card.dataset.id);
  });
  $("#runner-list")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".runner-card");
    if (!card || e.target !== card) return;
    e.preventDefault();
    toggleRunner(card.dataset.id);
  });
  $$("#alert-filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.channel = btn.dataset.channel;
      $$("#alert-filters .chip").forEach((c) => c.classList.toggle("is-on", c === btn));
      renderAlerts();
    });
  });
  $$("#alert-source-filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.alertSource = btn.dataset.source;
      $$("#alert-source-filters .chip").forEach((c) => c.classList.toggle("is-on", c === btn));
      renderAlerts();
    });
  });
  $$("#tip-side-filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tipSide = btn.dataset.side;
      $$("#tip-side-filters .chip").forEach((c) => c.classList.toggle("is-on", c === btn));
      renderTips();
    });
  });
  $$("#tip-venue-filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tipVenue = btn.dataset.venue;
      $$("#tip-venue-filters .chip").forEach((c) => c.classList.toggle("is-on", c === btn));
      renderTips();
    });
  });
  $("#view-desk")?.addEventListener("click", (e) => {
    const tfBtn = e.target.closest("[data-tf]");
    if (tfBtn) {
      const card = tfBtn.closest("[data-chart-id]");
      const id = card?.dataset.chartId;
      const tf = tfBtn.dataset.tf;
      if (id && tf) {
        state.chartTf[id] = tf;
        card.querySelectorAll("[data-tf]").forEach((c) => c.classList.toggle("is-on", c === tfBtn));
        chartInstances.get(id)?.setInterval(tf);
      }
      return;
    }
    const tip = e.target.closest(".tip-card[data-symbol]");
    if (tip) focusChartForSymbol(tip.dataset.symbol);
  });
  $("#view-desk")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const tip = e.target.closest(".tip-card[data-symbol]");
    if (!tip || e.target !== tip) return;
    e.preventDefault();
    focusChartForSymbol(tip.dataset.symbol);
  });

  wireLeadForms();

  setInterval(refreshAlerts, meta.poll_ms || 30000);
  setInterval(refreshTips, meta.poll_ms || 30000);
  setInterval(refreshPools, 120000);
  setInterval(refreshCharts, 120000);
  setInterval(refreshQuotes, 120000);
  setInterval(refreshLastRun, 120000);
  setInterval(refreshRunners, 60000);
}

boot().catch((err) => {
  $("#ticker").textContent = `数据加载失败：${err.message}`;
});
