// resultResolver.js - evaluate expired signals & teach AI
function start(opts = {}){
  const signalsRef = opts.signalsRef || null; // in some contexts passed
  const barsRef = opts.barsRef || opts.barsRef || {};
  const broadcast = opts.broadcast || opts.broadcast || (()=>{});
  const ai = opts.aiLearner || require('./aiLearner');
  const signalsGlobal = opts.signalsRef || global.signals || null; // fallback not used
  setInterval(()=>{
    try {
      // if function was passed with our internal "signals" ref, use it
      const rows = opts.signalsRef || [];
      for(const r of rows){
        if(r.result) continue;
        const nowTs = Math.floor(Date.now()/1000);
        if(!r.expiry_ts) continue;
        if(nowTs < r.expiry_ts) continue;
        const bars = (opts.barsRef && opts.barsRef[r.symbol]) || [];
        const final = bars.find(b => b.time >= r.expiry_ts) || bars[bars.length-1];
        if(!final) continue;
        const finalPrice = final.close;
        let won = false;
        if(r.direction === 'CALL') won = finalPrice >= (r.entry || 0);
        else won = finalPrice <= (r.entry || 0);
        r.result = won ? 'WIN' : 'LOSS';
        broadcast && broadcast({ type: 'signal_result', data: { id: r.id, symbol: r.symbol, result: r.result, finalPrice } });
        try {
          const fv = { fvg: r.notes && r.notes.includes('fvg'), volumeSpike: r.notes && r.notes.includes('volSpike'), manipulation: false, bos: r.notes && r.notes.includes('bos') ? 1 : 0 };
          ai.recordOutcome && ai.recordOutcome(fv, won);
        } catch(e){}
      }
    } catch(e){}
  }, 3000);
}
module.exports = { start };
