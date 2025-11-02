// manipulationDetector.js
module.exports = {
  detect: (ticks = [], bars = []) => {
    const res = { score:0, reasons:[] };
    if(!bars || bars.length === 0) return res;
    const last = bars[bars.length-1];
    const body = Math.abs((last.close||0) - (last.open||last.close||0));
    const wickUp = last.high - Math.max(last.open||last.close||0, last.close||0);
    const wickDown = Math.min(last.open||last.close||0, last.close||0) - last.low;
    if(body < 1e-9 && (wickUp > 0 || wickDown > 0)){ res.score += 30; res.reasons.push('tiny body large wick'); }
    if(wickUp > body*3 || wickDown > body*3){ res.score += 20; res.reasons.push('wick >3x body'); }
    if(bars.length >= 10){
      const last10 = bars.slice(-10);
      const highs = last10.map(b=>b.high), lows = last10.map(b=>b.low);
      const range = Math.max(...highs) - Math.min(...lows);
      if(range > 0 && (last.high - last.low) > range*0.6){ res.score += 15; res.reasons.push('range spike'); }
    }
    res.score = Math.min(100, res.score);
    return res;
  }
};
