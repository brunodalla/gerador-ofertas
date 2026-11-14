// Produtos sem o Gerador de Ofertas: colar a lista do cliente e achar as fotos no Banco de Produtos.
import {norm} from './engine.js';

// ---------- lista colada (WhatsApp, e-mail, planilha copiada) ----------
const MONEY=/(?:r\$\s*)?(\d{1,4}(?:\.\d{3})*[.,]\d{2})(?!\d)/gi;
export function parseLista(text){
  const out=[];
  for(let raw of String(text||'').split(/\r?\n/)){
    let line=raw.replace(/[*_~]/g,' ').replace(/\t+/g,' ; ').replace(/\s+/g,' ').trim();
    if(!line) continue;
    // "limite de 24 un" e observações entre parênteses viram campos à parte
    let limite='', obs='';
    line=line.replace(/[(\-–—,;]?\s*\blimite\s*(?:de\s*)?(\d+\s*[a-zç]*)\s*(?:por\s+cliente)?\)?/i,(m,a)=>{ limite=a.toUpperCase().replace(/^(\d+)\s*(UN|UNID\w*)$/,'$1 UND'); return ' '; }).replace(/\s+/g,' ').trim();
    line=line.replace(/\((exceto[^)]*|casco[^)]*|sabores[^)]*|nesta embalagem[^)]*)\)/i,(m,a)=>{ obs=a.toUpperCase(); return ' '; }).replace(/\s+/g,' ').trim();
    const prices=[...line.matchAll(MONEY)];
    if(!prices.length) continue;               // títulos, datas e linhas sem preço ficam de fora
    const first=prices[0].index;
    let name=line.slice(0,first);
    const after=line.slice(first);
    const vals=prices.map(m=>parseFloat(m[1].replace(/\.(?=\d{3})/g,'').replace(',','.')));
    const clubWord=/clube|club|s[oó]cio|cart[aã]o|app/i.test(line);
    let price='',club='';
    if(vals.length>=2){ price=Math.max(vals[0],vals[1]); club=Math.min(vals[0],vals[1]); if(price===club) club=''; }
    else if(clubWord&&/clube|club|s[oó]cio|cart[aã]o|app/i.test(after.slice(0,40)+name.slice(-25))) club=vals[0];
    else price=vals[0];
    // unidade: "KG" perto do preço ("o kg", "/kg", "kg 19,90") ou nome terminando em KG sem número antes
    const near=(name.slice(-12)+' '+after).toLowerCase();
    let unit='UND';
    if(/(\/\s*kg|\bo\s*kg\b|\bkg\b\s*(r\$)?\s*\d|\d[.,]\d{2}\s*(o\s*)?(kg|quilo)\b|\bquilo\b)/.test(near)||/(^|[^\d\s])\s*kg\s*$/i.test(name.trim())) unit='KG';
    else if(/100\s*g\b/i.test(after)) unit='100G';
    name=name.replace(/r\$\s*$/i,'').replace(/\b(por|apenas|só|so|de|clube|club|no clube|pre[cç]o)\s*[:\-–—]*\s*$/i,'')
      .replace(/^[\s\-–—•·*\d.)]+(?=[A-Za-zÀ-ú])/,'').replace(/[\s:;,\-–—|/]+$/,'').trim();
    if(unit==='KG') name=name.replace(/\s*(\/\s*)?\b(kg|o kg)\s*$/i,'').trim();
    if(!name) continue;
    out.push({limite,obs,name:name.toUpperCase(),price:price===''?'':price.toFixed(2).replace('.',','),club:club===''?'':club.toFixed(2).replace('.',','),unit});
  }
  return out;
}

// ---------- Banco de Produtos (a mesma pasta que o Gerador usa) ----------
const STOP=new Set(['de','da','do','das','dos','com','e','em','para','sem','tipo','un','und','unid','pct','pacote','lata','cx','caixa','pt','emb','embalagem','photoroom','png','transparente','sem','fundo']);
export function tokens(s){
  s=norm(s).replace(/(\d+(?:\s\d+)?)\s*(kg|g|gr|grs|ml|l|lt|lts|litros?|un|m|mts?)\b/g,(m,n,u)=>n.replace(' ','')+({gr:'g',grs:'g',lt:'l',lts:'l',litro:'l',litros:'l',mts:'m',mt:'m'}[u]||u));
  return s.split(' ').filter(t=>t&&!STOP.has(t)&&(t.length>1||/\d/.test(t)));
}
export const BANK={dir:null,items:[],df:new Map(),name:''};
const IDBkey='video.dir.banco';
// ---------- Google Drive (o mesmo login e a mesma pasta "BANCO DE PRODUTOS" do Gerador) ----------
const GD={token:null,exp:0,tc:null};
const GAPI='https://www.googleapis.com/drive/v3/files', GD_FOLDER='application/vnd.google-apps.folder';
const GD_CLIENT='66049641578-h1c7p9n6tkoi06li0qbk2m9d8kj7ssb0.apps.googleusercontent.com';
function gdClientId(){ try{ return localStorage.getItem('gd.client')||GD_CLIENT; }catch(e){ return GD_CLIENT; } }
export function gdLoadGis(){
  if(window.google&&google.accounts&&google.accounts.oauth2) return Promise.resolve();
  if(gdLoadGis.p) return gdLoadGis.p;
  return gdLoadGis.p=new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://accounts.google.com/gsi/client'; s.async=true; s.onload=res; s.onerror=()=>{ gdLoadGis.p=null; rej(new Error('não consegui carregar o login do Google (internet?)')); }; document.head.append(s); });
}
function gdLogin(){
  return new Promise(async(res,rej)=>{
    try{ await gdLoadGis(); }catch(e){ return rej(e); }
    const cid=gdClientId();
    if(!GD.tc||GD.tc._cid!==cid){ GD.tc=google.accounts.oauth2.initTokenClient({client_id:cid,scope:'https://www.googleapis.com/auth/drive',callback:()=>{}}); GD.tc._cid=cid; }
    GD.tc.callback=r=>{ if(r.error) return rej(new Error(r.error_description||r.error)); GD.token=r.access_token; GD.exp=Date.now()+((+r.expires_in||3600)-60)*1000; res(); };
    GD.tc.error_callback=e=>rej(new Error(e&&e.type==='popup_closed'?'janela do Google fechada':'login do Google cancelado'));
    GD.tc.requestAccessToken({prompt:''});
  });
}
async function gdFetch(url){
  if(!GD.token||Date.now()>GD.exp) throw new Error('A conexão com o Google expirou. Toque em "Conectar Banco de Produtos" de novo.');
  const r=await fetch(url,{headers:{Authorization:'Bearer '+GD.token}});
  if(r.status===401){ GD.token=null; throw new Error('A conexão com o Google expirou. Toque em "Conectar Banco de Produtos" de novo.'); }
  if(!r.ok) throw new Error('Drive '+r.status+': '+(await r.text()).slice(0,160));
  return r;
}
async function gdList(q){
  let out=[], pt='';
  do{ const u=`${GAPI}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime)')}&pageSize=1000&spaces=drive${pt?'&pageToken='+pt:''}`;
    const r=await (await gdFetch(u)).json(); out=out.concat(r.files||[]); pt=r.nextPageToken; }while(pt);
  return out;
}
// pasta do Drive com os mesmos métodos de uma pasta do computador (só leitura)
class GFile{ constructor(f){ this.kind='file'; this.name=f.name; this.id=f.id; this._mod=Date.parse(f.modifiedTime)||0; this._f=null; }
  async getFile(){ if(this._f) return this._f; const b=await (await gdFetch(`${GAPI}/${this.id}?alt=media`)).blob(); return this._f=new File([b],this.name,{lastModified:this._mod,type:b.type}); } }
class GDir{ constructor(id,name){ this.id=id; this.name=name; this.kind='directory'; this._c=null; }
  async _list(){ if(this._c) return this._c; const m=new Map(); for(const f of await gdList(`'${this.id}' in parents and trashed=false`)) if(f.mimeType!==GD_FOLDER) m.set(f.name.normalize('NFC'),new GFile(f)); return this._c=m; }
  async *entries(){ for(const e of await this._list()) yield e; }
  async getFileHandle(n){ const h=(await this._list()).get(String(n).normalize('NFC')); if(!h) throw new DOMException(n+' não encontrado','NotFoundError'); return h; } }
async function gdBank(){
  await gdLogin();
  const q=`name='BANCO DE PRODUTOS' and mimeType='${GD_FOLDER}' and trashed=false`;
  const b=(await gdList(q+` and 'root' in parents`))[0]||(await gdList(q))[0];
  if(!b) throw new Error('Não achei a pasta "BANCO DE PRODUTOS" no seu Google Drive.');
  try{ localStorage.setItem('video.banco.via','drive'); }catch(e){}
  return new GDir(b.id,b.name+' (Google Drive)');
}
export const usaDrive=()=>{ if(!window.showDirectoryPicker) return true; try{ const v=localStorage.getItem('video.banco.via'); return v==='drive'||(v!=='pasta'&&localStorage.getItem('gd.on')==='1'); }catch(e){ return false; } };

// via: 'pasta' (pasta do computador), 'drive' (Google) ou automático
export async function bankConnect(IDB,interactive,via=''){
  let h=null;
  if(!via&&usaDrive()) via='drive';
  if(via!=='drive'){
    h=await IDB.get(IDBkey).catch(()=>null)||await IDB.get('dir.banco').catch(()=>null);
    if(h&&typeof h.queryPermission!=='function') h=null;   // o Gerador guarda a pasta do Drive de outro jeito
  }
  if(h){
    let p=await h.queryPermission({mode:'read'});
    if(p!=='granted'&&interactive) p=await h.requestPermission({mode:'read'});
    if(p!=='granted') return {need:true,name:h.name};
  } else {
    if(!interactive) return {need:true,drive:usaDrive()};
    if(via==='drive') h=await gdBank();
    else { h=await window.showDirectoryPicker({id:'banco',mode:'read'}); await IDB.set(IDBkey,h); try{ localStorage.setItem('video.banco.via','pasta'); }catch(e){} }
  }
  BANK.dir=h; BANK.name=h.name;
  let index={}; try{ const fh=await h.getFileHandle('_indice.json'); for(const e of JSON.parse(await (await fh.getFile()).text())) if(e.file) index[e.file]=e; }catch(e){}
  const items=[];
  for await (const [n,fh] of h.entries()){
    if(fh.kind!=='file'||!/\.(png|webp|jpe?g)$/i.test(n)||n.startsWith('_')) continue;
    const name=(index[n]&&index[n].name)||n.replace(/\.[^.]+$/,'').replace(/\s\(\d+\)$/,'');
    items.push({file:n,name,handle:fh,tk:[...new Set(tokens(name))]});
  }
  const df=new Map(); for(const it of items) for(const t of it.tk) df.set(t,(df.get(t)||0)+1);
  BANK.items=items; BANK.df=df;
  return {ok:true,count:items.length,name:h.name};
}
function idf(t){ const N=BANK.items.length||1; let v=Math.log((N+1)/((BANK.df.get(t)||0)+0.5)); if(/^\d/.test(t)) v*=0.6; return Math.max(0,v); }
export function bankSearch(query,n=24){
  const q=[...new Set(tokens(query))]; if(!q.length||!BANK.items.length) return [];
  const total=q.reduce((a,t)=>a+idf(t),0)||1;
  const res=[];
  for(const it of BANK.items){
    let s=0; for(const t of q){ if(it.tk.includes(t)) s+=idf(t); else if(t.length>=5&&it.tk.some(x=>x.length>=5&&(x.startsWith(t.slice(0,5))||t.startsWith(x.slice(0,5))))) s+=idf(t)*0.6; }
    if(s>0) res.push({it,score:s/total});
  }
  return res.sort((a,b)=>b.score-a.score).slice(0,n);
}
export async function bankFile(file){ const it=BANK.items.find(i=>i.file===file); return it?await it.handle.getFile():null; }
