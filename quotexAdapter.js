// quotexAdapter.js - placeholder adapter (no live trading without proper API)
const axios = require('axios');
const WebSocket = require('ws');

async function startQuotexAdapter(env = {}, callbacks = {}){
  const apiUrl = env.apiUrl || process.env.QUOTEX_API_URL;
  const username = env.username || process.env.QUOTEX_USERNAME;
  const password = env.password || process.env.QUOTEX_PASSWORD;
  const wsUrl = env.wsUrl || process.env.QUOTEX_WS_URL;
  const appendTick = callbacks.appendTick || (()=>{});
  if(!apiUrl || !username || !password){
    console.log('quotexAdapter: credentials not set — adapter inactive (placeholder)');
    return { stop: ()=>{} };
  }
  try {
    const res = await axios.post(`${apiUrl}/auth/login`, { username, password }).catch(()=>null);
    const token = res && (res.data && (res.data.token || res.data.access_token));
    console.log('quotexAdapter: placeholder login attempted. token?', !!token);
    if(wsUrl && token){
      const ws = new WebSocket(wsUrl + '?token=' + encodeURIComponent(token));
      ws.on('open', ()=> console.log('quotexAdapter ws open'));
      ws.on('message', m => {
        try{
          const d = JSON.parse(m.toString());
          if(d.type === 'trade' && d.symbol && d.price) appendTick(d.symbol.toUpperCase(), Number(d.price), Number(d.volume||1), Math.floor((d.time?new Date(d.time).getTime():Date.now())/1000));
        }catch(e){}
      });
      ws.on('error', e => console.warn('quotex ws err', e && e.message));
      ws.on('close', ()=> setTimeout(()=> startQuotexAdapter(env, callbacks), 5000));
    }
    return { stop: ()=>{} };
  } catch(e){
    console.warn('quotexAdapter login failed (placeholder)', e.message || e);
    return { stop: ()=>{} };
  }
}

async function placeTrade(pair, direction, amount, expiryMinutes=1){
  console.log(`PLACE TRADE placeholder -> ${pair} ${direction} ${amount} expiry:${expiryMinutes}m`);
  return { success:true, id: 'sim-'+Date.now() };
}

module.exports = { startQuotexAdapter, placeTrade };
