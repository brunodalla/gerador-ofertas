// Produtos sem o Gerador de Ofertas: colar a lista do cliente e achar as fotos no Banco de Produtos.
import {norm} from './engine.js';

// ---------- lista colada (WhatsApp, e-mail, planilha copiada) ----------
const MONEY=/(?:r\$\s*)?(\d{1,4}(?:\.\d{3})*[.,]\d{2})(?!\d)/gi;
export function parseLista(text){
  const out=[];
  for(let raw of String(text||'').split(/\r?\n/)){
    let line=raw.replace(/[*_~]/g,' ').replace(/\t+/g,' ; ').replace(/\s+/g,' ').trim();
    if(!line) continue;
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
    out.push({name:name.toUpperCase(),price:price===''?'':price.toFixed(2).replace('.',','),club:club===''?'':club.toFixed(2).replace('.',','),unit});
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
export async function bankConnect(IDB,interactive){
  let h=await IDB.get('dir.banco').catch(()=>null)||await IDB.get(IDBkey).catch(()=>null);
  if(h&&typeof h.queryPermission!=='function') h=null;   // no celular o Gerador usa o Drive; aqui só a pasta do computador
  if(h){
    let p=await h.queryPermission({mode:'read'});
    if(p!=='granted'&&interactive) p=await h.requestPermission({mode:'read'});
    if(p!=='granted') return {need:true,name:h.name};
  } else {
    if(!interactive) return {need:true};
    if(!window.showDirectoryPicker) throw new Error('Este navegador não abre pastas do computador. Use o Chrome ou o Edge no computador.');
    h=await window.showDirectoryPicker({id:'banco',mode:'read'}); await IDB.set(IDBkey,h);
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
