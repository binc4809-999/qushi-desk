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
  const ordered = sortedAlerts();
  const live = ordered.filter((a) => a.live).slice(0, 3);
  const row = (live.length ? live : ordered.slice(0, 3))
    .map((a) => `${esc(a.symbol)} · ${esc(pick(a, "action", "title"))}`)
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

function renderSymbol(s, venue) {
  const { status, label } = stratStatus(s);
  const venueName = s.exchange || venue.title || venue.id || "";
  const inst = s.instId || s.symbol || "";
  const rule = pick(s, "rule", "params");
  const sig = lastSignalFor(s, venue);
  let sigLine = "暂无推送";
  if (sig) {
    const title = pick(sig, "action", "title") || KIND_LABEL[sig.kind] || "信号";
    const when = fmtShanghai(sig.ts);
    const liveBit = sig.live ? "LIVE" : "SAMPLE";
    sigLine = `${title}${when ? ` · ${when}（上海）` : ""} · ${liveBit}`;
  }
  const bits = [];
  if (s.ret_pct != null) bits.push(`收益 ${num(s.ret_pct, 2, "%")}`);
  if (s.maxdd_pct != null) bits.push(`回撤 ${num(s.maxdd_pct, 2, "%")}`);
  if (s.trades != null) bits.push(`${s.trades} 笔`);
  return `<article class="strat-card status-${esc(status)}">
    <div class="strat-top">
      <span class="pill ${esc(status === "live" ? "live" : status === "sample" ? "sample" : status)}">${esc(label)}</span>
      <span class="tag venue">${esc([venueName, inst].filter(Boolean).join(" · "))}</span>
    </div>
    <h2>${esc(s.name)}</h2>
    ${rule ? `<p class="strat-rule">${esc(rule)}</p>` : ""}
    <p class="strat-signal"><span class="kicker">最近信号</span> ${esc(sigLine)}</p>
    ${bits.length ? `<p class="strat-metrics">${esc(bits.join(" · "))}</p>` : ""}
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
  const venues = data.venues || [{ id: "okx", title: "OKX", symbols: data.symbols || [] }];
  const count = venues.reduce((n, v) => n + (v.symbols || []).length, 0);
  if (stamp) {
    const bits = [];
    if (data.sample) bits.push("示例数据，脚本可覆盖");
    if (data.updated_at) bits.push(`数据 ${fmtShanghai(data.updated_at) || data.updated_at}`);
    bits.push("名称 / 交易所 / 状态 / 最近信号 / 规则");
    stamp.textContent = bits.join(" · ");
  }
  if (!count) {
    host.innerHTML = `<p class="feed-msg">暂无策略卡片。</p>`;
    return;
  }
  host.innerHTML = venues
    .map((v) => {
      const cards = (v.symbols || []).map((s) => renderSymbol(s, v)).join("");
      if (!cards) return "";
      return `<section class="venue">
        <h2>${esc(v.title || v.id || "策略")}</h2>
        <div class="strat-grid">${cards}</div>
      </section>`;
    })
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

async function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  layoutChrome();
  window.addEventListener("resize", layoutChrome);

  const [meta, opps, alerts, strats, market, kzz, quotes, lastRun] = await Promise.all([
    loadJson("./data/meta.json"),
    loadOptional("./data/opportunities.json"),
    loadOptional("./data/alerts.json"),
    loadOptional("./data/strategies.json"),
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
  $$("#alert-source-filters .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.alertSource = btn.dataset.source;
      $$("#alert-source-filters .chip").forEach((c) => c.classList.toggle("is-on", c === btn));
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
