// public/script.js - frontend UI (plain JS)
const ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws');
const pairSelect = document.getElementById('pairSelect');
const startBtn = document.getElementById('startBtn');
const nextBtn = document.getElementById('nextBtn');
const signalTitle = document.getElementById('signalTitle');
const signalBody = document.getElementById('signalBody');
const countdownEl = document.getElementById('countdown');
const logBox = document.getElementById('logBox');

let currentPair = null;
let countdownTimer = null;

function pushLog(t){ const d = new Date().toLocaleTimeString(); logBox.innerHTML = `<div>[${d}] ${t}</div>` + logBox.innerHTML; }

ws.onopen = ()=> pushLog('WS connected to backend');
ws.onmessage = (evt) => {
  try {
    const msg = JSON.parse(evt.data);
    if(msg.type === 'hello'){
      pushLog('Server time: ' + msg.server_time);
      if(msg.pairs && msg.pairs.length) {
        msg.pairs.forEach(p => { const o=document.createElement('option'); o.value=p; o.textContent=p; pairSelect.appendChild(o); });
        currentPair = pairSelect.value;
      }
    } else if(msg.type === 'pairs'){
      msg.pairs.forEach(p => { const o=document.createElement('option'); o.value=p; o.textContent=p; pairSelect.appendChild(o); });
      currentPair = pairSelect.value;
    } else if(msg.type === 'signal'){
      showSignal(msg.data);
    } else if(msg.type === 'log'){
      pushLog(msg.data);
    } else if(msg.type === 'signal_result'){
      pushLog(`Result ${msg.data.symbol} => ${msg.data.result} @ ${msg.data.finalPrice}`);
    } else if(msg.type === 'info'){
      pushLog('Info: ' + JSON.stringify(msg.data));
    }
  } catch(e){}
};

pairSelect.onchange = ()=> currentPair = pairSelect.value;

function showSignal(rec){
  clearInterval(countdownTimer);
  signalTitle.textContent = `${rec.symbol} — ${rec.direction}  (conf ${rec.confidence}%)`;
  const analysis = rec.notes ? `<div class="list"><strong>Notes:</strong> ${rec.notes}</div>` : '';
  signalBody.innerHTML = `<div>Entry: <span class="confidence">${rec.entry}</span></div>${analysis}`;
  // countdown
  const nowTs = Math.floor(Date.now()/1000);
  let secs = Math.max(0, rec.expiry_ts - nowTs);
  countdownEl.textContent = `Countdown: ${secs}s`;
  countdownTimer = setInterval(()=> {
    secs--;
    if(secs <= 0){ clearInterval(countdownTimer); countdownEl.textContent = 'Signal closed — awaiting result'; }
    else countdownEl.textContent = `Countdown: ${secs}s`;
  }, 1000);
}

startBtn.onclick = () => {
  if(!currentPair) { pushLog('Select a pair first'); return; }
  ws.send(JSON.stringify({ type:'start', symbol: currentPair }));
  pushLog('Requested start for ' + currentPair);
};

nextBtn.onclick = () => {
  if(!currentPair) { pushLog('Select a pair first'); return; }
  ws.send(JSON.stringify({ type:'next', symbol: currentPair }));
  pushLog('Requested next for ' + currentPair);
};
