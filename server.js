// server.js — main backend + static + WS
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');

const compute = require('./computeStrategy');
const aiLearner = require('./aiLearner');
const manipDetector = require('./manipulationDetector');
const resultResolver = require('./resultResolver');
const quotexAdapter = require('./quotexAdapter'); // placeholder adapter

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const PORT = parseInt(process.env.PORT || '3000', 10);
const SIGNAL_INTERVAL_MS = parseInt(process.env.SIGNAL_INTERVAL_MS || '4000', 10);
const MIN_CONF = parseInt(process.env.MIN_BROADCAST_CONF || '30', 10);
const BINARY_EXPIRY_SECONDS = parseInt(process.env.BINARY_EXPIRY_SECONDS || '60', 10);

const PAIRS = (process.env.WATCH_SYMBOLS || 'EUR/USD,GBP/USD,USD/JPY,AUD/USD,USD/CAD,USD/CHF,NZD/USD')
  .split(',').map(s => s.trim().toUpperCase());

// in-memory bars and signals
const bars = {};      // bars[symbol] = [{time,open,high,low,close,volume}, ...]
const signals = [];   // {id,symbol,direction,confidence,entry,time_iso,expiry_ts,result,notes}

// serve frontend static
app.use(express.static('public'));

// endpoints
app.get('/pairs', (req, res) => res.json({ ok: true, pairs: PAIRS }));
app.get('/signals/history', (req, res) => res.json({ ok: true, rows: signals.slice(-200).reverse() }));

// broadcast helper
function broadcast(obj) {
  const raw = JSON.stringify(obj);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(raw); });
}

// appendTick -> build 1s bars
function appendTick(sym, price, qty, tsSec) {
  sym = sym.toUpperCase();
  bars[sym] = bars[sym] || [];
  const arr = bars[sym];
  const last = arr[arr.length - 1];
  if (!last || last.time !== tsSec) {
    arr.push({ time: tsSec, open: price, high: price, low: price, close: price, volume: qty || 1 });
    if (arr.length > 3600 * 2) arr.shift();
  } else {
    last.close = price;
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.volume = (last.volume || 0) + (qty || 0);
  }
}

// simulate ticks (used until live adapter present)
function simulateTick(sym) {
  const isCrypto = /BTC|DOGE|SHIBA|PEPE|ARB|APTOS|TRON|BINANCE|BONK|POLK/i.test(sym);
  const base = isCrypto ? (Math.random() * 200 + 20) : (sym.startsWith('EUR') ? 1.09 : 1.0);
  const noise = (Math.random() - 0.5) * (isCrypto ? 2 : 0.0025);
  const price = +(base + noise).toFixed(4);
  const qty = Math.random() * (isCrypto ? 5 : 100);
  appendTick(sym, price, qty, Math.floor(Date.now() / 1000));
}

// warmup minimal history so computeStrategy can run immediately
function warmup() {
  for (const s of PAIRS) {
    bars[s] = bars[s] || [];
    for (let i = 0; i < 120; i++) {
      const ts = Math.floor(Date.now() / 1000) - (120 - i);
      const base = s.startsWith('EUR') ? 1.09 : 1.0;
      appendTick(s, +(base + (Math.random() - 0.5) * 0.005).toFixed(4), Math.random() * 100, ts);
    }
  }
}
warmup();

// lightweight time-sync (worldtimeapi)
let serverOffsetMs = 0;
async function syncTime() {
  try {
    const r = await fetch('http://worldtimeapi.org/api/timezone/Etc/UTC');
    const j = await r.json();
    const serverMs = (j.unixtime ? j.unixtime * 1000 : (new Date(j.datetime)).getTime());
    serverOffsetMs = serverMs - Date.now();
  } catch (e) { /* ignore */ }
}
setInterval(syncTime, 60_000);
syncTime();

// auto-heal cleanup
setInterval(() => {
  try {
    for (const s of Object.keys(bars)) {
      const arr = bars[s];
      const cleaned = arr.filter((b, i) => b && typeof b.close === 'number' && isFinite(b.close) && (i === 0 || b.time > arr[i - 1].time));
      if (cleaned.length !== arr.length) bars[s] = cleaned;
    }
  } catch (e) { /* ignore */ }
}, 120_000);

// result resolver
resultResolver.start({ signalsRef: signals, barsRef: bars, broadcast, aiLearner });

// start quotex adapter (placeholder)
quotexAdapter.startQuotexAdapter({
  apiUrl: process.env.QUOTEX_API_URL,
  username: process.env.QUOTEX_USERNAME,
  password: process.env.QUOTEX_PASSWORD,
  wsUrl: process.env.QUOTEX_WS_URL
}, {
  appendTick: (sym, price, qty, ts) => appendTick(sym.toUpperCase(), price, qty, ts),
  onOrderConfirm: o => console.log('Order confirm', o)
}).catch(() => { /* placeholder only */ });

// Main loop: compute candidate signals periodically
setInterval(() => {
  for (const s of PAIRS) {
    try {
      if (!bars[s] || bars[s].length < 100) {
        simulateTick(s);
        continue;
      }

      const last100 = bars[s].slice(-100);
      const manip = manipDetector.detect([], last100);
      if (manip.score > 60) {
        broadcast({ type: 'log', data: `[SKIP] ${s} due to manipulation ${manip.score}` });
        continue;
      }

      const sig = compute.computeSignalForSymbol(s, bars, { require100: true });
      if (!sig) continue;

      const fv = {
        fvg: sig.notes && sig.notes.includes('fvg'),
        volumeSpike: sig.notes && sig.notes.includes('volSpike'),
        manipulation: manip.score > 0,
        bos: sig.notes && sig.notes.includes('bos') ? 1 : 0
      };
      const boost = aiLearner.predictBoost ? aiLearner.predictBoost(fv) : 0;
      sig.confidence = Math.max(1, Math.min(99, Math.round((sig.confidence || 50) + boost)));

      if (sig.confidence < MIN_CONF) continue;

      const id = signals.length + 1;
      const expiry_ts = Math.floor(Date.now() / 1000) + BINARY_EXPIRY_SECONDS;
      const rec = {
        id, symbol: s, market: 'binary', direction: sig.direction, confidence: sig.confidence,
        entry: sig.entry, notes: sig.notes || '', time_iso: new Date().toISOString(), expiry_ts, result: null
      };
      signals.push(rec);
      broadcast({ type: 'signal', data: rec });
      broadcast({ type: 'log', data: `Signal ${rec.symbol} ${rec.direction} conf:${rec.confidence}% id:${rec.id}` });
    } catch (e) {
      console.warn('signal loop err', e && e.message ? e.message : e);
    }
  }
}, SIGNAL_INTERVAL_MS);

// WebSocket client handlers (Start / Next / Exec)
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'hello', server_time: new Date(Date.now() + serverOffsetMs).toISOString(), pairs: PAIRS }));
  ws.on('message', msg => {
    try {
      const m = JSON.parse(msg.toString());
      if (m.type === 'start') {
        const sym = (m.symbol || PAIRS[0]).toUpperCase();
        const sig = compute.computeSignalForSymbol(sym, bars, { require100: true });
        if (!sig) ws.send(JSON.stringify({ type: 'info', data: 'No confirmed signal now — hold' }));
        else {
          const id = signals.length + 1;
          const expiry_ts = Math.floor(Date.now() / 1000) + BINARY_EXPIRY_SECONDS;
          const rec = { id, symbol: sym, market: 'binary', direction: sig.direction, confidence: sig.confidence, entry: sig.entry, notes: sig.notes || '', time_iso: new Date().toISOString(), expiry_ts, result: null };
          signals.push(rec);
          ws.send(JSON.stringify({ type: 'signal', data: rec }));
        }
      } else if (m.type === 'next') {
        const sym = (m.symbol || PAIRS[0]).toUpperCase();
        const sig = compute.computeSignalForSymbol(sym, bars, { require100: true, forceNext: true });
        if (!sig) ws.send(JSON.stringify({ type: 'info', data: 'No suitable opportunity now — Hold' }));
        else {
          const id = signals.length + 1;
          const expiry_ts = Math.floor(Date.now() / 1000) + BINARY_EXPIRY_SECONDS;
          const rec = { id, symbol: sym, market: 'binary', direction: sig.direction, confidence: sig.confidence, entry: sig.entry, notes: sig.notes || '', time_iso: new Date().toISOString(), expiry_ts, result: null };
          signals.push(rec);
          ws.send(JSON.stringify({ type: 'signal', data: rec }));
        }
      } else if (m.type === 'execTrade') {
        const { pair, direction, amount } = m;
        quotexAdapter.placeTrade(pair, direction, amount, 1).then(r => ws.send(JSON.stringify({ type: 'execResult', data: r }))).catch(e => ws.send(JSON.stringify({ type: 'execError', data: e.message || e })));
      }
    } catch (e) { /* ignore parse errors */ }
  });
});

// start server
server.listen(PORT, () => {
  console.log(`Binary Sniper server listening on port ${PORT}`);
  console.log(`Watching pairs: ${PAIRS.join(', ')}`);
});
