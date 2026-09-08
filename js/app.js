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
  region: "all",
  channel: "all",
  opportunities: [],
  notes: [],
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

function tickClock() {
  const el = $("#clock");
  if (!el) return;
  el.textContent = new Date().toLocaleString("zh-CN", { hour12: false });
}

function setView(name) {
  $$(".view").forEach((v) => v.classList.toggle("is-on", v.id === `view-${name}`));
  $$(".tab").forEach((t) => t.classList.toggle("is-on", t.dataset.view === name));
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

function renderOpps() {
  const rows = state.opportunities.filter(
    (o) => state.region === "all" || o.region === state.region
  );
  $("#opp-body").innerHTML = rows
    .map(
      (o) => `<tr>
        <td class="prio">${esc(o.priority)}</td>
        <td><span class="name">${esc(o.name)}</span><span class="sub">${esc(o.region_label)} · ${esc(o.klass_label)}</span></td>
        <td>${esc(o.thesis)}</td>
        <td>${esc(o.expected)}</td>
        <td>${esc(o.drawdown)}</td>
        <td>${esc(o.cost)}</td>
        <td><span class="pill ${esc(o.status)}">${esc(o.status_label)}</span></td>
      </tr>`
    )
    .join("");
}

function renderNotes() {
  const box = $("#notes");
  if (!box) return;
  box.innerHTML = state.notes
    .map(
      (n) => `<article class="note"><h2>${esc(n.title)}</h2><p>${esc(n.body)}</p></article>`
    )
    .join("");
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

async function boot() {
  tickClock();
  setInterval(tickClock, 1000);

  const [meta, opps, alerts, strats] = await Promise.all([
    loadJson("./data/meta.json"),
    loadJson("./data/opportunities.json"),
    loadJson("./data/alerts.json"),
    loadJson("./data/strategies.json"),
  ]);
  state.meta = meta;
  state.opportunities = opps.items || [];
  state.notes = opps.notes || [];
  state.alerts = alerts.items || [];
  state.strategies = strats;
  $("#disclaimer").textContent = meta.disclaimer;
  $("#cap").textContent = "CDN 静态分发 · 约 10 万并发阅读";

  renderOpps();
  renderNotes();
  renderAlerts();
  renderTicker();
  renderStrats();

  $$(".tab").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.view)));
  $$("#filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.region = btn.dataset.region;
      $$("#filters .chip").forEach((c) => c.classList.toggle("is-on", c === btn));
      renderOpps();
    });
  });
  $$("#alert-filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.channel = btn.dataset.channel;
      $$("#alert-filters .chip").forEach((c) => c.classList.toggle("is-on", c === btn));
      renderAlerts();
    });
  });

  setInterval(refreshAlerts, meta.poll_ms || 30000);
}

boot().catch((err) => {
  $("#ticker").textContent = `数据加载失败：${err.message}`;
});
