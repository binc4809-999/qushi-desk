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
  opportunities: [],
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
  const d = new Date();
  el.textContent = d.toLocaleString("zh-CN", { hour12: false });
}

function setView(name) {
  $$(".view").forEach((v) => v.classList.toggle("is-on", v.id === `view-${name}`));
  $$(".tab").forEach((t) => t.classList.toggle("is-on", t.dataset.view === name));
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

function renderAlerts() {
  const stamp = state.alerts[0] ? fmtTime(state.alerts[0].ts || state.meta?.updated_at) : "";
  $("#alert-stamp").textContent = stamp ? `最近更新 ${stamp}` : "";
  $("#alert-feed").innerHTML = state.alerts
    .map(
      (a) => `<li class="card sev-${esc(a.severity || "info")}">
        <div class="card-top">
          <span class="tag">${a.live ? "LIVE" : "SAMPLE"} · ${esc(a.kind)} · ${esc(a.symbol)}</span>
          <time datetime="${esc(a.ts)}">${esc(fmtTime(a.ts))}</time>
        </div>
        <h2>${esc(a.title)}</h2>
        <p>${esc(a.body)}</p>
      </li>`
    )
    .join("");
}

function pctClass(n) {
  return n >= 0 ? "up" : "down";
}

function renderStrats() {
  const data = state.strategies;
  if (!data) return;
  $("#strat-lede").textContent = `${data.range} · ${data.fee}。${data.notes[0]}`;
  $("#strat-row").innerHTML = data.symbols
    .map((s) => {
      const sig = s.by_signal
        .map(
          (x) => `<tr><td>${esc(x.signal)}</td><td>${x.n}</td><td class="${pctClass(x.pnl)}">${x.pnl.toFixed(2)}</td><td>${x.winrate.toFixed(1)}%</td></tr>`
        )
        .join("");
      return `<article class="panel">
        <h2>${esc(s.name)}</h2>
        <p class="sub">${esc(s.instId)} · ${esc(s.params)}</p>
        <dl class="stats">
          <div class="stat"><dt>三年收益</dt><dd class="${pctClass(s.ret_pct)}">${s.ret_pct.toFixed(2)}%</dd></div>
          <div class="stat"><dt>年化</dt><dd>${s.ann_pct.toFixed(2)}%</dd></div>
          <div class="stat"><dt>最大回撤</dt><dd class="down">${s.maxdd_pct.toFixed(2)}%</dd></div>
          <div class="stat"><dt>盈亏比 / PF</dt><dd>${s.payoff.toFixed(2)} / ${s.pf.toFixed(2)}</dd></div>
        </dl>
        <table class="sig-table">
          <thead><tr><th>信号</th><th>笔数</th><th>净利</th><th>胜率</th></tr></thead>
          <tbody>${sig}</tbody>
        </table>
        <p class="sub">交易 ${s.trades} 笔 · 胜率 ${s.winrate.toFixed(2)}%</p>
      </article>`;
    })
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
  state.alerts = alerts.items || [];
  state.strategies = strats;
  $("#disclaimer").textContent = meta.disclaimer;
  $("#cap").textContent = "CDN 静态分发 · 约 10 万并发阅读";

  renderOpps();
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

  setInterval(refreshAlerts, meta.poll_ms || 30000);
}

boot().catch((err) => {
  $("#ticker").textContent = `数据加载失败：${err.message}`;
});
