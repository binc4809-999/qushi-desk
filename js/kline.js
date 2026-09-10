/* 示意 K 线：按标的种子生成，可拖动、切换周期、叠加买卖点。无外部依赖。 */
(function (global) {
  const MS = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
  };

  const STOCK_TF = [
    { id: "1d", label: "日线" },
    { id: "1h", label: "60分" },
    { id: "30m", label: "30分" },
    { id: "15m", label: "15分" },
  ];

  const CRYPTO_TF = [
    { id: "30m", label: "30分" },
    { id: "15m", label: "15分" },
    { id: "5m", label: "5分" },
    { id: "1h", label: "60分" },
    { id: "1d", label: "日线" },
  ];

  const BASE_PRICE = {
    "600519": 1482,
    "300750": 248,
    "002594": 106.5,
    "601318": 57.8,
    "000858": 127.4,
    "600036": 39.2,
    "000333": 71.4,
    "002415": 30.6,
    "600276": 46.4,
    "300124": 61.2,
    "601012": 16.5,
    "688981": 86.8,
    "000001": 11.4,
    "000651": 41.2,
    BTCUSDT: 63800,
    ETHUSDT: 3490,
    "BTC-USDT-SWAP": 63800,
    "SOL-USDT-SWAP": 148,
    SOLUSDT: 148,
  };

  function hashSeed(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function rand() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function token(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function colors() {
    return {
      bg: token("--paper", "#161a20"),
      line: token("--line", "#2a313b"),
      ink: token("--ink", "#e6e1d6"),
      muted: token("--muted", "#8b8478"),
      brass: token("--brass", "#c4a36a"),
      up: token("--up", "#3d9a78"),
      down: token("--down", "#c45c4a"),
    };
  }

  function basePrice(symbol) {
    const key = String(symbol || "").replace(/[-_/]/g, "").toUpperCase();
    if (BASE_PRICE[symbol] != null) return BASE_PRICE[symbol];
    if (BASE_PRICE[key] != null) return BASE_PRICE[key];
    const n = hashSeed(symbol) % 8000;
    return 20 + (n / 8000) * 180;
  }

  function isCryptoKind(kind, venue, symbol) {
    const k = String(kind || "").toLowerCase();
    const v = String(venue || "").toLowerCase();
    const s = String(symbol || "").toUpperCase();
    if (k === "crypto") return true;
    if (v.includes("binance") || v.includes("okx") || v.includes("crypto") || v.includes("加密")) return true;
    return /USDT|BTC|ETH|SOL/.test(s) && !/^\d{6}$/.test(String(symbol || ""));
  }

  function shanghaiWeekday(ms) {
    return new Date(ms + 8 * 3600 * 1000).getUTCDay();
  }

  function alignEnd(ms, interval, crypto) {
    const step = MS[interval] || MS["1d"];
    let t = Math.floor(ms / step) * step;
    if (interval === "1d" && !crypto) {
      while (shanghaiWeekday(t) === 0 || shanghaiWeekday(t) === 6) t -= step;
    }
    return t;
  }

  function prevBarTime(t, interval, crypto) {
    const step = MS[interval] || MS["1d"];
    let next = t - step;
    if (interval === "1d" && !crypto) {
      while (shanghaiWeekday(next) === 0 || shanghaiWeekday(next) === 6) next -= step;
    }
    return next;
  }

  function parseTs(value) {
    if (value == null || value === "") return NaN;
    if (typeof value === "number") return value;
    const t = Date.parse(value);
    return Number.isNaN(t) ? NaN : t;
  }

  function seriesEnd(spec, interval) {
    const markerTimes = (spec.markers || []).map((m) => parseTs(m.ts)).filter((t) => !Number.isNaN(t));
    const latestMarker = markerTimes.length ? Math.max(...markerTimes) : 0;
    const now = Date.now();
    const step = MS[interval] || MS["1d"];
    const windowMs = 180 * step;
    if (latestMarker && now - latestMarker > windowMs * 0.65) {
      return latestMarker + step * 2;
    }
    return Math.max(now, latestMarker);
  }

  function makeBars(spec, interval, count = 200) {
    const symbol = spec.symbol || spec.id || "X";
    const crypto = isCryptoKind(spec.kind, spec.venue, symbol);
    const rand = mulberry32(hashSeed(`${symbol}|${interval}|kline`));
    const end = alignEnd(seriesEnd(spec, interval), interval, crypto);
    let price = basePrice(symbol);
    const times = [];
    let t = end;
    for (let i = 0; i < count; i += 1) {
      times.push(t);
      t = prevBarTime(t, interval, crypto);
    }
    times.reverse();

    const volScale = interval === "1d" ? 0.016 : 0.007;
    const bars = times.map((time) => {
      const drift = (rand() - 0.48) * price * volScale;
      const shock = price * (0.002 + rand() * volScale);
      const open = price;
      const close = Math.max(price * 0.2, open + drift);
      const high = Math.max(open, close) + rand() * shock;
      const low = Math.max(0.01, Math.min(open, close) - rand() * shock);
      const volume = 100 + rand() * 900;
      price = close;
      return { time, open, high, low, close, volume };
    });

    const target =
      Number(spec.price) ||
      Number((spec.markers || []).filter((m) => Number(m.price) > 0).slice(-1)[0]?.price) ||
      0;
    pinEndPrice(bars, target);
    applyMarkers(bars, spec.markers || []);
    return bars;
  }

  function pinEndPrice(bars, target) {
    if (!bars.length || !target || !Number.isFinite(target) || target <= 0) return;
    const last = bars[bars.length - 1].close;
    if (!last) return;
    const scale = target / last;
    if (!Number.isFinite(scale) || scale <= 0) return;
    bars.forEach((b) => {
      b.open *= scale;
      b.high *= scale;
      b.low *= scale;
      b.close *= scale;
    });
  }

  function nearestIndex(bars, ts) {
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < bars.length; i += 1) {
      const d = Math.abs(bars[i].time - ts);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  }

  function applyMarkers(bars, markers) {
    if (!bars.length) return bars;
    markers.forEach((m) => {
      const ts = parseTs(m.ts);
      if (Number.isNaN(ts)) return;
      const i = nearestIndex(bars, ts);
      const bar = bars[i];
      const px = Number(m.price);
      const side = m.side || "alert";
      const near =
        Number.isFinite(px) && px > 0 && Math.abs(px - bar.close) / Math.max(bar.close, 1e-9) < 0.04;
      if (near) {
        bar.high = Math.max(bar.high, px);
        bar.low = Math.min(bar.low, px);
      }
      const y = near ? px : side === "buy" ? bar.low : side === "sell" ? bar.high : bar.close;
      bar._marks = bar._marks || [];
      bar._marks.push({
        side,
        label: m.label || "",
        script_id: m.script_id || "",
        price: y,
      });
    });
    return bars;
  }

  function fmtPrice(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1000) return n.toFixed(1);
    if (abs >= 100) return n.toFixed(2);
    if (abs >= 1) return n.toFixed(2);
    return n.toFixed(4);
  }

  function fmtTime(ms, interval) {
    const pad = (x) => String(x).padStart(2, "0");
    const sh = new Date(ms + 8 * 3600 * 1000);
    const y = sh.getUTCFullYear();
    const mo = pad(sh.getUTCMonth() + 1);
    const day = pad(sh.getUTCDate());
    const h = pad(sh.getUTCHours());
    const mi = pad(sh.getUTCMinutes());
    if (interval === "1d") return `${y}-${mo}-${day}`;
    return `${mo}-${day} ${h}:${mi}`;
  }

  function tfList(spec) {
    return isCryptoKind(spec.kind, spec.venue, spec.symbol) ? CRYPTO_TF : STOCK_TF;
  }

  function defaultInterval(spec) {
    if (spec.default_interval && MS[spec.default_interval]) return spec.default_interval;
    return isCryptoKind(spec.kind, spec.venue, spec.symbol) ? "30m" : "1d";
  }

  function Chart(host, spec) {
    this.host = host;
    this.spec = spec;
    this.interval = defaultInterval(spec);
    this.bars = [];
    this.offset = 0;
    this.hover = -1;
    this.drag = null;
    this.ro = null;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "kline-canvas";
    this.canvas.setAttribute("role", "img");
    host.innerHTML = "";
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.reload();
    this.bind();
    this.resize();
  }

  Chart.prototype.reload = function reload() {
    this.bars = makeBars(this.spec, this.interval, 220);
    this.offset = 0;
    this.hover = -1;
  };

  Chart.prototype.setInterval = function setInterval(tf) {
    if (!MS[tf] || tf === this.interval) {
      this.interval = tf;
      this.draw();
      return;
    }
    this.interval = tf;
    this.reload();
    this.draw();
  };

  Chart.prototype.visibleCount = function visibleCount() {
    const w = this.canvas.clientWidth || this.host.clientWidth || 640;
    return Math.max(28, Math.min(90, Math.floor(w / 7)));
  };

  Chart.prototype.slice = function slice() {
    const n = this.visibleCount();
    const maxOff = Math.max(0, this.bars.length - n);
    this.offset = Math.max(0, Math.min(this.offset, maxOff));
    const end = this.bars.length - this.offset;
    const start = Math.max(0, end - n);
    return this.bars.slice(start, end);
  };

  Chart.prototype.bind = function bind() {
    const c = this.canvas;
    this.onDown = (e) => {
      const x = (e.clientX ?? e.touches?.[0]?.clientX) || 0;
      this.drag = { x, offset: this.offset, moved: false };
      c.setPointerCapture?.(e.pointerId);
    };
    this.onMove = (e) => {
      const rect = c.getBoundingClientRect();
      const x = (e.clientX ?? e.touches?.[0]?.clientX) - rect.left;
      const vis = this.slice();
      const pad = this.pad();
      const plotW = Math.max(1, c.clientWidth - pad.l - pad.r);
      const slot = plotW / Math.max(1, vis.length);
      const idx = Math.floor((x - pad.l) / slot);
      this.hover = idx >= 0 && idx < vis.length ? idx : -1;
      if (this.drag) {
        const dx = ((e.clientX ?? e.touches?.[0]?.clientX) || 0) - this.drag.x;
        if (Math.abs(dx) > 3) this.drag.moved = true;
        const bars = Math.round(-dx / slot);
        this.offset = this.drag.offset + bars;
      }
      this.draw();
    };
    this.onUp = () => {
      this.drag = null;
      c.style.cursor = "grab";
    };
    this.onLeave = () => {
      this.hover = -1;
      this.draw();
    };
    c.style.cursor = "grab";
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onUp);
    c.addEventListener("pointerleave", this.onLeave);
    c.addEventListener("lostpointercapture", this.onUp);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);
  };

  Chart.prototype.pad = function pad() {
    return { t: 10, r: 58, b: 44, l: 8 };
  };

  Chart.prototype.resize = function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(280, this.host.clientWidth || 640);
    const h = Math.max(220, this.host.clientHeight || 280);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  };

  Chart.prototype.draw = function draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const c = colors();
    const pad = this.pad();
    const vis = this.slice();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);
    if (!vis.length) return;

    const volH = 36;
    const plotH = h - pad.t - pad.b - volH;
    const plotW = w - pad.l - pad.r;
    const slot = plotW / vis.length;
    let lo = Infinity;
    let hi = -Infinity;
    let maxVol = 1;
    vis.forEach((b) => {
      lo = Math.min(lo, b.low);
      hi = Math.max(hi, b.high);
      maxVol = Math.max(maxVol, b.volume || 0);
    });
    const padY = (hi - lo) * 0.08 || hi * 0.01;
    lo -= padY;
    hi += padY;
    const yOf = (px) => pad.t + ((hi - px) / (hi - lo)) * plotH;
    const xOf = (i) => pad.l + slot * i + slot / 2;

    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = 0; g < 4; g += 1) {
      const y = pad.t + (plotH * g) / 3;
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
    }
    ctx.stroke();

    ctx.font = "11px Segoe UI, PingFang SC, sans-serif";
    ctx.fillStyle = c.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let g = 0; g < 4; g += 1) {
      const px = hi - ((hi - lo) * g) / 3;
      ctx.fillText(fmtPrice(px), w - 6, pad.t + (plotH * g) / 3);
    }

    vis.forEach((b, i) => {
      const x = xOf(i);
      const up = b.close >= b.open;
      ctx.strokeStyle = up ? c.up : c.down;
      ctx.fillStyle = up ? c.up : c.down;
      ctx.beginPath();
      ctx.moveTo(x, yOf(b.high));
      ctx.lineTo(x, yOf(b.low));
      ctx.stroke();
      const bodyW = Math.max(2, slot * 0.62);
      const y1 = yOf(Math.max(b.open, b.close));
      const y2 = yOf(Math.min(b.open, b.close));
      const bh = Math.max(1, y2 - y1);
      ctx.fillRect(x - bodyW / 2, y1, bodyW, bh);
    });

    const volTop = pad.t + plotH + 8;
    vis.forEach((b, i) => {
      const x = xOf(i);
      const vh = ((b.volume || 0) / maxVol) * volH;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = b.close >= b.open ? c.up : c.down;
      ctx.fillRect(x - Math.max(1, slot * 0.4) / 2, volTop + volH - vh, Math.max(1, slot * 0.4), vh);
      ctx.globalAlpha = 1;
    });

    vis.forEach((b, i) => {
      (b._marks || []).forEach((m, mi) => {
        const x = xOf(i);
        const side = m.side;
        const color = side === "buy" ? c.up : side === "sell" ? c.down : c.brass;
        let y = yOf(m.price);
        y = Math.max(pad.t + 14, Math.min(pad.t + plotH - 14, y));
        if (mi) y += side === "sell" ? -12 : 12;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(x, yOf(b.close));
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        if (side === "buy") {
          ctx.moveTo(x, y + 8);
          ctx.lineTo(x - 7, y - 4);
          ctx.lineTo(x + 7, y - 4);
        } else if (side === "sell") {
          ctx.moveTo(x, y - 8);
          ctx.lineTo(x - 7, y + 4);
          ctx.lineTo(x + 7, y + 4);
        } else {
          ctx.moveTo(x, y - 7);
          ctx.lineTo(x + 6, y);
          ctx.lineTo(x, y + 7);
          ctx.lineTo(x - 6, y);
        }
        ctx.closePath();
        ctx.fill();
        const label = m.label || (side === "buy" ? "买" : side === "sell" ? "卖" : "警");
        ctx.font = "11px Segoe UI, PingFang SC, sans-serif";
        const tw = ctx.measureText(label).width;
        const lx = Math.min(x + 8, w - pad.r - tw - 10);
        const ly = y - 8;
        ctx.fillStyle = "rgba(14,16,20,0.86)";
        ctx.fillRect(lx - 3, ly - 2, tw + 6, 14);
        ctx.fillStyle = color;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(label, lx, ly);
      });
    });

    ctx.fillStyle = c.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = "10px Segoe UI, PingFang SC, sans-serif";
    const ticks = [0, Math.floor(vis.length / 2), vis.length - 1];
    ticks.forEach((i) => {
      if (!vis[i]) return;
      ctx.fillText(fmtTime(vis[i].time, this.interval), xOf(i), h - 16);
    });

    if (this.hover >= 0 && vis[this.hover]) {
      const b = vis[this.hover];
      const x = xOf(this.hover);
      ctx.strokeStyle = c.brass;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const last = vis[vis.length - 1];
      const chg = last && vis[0] ? ((b.close - b.open) / b.open) * 100 : 0;
      const tip = `${fmtTime(b.time, this.interval)}  O ${fmtPrice(b.open)}  H ${fmtPrice(b.high)}  L ${fmtPrice(b.low)}  C ${fmtPrice(b.close)}  ${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`;
      ctx.fillStyle = "rgba(14,16,20,0.82)";
      ctx.fillRect(pad.l, 4, Math.min(plotW, 420), 16);
      ctx.fillStyle = c.ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.font = "11px ui-monospace, SF Mono, Consolas, monospace";
      ctx.fillText(tip, pad.l + 4, 6);
    }

    const last = vis[vis.length - 1];
    if (last && this.hover < 0) {
      ctx.fillStyle = last.close >= last.open ? c.up : c.down;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.font = "11px ui-monospace, SF Mono, Consolas, monospace";
      ctx.fillText(fmtPrice(last.close), w - 6, 4);
    }

    this.canvas.setAttribute(
      "aria-label",
      `${this.spec.name || this.spec.symbol} ${this.interval} K线，可拖动查看`
    );
  };

  Chart.prototype.destroy = function destroy() {
    const c = this.canvas;
    c.removeEventListener("pointerdown", this.onDown);
    c.removeEventListener("pointermove", this.onMove);
    c.removeEventListener("pointerup", this.onUp);
    c.removeEventListener("pointercancel", this.onUp);
    c.removeEventListener("pointerleave", this.onLeave);
    c.removeEventListener("lostpointercapture", this.onUp);
    this.ro?.disconnect();
    c.remove();
  };

  function mount(host, spec) {
    return new Chart(host, spec);
  }

  global.DeskKline = {
    mount,
    makeBars,
    tfList,
    defaultInterval,
    MS,
    STOCK_TF,
    CRYPTO_TF,
  };
})(window);
