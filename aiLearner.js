// aiLearner.js - adaptive weight store (file persistence)
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'ai_state.json');
let state = { weights: { fvg:1, volume:1, manipulation:-2, bos:1 }, alpha:0.05, stats:{wins:0,losses:0} };
try{ if(fs.existsSync(FILE)) state = JSON.parse(fs.readFileSync(FILE,'utf8')); } catch(e){}
function save(){ try{ fs.writeFileSync(FILE, JSON.stringify(state,null,2)); } catch(e){} }
function predictBoost(fv){
  let boost = 0;
  if(fv.fvg) boost += (state.weights.fvg||0);
  if(fv.volumeSpike) boost += (state.weights.volume||0);
  if(fv.manipulation) boost += (state.weights.manipulation||0);
  if(fv.bos) boost += (state.weights.bos||0);
  return Math.round(boost);
}
function recordOutcome(fv, outcome){
  const y = outcome ? 1 : 0;
  const pred = predictBoost(fv) > 0 ? 1 : 0;
  const err = y - pred;
  ['fvg','volume','bos'].forEach(k => {
    const x = fv[k] ? 1 : 0;
    state.weights[k] = (state.weights[k]||0) + state.alpha * err * x;
  });
  state.weights.manipulation = (state.weights.manipulation||0) + state.alpha * (-err) * (fv.manipulation ? 1 : 0);
  if(y) state.stats.wins++; else state.stats.losses++;
  save();
}
module.exports = { predictBoost, recordOutcome, getState: ()=> JSON.parse(JSON.stringify(state)) };
