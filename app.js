// ---------- helpers ----------
const qs = s => document.querySelector(s);
const clamp = (v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,v));
const num = (v, d=0)=> (v==null||Number.isNaN(v)) ? '—' : Number(v).toFixed(d);
const isoHM = t => new Date(t).toISOString().slice(11,16);

// ---------- data endpoints ----------
const SWPC = "https://services.swpc.noaa.gov/products/solar-wind";
const ENDPOINTS = {
  plasma: `${SWPC}/plasma-2-hour.json`,
  mag:    `${SWPC}/mag-2-hour.json`,
  kp:     "https://services.swpc.noaa.gov/json/rtsw/rtsw_kp_1m.json"
};
const DONKI = {
  url: (start, end, key="DEMO_KEY") =>
    `https://api.nasa.gov/DONKI/notifications?type=all&startDate=${start}&endDate=${end}&api_key=${key}`
};

// ---------- state ----------
let state = {
  speed:null, dens:null, bz:null, bt:null, kp:null,
  beatIdx:0, updated:null, history:[], mode:"active", geo:null,
  replayOffsetMin:0, donkiWatch:false, view:"orbits"
};

// ---------- audio ----------
let audio = { ctx:null, master:null, bass:null, filter:null, enabled:true };
function initAudio(){ try{
  audio.ctx = new (window.AudioContext||window.webkitAudioContext)();
  audio.master = audio.ctx.createGain(); audio.master.gain.value = 0.35;
  audio.filter = audio.ctx.createBiquadFilter(); audio.filter.type="lowpass"; audio.filter.frequency.value=900; audio.filter.Q.value=6;
  audio.bass = audio.ctx.createOscillator(); audio.bass.type="sine"; audio.bass.frequency.value = 55;
  audio.bass.connect(audio.filter); audio.filter.connect(audio.master); audio.master.connect(audio.ctx.destination); audio.bass.start();
}catch(e){console.warn(e)}}
function setAudioEnabled(v){ audio.enabled=!!v; if(audio.master) audio.master.gain.value = audio.enabled ? Number(qs('#vol').value||0.35):0; }
function setVolume(v){ if(audio.master){ audio.master.gain.value = audio.enabled? v:0; qs('#vol').value=String(v); } }
function setMute(){ const now=audio.master?.gain.value||0; if(now>0){setAudioEnabled(false)} else {setAudioEnabled(true)} }
let activated=false; ['click','keydown','pointerdown','touchstart'].forEach(ev=>window.addEventListener(ev,async()=>{ if(activated||!audio.ctx)return; try{await audio.ctx.resume(); setAudioEnabled(true); activated=true; const t=qs('#audioStatus'); if(t){t.textContent='audio: on'; t.style.opacity=.8;} }catch{} },{once:true}));

// ---------- mapping ----------
function speedToBpm(v){ v=Math.max(300,Math.min(800,v||360)); return 60+(v-300)*(80/500); }
function densToHz(n){ n=Math.max(0,Math.min(20,n||4)); return 45+n*(20/20); }
function bzToCutoff(bz){ bz=Math.max(-10,Math.min(10,bz||0)); return 300+((bz+10)/20)*1500; }
function currentBeat(bpm){ return Math.floor(Date.now()/(60000/bpm)); }
function bzColor(bz){ return bz<-2?0xff6f61:(bz<0?0xffb74d:0xfff3b0); }

// ---------- THREE ----------
let renderer, scene, camera, sun, earth, auroraRing, stars;
function initScene(){
  const canvas = qs('#scene');
  renderer = new THREE.WebGLRenderer({canvas, antialias:true});
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, canvas.clientWidth/canvas.clientHeight, .1, 2000);
  resize(); window.addEventListener('resize',resize);
  camera.position.set(0,1.2,3.3);
  const light=new THREE.PointLight(0xffffff,2.2,100); light.position.set(0,0,0); scene.add(light);

  const sunGeo=new THREE.SphereGeometry(0.8,64,64), sunMat=new THREE.MeshBasicMaterial({color:0xfff3b0});
  sun=new THREE.Mesh(sunGeo,sunMat); scene.add(sun);

  const earthGeo=new THREE.SphereGeometry(0.35,64,64), earthMat=new THREE.MeshPhongMaterial({color:0x4fc3f7,emissive:0x00111a,shininess:6});
  earth=new THREE.Mesh(earthGeo,earthMat); earth.position.set(2,0,0); scene.add(earth);

  const ringGeo=new THREE.RingGeometry(0.42,0.49,128), ringMat=new THREE.MeshBasicMaterial({color:0x66ff99,transparent:true,opacity:.15,side:THREE.DoubleSide});
  auroraRing=new THREE.Mesh(ringGeo,ringMat); auroraRing.rotation.x=Math.PI/2; earth.add(auroraRing);

  const sGeo=new THREE.BufferGeometry(), N=1200, pos=new Float32Array(N*3);
  for(let i=0;i<N;i++){ pos[i*3]=(Math.random()-.5)*50; pos[i*3+1]=(Math.random()-.5)*50; pos[i*3+2]=(Math.random()-.5)*50-10; }
  sGeo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  stars=new THREE.Points(sGeo, new THREE.PointsMaterial({color:0x97a5c7,size:0.03,opacity:.5,transparent:true})); scene.add(stars);

  animate();
}
function resize(){
  const c=qs('#scene'); if(!c) return;
  const w=c.clientWidth, h=c.clientHeight||1;
  renderer.setSize(w,h,false);
  camera.aspect=w/h; camera.updateProjectionMatrix();
}
function animate(){ requestAnimationFrame(animate);
  const bpm=speedToBpm(state.speed||360);
  const beat=currentBeat(bpm);
  if(beat!==state.beatIdx){ state.beatIdx=beat; pulse(); }
  sun.rotation.y+=.002; earth.rotation.y+=.003; renderer.render(scene,camera);
}
function pulse(){
  const base=Math.min(.25,(state.bt||4)/40); const s=1.0+base*(state.sunPulseMult||1); sun.scale.set(s,s,s);
  const bz=state.bz||0, color=bzColor(bz), boost=state.colorBoost||1, r=(color>>16)&255,g=(color>>8)&255,b=color&255;
  sun.material.color.setRGB((r*boost)/255,(g*boost)/255,(b*boost)/255);
  auroraRing.material.opacity=Math.min(.7,Math.max(.06,(Math.abs(Math.min(0,bz)))/10));
  updateSound(); updateHUD();
}
function updateSound(){ if(!audio.ctx)return; audio.bass.frequency.setTargetAtTime(densToHz(state.dens),audio.ctx.currentTime,.05); audio.filter.frequency.setTargetAtTime(bzToCutoff(state.bz),audio.ctx.currentTime,.05); }

// ---------- floating dock ----------
const feed = [];
function logActivity(msg){
  const t = isoHM(Date.now());
  feed.unshift(`${t} · ${msg}`); if(feed.length>10) feed.pop();
  const box=qs('#dockFeed'); if(box) box.innerHTML = feed.map(line=>`<div class="feedRow">${line}</div>`).join('');
}
function updateAuroraMeter(){
  const b = Math.max(0, -1*(state.bz||0)); const k = clamp((state.kp||0)/9,0,1);
  const val = clamp(0.6*b/10 + 0.4*k, 0, 1);
  const bar=qs('#auroraBar'); if(bar) bar.style.width = `${Math.round(val*100)}%`;
  const note=qs('#auroraNote'); if(note) note.textContent = (b>2||k>=5)? 'conditions favor aurora at higher lats' : 'quiet to mild';
}
function setView(mode){
  state.view=mode;
  if(mode==='orbits'){ camera.position.set(0,1.2,3.3); stars.material.opacity=0.5; auroraRing.visible=true; }
  if(mode==='aurora'){ camera.position.set(1.2,0.6,2.2); stars.material.opacity=0.35; auroraRing.visible=true; }
  if(mode==='spectro'){ camera.position.set(0,0.9,1.8); stars.material.opacity=0.15; auroraRing.visible=false; }
  logActivity(`view → ${mode}`);
}

// ---------- data ----------
async function fetchJSON(url){ const r=await fetch(url,{cache:"no-store"}); if(!r.ok) throw new Error(url); return r.json(); }
function lastRow(table){ const head=table[0], row=table[table.length-1], o={}; head.forEach((h,i)=>o[h]=row[i]); return o; }

async function seedHistory(){
  try{
    const [plasma, mag] = await Promise.all([ fetchJSON(ENDPOINTS.plasma), fetchJSON(ENDPOINTS.mag) ]);
    const ph=plasma[0], mh=mag[0];
    const rows = plasma.slice(-40).map((p,i)=>{
      const m = mag[Math.max(1, mag.length - (plasma.length - (plasma.length-40+i)))];
      const t = Date.parse(p[ph.indexOf('time_tag')]);
      const speed = Number(p[ph.indexOf('speed')] || p[ph.indexOf('Speed')] || 360);
      const bz = Number(m[mh.indexOf('bz')] || m[mh.indexOf('Bz')] || 0);
      return { t: isNaN(t)? Date.now()-(40-i)*30000 : t, speed, bz };
    });
    state.history.push(...rows.filter(r=>Number.isFinite(r.speed)&&Number.isFinite(r.bz)));
  }catch(e){ console.warn('seed history failed', e); }
}

async function loadSpaceWeather(){
  try{
    const [plasma, mag] = await Promise.all([ fetchJSON(ENDPOINTS.plasma), fetchJSON(ENDPOINTS.mag) ]);
    const p=lastRow(plasma), m=lastRow(mag);
    state.speed=Number(p.speed||p.Speed||p.Vx||0);
    state.dens =Number(p.density||p.Density||p.Np||0);
    state.bt   =Number(m.bt||m.Bt||4);
    state.bz   =Number(m.bz||m.Bz||0);
    state.updated = p.time_tag || m.time_tag || new Date().toISOString();
    const rawBox=qs('#rawBox'); if(rawBox) rawBox.textContent = JSON.stringify({plasma:p,mag:m},null,2);
    logActivity(`live: speed ${num(state.speed)} · Bz ${num(state.bz,1)} · dens ${num(state.dens,1)}`);
  }catch(e){
    console.warn("live fetch failed, using defaults", e);
    state.speed=360; state.dens=4; state.bt=4; state.bz=1; state.updated=new Date().toISOString();
  }
  state.history.push({ t:Date.now(), speed:state.speed, bz:state.bz });
  if(state.history.length>200) state.history.shift();
  updateHUD();
}

let kpSeries=[], kpChart=null;
async function loadKp(){
  try {
    const j = await fetchJSON(ENDPOINTS.kp);
    const clean = j.map(r => ({ t: Date.parse(r.time_tag || r.timestamp || r.time || Date.now()),
      kp: r.kp_index!=null ? Number(r.kp_index) : (r.value!=null?Number(r.value):NaN) }))
      .filter(r => Number.isFinite(r.kp) && Number.isFinite(r.t));
    if (clean.length) {
      state.kp = clean[clean.length-1].kp;
      kpSeries = clean.slice(-48);
      qs('#kp').textContent = state.kp.toFixed(1);
      buildKpChart();
      logActivity(`Kp update → ${state.kp.toFixed(1)}`);
      return;
    }
  } catch (e) { /* use proxy below */ }
  const v = Number(state.speed || 360);
  const bz = Number(state.bz || 0);
  const kpProxy = clamp(((v - 300) / 60) + (Math.max(0, -bz) * 0.6), 0, 9);
  state.kp = Math.round(kpProxy * 10) / 10;
  qs('#kp').textContent = state.kp.toFixed(1);
  const now = Date.now();
  kpSeries = Array.from({length:24}, (_,i)=>({ t: now - (23-i)*30*60*1000, kp: state.kp }));
  buildKpChart();
  logActivity(`Kp proxy → ${state.kp.toFixed(1)}`);
}
function buildKpChart(){
  const el = document.getElementById('kpChart'); if (!el) return;
  if (kpChart) kpChart.destroy();
  kpChart = new Chart(el, {
    type: 'line',
    data: { labels: kpSeries.map(x => isoHM(x.t)),
      datasets: [{ label:'Kp', data: kpSeries.map(x => x.kp), pointRadius:0, borderWidth:1 }] },
    options: {
      responsive:true, plugins:{legend:{display:false}},
      scales:{
        x:{ticks:{color:'#9fb0d6', maxTicksLimit:8}, grid:{color:'#152241'}},
        y:{ticks:{color:'#9fb0d6'}, grid:{color:'#152241'}, suggestedMin:0, suggestedMax:9}
      }, elements:{ line:{ tension:0.2 } }
    }
  });
}

// DONKI
async function loadDonki(){
  try{
    const end = new Date();
    const start = new Date(Date.now()-3*24*3600*1000);
    const fmt = d => d.toISOString().slice(0,10);
    const data = await fetchJSON(DONKI.url(fmt(start), fmt(end)));
    const box = qs('#donkiBox');
    if(!Array.isArray(data) || !data.length){ if(box) box.textContent = "no recent DONKI alerts."; state.donkiWatch=false; setWatchBadge(false); return; }
    const rows = data.filter(n => /FLR|CME|SEP|GST|RBE/.test(n.messageType||"")).slice(0,6);
    state.donkiWatch = rows.some(r => /G[1-5]|M-class|X-class|CME/i.test(r.messageBody||""));
    setWatchBadge(state.donkiWatch);
    if (rows.length && box){
      box.innerHTML = rows.map(r=>{
        const t = (r.messageIssueTime||'').replace('T',' ').replace('Z',' UTC');
        const type = r.messageType||'NOTICE';
        const body = (r.messageBody||'').split('\n')[0].slice(0,140);
        return `<div style="margin:6px 0"><b>${type}</b> — <span style="opacity:.9">${t}</span><br/><span style="opacity:.85">${body}…</span></div>`;
      }).join('');
    }
    if(rows.length){ logActivity(`DONKI: ${rows[0].messageType||'notice'}`); }
  }catch(e){
    console.warn('DONKI failed', e);
    const box = qs('#donkiBox'); if(box) box.textContent = "couldn’t load DONKI.";
    setWatchBadge(false);
  }
}
function setWatchBadge(on){ const b=qs('#watchBadge'); if(b) b.classList.toggle('hidden', !on); }

// ---------- forecast / impact ----------
function impactSnapshot(speed,bz,kp){
  const s=speed||0,b=bz||0,k=kp||0; let r=[];
  if(k>=5) r.push("geomagnetic storm (G1+) conditions");
  if(s>=600) r.push("satellite drag ↑ (LEO)");
  if(b<=-5) r.push("GPS scintillation risk ↑ (high lat)");
  if(k>=6) r.push("HF radio disruption possible");
  return r.length? r.join(" • ") : "nominal — low impacts expected right now";
}
function linReg(xs,ys){
  const n=xs.length; if(n<2) return {m:0,b:ys[n-1]||0};
  let sx=0,sy=0,sxx=0,sxy=0;
  for(let i=0;i<n;i++){ sx+=xs[i]; sy+=ys[i]; sxx+=xs[i]*xs[i]; sxy+=xs[i]*ys[i]; }
  const m=(n*sxy - sx*sy)/Math.max(1e-9,(n*sxx - sx*sx)), b=(sy - m*sx)/n;
  return {m,b};
}
function median(a){ const s=[...a].sort((x,y)=>x-y); const k=Math.floor(s.length/2); return s.length?(s.length%2?s[k]:(s[k-1]+s[k])/2):0; }
function smooth(arr,w=3){ if(arr.length<=w) return arr; const out=[]; for(let i=0;i<arr.length;i++){ out.push(median(arr.slice(Math.max(0,i-w), i+1))); } return out; }
function forecastFromHistory(){
  const H=state.history.slice(-40); if(H.length<6) return null;
  const xs=H.map(r=>r.t), bzA=smooth(H.map(r=>r.bz??0),2), spA=smooth(H.map(r=>r.speed??360),2);
  const {m:mbz,b:bbz}=linReg(xs,bzA), {m:msp,b:bsp}=linReg(xs,spA);
  const now=Date.now(); const at=dt=>({bz:bbz+mbz*(now+dt), speed:bsp+msp*(now+dt), bpm:speedToBpm(bsp+msp*(now+dt))});
  return { t0:at(0), t30:at(30*60*1000), t60:at(60*60*1000) };
}
function riskScore(speed,bz,kp){ let s=0; if(bz<=-1) s+=Math.min(30,(-bz)*3); if(speed>=400) s+=Math.min(30,(speed-400)/7); if(kp!=null) s+=Math.min(30,kp*3.3); return Math.round(Math.max(0,Math.min(100,s))); }
function riskLabel(sc){ return sc>=70?'high':(sc>=40?'elevated':'low'); }

let notifOK=false, lastAlertBucket=null;
async function ensureNotifications(){ if(!("Notification"in window)) return false; if(Notification.permission==='granted'){notifOK=true;return true;} if(Notification.permission!=='denied'){ const p=await Notification.requestPermission(); notifOK=(p==='granted'); } return notifOK; }
function maybeNotify(score){
  if(!qs('#notifToggle').checked||!notifOK) return;
  const bucket=score>=70?'high':(score>=40?'elevated':'low');
  if(bucket!==lastAlertBucket){
    lastAlertBucket=bucket;
    try{ new Notification(`flaresync: storm risk ${bucket}`, { body:`speed ${num(state.speed)} km/s · Bz ${num(state.bz,1)} nT · Kp ${state.kp??'—'}`}); }catch{}
    if(navigator.vibrate) navigator.vibrate([80,40,80]);
  }
}

function updateForecastUI(){
  const fc=forecastFromHistory();
  const set = (id,txt)=>{ const el=qs('#'+id); if(el) el.textContent = txt; };

  if(!fc){ ['fcBz','fcRisk','fcAurora','fcBpm','riskNow','risk30','risk60'].forEach(id=>set(id,'—')); return; }

  const dir=fc.t60.bz - fc.t0.bz; const arrow=dir<0?'↓':(dir>0?'↑':'→');
  set('fcBz', `${arrow} ${fc.t0.bz.toFixed(1)} → ${fc.t60.bz.toFixed(1)} nT`);

  const sNow=riskScore(fc.t0.speed, fc.t0.bz, state.kp);
  const s30=riskScore(fc.t30.speed, fc.t30.bz, state.kp);
  const s60=riskScore(fc.t60.speed, fc.t60.bz, state.kp);
  set('riskNow', `${riskLabel(sNow)} (${sNow})`);
  set('risk30', `${riskLabel(s30)} (${s30})`);
  set('risk60', `${riskLabel(s60)} (${s60})`);
  set('fcRisk', `${riskLabel(s30)} (${s30})`);

  const here = state.geo?.lat!=null
    ? (Math.abs(state.geo.lat)>=60 ? 'likely' : (Math.abs(state.geo.lat)>=50 ? 'possible' : 'unlikely'))
    : 'allow location to personalize';
  set('fcAurora', here);
  set('fcBpm', `${fc.t0.bpm.toFixed(0)} → ${fc.t60.bpm.toFixed(0)}`);

  maybeNotify(s30);
}
function updateImpact(){ const el=qs('#impactText'); if(el) el.textContent = impactSnapshot(state.speed,state.bz,state.kp); }

// ---------- satellite drag sandbox ----------
function dragIndex(altKm, speed, bz, kp, swDens){
  const s = clamp((speed - 350) / 400, 0, 1);
  const b = clamp((-Math.min(0, bz)) / 10, 0, 1);
  const k = clamp((kp || 0) / 9, 0, 1);
  const d = clamp((swDens || 0) / 20, 0, 1);
  const driver = 0.4*s + 0.3*b + 0.2*k + 0.1*d;
  const altFactor = Math.exp(-altKm / 700);
  return Math.round(100 * driver * altFactor);
}
function decayEstimateMPerDay(altKm, idx, massKg, areaM2, Cd){
  const B = Math.max(1e-6, massKg / (Math.max(1e-6, Cd*areaM2)));
  const altitudeScale = Math.exp(-(altKm - 300) / 700);
  const k = 0.15;
  const decay = idx * altitudeScale * (10 / B) * k;
  return Math.round(decay);
}
function dragRiskLabel(idx){ if(idx >= 60) return "high"; if(idx >= 30) return "elevated"; return "low"; }
function updateSandbox(){
  const sel = qs('#orbitSel'); if(!sel) return;
  const alt = Number(sel.value);
  const mass = Number(qs('#satMass').value);
  const area = Number(qs('#satArea').value);
  const Cd   = Number(qs('#satCd').value);
  const idx = dragIndex(alt, state.speed||360, state.bz||0, state.kp||0, state.dens||4);
  const decay = decayEstimateMPerDay(alt, idx, mass, area, Cd);
  qs('#dragIdx').textContent   = isFinite(idx)   ? idx   : '—';
  qs('#dragRisk').textContent  = dragRiskLabel(idx);
  qs('#dragDecay').textContent = isFinite(decay) ? decay : '—';
  let note = 'driver mostly wind speed';
  if (state.bz <= -5) note = 'southward Bz adding energy';
  if (alt >= 2000) note = 'negligible at this altitude';
  qs('#dragNotes').textContent = note;
}

// ---------- mini-HUD ----------
function updateMiniHud(){
  const bpm = speedToBpm(state.speed||360);
  const here = state.geo?.lat!=null
    ? (Math.abs(state.geo.lat)>=60 ? 'likely' : (Math.abs(state.geo.lat)>=50 ? 'possible' : 'unlikely'))
    : '—';
  const risk = riskScore(state.speed||360, state.bz||0, state.kp||0);
  const riskTxt = `${riskLabel(risk)} (${risk})`;
  const set = (sel, v) => { const el = qs(sel); if(el) el.textContent = v; };
  set('#hudBpm', Math.round(bpm));
  set('#hudRisk', riskTxt);
  set('#hudAurora', here);
  set('#hudKp', state.kp!=null ? Number(state.kp).toFixed(1) : '—');
}

// ---------- HUD ----------
function updateHUD(){
  const s=qs('#speed'), b=qs('#bz'), d=qs('#dens'), beat=qs('#beat'), up=qs('#updated');
  if(s) s.textContent=num(state.speed);
  if(b) b.textContent=num(state.bz,1);
  if(d) d.textContent=num(state.dens,1);
  if(beat) beat.textContent=state.beatIdx;
  if(up) up.textContent=`updated ${new Date(state.updated||Date.now()).toUTCString()}`;
  updateImpact(); updateForecastUI(); updateSandbox(); updateAuroraMeter(); updateMiniHud();
  const rlab=qs('#replayLabel'); if(rlab) rlab.textContent = state.replayOffsetMin? `${state.replayOffsetMin} min ago` : 'live';
}

// ---------- modes ----------
const presets={calm:{sunPulse:.05,colorBoost:.9,gainCap:.25},active:{sunPulse:.15,colorBoost:1.0,gainCap:.4},storm:{sunPulse:.25,colorBoost:1.15,gainCap:.55}}; 
function applyMode(mode){ const p=presets[mode]||presets.active; state.sunPulseMult=p.sunPulse; state.colorBoost=p.colorBoost; if(audio.master){ audio.master.gain.value=Math.min(Number(qs('#vol').value||0.35),p.gainCap);} }

// ---------- quiz ----------
const QUIZ={idx:0,score:0,q:[]};
function buildQuiz(){
  const live={ q:()=>`Live check: IMF Bz is ${num(state.bz,1)} nT. Which is MOST accurate?`,
    choices:["Positive Bz couples strongly and drives storms.","Negative Bz couples strongly and increases storm risk.","Bz is unrelated to storms.","Bz is only measured during eclipses."],
    correct:1, why:"Southward (negative) Bz reconnects with Earth’s field, raising storm risk." };
  const qsA=[ {q:"Kp≈7 suggests what?",choices:["Quiet","Severe geomagnetic storming","Tropics-only aurora","No satellite impact"],correct:1,why:"Kp≥7 is strong storming (G3)."},
              {q:"What raises LEO drag the most?",choices:["Slow wind + positive Bz","Fast wind + negative Bz","Any Bz with low density","Only when Kp=0"],correct:1,why:"Fast wind + southward Bz → energy input → upper-atmosphere expansion."},
              {q:"OVATION gives probabilities for…",choices:["Hurricanes","Aurora","Solar flares","Tornadoes"],correct:1,why:"OVATION is an aurora probability model."},
              {q:"In flaresync, heartbeat tempo maps from:",choices:["Solar wind speed","Local time","Earthquakes","Random"],correct:0,why:"Wind speed → BPM; density/Bz shape timbre."} ];
  QUIZ.q=[live, ...qsA]; QUIZ.idx=0; QUIZ.score=0;
}
function renderQuiz(){
  const ov=qs('#quizOverlay'), body=qs('#quizBody'); ov.classList.remove('hidden'); ov.style.display='flex';
  const i=QUIZ.idx,N=QUIZ.q.length,item=QUIZ.q[i], text=(typeof item.q==='function')?item.q():item.q;
  body.innerHTML=`<div style="opacity:.8">Question ${i+1} of ${N}</div>
  <div style="margin:8px 0 10px 0;font-weight:600">${text}</div>
  <div id="quizChoices" style="display:grid;gap:8px;margin-bottom:8px"></div>
  <div id="quizExplain" style="min-height:32px;opacity:.9"></div>
  <div style="display:flex;gap:8px;margin-top:10px">
    <button id="quizNext" class="chip" disabled>next</button>
    <div style="margin-left:auto">score: <b id="quizScore">${QUIZ.score}</b></div></div>`;
  const box=qs('#quizChoices');
  item.choices.forEach((c,idx)=>{ const b=document.createElement('button'); b.textContent=c; b.className='chip';
    b.onclick=()=>{ Array.from(box.children).forEach(x=>x.disabled=true); const ok=(idx===item.correct); if(ok) QUIZ.score+=1; qs('#quizScore').textContent=QUIZ.score; qs('#quizExplain').innerHTML=(ok?'✅ Correct. ':'❌ Not quite. ')+item.why; qs('#quizNext').disabled=false; }; box.appendChild(b); });
  qs('#quizNext').onclick=()=>{ QUIZ.idx+=1; if(QUIZ.idx>=QUIZ.q.length){
      const best=Number(localStorage.getItem('flaresync_best')||0); if(QUIZ.score>best) localStorage.setItem('flaresync_best',String(QUIZ.score));
      body.innerHTML=`<div style="font-size:18px;font-weight:700;margin-bottom:8px">done!</div>
      <div>your score: <b>${QUIZ.score}/${QUIZ.q.length}</b> · best: <b>${Math.max(best,QUIZ.score)}</b></div>
      <div style="margin-top:10px;opacity:.85">tip: switch to <b>storm</b> mode and try again.</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="quizRestart" class="chip">restart</button>
        <button id="quizClose2" class="chip" style="margin-left:auto">close</button></div>`;
      qs('#quizRestart').onclick=()=>{ buildQuiz(); renderQuiz(); };
      qs('#quizClose2').onclick=()=>{ qs('#quizOverlay').classList.add('hidden'); };
    } else { renderQuiz(); } };
}
function wireQuiz(){
  const open1=qs('#quizBtn'), open2=qs('#openQuiz'), ov=qs('#quizOverlay'), close=qs('#quizClose');
  const open=()=>{ buildQuiz(); renderQuiz(); };
  if(open1) open1.onclick=open; if(open2) open2.onclick=open;
  if(close) close.onclick=()=>ov.classList.add('hidden');
  ov.addEventListener('click',e=>{ if(e.target===ov) ov.classList.add('hidden'); });
}

// ---------- tabs / overlays ----------
function wireTabs(){
  const learnOv = qs('#learnOverlay');
  const expOv   = qs('#exploreOverlay');
  const storyOv = qs('#storyOverlay');
  const show = (el)=>{ el.classList.remove('hidden'); el.style.display='flex'; };
  const hide = (el)=>{ el.classList.add('hidden'); };

  qs('#btnOverview').onclick = ()=>{ hide(learnOv); hide(expOv); hide(storyOv); };
  qs('#btnLearn').onclick    = ()=>{ hide(expOv); hide(storyOv); show(learnOv); };
  qs('#btnExplore').onclick  = ()=>{ hide(learnOv); hide(storyOv); show(expOv); };
  qs('#btnStory').onclick    = ()=>{ hide(learnOv); hide(expOv); show(storyOv); renderStory(); };

  qs('#learnClose').onclick  = ()=> hide(learnOv);
  qs('#exploreClose').onclick= ()=> hide(expOv);

  storyOv.addEventListener('click',e=>{ if(e.target===storyOv) hide(storyOv); });
  qs('#storyClose').onclick  = ()=> hide(storyOv);
}

// ---------- replay scrubber ----------
function wireReplay(){
  const r = qs('#replayRange'); const back = qs('#replayLive');
  if(!r) return;
  r.oninput = e=>{
    const min = Number(e.target.value||0);
    state.replayOffsetMin = min;
    stars.material.opacity = min? 0.25 : 0.5;
    updateHUD();
  };
  back.onclick = ()=>{ state.replayOffsetMin=0; r.value=0; stars.material.opacity=0.5; updateHUD(); };
}

// ---------- view buttons ----------
function wireViews(){
  const o=qs('#viewOrbits'), a=qs('#viewAurora'), s=qs('#viewSpectro');
  if(o) o.onclick=()=>setView('orbits');
  if(a) a.onclick=()=>setView('aurora');
  if(s) s.onclick=()=>setView('spectro');
}

// ---------- STORY (complete, self-contained) ----------
function svgBanner(){return `<svg viewBox="0 0 520 120" class="illust"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd685"/><stop offset="1" stop-color="#ff6f61"/></linearGradient></defs><circle cx="70" cy="60" r="40" fill="url(#g1)"/><circle cx="200" cy="60" r="22" fill="#4fc3f7"/><rect x="240" y="30" width="120" height="60" rx="12" fill="#112241" stroke="#1e2a44"/><text x="300" y="68" text-anchor="middle" fill="#cfe2ff" font-size="16">Choose a path</text></svg>`;}
function svgPilot(){return `<svg viewBox="0 0 520 120" class="illust"><rect x="0" y="0" width="520" height="120" fill="#071225"/><circle cx="80" cy="60" r="38" fill="#9bd4ff"/><rect x="140" y="44" width="320" height="32" rx="16" fill="#132a4d"/><text x="300" y="65" text-anchor="middle" fill="#d8e9ff" font-size="14">Maya checks HF comms before polar hop</text></svg>`;}
function svgFarmer(){return `<svg viewBox="0 0 520 120" class="illust"><rect width="520" height="120" fill="#0a1a2f"/><rect x="0" y="70" width="520" height="50" fill="#1f3a26"/><circle cx="90" cy="40" r="28" fill="#ffd685"/><text x="300" y="64" text-anchor="middle" fill="#eaf5ff" font-size="14">Jules scans the sky: is tonight the night?</text></svg>`;}
function svgAstro(){return `<svg viewBox='0 0 520 120' class='illust'><rect width='520' height='120' fill='#030b18'/><circle cx='60' cy='60' r='26' fill='#fff3b0'/><rect x='160' y='34' width='320' height='52' rx='8' fill='#0e1b2b' stroke='#1c2d52'/><text x='320' y='65' text-anchor='middle' fill='#cfe2ff' font-size='14'>Ari readies for a spacewalk during high Kp</text></svg>`;}
function svgCME(){return `<svg viewBox='0 0 520 120' class='illust'><rect width='520' height='120' fill='#100a14'/><circle cx='60' cy='60' r='30' fill='#ffb46a'/><path d='M100,60 Q200,10 300,60 T500,60' fill='none' stroke='#ff6f61' stroke-width='3'/><text x='320' y='70' text-anchor='middle' fill='#ffe9e0' font-size='14'>Sol the CME races outward…</text></svg>`;}

const STORY = {
  start:{title:"Choose a perspective",
    text:"Space weather touches many lives. Whose eyes will you borrow?",
    svg:svgBanner,
    choices:[{label:"Maya · polar pilot",next:"pilot1"},{label:"Jules · high-lat farmer",next:"farmer1"},{label:"Ari · astronaut",next:"astro1"},{label:"Sol · a traveling CME",next:"cme1"}]},

  // Pilot path
  pilot1:{title:"Maya hears static",
    text:"Over the Arctic, HF radio grows patchy. Bz is dipping southward; Kp is rising.",
    svg:svgPilot,
    choices:[{label:"Climb 2,000 ft to a quieter layer",next:"pilot2a"},{label:"Hold altitude, reroute via satcom",next:"pilot2b"}]},
  pilot2a:{title:"Climb",
    text:"The air smooths and HF noise eases. A window opens between ionospheric layers.",
    svg:svgPilot,
    choices:[{label:"Push across the pole",next:"pilot3"},{label:"Turn back—safety first",next:"endSafe"}]},
  pilot2b:{title:"Reroute",
    text:"Satcom is stable but costly. Dispatch approves the fuel plan for a longer arc.",
    svg:svgPilot,
    choices:[{label:"Take the arc",next:"pilot3"},{label:"Divert to alternate",next:"endSafe"}]},
  pilot3:{title:"Touchdown",
    text:"Maya lands on schedule. The log notes: kp 6. HF degraded, procedures worked.",
    svg:svgPilot,
    choices:[{label:"Try another role",next:"start"}]},

  // Farmer path
  farmer1:{title:"Jules watches the sky",
    text:"Forecast whispers of aurora. Southward Bz would help. Clouds are thin.",
    svg:svgFarmer,
    choices:[{label:"Drive to the dark ridge",next:"farmer2a"},{label:"Stay home; check GPS drift on tractor",next:"farmer2b"}]},
  farmer2a:{title:"The ridge",
    text:"A green arc blooms. Cameras click; neighbors cheer as curtains ripple.",
    svg:svgFarmer,
    choices:[{label:"Time-lapse the substorm",next:"farmer3"},{label:"Head back before dawn",next:"endWarm"}]},
  farmer2b:{title:"Back on the farm",
    text:"GPS nudges off by meters during peaks. Old fence lines help re-align rows.",
    svg:svgFarmer,
    choices:[{label:"File notes for next season",next:"farmer3"}]},
  farmer3:{title:"Aurora diary",
    text:"Jules posts shots and tips—watch Bz, mind Moon, chase the gap.",
    svg:svgFarmer,
    choices:[{label:"Try another role",next:"start"}]},

  // Astronaut path
  astro1:{title:"Ari preps the suit",
    text:"Solar wind speed is up. Flight rules: EVA only if radiation risk low.",
    svg:svgAstro,
    choices:[{label:"Delay EVA until kp drops",next:"astro2a"},{label:"Proceed with extra dosimetry",next:"astro2b"}]},
  astro2a:{title:"Delay",
    text:"The storm eases overnight. Tomorrow’s window looks clear.",
    svg:svgAstro,
    choices:[{label:"Begin EVA",next:"astro3"}]},
  astro2b:{title:"Proceed carefully",
    text:"Dosimeters ping but stay within limits. The repair is quick.",
    svg:svgAstro,
    choices:[{label:"Log lessons learned",next:"astro3"}]},
  astro3:{title:"Earthrise",
    text:"Blue glow, thin shield. Ari logs the storm: awe and respect.",
    svg:svgAstro,
    choices:[{label:"Try another role",next:"start"}]},

  // CME path
  cme1:{title:"Sol awakens",
    text:"A loop snaps; plasma billows. Sol hurtles into the heliosphere—curious, hot-headed.",
    svg:svgCME,
    choices:[{label:"Aim for Earth’s magnetic doorway",next:"cme2a"},{label:"Veer harmlessly aside",next:"endKind"}]},
  cme2a:{title:"Encounter",
    text:"Earth’s field meets Sol. Southward tilt? Doors open—energy pours in.",
    svg:svgCME,
    choices:[{label:"Spark aurora for the nightfolk",next:"cme3"},{label:"Rattle radios for a moment",next:"cme3"}]},
  cme3:{title:"Dissipate",
    text:"Spent and stretched, Sol fades into the wind. Stories remain in skyglow.",
    svg:svgCME,
    choices:[{label:"Choose a human view",next:"start"}]},

  // endings
  endSafe:{title:"Safe choices",
    text:"Storms reward prudence. You traded time for safety—textbook.",
    svg:svgBanner,
    choices:[{label:"Back to start",next:"start"}]},
  endWarm:{title:"Warm dawn",
    text:"You caught the glow and still made the morning milking. Perfect.",
    svg:svgBanner,
    choices:[{label:"Back to start",next:"start"}]},
  endKind:{title:"Kind space",
    text:"Most eruptions miss us. Space weather is often a gentle breeze.",
    svg:svgBanner,
    choices:[{label:"Back to start",next:"start"}]}
};

let storyId = localStorage.getItem('flaresync_story') || 'start';
let storyUtter = null;
function renderStory(){
  const node = STORY[storyId] || STORY.start;
  const body = qs('#storyBody');
  const makeChoice = (next)=>{ storyId = next; localStorage.setItem('flaresync_story', storyId); renderStory(); };
  body.innerHTML = `
    <div class="card">
      <h4>${node.title}</h4>
      <div class="storyWrap">
        ${node.svg? node.svg() : ''}
        <div class="storyText">${node.text}</div>
      </div>
      <div class="choices">
        ${(node.choices||[]).map(c=>`<button class="chip choiceBtn" data-next="${c.next}">${c.label}</button>`).join('')}
      </div>
    </div>
    <div class="mini">Tip: your choices change the path. Progress autosaves.</div>`;
  body.querySelectorAll('.choiceBtn').forEach(btn=>{
    btn.onclick = () => makeChoice(btn.getAttribute('data-next'));
  });
}
function wireStory(){
  qs('#storyRestart').onclick = ()=>{
    storyId='start';
    localStorage.setItem('flaresync_story', storyId);
    renderStory();
  };
  qs('#storyRead').onclick = ()=>{
    try{
      if(storyUtter){ speechSynthesis.cancel(); storyUtter=null; return; }
      const node = STORY[storyId] || STORY.start;
      const text = `${node.title}. ${node.text}`;
      storyUtter = new SpeechSynthesisUtterance(text);
      storyUtter.onend = ()=>{ storyUtter=null; };
      speechSynthesis.speak(storyUtter);
    }catch{}
  };
}

// ---------- boot ----------
window.addEventListener('load', async ()=>{
  initAudio(); initScene();
  qs('#muteBtn').onclick=setMute; qs('#vol').oninput=e=>setVolume(Number(e.target.value));
  const modeSel=qs('#modeSel'); applyMode(modeSel.value); modeSel.onchange=e=>applyMode(e.target.value);
  qs('#hcChk').onchange=e=>document.body.classList.toggle('hc', e.target.checked);
  qs('#notifToggle').onchange=async e=>{ if(e.target.checked) await ensureNotifications(); };

  wireTabs(); wireReplay(); wireQuiz(); wireViews(); wireStory();

  await seedHistory();
  await loadSpaceWeather(); loadKp().catch(()=>{});
  await loadDonki();

  setInterval(loadSpaceWeather, 30000);
  setInterval(loadKp,         5*60*1000);
  setInterval(loadDonki,     15*60*1000);

  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos=>{
      state.geo={lat:pos.coords.latitude,lng:pos.coords.longitude}; updateForecastUI(); updateMiniHud();
    },()=>{ /* blocked */ });
  }

  setView('orbits'); // default camera
});
