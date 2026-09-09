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
  opportunities: [],
  opportunitiesMeta: null,
  opportunitiesError: null,
  lastRun: null,
  lastRunError: null,
  market: { items: [], note: "" },
  kzz: null,
  alerts: [],
  strategies: null,
  meta: null,
};

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

function setView(name) {
  $$(".view").forEach((v) => v.classList.toggle("is-on", v.id === `view-${name}`));
  $$(".tab").forEach((t) => t.classList.toggle("is-on", t.dataset.view === name));
  if (name !== "opps") closeDetail({ restoreFocus: false });
}

function num(v, digits = 2, suffix = "") {
  if (v == null || Number.isNaN(Number(v))) return "—";
  return `${Number(v).toFixed(digits)}${suffix}`;
}

function pctClass(n) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return n >= 0 ? "up" : "down";
}

function renderTicker() {
  const live = state.alerts.filter((a) => a.live).slice(0, 3);
  const row = (live.length ? live : state.alerts.slice(0, 3))
    .map((a) => `${esc(a.symbol)} · ${esc(a.title)}`)
    .join("    ·    ");
  $("#ticker").textContent = row || "暂无预警";
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
  cnBlock.classList.toggle("is-hidden", !showCn);

  if (state.opportunitiesError) {
    const html = msgRow(state.opportunitiesError, true);
    $("#opp-body").innerHTML = html;
    $("#cn-body").innerHTML = html;
  } else {
    const empty = emptyOppMessage(regionCount, rows.length);
    const html = rows.length ? rows.map(rowHtml).join("") : msgRow(empty);
    if (showCn) {
      $("#opp-body").innerHTML = "";
      $("#cn-body").innerHTML = html;
    } else {
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

function renderLastRun() {
  const host = $("#pipeline");
  if (!host) return;
  const run = state.lastRun;
  if (!run) {
    host.dataset.status = "unknown";
    const detail = state.lastRunError || "未读到 data/last_run.json";
    host.innerHTML = `<span class="pl-kicker">管道</span><span class="pl-line">${esc(detail)}</span>`;
    return;
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
  host.dataset.status = status;
  host.innerHTML = [
    `<span class="pl-kicker">管道</span>`,
    `<span class="pl-status">${esc(label)}</span>`,
    timeBit ? `<span class="pl-time">${esc(timeBit)}</span>` : "",
    scripts ? `<span class="pl-scripts">${esc(scripts)}</span>` : "",
    summary ? `<span class="pl-summary">${esc(summary)}</span>` : "",
    err,
    sample,
  ].join("");
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


function renderAlerts() {
  const stamp = state.alerts[0] ? fmtTime(state.alerts[0].ts || state.meta?.updated_at) : "";
  $("#alert-stamp").textContent = stamp ? `最近更新 ${stamp}` : "";
  const rows = state.alerts.filter(
    (a) => state.channel === "all" || (a.channel || "system") === state.channel
  );
  $("#alert-feed").innerHTML = rows
    .map(
      (a) => `<li class="card sev-${esc(a.severity || "info")}">
        <div class="card-top">
          <span class="tag">${a.live ? "LIVE" : "SAMPLE"} · ${esc(a.kind)} · ${esc(a.venue || a.symbol)}</span>
          <time datetime="${esc(a.ts)}">${esc(fmtTime(a.ts))}</time>
        </div>
        <h2>${esc(a.title)}</h2>
        <p>${esc(a.body)}</p>
      </li>`
    )
    .join("");
}

function renderSymbol(s) {
  const rows = (s.by_signal || []).filter((x) => x.n != null);
  const table = rows.length
    ? `<table class="sig-table">
        <thead><tr><th>信号</th><th>笔数</th><th>净利</th><th>胜率</th></tr></thead>
        <tbody>${rows
          .map(
            (x) => `<tr><td>${esc(x.signal)}</td><td>${x.n}</td><td class="${pctClass(x.pnl)}">${num(x.pnl)}</td><td>${num(x.winrate, 1, "%")}</td></tr>`
          )
          .join("")}</tbody>
      </table>`
    : "";
  const trades = s.trades != null ? `交易 ${s.trades} 笔` : "";
  const wr = s.winrate != null ? `胜率 ${Number(s.winrate).toFixed(2)}%` : "";
  const foot = [trades, wr].filter(Boolean).join(" · ");
  return `<article class="panel">
    <h2>${esc(s.name)}</h2>
    <p class="sub">${esc(s.exchange || "")} · ${esc(s.instId)} · ${esc(s.params)}</p>
    <dl class="stats">
      <div class="stat"><dt>收益</dt><dd class="${pctClass(s.ret_pct)}">${num(s.ret_pct, 2, "%")}</dd></div>
      <div class="stat"><dt>年化</dt><dd>${num(s.ann_pct, 2, "%")}</dd></div>
      <div class="stat"><dt>最大回撤</dt><dd class="down">${num(s.maxdd_pct, 2, "%")}</dd></div>
      <div class="stat"><dt>盈亏比 / PF</dt><dd>${num(s.payoff)} / ${num(s.pf)}</dd></div>
    </dl>
    ${table}
    ${foot ? `<p class="sub">${esc(foot)}</p>` : ""}
  </article>`;
}

function renderStrats() {
  const data = state.strategies;
  const host = $("#strat-venues");
  if (!data || !host) return;
  const venues = data.venues || [{ id: "okx", title: "OKX", lede: data.notes?.[0] || "", symbols: data.symbols || [] }];
  if (venues[0]?.lede) $("#strat-lede").textContent = "上方是 OKX 价突破；下方是仍在币安运行的趋势跟踪与 MACD 脚本。";
  host.innerHTML = venues
    .map(
      (v) => `<section class="venue">
        <h2>${esc(v.title)}</h2>
        <p class="lede">${esc(v.lede || "")}</p>
        <div class="strat-row">${(v.symbols || []).map(renderSymbol).join("")}</div>
      </section>`
    )
    .join("");
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

async function refreshAlerts() {
  try {
    const url = state.meta?.alerts_url || "./data/alerts.json";
    const bucket = Math.floor(Date.now() / (state.meta?.poll_ms || 30000));
    const join = url.includes("?") ? "&" : "?";
    const data = await loadJson(`${url}${join}t=${bucket}`);
    state.alerts = data.items || [];
    renderAlerts();
    renderTicker();
  } catch (err) {
    console.warn(err);
  }
}

function layoutChrome() {
  const tick = $("#ticker");
  const mast = $(".mast");
  const bottom = tick?.getBoundingClientRect().bottom || mast?.getBoundingClientRect().bottom || 0;
  document.documentElement.style.setProperty("--chrome-h", `${Math.round(bottom)}px`);
}

async function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  layoutChrome();
  window.addEventListener("resize", layoutChrome);

  const [meta, opps, alerts, strats, market, kzz, quotes, lastRun] = await Promise.all([
    loadJson("./data/meta.json"),
    loadOptional("./data/opportunities.json"),
    loadJson("./data/alerts.json"),
    loadJson("./data/strategies.json"),
    loadJson("./data/market-links.json"),
    loadJson("./data/kzz.json"),
    loadJson("./data/quotes.json").catch(() => null),
    loadOptional("./data/last_run.json"),
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
  state.alerts = alerts.items || [];
  state.strategies = strats;
  $("#disclaimer").textContent = meta.disclaimer;
  $("#cap").textContent = "CDN 静态分发 · 约 10 万并发阅读";

  renderLastRun();
  renderOpps();
  renderQuotes();
  renderKzz();
  renderAlerts();
  renderTicker();
  renderStrats();
  layoutChrome();

  $$(".tab").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
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
    if (e.key === "Escape" && state.selectedId) closeDetail();
  });
  $$("#alert-filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.channel = btn.dataset.channel;
      $$("#alert-filters .chip").forEach((c) => c.classList.toggle("is-on", c === btn));
      renderAlerts();
    });
  });

  setInterval(refreshAlerts, meta.poll_ms || 30000);
  setInterval(refreshQuotes, 120000);
  setInterval(refreshLastRun, 120000);
}

boot().catch((err) => {
  $("#ticker").textContent = `数据加载失败：${err.message}`;
});
