// Página "Vídeo de ofertas" (pasta /video/ do Gerador de Ofertas). Só o chat dos vídeos mexe aqui.
import * as E from './engine.js';
import {parseLista,BANK,bankConnect,bankSearch,bankFile} from './banco.js';

const $=(q,el=document)=>el.querySelector(q);
const el=(tag,attrs={},...kids)=>{ const e=document.createElement(tag); for(const [k,v] of Object.entries(attrs)){ if(k==='class') e.className=v; else if(k.startsWith('on')) e.addEventListener(k.slice(2),v); else if(k==='value') e.value=v; else if(v!==false&&v!=null) e.setAttribute(k,v===true?'':v); } for(const k of kids.flat()) if(k!=null) e.append(k.nodeType?k:document.createTextNode(k)); return e; };
function toast(msg,kind=''){ const t=el('div',{class:'toast '+kind},msg); $('#toasts').append(t); setTimeout(()=>t.remove(),kind==='err'?10000:5000); }
const st=(id,txt,cls='')=>{ const s=$('#'+id); s.textContent=txt; s.className='st '+cls; };
const fmtT=s=>`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;

// ---------- armazenamento (mesmo banco do Gerador de Ofertas: mesmo site) ----------
const IDB={db:null,
  async open(){ if(this.db) return this.db; this.db=await new Promise((res,rej)=>{ const r=indexedDB.open('gerador-ofertas'); r.onupgradeneeded=()=>{ if(!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); return this.db; },
  async get(k){ const db=await this.open(); return new Promise(res=>{ const q=db.transaction('kv').objectStore('kv').get(k); q.onsuccess=()=>res(q.result); q.onerror=()=>res(undefined); }); },
  async set(k,v){ const db=await this.open(); return new Promise(res=>{ const t=db.transaction('kv','readwrite'); t.objectStore('kv').put(v,k); t.oncomplete=res; t.onerror=res; }); },
  async del(k){ const db=await this.open(); return new Promise(res=>{ const t=db.transaction('kv','readwrite'); t.objectStore('kv').delete(k); t.oncomplete=res; t.onerror=res; }); },
  async keys(prefix){ const db=await this.open(); return new Promise(res=>{ const q=db.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess=()=>res((q.result||[]).filter(k=>typeof k==='string'&&k.startsWith(prefix))); q.onerror=()=>res([]); }); }
};
const LS={get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }, set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }};
const FALADO_KEY='video.falado.v1';
let FALADO=LS.get(FALADO_KEY,{});
async function sha(s){ const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)); return [...new Uint8Array(b)].slice(0,12).map(x=>x.toString(16).padStart(2,'0')).join(''); }

// ---------- estado ----------
const V={models:[],model:null,base:'',A:null,job:null,seg:new Map(),imgs:new Map(),busy:false,lastBlob:null};
const cfgKey=()=>'video.cfg.'+V.model.id;
const cfg=()=>LS.get(cfgKey(),{});
const setCfg=patch=>LS.set(cfgKey(),{...cfg(),...patch});
const newId=()=>Math.random().toString(36).slice(2,10);

function blankJob(){ return {id:newId(),title:'',model:V.model.id,from:'',to:'',val:'',intro:cfg().intro||V.model.textos.intro,fim:cfg().fim||V.model.textos.fim,items:[],at:Date.now()}; }
let saveT=null;
function saveJob(){ clearTimeout(saveT); saveT=setTimeout(async()=>{ if(!V.job) return; V.job.at=Date.now(); await IDB.set('vjob:'+V.job.id,V.job); await IDB.set('vjob.last',V.job.id); },400); }

// ---------- modelos ----------
async function loadModels(){
  V.models=await (await fetch('modelos/index.json',{cache:'no-cache'})).json();
  const s=$('#sel-model'); s.innerHTML=''; for(const m of V.models) s.append(el('option',{value:m.id},m.nome));
  s.onchange=()=>setModel(s.value);
}
async function setModel(id){
  V.base=`modelos/${id}/`;
  V.model=await (await fetch(V.base+'modelo.json',{cache:'no-cache'})).json();
  $('#sel-model').value=id; V.A=null; V.assetsP=null;
  if(V.job) V.job.model=id;
  elStatus();
}
async function assets(){
  if(V.A) return V.A;
  if(!V.assetsP) V.assetsP=E.loadAssets(V.base,V.model,s=>st('st-render','Carregando '+s+'…')).then(A=>{ V.A=A; st('st-render',''); return A; }).catch(e=>{ V.assetsP=null; throw e; });
  return V.assetsP;
}

// ---------- produtos ----------
function itemFalado(it){ return it.falado||FALADO[E.norm(it.name)]||E.nomeFaladoAuto(it.name); }
async function itemImg(it){
  if(!it.img) return null;
  if(V.imgs.has(it.id)) return V.imgs.get(it.id);
  const p=createImageBitmap(it.img).then(trimBitmap).catch(()=>null); V.imgs.set(it.id,p); return p;
}
// corta a transparência em volta do produto
async function trimBitmap(bmp){
  const c=new OffscreenCanvas(bmp.width,bmp.height), x=c.getContext('2d'); x.drawImage(bmp,0,0);
  const d=x.getImageData(0,0,c.width,c.height).data; let x0=c.width,y0=c.height,x1=-1,y1=-1;
  for(let y=0;y<c.height;y+=2) for(let i=0;i<c.width;i+=2){ if(d[(y*c.width+i)*4+3]>12){ if(i<x0)x0=i; if(i>x1)x1=i; if(y<y0)y0=y; if(y>y1)y1=y; } }
  if(x1<0) return bmp;
  x0=Math.max(0,x0-2); y0=Math.max(0,y0-2); x1=Math.min(c.width-1,x1+2); y1=Math.min(c.height-1,y1+2);
  return createImageBitmap(c,x0,y0,x1-x0+1,y1-y0+1);
}
function renderItems(){
  const box=$('#items'); box.innerHTML='';
  if(!V.job.items.length){ box.append(el('div',{class:'st'},'Nenhum produto ainda. Cole a lista que o cliente mandou em "Colar lista de produtos", traga do Gerador de Ofertas ou adicione um por um em "+ Produto".')); return; }
  V.job.items.forEach((it,i)=>{
    const th=el('div',{class:'th',title:'Trocar a foto',onclick:()=>pickImage(it)});
    if(it.img){ th.style.backgroundImage=`url(${URL.createObjectURL(it.img)})`; th.classList.add('has'); }
    const upd=(k,v)=>{ it[k]=v; E.resetLayouts([it]); saveJob(); say.textContent='🔊 '+E.fraseOferta({...it,falado:itemFalado(it)},V.model); renderSegs(); };
    const say=el('div',{class:'say'},'🔊 '+E.fraseOferta({...it,falado:itemFalado(it)},V.model));
    const fal=el('input',{value:itemFalado(it),title:'Como a voz lê o produto',onchange:e=>{ const v=e.target.value.trim(); it.falado=v; if(v&&v!==E.nomeFaladoAuto(it.name)){ FALADO[E.norm(it.name)]=v; } else delete FALADO[E.norm(it.name)]; LS.set(FALADO_KEY,FALADO); upd('falado',v); }});
    const row=el('div',{class:'it'+(it.on?'':' off')},
      el('input',{type:'checkbox',title:'Entra no vídeo',checked:it.on!==false,onchange:e=>{ it.on=e.target.checked; row.classList.toggle('off',!it.on); saveJob(); renderSegs(); }}),
      th,
      el('div',{style:'display:grid;gap:6px'},
        el('div',{class:'fs'},
          el('label',{class:'f'},'Texto na tela',el('input',{value:it.tela||it.name,onchange:e=>{ const v=e.target.value; if(!it.name||it.name==='PRODUTO'||it.name===it.tela){ it.name=v.toUpperCase(); if(!it.falado) fal.value=itemFalado(it); } upd('tela',v); if(!it.img) autoImage(it).then(ok=>{ if(ok){ saveJob(); renderItems(); } }); }})),
          el('label',{class:'f'},'Preço normal',el('input',{value:it.price??'',placeholder:'4,99',onchange:e=>upd('price',e.target.value)})),
          el('label',{class:'f'},'Preço clube',el('input',{value:it.club??'',placeholder:'(sem)',onchange:e=>upd('club',e.target.value)})),
          el('label',{class:'f'},'Unidade',el('input',{value:it.unit||'UND',onchange:e=>upd('unit',e.target.value.toUpperCase())})),
          el('label',{class:'f wide'},'Nome falado',fal)),
        say),
      el('div',{class:'ord'},
        el('button',{title:'Subir',disabled:i===0,onclick:()=>{ V.job.items.splice(i-1,0,V.job.items.splice(i,1)[0]); saveJob(); renderItems(); renderSegs(); }},'▲'),
        el('button',{title:'Descer',disabled:i===V.job.items.length-1,onclick:()=>{ V.job.items.splice(i+1,0,V.job.items.splice(i,1)[0]); saveJob(); renderItems(); renderSegs(); }},'▼'),
        el('button',{title:'Tirar da lista',onclick:()=>{ V.job.items.splice(i,1); saveJob(); renderItems(); renderSegs(); }},'✕')));
    box.append(row);
  });
}
// ---------- fotos: Banco de Produtos, arquivo ou imagem colada ----------
const IMGMEM_KEY='video.img.v1'; let IMGMEM=LS.get(IMGMEM_KEY,{});
function setItemImg(it,blob,file){ it.img=blob; V.imgs.delete(it.id); if(file){ IMGMEM[E.norm(it.name)]=file; LS.set(IMGMEM_KEY,IMGMEM); } saveJob(); renderItems(); }
async function autoImage(it){
  if(it.img||!BANK.items.length) return false;
  const mem=IMGMEM[E.norm(it.name)]; let f=mem?await bankFile(mem):null;
  if(!f){ const r=bankSearch(it.name,1)[0]; if(r&&r.score>=0.7) f=await r.it.handle.getFile(); }
  if(f){ it.img=f; V.imgs.delete(it.id); return true; } return false;
}
async function bankStatus(interactive=false){
  const b=$('#btn-bank');
  try{
    const r=await bankConnect(IDB,interactive);
    if(r.ok){ b.textContent=`Banco: ${r.count} fotos ✓`; b.title=r.name; return true; }
    b.textContent=r.name?`Reabrir banco (${r.name})`:'Conectar Banco de Produtos';
  }catch(e){ if(e.name!=='AbortError') toast(e.message,'err'); }
  return false;
}
let PICK=null;
async function pickImage(it){
  PICK=it; const d=$('#dlg-img'), q=$('#img-q'), grid=$('#img-grid');
  $('#img-for').textContent=it.tela||it.name;
  const show=async()=>{
    grid.innerHTML='';
    if(!BANK.items.length){ grid.append(el('div',{class:'st'},'Banco de Produtos não conectado. Toque em "Conectar banco" ou envie um arquivo.')); return; }
    const res=bankSearch(q.value,30);
    if(!res.length){ grid.append(el('div',{class:'st'},'Nada encontrado. Tente outras palavras.')); return; }
    for(const r of res){
      const card=el('div',{class:'pk',title:r.it.name,onclick:async()=>{ setItemImg(it,await r.it.handle.getFile(),r.it.file); d.close(); }},el('div',{class:'pth'}),el('div',{class:'pn'},r.it.name));
      grid.append(card);
      r.it.handle.getFile().then(f=>{ card.querySelector('.pth').style.backgroundImage=`url(${URL.createObjectURL(f)})`; });
    }
  };
  q.value=it.name; q.oninput=()=>{ clearTimeout(q._t); q._t=setTimeout(show,250); };
  $('#img-bank').onclick=async()=>{ if(await bankStatus(true)) show(); };
  $('#img-file').onclick=()=>{ $('#file-img').value=''; $('#file-img').click(); };
  d.onpaste=e=>{ const f=[...(e.clipboardData?.files||[])].find(f=>f.type.startsWith('image/')); if(f){ setItemImg(it,f); d.close(); } };
  $('#img-paste').onclick=async()=>{ try{ for(const ci of await navigator.clipboard.read()){ const t=ci.types.find(t=>t.startsWith('image/')); if(t){ setItemImg(it,await ci.getType(t)); d.close(); return; } } toast('Não tem imagem copiada.','err'); }catch(e){ toast('Use Ctrl+V com a janela aberta.','err'); } };
  d.showModal(); show();
}
$('#file-img').onchange=async e=>{ const f=e.target.files[0]; if(!f||!PICK) return; setItemImg(PICK,f); $('#dlg-img').close(); PICK=null; };
// colar a lista de produtos como o cliente manda
function openLista(){
  const d=$('#dlg-list'); $('#list-txt').value=''; $('#list-prev').textContent='';
  $('#list-txt').oninput=()=>{ const r=parseLista($('#list-txt').value); $('#list-prev').textContent=r.length?r.map(x=>`• ${x.name} — ${x.club?`R$ ${x.club} clube (normal ${x.price||'—'})`:`R$ ${x.price}`}${x.unit!=='UND'?' '+x.unit:''}`).join('\n'):'Nenhuma linha com preço ainda.'; };
  const go=async replace=>{
    const r=parseLista($('#list-txt').value); if(!r.length){ toast('Não achei preços na lista.','err'); return; }
    const novos=r.map(x=>({id:newId(),name:x.name,tela:x.name,price:x.price,club:x.club,unit:x.unit,img:null,on:true}));
    V.job.items=replace?novos:V.job.items.concat(novos); d.close();
    if(!BANK.items.length) await bankStatus(true);
    let n=0; for(const it of novos) if(await autoImage(it)) n++;
    saveJob(); renderItems(); renderSegs();
    toast(`${novos.length} produtos adicionados${BANK.items.length?` · ${n} com foto do banco`:''}. Confira as fotos tocando nelas.`);
  };
  $('#list-add').onclick=()=>go(false); $('#list-rep').onclick=()=>go(true);
  d.showModal(); $('#list-txt').focus();
}
// "06/11" ou "06/11/2026" (como o Gerador guarda) → "2026-11-06"
function isoDate(s){
  s=String(s||'').trim(); if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m=/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s); if(!m) return '';
  const now=new Date(); let y=m[3]?(+m[3]<100?2000+ +m[3]:+m[3]):now.getFullYear();
  if(!m[3]&&+m[2]<now.getMonth()+1-6) y++;
  return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
}
// escolher só os produtos que o cliente pediu (na ordem dos cliques = ordem no vídeo)
function pickProducts(h){
  return new Promise(res=>{
    const d=$('#dlg-pick'), box=$('#pick-list'), sel=[];
    $('#pick-title').textContent=`Escolha os produtos do vídeo (${h.items.length} no trabalho "${h.title||'Gerador de Ofertas'}")`;
    box.innerHTML='';
    const btnOk=$('#pick-ok');
    const upd=()=>{ box.querySelectorAll('.pk').forEach(c=>{ const i=sel.indexOf(+c.dataset.i); c.classList.toggle('on',i>=0); c.querySelector('.num').textContent=i>=0?i+1:''; }); btnOk.textContent=`Usar ${sel.length} produto${sel.length===1?'':'s'}`; btnOk.disabled=!sel.length; };
    h.items.forEach((x,i)=>{
      const club=x.club!=null&&x.club!==''; const v=E.parseMoney(club?x.club:x.price);
      const th=el('div',{class:'pth'}); if(x.img) th.style.backgroundImage=`url(${URL.createObjectURL(x.img)})`;
      box.append(el('div',{class:'pk','data-i':i,onclick:()=>{ const k=sel.indexOf(i); if(k>=0) sel.splice(k,1); else sel.push(i); upd(); }},
        el('span',{class:'num'}),th,el('div',{class:'pn'},x.name),el('div',{class:'pp'},v!=null?E.precoTela(v)+(club?' clube':'')+(/KG/i.test(x.unit||'')?' kg':''):'')));
    });
    const done=v=>{ d.close(); btnOk.onclick=$('#pick-all').onclick=$('#pick-cancel').onclick=null; res(v); };
    btnOk.onclick=()=>done(sel.map(i=>h.items[i]));
    $('#pick-all').onclick=()=>done(h.items.slice());
    $('#pick-cancel').onclick=()=>done(null);
    d.oncancel=()=>res(null);
    upd(); d.showModal();
  });
}
async function fromGenerator(){
  const h=await IDB.get('video:handoff');
  if(!h||!h.items||!h.items.length){ toast('Nada para trazer. No Gerador de Ofertas, abra o trabalho e toque em "Gerar vídeo deste trabalho".','err'); return; }
  const chosen=await pickProducts(h);
  if(!chosen) return;
  const money=v=>{ const n=E.parseMoney(v); return n==null?'':n.toFixed(2).replace('.',','); };
  V.job.items=chosen.map(x=>({id:newId(),name:x.name,tela:x.name,price:money(x.price),club:money(x.club),unit:x.unit||'UND',img:x.img||null,on:true}));
  if(h.from) V.job.from=isoDate(h.from); if(h.to) V.job.to=isoDate(h.to)||V.job.from;
  if(!V.job.title&&h.title) V.job.title=h.title;
  V.job.val=E.datasTexto(V.job.from,V.job.to)||V.job.val;
  V.imgs.clear(); fillJobFields(); renderItems(); renderSegs(); saveJob();
  toast(`${V.job.items.length} produtos trazidos do Gerador de Ofertas.`);
}

// ---------- ElevenLabs ----------
const EL='https://api.elevenlabs.io';
const elKey=()=>LS.get('video.el.key','');
async function elFetch(path,opt={}){
  const r=await fetch(EL+path,{...opt,headers:{'xi-api-key':elKey(),...(opt.body?{'Content-Type':'application/json'}:{}),...(opt.headers||{})}});
  if(!r.ok){ let m=''; try{ const j=await r.json(); m=(j.detail&&(j.detail.message||j.detail.status||JSON.stringify(j.detail)))||JSON.stringify(j); }catch(e){ m=r.statusText; } const er=new Error(`ElevenLabs ${r.status}: ${m}`); er.status=r.status; er.msg=m; throw er; }
  return r;
}
function voiceSettings(){ const c=cfg(), v=V.model.voz; return {stability:c.stab??v.stability,similarity_boost:c.sim??v.similarity_boost,style:c.style??v.style??0,speed:c.speed??v.speed??1,use_speaker_boost:true}; }
async function elStatus(){
  if(!elKey()){ st('st-el','ElevenLabs não conectado','warn'); return; }
  const c=cfg(); st('st-el',c.voiceName?`Voz: ${c.voiceName}${c.modelName?' · '+c.modelName:''}`:'Escolha a voz em "ElevenLabs…"',c.voiceId?'ok':'warn');
}
async function elConnect(){
  const key=$('#el-key').value.trim(); if(!key){ st('el-st','Cole a chave.','bad'); return; }
  LS.set('video.el.key',key); st('el-st','Conectando…');
  try{
    const [vs,ms]=await Promise.all([elFetch('/v1/voices').then(r=>r.json()),elFetch('/v1/models').then(r=>r.json())]);
    const voices=(vs.voices||[]).sort((a,b)=>a.name.localeCompare(b.name));
    const models=(ms||[]).filter(m=>m.can_do_text_to_speech!==false);
    const c=cfg();
    const sv=$('#el-voice'); sv.innerHTML=''; for(const v of voices) sv.append(el('option',{value:v.voice_id},v.name+(v.category?` (${v.category})`:'')));
    const want=c.voiceId||(voices.find(v=>E.norm(v.name).includes(E.norm(V.model.voz.nome)))||{}).voice_id; if(want) sv.value=want;
    const sm=$('#el-model'); sm.innerHTML=''; for(const m of models) sm.append(el('option',{value:m.model_id},`${m.name} (${m.model_id})`));
    const wantM=c.modelId||(models.find(m=>/v4/i.test(m.model_id))||models.find(m=>m.model_id==='eleven_v3')||models.find(m=>/multilingual_v2/.test(m.model_id))||{}).model_id; if(wantM) sm.value=wantM;
    const vsx=voiceSettings(); $('#el-stab').value=vsx.stability; $('#el-sim').value=vsx.similarity_boost; $('#el-style').value=vsx.style; $('#el-speed').value=vsx.speed;
    const save=()=>{ setCfg({voiceId:sv.value,voiceName:sv.selectedOptions[0]?.textContent.replace(/ \(.*\)$/,''),modelId:sm.value,modelName:sm.selectedOptions[0]?.textContent.replace(/ \(.*\)$/,''),stab:+$('#el-stab').value,sim:+$('#el-sim').value,style:+$('#el-style').value,speed:+$('#el-speed').value}); elStatus(); renderSegs(); };
    for(const i of ['#el-voice','#el-model','#el-stab','#el-sim','#el-style','#el-speed']) $(i).onchange=save;
    save(); $('#el-cfg').hidden=false;
    st('el-st',`Conectado · ${voices.length} vozes`,'ok');
  }catch(e){ console.error(e); st('el-st',e.status===401?'Chave recusada pelo ElevenLabs.':'Não consegui conectar: '+e.message,'bad'); }
}
async function tts(text,{seed}={}){
  const c=cfg(); if(!c.voiceId) throw new Error('Escolha a voz em "ElevenLabs…".');
  const body={text,model_id:c.modelId,voice_settings:voiceSettings()}; if(seed!=null) body.seed=seed;
  // com marcação de tempo de cada letra: serve para saber quando o locutor fala o preço
  const go=b=>elFetch(`/v1/text-to-speech/${c.voiceId}/with-timestamps?output_format=mp3_44100_128`,{method:'POST',body:JSON.stringify(b)});
  let r;
  try{ r=await go(body); }
  catch(e){
    // alguns modelos só aceitam certos valores de stability, ou não aceitam speed/style
    if(e.status===400||e.status===422){ const b2={...body,voice_settings:{stability:[0,0.5,1].reduce((a,x)=>Math.abs(x-body.voice_settings.stability)<Math.abs(a-body.voice_settings.stability)?x:a,0.5),similarity_boost:body.voice_settings.similarity_boost}}; r=await go(b2); }
    else throw e;
  }
  const j=await r.json();
  const bin=atob(j.audio_base64), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  return {ab:u.buffer,al:j.alignment||null};
}

// ---------- locução (trechos) ----------
const introVideo=()=>!!V.model.intro.audio&&V.job.introVideo!==false;
const fimVideo=()=>!!V.model.assina.audio&&V.job.fimVideo!==false;
function segList(){
  const its=V.job.items.filter(i=>i.on!==false);
  return [introVideo()?null:{key:'intro',label:'Abertura',text:V.job.intro.trim()},
    ...its.map((it,i)=>{ const club=it.club!=null&&it.club!==''; const v=E.parseMoney(club?it.club:it.price); return {key:'o:'+it.id,label:`Oferta ${i+1}`,text:E.fraseOferta({...it,falado:itemFalado(it)},V.model),preco:v!=null?E.precoFalado(v):null}; }),
    fimVideo()?null:{key:'fim',label:'Final',text:V.job.fim.trim()}].filter(s=>s&&s.text);
}
// em que segundo da fala começa o preço (pela marcação do ElevenLabs; sem ela, estimativa pela posição no texto)
function precoTempo(s,rec){
  if(!s.preco) return null;
  let idx=s.text.indexOf(s.preco); if(idx<0){ const m=/\d/.exec(s.text.slice(Math.max(0,s.text.length-40))); idx=m?s.text.length-40+m.index:-1; } if(idx<0) return null;
  const al=rec.al;
  if(al&&al.character_start_times_seconds&&al.character_start_times_seconds[idx]!=null) return Math.max(0,al.character_start_times_seconds[idx]-rec.offset);
  return rec.buf.duration*idx/s.text.length;
}
async function segHash(s){ const c=cfg(); return sha([c.voiceId,c.modelId,JSON.stringify(voiceSettings()),s.text].join('|')); }
async function segAudio(s,{create=false,fresh=false}={}){
  const h=await segHash(s); const k='tts:'+h;
  const cur=V.seg.get(s.key); if(!fresh&&cur&&cur.hash===h&&cur.buf) return cur.buf;
  let rec=fresh?null:await IDB.get(k);
  if(rec instanceof ArrayBuffer) rec={ab:rec,al:null};
  if(!rec){ if(!create) return null; rec=await tts(s.text,{seed:fresh?Math.floor(Math.random()*4e9):undefined}); await IDB.set(k,rec); }
  const tr=E.trimSilence(await E.decodeAudio(rec.ab));
  const r={hash:h,buf:tr.buf,offset:tr.offset,al:rec.al}; r.preco=precoTempo(s,r);
  V.seg.set(s.key,r); return tr.buf;
}
let PLAYING=null;
function play(buf){ if(PLAYING){ try{ PLAYING.stop(); }catch(e){} } const ac=new AudioContext(); const s=ac.createBufferSource(); s.buffer=buf; s.connect(ac.destination); s.start(); PLAYING=s; }
let SEGRUN=0;
async function renderSegs(){
  const run=++SEGRUN; const box=document.createDocumentFragment();
  const list=segList(); let missing=0;
  for(const s of list){
    const buf=await segAudio(s).catch(()=>null); if(!buf) missing++;
    const info=el('span',{class:'st '+(buf?'ok':'')},buf?`${buf.duration.toFixed(1)} s`:'falta gerar');
    box.append(el('div',{class:'seg'},el('div',{class:'t'},s.label),el('div',{},s.text),
      el('div',{class:'row'},info,
        el('button',{disabled:!buf,onclick:()=>play(buf)},'▶'),
        el('button',{title:'Gerar de novo este trecho (outra leitura)',onclick:async e=>{ e.target.disabled=true; info.textContent='gerando…'; try{ const b=await segAudio(s,{create:true,fresh:true}); play(b); renderSegs(); }catch(er){ toast(er.message,'err'); info.textContent='erro'; e.target.disabled=false; } }},buf?'Refazer':'Gerar'))));
  }
  if(run!==SEGRUN) return;   // outra atualização começou depois desta
  $('#segs').replaceChildren(box);
  $('#btn-tts').textContent=missing?`Gerar locução (${missing} trecho${missing>1?'s':''})`:'Locução pronta ✓';
  $('#btn-tts').disabled=!missing;
  updTimeline();
}
async function genAll(){
  if(!elKey()){ $('#dlg-el').showModal(); return; }
  if(!cfg().voiceId){ $('#dlg-el').showModal(); await elConnect(); return; }
  const list=segList(); $('#btn-tts').disabled=true; let n=0;
  try{
    for(const s of list){ st('st-tts',`Gerando ${s.label}…`); const had=await segAudio(s); if(!had){ await segAudio(s,{create:true}); n++; } }
    st('st-tts',n?`${n} trecho(s) gerado(s).`:'Nada novo para gerar.','ok');
  }catch(e){ console.error(e); st('st-tts',e.message,'bad'); toast(e.message,'err'); }
  renderSegs();
}

// ---------- linha do tempo e render ----------
async function currentTimeline(){
  const items=V.job.items.filter(i=>i.on!==false);
  const list=segList(); const by=new Map(); for(const s of list) by.set(s.key,await segAudio(s));
  const voices={intro:by.get('intro')||null,fim:by.get('fim')||null,ofertas:items.map(it=>{ const b=by.get('o:'+it.id); return b?{buf:b,preco:V.seg.get('o:'+it.id)?.preco??null}:null; })};
  const tl=E.buildTimeline(V.model,items,voices,true,{introVideo:introVideo(),fimVideo:fimVideo()});
  return {tl,items,voices,missing:list.filter(s=>!by.get(s.key)).length};
}
async function updTimeline(){
  if(!V.job.items.some(i=>i.on!==false)){ $('#timeline').textContent=''; return; }
  const {tl,missing}=await currentTimeline();
  const offers=tl.parts.filter(p=>p.type==='oferta').map(p=>(p.end-p.start).toFixed(1)+'s');
  $('#timeline').textContent=`Duração: ${fmtT(tl.T)} (${tl.T.toFixed(1)} s) · abertura ${tl.parts[0].end.toFixed(1)}s · ofertas ${offers.join(', ')} · assinatura ${(tl.T-tl.parts[tl.parts.length-1].start).toFixed(1)}s${missing?` · faltam ${missing} trecho(s) de locução (as ofertas sem fala ficam com o tempo mínimo)`:''}`;
}
async function imgsFor(items){ return Promise.all(items.map(itemImg)); }
async function thumbs(){
  const box=$('#thumbs'); box.innerHTML=''; st('st-render','Montando quadros…');
  try{
    const A=await assets(); const {tl,items}=await currentTimeline(); const imgs=await imgsFor(items); E.resetLayouts(items);
    const big=document.createElement('canvas'); big.width=V.model.w; big.height=V.model.h; const ctx=big.getContext('2d');
    for(const p of tl.parts.filter(p=>p.type==='oferta')){
      await E.drawFrameAt(ctx,tl,V.model,A,imgs,V.job.val,p.start+Math.min(1.6,(p.end-p.start)*0.7));
      const c=document.createElement('canvas'); c.width=360; c.height=640; c.getContext('2d').drawImage(big,0,0,360,640); box.append(c);
    }
    st('st-render','');
  }catch(e){ console.error(e); st('st-render','Erro: '+e.message,'bad'); }
}
let ABORT=null;
async function render(){
  if(V.busy){ if(ABORT) ABORT.abort(); return; }
  const {missing}=await currentTimeline();
  if(missing&&!confirm(`Faltam ${missing} trecho(s) de locução. Gerar o vídeo mesmo assim?`)) return;
  V.busy=true; ABORT=new AbortController(); const b=$('#btn-render'); b.textContent='Cancelar';
  $('#out').innerHTML='';
  try{
    const A=await assets();
    const {tl,items}=await currentTimeline(); const imgs=await imgsFor(items); E.resetLayouts(items);
    st('st-render','Mixando o áudio…');
    const audio=await E.mixAudio(tl,A,V.model,{musicDb:+$('#in-mdb').value});
    st('st-render','Gerando o vídeo…');
    const blob=await E.renderMp4({tl,model:V.model,A,imgs,datas:V.job.val,audio,signal:ABORT.signal,onProgress:(p,s)=>{ $('#prog').style.width=(p*100).toFixed(1)+'%'; st('st-render',`Gerando o vídeo… ${Math.round(p*100)}% · ${Math.round(s)} s`); }});
    V.lastBlob=blob;
    const name=(V.job.title||V.model.nome).replace(/[\\/:*?"<>|·]+/g,' ').replace(/\s+/g,' ').trim()+'.mp4';
    const url=URL.createObjectURL(blob);
    const share=navigator.canShare&&navigator.canShare({files:[new File([blob],name,{type:'video/mp4'})]});
    $('#out').append(el('video',{class:'out',src:url,controls:true}),el('div',{class:'row',style:'margin-top:8px'},
      el('a',{class:'btn',href:url,download:name},'Baixar MP4'),
      window.showSaveFilePicker?el('button',{onclick:async()=>{ try{ const h=await window.showSaveFilePicker({suggestedName:name,id:'video-saidas',types:[{description:'Vídeo MP4',accept:{'video/mp4':['.mp4']}}]}); const w=await h.createWritable(); await w.write(blob); await w.close(); toast('Vídeo salvo: '+h.name); }catch(e){ if(e.name!=='AbortError') toast('Não consegui salvar: '+e.message,'err'); } }},'Salvar na pasta…'):null,
      share?el('button',{onclick:()=>navigator.share({files:[new File([blob],name,{type:'video/mp4'})]}).catch(()=>{})},'Compartilhar'):null,
      el('span',{class:'st'},`${(blob.size/1e6).toFixed(1)} MB · ${tl.T.toFixed(1)} s`)));
    st('st-render','Vídeo pronto ✓','ok');
  }catch(e){ console.error(e); st('st-render',e.message==='cancelado'?'Cancelado.':'Erro: '+e.message,e.message==='cancelado'?'':'bad'); if(e.message!=='cancelado') toast(e.message,'err'); }
  finally{ V.busy=false; ABORT=null; b.textContent='Gerar vídeo MP4'; }
}

// ---------- trabalhos ----------
function fillJobFields(){ $('#in-title').value=V.job.title||''; $('#in-from').value=V.job.from||''; $('#in-to').value=V.job.to||''; $('#in-val').value=V.job.val||''; $('#in-intro').value=V.job.intro||''; $('#in-fim').value=V.job.fim||'';
  for(const [ck,lb,on,has] of [['#ck-intro','#lb-intro',introVideo(),!!V.model.intro.audio],['#ck-fim','#lb-fim',fimVideo(),!!V.model.assina.audio]]){ $(ck).checked=on; $(ck).disabled=!has; $(ck).parentElement.hidden=!has; $(lb).hidden=on; }
}
async function openJobs(){
  const box=$('#jobs-list'); box.innerHTML='Carregando…'; $('#dlg-jobs').showModal();
  const keys=await IDB.keys('vjob:'); const jobs=[]; for(const k of keys){ const j=await IDB.get(k); if(j) jobs.push(j); }
  jobs.sort((a,b)=>b.at-a.at); box.innerHTML='';
  box.append(el('button',{onclick:async()=>{ V.job=blankJob(); V.seg.clear(); V.imgs.clear(); fillJobFields(); renderItems(); renderSegs(); saveJob(); $('#dlg-jobs').close(); }},'+ Vídeo novo (vazio)'));
  for(const j of jobs) box.append(el('div',{class:'row',style:'justify-content:space-between;border-bottom:1px solid var(--line);padding:4px 0'},
    el('div',{},el('b',{},j.title||'(sem nome)'),el('div',{class:'st'},`${new Date(j.at).toLocaleString('pt-BR')} · ${j.items.length} produtos`)),
    el('div',{class:'row'},el('button',{class:'pri',onclick:async()=>{ await openJob(j); $('#dlg-jobs').close(); }},'Abrir'),el('button',{class:'lnk',onclick:async e=>{ await IDB.del('vjob:'+j.id); e.target.closest('.row').parentElement.remove(); }},'✕'))));
}
async function openJob(j){ V.job=j; V.seg.clear(); V.imgs.clear(); if(j.model&&j.model!==V.model.id) await setModel(j.model); fillJobFields(); renderItems(); renderSegs(); }

// ---------- início ----------
async function init(){
  await loadModels();
  const lastId=await IDB.get('vjob.last'); const last=lastId?await IDB.get('vjob:'+lastId):null;
  await setModel((last&&last.model)||V.models[0].id);
  V.job=last||blankJob();
  // veio do botão "Gerar vídeo deste trabalho": traz os produtos novos
  const h=await IDB.get('video:handoff');
  if(location.hash==='#gerador'&&h&&h.items&&h.items.length&&(!V.job.handoffAt||V.job.handoffAt<h.at)){
    V.job=blankJob(); V.job.handoffAt=h.at; await openJob(V.job); await fromGenerator(); history.replaceState(null,'',location.pathname);
  }
  fillJobFields(); renderItems(); renderSegs(); elStatus();
  $('#in-title').onchange=e=>{ V.job.title=e.target.value; saveJob(); };
  const dates=()=>{ V.job.from=$('#in-from').value; V.job.to=$('#in-to').value; V.job.val=E.datasTexto(V.job.from,V.job.to); $('#in-val').value=V.job.val; saveJob(); };
  $('#in-from').onchange=dates; $('#in-to').onchange=dates;
  $('#in-val').onchange=e=>{ V.job.val=e.target.value.toUpperCase(); e.target.value=V.job.val; saveJob(); };
  $('#in-intro').onchange=e=>{ V.job.intro=e.target.value; setCfg({intro:V.job.intro}); saveJob(); renderSegs(); };
  $('#in-fim').onchange=e=>{ V.job.fim=e.target.value; setCfg({fim:V.job.fim}); saveJob(); renderSegs(); };
  $('#btn-from-gen').onclick=fromGenerator;
  $('#ck-intro').onchange=e=>{ V.job.introVideo=e.target.checked; saveJob(); fillJobFields(); renderSegs(); };
  $('#ck-fim').onchange=e=>{ V.job.fimVideo=e.target.checked; saveJob(); fillJobFields(); renderSegs(); };
  $('#btn-add').onclick=()=>{ V.job.items.push({id:newId(),name:'PRODUTO',tela:'PRODUTO',price:'',club:'',unit:'UND',img:null,on:true}); saveJob(); renderItems(); renderSegs(); };
  $('#btn-list').onclick=openLista;
  $('#btn-bank').onclick=()=>bankStatus(true);
  $('#btn-new').onclick=async()=>{ if(V.job.items.length&&!confirm('Começar um vídeo novo? Este fica guardado em "Vídeos anteriores".')) return; await openJob(blankJob()); saveJob(); };
  bankStatus(false);
  $('#btn-tts').onclick=genAll;
  $('#btn-thumbs').onclick=thumbs;
  $('#btn-render').onclick=render;
  $('#in-mdb').value=cfg().mdbv||'0'; $('#in-mdb').onchange=e=>setCfg({mdbv:e.target.value}); 
  $('#btn-jobs').onclick=openJobs;
  $('#btn-el').onclick=()=>{ $('#el-key').value=elKey(); $('#dlg-el').showModal(); if(elKey()) elConnect(); };
  $('#el-load').onclick=elConnect; $('#el-close').onclick=()=>{ $('#dlg-el').close(); renderSegs(); };
  assets().catch(e=>st('st-render','Não consegui carregar o modelo: '+e.message,'bad'));
}
window.addEventListener('hashchange',()=>{ if(location.hash==='#gerador') location.reload(); });
init().catch(e=>{ console.error(e); toast('Erro ao abrir: '+e.message,'err'); });
// para testes
window.__V=V; window.__E=E;
