// Motor do vídeo de ofertas: textos falados, linha do tempo, trilha, mixagem, desenho dos quadros e MP4.
// Usado pela página /video/ (app.js). Não depende do index.html do Gerador de Ofertas.
import {Input,ALL_FORMATS,UrlSource,BlobSource,CanvasSink,Output,Mp4OutputFormat,BufferTarget,CanvasSource,AudioBufferSource,canEncodeVideo,canEncodeAudio} from './lib/mediabunny.min.mjs';

export const SR=48000;

// ---------------- textos falados ----------------
export const norm=s=>(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function parseMoney(v){ if(v==null||v==='') return null; if(typeof v==='number') return v; const s=String(v).replace(/[^\d,.\-]/g,''); if(!s) return null; const t=s.includes(',')?s.replace(/\./g,'').replace(',','.'):s; const n=parseFloat(t); return isFinite(n)?n:null; }
export function splitPrice(v){ const c=Math.round(v*100); return {int:String(Math.floor(c/100)), cents:String(c%100).padStart(2,'0')}; }
export function precoFalado(v){ const p=splitPrice(v); return p.cents==='00'?`${p.int} reais`:`${p.int} e ${p.cents}`; }
export function precoTela(v){ const p=splitPrice(v); return `R$ ${p.int},${p.cents}`; }
const lowerFirst=s=>s.charAt(0).toUpperCase()+s.slice(1);
// nome do produto como a voz lê melhor (as mesmas trocas que o Bruno faz à mão)
export function nomeFaladoAuto(name){
  let s=' '+(name||'').toLowerCase().replace(/\s+/g,' ')+' ';
  s=s.replace(/\([^)]*\)/g,' ');
  s=s.replace(/\b(pacote|pct|embalagem|emb)\s+(com|c\/)\s+/g,' ');
  s=s.replace(/\s(lata|pet|pote|frasco|sache|sachê|garrafa)\s/g,' ');
  s=s.replace(/(\d+(?:[.,]\d+)?)\s*ml\b/g,'$1 emiélis');
  s=s.replace(/(\d+(?:[.,]\d+)?)\s*(?:l|lt|lts|litros?)\b/g,(m,n)=>n==='1'?'1 litro':`${n} litros`);
  s=s.replace(/(\d+(?:[.,]\d+)?)\s*(?:kg|kgs|quilos?)\b/g,'$1kg');
  s=s.replace(/(\d+(?:[.,]\d+)?)\s*(?:g|gr|grs|gramas)\b/g,'$1g');
  s=s.replace(/(\d+)\s*(?:m|mt|mts|metros)\b/g,'$1 metros');
  s=s.replace(/(\d+)\s*(?:un|und|unid|unidades)\b/g,'$1 unidades');
  s=s.replace(/\s+/g,' ').trim();
  return lowerFirst(s);
}
export function unidadeFalada(unit,model){
  const u=(unit||'').toUpperCase();
  if(/KG/.test(u)&&!/UND/.test(u)) return ' o quilo';
  if(/100\s*G/.test(u)) return ' os cem gramas';
  if(model.textos.falaUnidade&&/UN|CADA/.test(u)) return ' a unidade';
  return '';
}
export function fraseOferta(it,model){
  if(it.fraseLivre&&it.fraseLivre.trim()) return it.fraseLivre.trim();
  const club=it.club!=null&&it.club!=='';
  const v=club?parseMoney(it.club):parseMoney(it.price);
  return model.textos.oferta
    .replace('{nome}',(it.falado||nomeFaladoAuto(it.name)).trim())
    .replace('{preco}',v!=null?precoFalado(v):'')
    .replace('{unidade}',unidadeFalada(it.unit,model))
    .replace('{clube}',club?' no clube':'')
    .replace(/\s+([,!.])/g,'$1').replace(/\s{2,}/g,' ');
}

// ---------------- datas da validade ----------------
const MESES=['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
export function datasTexto(from,to){
  const p=s=>{ if(!s) return null; const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m?{d:m[3],m:+m[2]-1}:null; };
  const a=p(from), b=p(to)||a; if(!a) return '';
  if(a.m===b.m&&a.d===b.d) return `${a.d} DE ${MESES[a.m]}`;
  if(a.m===b.m) return `${a.d} A ${b.d} DE ${MESES[a.m]}`;
  return `${a.d} DE ${MESES[a.m]} A ${b.d} DE ${MESES[b.m]}`;
}

// ---------------- áudio ----------------
let ACTX=null;
function actx(){ if(!ACTX) ACTX=new (window.AudioContext||window.webkitAudioContext)({sampleRate:SR}); return ACTX; }
export async function decodeAudio(arrayBuffer){ return await actx().decodeAudioData(arrayBuffer.slice(0)); }
// corta o silêncio do começo e do fim da locução (deixa uma folga curta); devolve também quanto cortou do começo
export function trimSilence(buf,thr=0.012,pad=0.04){
  const n=buf.length, ch=[...Array(buf.numberOfChannels)].map((_,i)=>buf.getChannelData(i));
  const loud=i=>ch.some(c=>Math.abs(c[i])>thr);
  let a=0; while(a<n&&!loud(a)) a++; let b=n-1; while(b>a&&!loud(b)) b--;
  a=Math.max(0,a-Math.round(pad*buf.sampleRate)); b=Math.min(n-1,b+Math.round(pad*1.5*buf.sampleRate));
  const out=new AudioBuffer({length:Math.max(1,b-a+1),numberOfChannels:buf.numberOfChannels,sampleRate:buf.sampleRate});
  for(let i=0;i<buf.numberOfChannels;i++) out.copyToChannel(ch[i].subarray(a,b+1),i);
  return {buf:out,offset:a/buf.sampleRate};
}
function rms(buf,from=0,to=buf.duration,thr=0.01){
  const c=buf.getChannelData(0), a=Math.floor(from*buf.sampleRate), b=Math.min(c.length,Math.floor(to*buf.sampleRate));
  let s=0,k=0; for(let i=a;i<b;i+=4){ const v=c[i]; if(Math.abs(v)>thr){ s+=v*v; k++; } } return k?Math.sqrt(s/k):0;
}

// ---------------- linha do tempo ----------------
// voices: {intro, fim, ofertas:[{buf, preco}]} (preco = segundos, dentro da fala, em que o preço começa)
// opts.introVideo / opts.fimVideo: usar o áudio que já vem no vídeo da intro / assinatura (locução, trilha e efeitos)
export function buildTimeline(model,items,voices,music,opts={}){
  const tm=model.tempos, tr=model.transicao, fps=model.fps, trFps=tr.fps||fps;
  const snap=t=>Math.round(t*fps)/fps;
  const introVideo=!!(opts.introVideo&&model.intro.audio), fimVideo=!!(opts.fimVideo&&model.assina.audio);
  const parts=[]; let t=0;
  // abertura: o vídeo da intro inteiro; com locução gerada mais longa, a intro segura o último quadro
  const vi=introVideo?null:voices.intro;
  let introEnd=model.intro.dur;
  if(vi) introEnd=Math.max(introEnd, tm.introVoz+vi.duration+0.25);
  parts.push({type:'intro',start:0,end:snap(introEnd),voice:vi?{buf:vi,at:tm.introVoz}:null,clip:introVideo?'intro':null});
  t=snap(introEnd);
  items.forEach((it,i)=>{
    const v=voices.ofertas[i];
    const d=Math.max(tm.ofertaMin,(v?v.buf.duration:0)+tm.ofertaVoz+tm.ofertaFolga);
    parts.push({type:'oferta',item:it,idx:i,start:t,end:snap(t+d),voice:v?{buf:v.buf,at:t+tm.ofertaVoz,preco:v.preco}:null});
    t=snap(t+d);
  });
  const vf=fimVideo?null:voices.fim;
  let aEnd=t+model.assina.dur;
  if(vf) aEnd=Math.max(aEnd,t+tm.assinaVoz+vf.duration+0.6);
  parts.push({type:'assina',start:t,end:snap(aEnd),voice:vf?{buf:vf,at:t+tm.assinaVoz}:null,clip:fimVideo?'assina':null});
  let T=snap(aEnd);
  // trilha: depois da intro com áudio próprio ela continua do ponto em que a intro parou (mesma música, sem corte);
  // o final da música cai no fim do vídeo; a sobra (menos de um compasso) vira tempo a mais nas ofertas
  // intro com trilha dentro (Detona): a trilha continua de onde a intro parou. Intro sem trilha: a trilha toca desde o começo, por baixo da intro.
  const introTemTrilha=introVideo&&model.intro.musicaDesde!=null;
  const mStart=introTemTrilha?parts[0].end:0;
  const songStart=introTemTrilha?(model.intro.musicaDesde+parts[0].end):model.trilha.inicio;
  let mus=null;
  if(music&&model.trilha.ateAssina){
    // trilha só por baixo das ofertas (Baratão): começa no fim da intro e para no corte da assinatura
    const fim=parts[parts.length-1].start, len=Math.max(0,fim-mStart);
    mus={pieces:[{from:songStart,to:Math.min(songStart+len,model.trilha.fimArquivo||1e9),at:mStart,ending:true}],extra:0,stopAt:fim};
  } else if(music){
    mus=planMusic(model.trilha,songStart,T-tm.fimFolga-mStart,mStart);
    if(mus.extra>0.001){
      const n=parts.filter(p=>p.type==='oferta').length||1;
      let shift=0;
      for(const p of parts){
        p.start=snap(p.start+shift); if(p.voice&&p.type!=='intro') p.voice.at+=shift;
        if(p.type==='oferta') shift+=mus.extra/n;
        p.end=snap(p.end+shift);
      }
      T=parts[parts.length-1].end;
      mus=planMusic(model.trilha,songStart,T-tm.fimFolga-mStart,mStart);
    }
  }
  // preço: momento (no tempo do vídeo) em que o locutor fala o preço
  for(const p of parts) if(p.type==='oferta'&&p.voice&&p.voice.preco!=null) p.precoAt=p.voice.at+p.voice.preco;
  // transições: o quadro que cobre a tela cai exatamente no corte entre dois trechos
  const trans=[]; for(let i=1;i<parts.length;i++){ const st=parts[i].start-tr.cobre/trFps; trans.push({cut:parts[i].start,start:st,audioAt:st+(tr.audioDesloc||0)}); }
  return {parts,T,trans,music:mus,frames:Math.round(T*fps),introVideo:introTemTrilha,fimVideo};
}
// pedaços da música (tempo da música → tempo do vídeo), cortes sempre no início de compasso
export function planMusic(m,songStart,length,offset=0){
  const bar=4*60/m.bpm, tail=m.para-m.finalCompasso;
  const Lb=Math.max(bar,length-tail);
  const pieces=[]; let bodyLen;
  const natural=m.finalCompasso-songStart;
  if(Lb<=natural){
    const k=Math.floor((natural-Lb)/bar+1e-6); const end=m.finalCompasso-k*bar;
    pieces.push({from:songStart,to:end,at:offset}); bodyLen=end-songStart;
  } else {
    pieces.push({from:songStart,to:m.finalCompasso,at:offset}); let at=natural, rem=Lb-natural; const loop=m.finalCompasso-m.loopDe;
    while(rem>loop+1e-6){ pieces.push({from:m.loopDe,to:m.finalCompasso,at:offset+at}); at+=loop; rem-=loop; }
    const k=Math.floor((loop-rem)/bar+1e-6); const end=m.finalCompasso-k*bar;
    pieces.push({from:m.loopDe,to:end,at:offset+at}); bodyLen=at+(end-m.loopDe);
  }
  pieces.push({from:m.finalCompasso,to:m.fimArquivo,at:offset+bodyLen,ending:true});
  return {pieces,extra:bodyLen-Lb,stopAt:offset+bodyLen+tail};
}

// mistura: áudio da intro/assinatura/transições + locução + trilha, num AudioBuffer estéreo do tamanho do vídeo
// trilha no mesmo volume em que ela toca dentro da intro (model.trilha.ganho); locução no nível da voz da intro (model.voz.nivel)
export async function mixAudio(tl,A,model,{musicDb=0}={}){
  const T=tl.T, len=Math.ceil(T*SR);
  const oc=new OfflineAudioContext(2,len,SR);
  // limitador no fim: segura só os picos (transição por cima da intro, etc.) sem baixar o resto
  const lim=oc.createDynamicsCompressor(); lim.threshold.value=-2; lim.knee.value=0; lim.ratio.value=20; lim.attack.value=0.002; lim.release.value=0.08;
  lim.connect(oc.destination);
  const OUT=lim;
  const voices=tl.parts.filter(p=>p.voice).map(p=>p.voice);
  let vr=0,vn=0; for(const v of voices){ const r=rms(v.buf); if(r){ vr+=r*r; vn++; } } vr=vn?Math.sqrt(vr/vn):0.1;
  const vg=(model.voz.nivel||0.25)/vr;
  const play=(buf,at,gain=1,dest=OUT)=>{ if(!buf) return; const s=oc.createBufferSource(); s.buffer=buf; const g=oc.createGain(); g.gain.value=gain; s.connect(g); g.connect(dest); const off=Math.max(0,-at); s.start(Math.max(0,at),off); };
  if(A.music&&tl.music){
    const g=(model.trilha.ganho||0.14)*Math.pow(10,musicDb/20);
    const master=oc.createGain(); master.connect(OUT);
    const mEnd=Math.min(T,tl.music.stopAt??T);
    master.gain.setValueAtTime(g,0); master.gain.setValueAtTime(g,Math.max(0,mEnd-0.3)); master.gain.linearRampToValueAtTime(0,mEnd);
    const X=0.012;
    tl.music.pieces.forEach((p,i)=>{
      const dur=Math.min(p.to-p.from,T-p.at); if(dur<=0) return;
      const s=oc.createBufferSource(); s.buffer=A.music; const gn=oc.createGain(); s.connect(gn); gn.connect(master);
      const a=p.at, b=p.at+dur, first=i===0;
      const fin=first?(tl.introVideo?X:0.03):X;
      gn.gain.setValueAtTime(0,Math.max(0,a-X)); gn.gain.linearRampToValueAtTime(1,a+(first&&!tl.introVideo?0.03:X));
      if(!p.ending){ gn.gain.setValueAtTime(1,b-X); gn.gain.linearRampToValueAtTime(0,b+X); }
      const pre=X; s.start(Math.max(0,a-pre),Math.max(0,p.from-pre),dur+pre+X);
    });
  }
  // áudio que vem nos vídeos (intro e assinatura) e o efeito de cada transição
  for(const p of tl.parts) if(p.clip&&A.clips[p.clip]){
    const buf=A.clips[p.clip], s=oc.createBufferSource(); s.buffer=buf; const g=oc.createGain(); s.connect(g); g.connect(OUT);
    const end=Math.min(p.end,p.start+buf.duration);
    g.gain.setValueAtTime(1,p.start); g.gain.setValueAtTime(1,Math.max(p.start,end-0.015)); g.gain.linearRampToValueAtTime(0,end);
    s.start(p.start,0,end-p.start);
  }
  if(A.clips.tr) for(const tr of tl.trans) play(A.clips.tr,tr.audioAt);
  for(const v of voices) play(v.buf,v.at,vg);
  const out=await oc.startRendering();
  // segurança: se passar de -1 dB, abaixa tudo junto
  let pk=0; for(let c=0;c<2;c++){ const d=out.getChannelData(c); for(let i=0;i<d.length;i++){ const a=Math.abs(d[i]); if(a>pk) pk=a; } }
  if(pk>0.95){ const k=0.95/pk; for(let c=0;c<2;c++){ const d=out.getChannelData(c); for(let i=0;i<d.length;i++) d[i]*=k; } }
  return out;
}
export function wavBlob(buf){
  const n=buf.length, ch=buf.numberOfChannels, b=new ArrayBuffer(44+n*ch*2), v=new DataView(b);
  const w=(o,s)=>{ for(let i=0;i<s.length;i++) v.setUint8(o+i,s.charCodeAt(i)); };
  w(0,'RIFF'); v.setUint32(4,36+n*ch*2,true); w(8,'WAVE'); w(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,ch,true);
  v.setUint32(24,buf.sampleRate,true); v.setUint32(28,buf.sampleRate*ch*2,true); v.setUint16(32,ch*2,true); v.setUint16(34,16,true); w(36,'data'); v.setUint32(40,n*ch*2,true);
  const d=[...Array(ch)].map((_,i)=>buf.getChannelData(i)); let o=44;
  for(let i=0;i<n;i++) for(let c=0;c<ch;c++){ const s=Math.max(-1,Math.min(1,d[c][i])); v.setInt16(o,s<0?s*0x8000:s*0x7fff,true); o+=2; }
  return new Blob([b],{type:'audio/wav'});
}

// ---------------- desenho ----------------
const F={int:'AntonX',desc:'MontR',old:'MontXB',val:'MontR',bk:'MontBk',sb:'MontSB'};
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const easeOut=t=>1-Math.pow(1-t,3);
const easeBack=(t,s=1.7)=>{ t=clamp(t)-1; return t*t*((s+1)*t+s)+1; };
const prog=(t,a,b)=>clamp((t-a)/(b-a));
const capCache={};
function capRatio(ctx,font,ch='H'){ const k=font+ch; if(capCache[k]) return capCache[k]; ctx.font=`100px ${font}`; const m=ctx.measureText(ch); return capCache[k]=m.actualBoundingBoxAscent/100; }
function wrap(ctx,text,maxW){
  const words=text.split(/\s+/).filter(Boolean), lines=[]; let cur='';
  for(const w of words){ const t=cur?cur+' '+w:w; if(ctx.measureText(t).width<=maxW||!cur) cur=t; else { lines.push(cur); cur=w; } }
  if(cur) lines.push(cur); return lines;
}
// mede o bloco de preço + descrição de uma oferta (valores tirados do vídeo de referência, quadro 1080x1920)
export function layoutOffer(ctx,it,model){
  const club=it.club!=null&&it.club!=='';
  const v=parseMoney(club?it.club:it.price)||0, p=splitPrice(v);
  const unit=(it.unit||'UND').toUpperCase().replace(/^UN$|^UNID$/,'UND');
  // model.detona: posição e tamanho do bloco de preço em cada modelo com este layout (padrão = Detona Preço)
  const D=(model&&model.detona)||{}, e=D.escala||1;
  const top=D.top??600;
  const L={club,p,unit,e};
  L.intSize=270*e/capRatio(ctx,F.int,'8'); ctx.font=`${L.intSize}px ${F.int}`; ctx.letterSpacing='0px'; L.intW=ctx.measureText(p.int).width;
  L.cSize=95*e/capRatio(ctx,F.int,'8'); ctx.font=`${L.cSize}px ${F.int}`; L.cW=ctx.measureText(p.cents).width;
  L.uSize=75*e/capRatio(ctx,F.int,'U'); ctx.font=`${L.uSize}px ${F.int}`; L.uW=ctx.measureText(unit).width;
  if(L.uW>L.cW*1.45){ L.uSize*=L.cW*1.45/L.uW; L.uW=L.cW*1.45; }
  L.colW=Math.max(L.cW,L.uW,60*e);
  // descrição
  const desc=(it.tela||it.name||'').toUpperCase().replace(/\s+/g,' ').trim();
  let ds=47, lines; const maxW=D.descW||380;
  for(;;){ ctx.font=`${ds}px ${F.desc}`; ctx.letterSpacing=(ds*0.05)+'px'; lines=wrap(ctx,desc,maxW); if(lines.length<=(club?4:5)||ds<32) break; ds*=0.92; }
  L.ds=ds; L.lines=lines; L.lineH=ds*1.235; L.descW=Math.max(...lines.map(l=>ctx.measureText(l).width),0);
  L.old=club&&parseMoney(it.price)?precoTela(parseMoney(it.price)):null;
  if(L.old){ ctx.font=`${ds*0.98}px ${F.old}`; ctx.letterSpacing='0px'; L.oldW=ctx.measureText(L.old).width; L.descW=Math.max(L.descW,L.oldW); }
  L.gap1=23*e; L.gap2=20;
  // onde o texto termina (para o "no CLUBE" não encostar na descrição)
  L.textBottom=top+L.ds*0.72+10+(L.lines.length-1+(L.old?1:0))*L.lineH+L.ds*0.3;
  L.tagY=Math.max(D.seloTopo??862,Math.round(L.textBottom+18)); L.tagX=D.seloX??598;
  const W=L.intW+L.gap1+L.colW+L.gap2+L.descW;
  L.x0=Math.max(118,Math.round(540-W/2)); L.top=top;
  return L;
}
// tamanho e posição do produto: cabe numa área de 880x980 em volta do centro (540,1390);
// it.esc = tamanho (1 = padrão), it.dx/it.dy = deslocamento, it.copias = 1 a 3 (produto repetido lado a lado)
export function productBoxes(img,it={},L=null,cfg=null){
  if(Array.isArray(img)) return productBoxesMulti(img,it,L,cfg);
  const ar=img.width/img.height, n=Math.max(1,Math.min(3,it.copias|0||1));
  // cópias de um produto largo (caixa de bombom): uma em cima da outra, como as fotos diferentes
  if(n>1&&arranjoDe([img],it)==='pilha') return productBoxesMulti(Array(n).fill(img),it,L,cfg);
  const step=0.62;                                   // quanto cada cópia anda para o lado (em larguras)
  const spanW=1+(n-1)*step;                          // largura total em larguras de um produto
  const C=cfg||{cx:540,topo:900,base:1880,maxW:880,area:400000};
  // área livre: do fim do texto (descrição longa empurra para baixo) até a base
  const top=Math.max(C.topo,L&&L.textBottom?L.textBottom+30:C.topo), bot=C.base, boxH=bot-top;
  let h=Math.min(boxH,C.maxW/(ar*spanW),Math.sqrt(C.area/(ar*(n>1?spanW*0.8:1))));
  h*=it.esc||1; const w=h*ar;
  const cx=C.cx+(it.dx||0), cy=top+boxH/2+(it.dy||0);
  const order=n===3?[0,2,1]:[...Array(n).keys()];  // a do meio na frente
  const boxes=order.map(i=>{ const ox=(i-(n-1)/2)*w*step; const back=n===3&&i!==1?0.92:1; const bw=w*back, bh=h*back;
    return {i,k:n-1-i,x:cx+ox-bw/2,y:cy+h/2-bh,w:bw,h:bh}; });
  return {cx,cy,boxes};
}
// fotos diferentes na mesma oferta (ex.: duas marcas). Caixas largas (bombom, biscoito) ficam uma em cima
// da outra; garrafas e embalagens altas ficam lado a lado. it.arranjo: 'auto' | 'lado' | 'pilha'
export function arranjoDe(imgs,it={}){
  if(it.arranjo==='lado'||it.arranjo==='pilha') return it.arranjo;
  const ars=imgs.map(i=>i.width/i.height), m=ars.reduce((a,b)=>a+b,0)/ars.length;
  return m>1.15?'pilha':'lado';
}
function productBoxesMulti(imgs,it={},L=null,cfg=null){
  const C=cfg||{cx:540,topo:900,base:1880,maxW:880,area:400000};
  const top=Math.max(C.topo,L&&L.textBottom?L.textBottom+30:C.topo), bot=C.base, boxH=bot-top;
  const ars=imgs.map(i=>i.width/i.height), n=imgs.length, cx=C.cx+(it.dx||0), cy=top+boxH/2+(it.dy||0);
  if(arranjoDe(imgs,it)==='pilha'){
    const ov=0.93;                                              // cada caixa desce 93% da altura da de cima
    const unitH=ars.reduce((s,a,i)=>s+(i<n-1?ov/a:1/a),0);       // altura total para largura 1
    let w=Math.min(C.maxW,boxH/unitH,Math.sqrt(C.area*1.3/unitH)); w*=it.esc||1;
    let y=cy-unitH*w/2;
    const boxes=imgs.map((img,i)=>{ const h=w/ars[i]; const b={i,k:i,img,x:cx-w/2,y,w,h}; y+=h*(i<n-1?ov:1); return b; });
    return {cx,cy,boxes};
  }
  const ov=0.88;                                                // cada foto anda 88% da largura da anterior
  const unitW=ars.reduce((s,a,i)=>s+(i<n-1?a*ov:a),0);         // largura total para altura 1
  let h=Math.min(boxH,C.maxW/unitW,Math.sqrt(C.area*1.25/unitW)); h*=it.esc||1;
  let x=cx-unitW*h/2;
  const boxes=imgs.map((img,i)=>{ const w=ars[i]*h; const b={i,k:n-1-i,img,x,y:cy-h/2,w,h}; x+=w*(i<n-1?ov:1); return b; });
  return {cx,cy,boxes};
}
// produto com as cópias entrando uma depois da outra (a da direita primeiro)
function drawProduct(ctx,img,P,t,copia=0){
  for(const b of P.boxes){ const im=b.img||img; popAt(ctx,t-b.k*copia,b.x+b.w/2,b.y+b.h/2,()=>ctx.drawImage(im,b.x,b.y,b.w,b.h)); }
}
function drawSkewText(ctx,text,x,y,skew=-0.2){ ctx.save(); ctx.translate(x,y); ctx.transform(1,0,skew,1,0,0); ctx.fillText(text,0,0); ctx.restore(); }
// desenha uma oferta no tempo local lt (segundos desde o corte da transição)
// ---- movimento medido no vídeo de referência (Detona Preço v11, quadro a quadro) ----
// "pop" com mola: nasce pequeno, passa ~19% do tamanho em 0,18 s, recua ~3,5% e assenta em ~0,5 s
const SPR={z:0.47,wd:17.5};
export function spring(t){
  if(t<=0) return 0;
  const w=SPR.wd/Math.sqrt(1-SPR.z*SPR.z), a=SPR.z*w;
  return 1-Math.exp(-a*t)*(Math.cos(SPR.wd*t)+(a/SPR.wd)*Math.sin(SPR.wd*t));
}
// quando cada parte entra, em segundos depois do corte da transição (medido no v11)
export const ENTRA={produto:0.43,inteiro:0.62,centavos:0.78,descricao:0.86,unidade:0.99,selo:1.0};
// pulo do preço quando o locutor fala: sobe devagar, acelera, segura e volta (curva do v11, pico +28%)
const PULO=[[0,0],[.04,.03],[.08,.05],[.12,.08],[.17,.24],[.21,.46],[.25,.65],[.29,.76],[.33,.84],[.37,.89],[.42,.95],[.46,.97],[.50,1],[.75,1],[.79,.97],[.87,.97],[.91,.95],[.96,.92],[1.0,.89],[1.04,.84],[1.08,.76],[1.12,.65],[1.16,.51],[1.21,.35],[1.25,.22],[1.29,.14],[1.33,.08],[1.37,.05],[1.42,0]];
function puloCurva(t){
  if(t<=0||t>=PULO[PULO.length-1][0]) return 0;
  for(let i=1;i<PULO.length;i++){ const [t1,v1]=PULO[i]; if(t<=t1){ const [t0,v0]=PULO[i-1]; const u=(t-t0)/(t1-t0); const k=u*u*(3-2*u); return v0+(v1-v0)*k; } }
  return 0;
}
// escala em volta de um ponto (ax,ay), com fade de entrada curtinho
function popAt(ctx,t,ax,ay,fn){
  if(t<=0) return; const s=spring(t); if(s<=0.001) return;
  ctx.save(); ctx.globalAlpha*=clamp(t/0.05); ctx.translate(ax,ay); ctx.scale(s,s); ctx.translate(-ax,-ay); fn(); ctx.restore();
}
// entrada "batida": nasce grande e encolhe até o lugar, com um pequeno rebote (logo e preço do Baratão)
function slamAt(ctx,t,ax,ay,fn,k=1.1){
  if(t<=0) return; const s=1+k*(1-spring(t));
  ctx.save(); ctx.globalAlpha*=clamp(t/0.06); ctx.translate(ax,ay); ctx.scale(s,s); ctx.translate(-ax,-ay); fn(); ctx.restore();
}
// bebida alcoólica: selo 18+ (Baratão)
export const ALCOOL=/\b(cerveja|chopp?|vinho|espumante|vodka|whisky|whiskey|uisque|cachaca|licor|gin|rum|conhaque|tequila|aperitivo|bebida mista|beats)\b/;
export function drawOffer(ctx,it,img,L,lt,A,precoLt=null,pulo=null,model=null){
  const e=L.e||1, intB=L.top+270*e, x0=L.x0, T=model&&model.entra?{...ENTRA,...model.entra}:ENTRA;
  const D=(model&&model.detona)||{};
  ctx.fillStyle='#fff'; ctx.textBaseline='alphabetic'; ctx.textAlign='left';
  // logos que entram a cada oferta (ex.: BARATÃO! e Proner)
  for(const g of D.logos||[]){ const im=A.img&&A.img[g.img]; if(!im) continue;
    const anim=g.anim==='slam'?slamAt:popAt; anim(ctx,lt-(T[g.entra]??g.entra??0),g.x+g.w/2,g.y+g.h/2,()=>ctx.drawImage(im,g.x,g.y,g.w,g.h)); }
  // produto: pop a partir do centro
  if(img){ const P=productBoxes(img,it,L,D.produto||null); drawProduct(ctx,img,P,lt-T.produto,0.06); }
  // 18+ nas bebidas alcoólicas
  const m18=D.mais18; if(m18&&(it.mais18??ALCOOL.test(norm(it.tela||it.name||'')))){
    popAt(ctx,lt-(T.mais18??T.selo),m18.x,m18.y,()=>{ ctx.save(); ctx.lineWidth=m18.r*0.17; ctx.strokeStyle=m18.cor||'#d7141e';
      ctx.beginPath(); ctx.arc(m18.x,m18.y,m18.r-ctx.lineWidth/2,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.font=`${m18.r*0.95}px MontB`; ctx.letterSpacing='-2px'; ctx.fillText('18+',m18.x,m18.y+m18.r*0.33); ctx.restore(); }); }
  const colX=x0+L.intW+L.gap1, cX=colX+L.colW/2;
  // ênfase quando o locutor fala o preço: cresce a partir do lado esquerdo do preço
  let bs=1;
  if(precoLt!=null&&pulo) bs=1+(pulo.escala||0.28)*puloCurva(lt-(precoLt-(pulo.antes??0.15)));
  ctx.save();
  if(bs!==1){ const gx=x0, gy=L.top+135*e; ctx.translate(gx,gy); ctx.scale(bs,bs); ctx.translate(-gx,-gy); }
  // inteiro + ponto: pop a partir do canto de baixo à esquerda (no Baratão entra "batido", do grande para o lugar)
  const intIn=D.inteiroBatido?slamAt:popAt, iax=D.inteiroBatido?x0+L.intW/2:x0, iay=D.inteiroBatido?intB-135*e:intB;
  intIn(ctx,lt-T.inteiro,iax,iay,()=>{ ctx.font=`${L.intSize}px ${F.int}`; ctx.letterSpacing='0px'; ctx.fillText(L.p.int,x0,intB); ctx.fillRect(colX-10*e,intB-53*e,55*e,53*e); });
  // centavos e unidade: pop a partir de baixo, no centro
  popAt(ctx,lt-T.centavos,cX,L.top+100*e,()=>{ ctx.font=`${L.cSize}px ${F.int}`; ctx.textAlign='center'; ctx.fillText(L.p.cents,cX,L.top+100*e); });
  popAt(ctx,lt-T.unidade,cX,L.top+190*e,()=>{ ctx.font=`${L.uSize}px ${F.int}`; ctx.textAlign='center'; ctx.fillText(L.unit,cX,L.top+190*e); });
  ctx.textAlign='left';
  ctx.restore();
  // descrição e preço antigo: pop a partir do centro do bloco
  { const x=colX+L.colW+L.gap2, cx=x+L.descW/2, cy=(L.top+L.textBottom)/2;
    popAt(ctx,lt-T.descricao,cx,cy,()=>{
      ctx.font=`${L.ds}px ${F.desc}`; ctx.letterSpacing=(L.ds*0.05)+'px';
      let y=L.top+L.ds*0.72+10; for(const ln of L.lines){ drawSkewText(ctx,ln,x,y); y+=L.lineH; }
      if(L.old){ ctx.font=`${L.ds*0.98}px ${F.old}`; ctx.letterSpacing='0px'; drawSkewText(ctx,L.old,x,y+2); }
    }); }
  // "no CLUBE": pop a partir do centro do selo
  if(L.club&&A.tag){ const se=D.seloEscala||1, tw=A.tag.width*se, th=A.tag.height*se, tx=L.tagX??598, ty=L.tagY||862;
    popAt(ctx,lt-T.selo,tx+tw/2,ty+th/2,()=>ctx.drawImage(A.tag,tx,ty,tw,th)); }
}
export function layoutFor(ctx,it,model){ return model.layout==='caixa'?layoutCaixa(ctx,it,model):layoutOffer(ctx,it,model); }
export function drawFor(ctx,it,img,L,lt,A,precoLt,model){ return model.layout==='caixa'?drawCaixa(ctx,it,img,L,lt,A,precoLt,model):drawOffer(ctx,it,img,L,lt,A,precoLt,model.precoPulo,model); }

// ---------------- layout "caixa" (Findi Iguatemi, Super Ofertas): nome + preço normal à esquerda, preço do clube numa caixa à direita ----------------
const TRK=-0.03;   // espaçamento das letras (-30 no Photoshop)
function setF(ctx,font,size){ ctx.font=`${size}px ${font}`; ctx.letterSpacing=(size*TRK)+'px'; }
function meas(ctx,font,size,t){ setF(ctx,font,size); const m=ctx.measureText(t); return {w:m.width,a:m.actualBoundingBoxAscent}; }
function rr(ctx,x,y,w,h,r,c){ ctx.fillStyle=c; ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fill(); }
// valor do limite: "24 UND", "5 PACK"... (aceita "LIMITE DE 24UN POR CLIENTE")
export function limiteValor(s){ s=String(s||'').toUpperCase().replace(/LIMITE\s*(DE)?/,'').replace(/POR\s+CLIENTE/,'').replace(/[()]/g,'').trim(); s=s.replace(/^(\d+)\s*(UN|UNID\w*)\b/,'$1 UND').replace(/^(\d+)([A-Z])/,'$1 $2'); return s; }
// quebra a observação em até 3 linhas parecidas
function obsLinhas(s){
  const w=String(s||'').toUpperCase().replace(/\s+/g,' ').trim().split(' ').filter(Boolean); if(!w.length) return [];
  if(w.length<=3) return w;                                   // EXCETO / ZERO / LACTOSE
  const last=w[w.length-1], num=/^R?\$?\d/.test(last);         // "... SAI POR 2,79": o número fica sozinho na última linha
  const rest=num?w.slice(0,-1):w;
  const n=num?2:Math.min(3,Math.max(2,Math.round(rest.join(' ').length/13)));
  const per=rest.join(' ').length/n, L=[]; let cur='';
  for(const x of rest){ if(cur&&(cur.length+1+x.length/2)>per&&L.length<n-1){ L.push(cur); cur=x; } else cur=cur?cur+' '+x:x; }
  if(cur) L.push(cur); if(num) L.push(last); return L;
}
// texto em linhas, cada linha do mesmo comprimento (como nas caixas de limite do Photoshop)
function boxLines(ctx,lines,font,x,y,w,h,color){
  const W=w*0.82, maxZ=h*0.44;
  let sizes=lines.map(l=>{ const m=meas(ctx,font,100,l); return Math.min(100*W/m.w,maxZ); });
  const cap=meas(ctx,font,100,'H').a/100, gap=h*0.035;
  let tot=sizes.reduce((s,z)=>s+cap*z,0)+gap*(lines.length-1);
  if(tot>h*0.8){ const k=h*0.8/tot; sizes=sizes.map(z=>z*k); tot*=k; }
  let yy=y+(h-tot)/2; ctx.fillStyle=color; ctx.textAlign='center';
  lines.forEach((l,i)=>{ yy+=cap*sizes[i]; setF(ctx,font,sizes[i]); ctx.fillText(l,x+w/2,yy); yy+=gap; });
  ctx.textAlign='left';
}
function wrapW(ctx,text,maxW){ const words=text.split(/\s+/).filter(Boolean), out=[]; let cur=''; for(const w of words){ const t=cur?cur+' '+w:w; if(ctx.measureText(t).width<=maxW||!cur) cur=t; else { out.push(cur); cur=w; } } if(cur) out.push(cur); return out; }
export function layoutCaixa(ctx,it,model){
  const C=model.caixa, L={C};
  const club=it.club!=null&&it.club!=='';
  L.club=club; L.boxVal=parseMoney(club?it.club:it.price)||0; L.left=club?parseMoney(it.price):null;
  L.unit=(it.unit||'UND').toUpperCase().replace(/^UN$|^UNID$/,'UND');
  // nome
  const N=C.nome; let z=N.size; let lines;
  for(;;){ setF(ctx,F.sb,z); lines=wrapW(ctx,(it.tela||it.name||'').toUpperCase().replace(/\s+/g,' ').trim(),N.maxW); if(lines.length<=3||z<18) break; z*=0.92; }
  const lh=N.lineH*z/N.size, cap=meas(ctx,F.sb,z,'H').a;
  const blockH=cap+(lines.length-1)*lh;
  const top=N.topo!=null?N.topo:N.cy-blockH/2;
  L.nome={z,lines,lh,cap,top,bottom:top+blockH};
  // sem preço do clube: preço grande branco + nome ao lado (sem a caixa do clube), como nos vídeos sem clube
  if(!club){
    const S=Object.assign({cx:579,top:628,h:152,nomeW:320,nomeSize:32,nomeLineH:37,gap:22,nomeDesce:23},C.semClube||{});
    const Q=clubLayout(ctx,L.boxVal,L.unit,{x:0,y:S.top,w:2000,h:S.h});
    let nz=S.nomeSize, nl; for(;;){ setF(ctx,F.sb,nz); nl=wrapW(ctx,(it.tela||it.name||'').toUpperCase().replace(/\s+/g,' ').trim(),S.nomeW); if(nl.length<=4||nz<20) break; nz*=0.92; }
    const nW=Math.max(...nl.map(l=>ctx.measureText(l).width)), ncap=meas(ctx,F.sb,nz,'H').a, nlh=S.nomeLineH*nz/S.nomeSize;
    const tot=Q.W+S.gap+nW, x0=Math.max(110,S.cx-tot/2), dx=x0-Q.x0;
    for(const k of ['x0','ix','colX','cx']) Q[k]+=dx;
    const nh=ncap+(nl.length-1)*nlh;
    L.sem={Q,nome:{lines:nl,z:nz,lh:nlh,cap:ncap,x:Q.x0+Q.W+S.gap,top:Q.top+S.nomeDesce}};
    L.sem.nome.bottom=L.sem.nome.top+nh;
    const lv=limiteValor(it.limite); let yb=Math.max(Q.base,L.sem.nome.bottom);
    if(lv){ const B=C.limite; L.limite={x:B.x,y:yb+B.abaixo,w:B.w,h:B.h,lines:['LIMITE DE',lv,'POR CLIENTE']}; yb=L.limite.y+L.limite.h; }
    const ob=obsLinhas(it.obs); if(ob.length){ const B=C.obs; const oy=L.limite?L.limite.y:Math.max(Q.base,L.sem.nome.bottom)+(C.limite.abaixo||30); L.obs={x:B.x,y:oy,w:B.w,h:B.h,lines:ob}; yb=Math.max(yb,oy+B.h); }
    L.textBottom=yb+10;
    return L;
  }
  // preço normal (só quando tem clube)
  const P=C.preco; let y=L.nome.bottom;
  if(L.left!=null){ const p=splitPrice(L.left); let k=1;
    const runs=()=>[[ 'R$ ',P.small*k],[p.int+'.'+p.cents,P.big*k],[' '+L.unit,P.small*k]];
    const width=()=>runs().reduce((s,[t,zz])=>s+meas(ctx,F.bk,zz,t).w,0);
    if(width()>P.maxW) k=P.maxW/width();
    L.preco={runs:runs(),w:width(),base:L.nome.bottom+P.abaixo*(0.85+0.15*k)}; y=L.preco.base; }
  // limite
  const lv=limiteValor(it.limite); if(lv){ const B=C.limite; L.limite={x:B.x,y:y+B.abaixo,w:B.w,h:B.h,lines:['LIMITE DE',lv,'POR CLIENTE']}; }
  const ob=obsLinhas(it.obs); if(ob.length){ const B=C.obs; L.obs={x:B.x,y:B.y,w:B.w,h:B.h,lines:ob}; }
  // o produto começa abaixo da coluna da esquerda
  L.textBottom=L.limite?L.limite.y+L.limite.h:y;
  return L;
}
// preço do clube: [R$][INTEIRO][centavos em cima da unidade, a bolinha embaixo] ocupando a área da caixa
function clubLayout(ctx,value,unit,A){
  const p=splitPrice(value);
  const lay=Fz=>{ const rs=meas(ctx,F.bk,Fz*0.267,'R$'), I=meas(ctx,F.bk,Fz,p.int), Cc=meas(ctx,F.bk,Fz*0.33,p.cents), D=meas(ctx,F.bk,Fz,'.'), uz=Fz*0.19*(unit.length>3?0.8:1), U=meas(ctx,F.bk,uz,unit);
    const colW=Math.max(Cc.w,U.w,D.w*1.1), g=Fz*0.035; return {F:Fz,p,rs,I,C:Cc,D,uz,U,colW,g,W:rs.w+g+I.w+g*0.6+colW,H:I.a}; };
  let Q=lay(200); Q=lay(Math.min(200*A.w/Q.W,200*A.h/Q.H));
  Q.x0=A.x+(A.w-Q.W)/2; Q.base=A.y+(A.h+Q.H)/2; Q.top=Q.base-Q.H; Q.ix=Q.x0+Q.rs.w+Q.g; Q.colX=Q.ix+Q.I.w+Q.g*0.6; Q.cx=Q.colX+Q.colW/2;
  return Q;
}
export function drawCaixa(ctx,it,img,L,lt,A,precoLt,model){
  const C=model.caixa, T=model.entra||{}, ink=C.nome.cor;
  ctx.textBaseline='alphabetic'; ctx.textAlign='left';
  // produto
  if(img){ const pc=L.sem?{...C.produto,topo:Math.min(C.produto.topo,L.textBottom+40)}:C.produto; const P=productBoxes(img,it,L,pc); drawProduct(ctx,img,P,lt-T.produto,T.copia||0); }
  if(L.sem){ drawSemClube(ctx,L,lt,A,precoLt,model); return; }
  // nome
  { const N=L.nome; const cy=(N.top+N.bottom)/2;
    popAt(ctx,lt-T.nome,C.nome.cx,cy,()=>{ ctx.fillStyle=ink; ctx.textAlign='center'; let yy=N.top+N.cap; for(const l of N.lines){ setF(ctx,F.sb,N.z); ctx.fillText(l,C.nome.cx,yy); yy+=N.lh; } ctx.textAlign='left'; }); }
  // preço normal
  if(L.preco){ const R=L.preco; popAt(ctx,lt-T.preco,C.preco.cx,R.base-20,()=>{ ctx.fillStyle=C.preco.cor; let x=C.preco.cx-R.w/2; for(const [t,z] of R.runs){ setF(ctx,F.bk,z); ctx.fillText(t,x,R.base); x+=ctx.measureText(t).width; } }); }
  // caixas de limite e observação
  const caixa=(B,cfg,tIn,tTxt)=>{ if(!B) return; const cx=B.x+B.w/2, cy=B.y+B.h/2;
    popAt(ctx,lt-tIn,cx,cy,()=>{ if(cfg.img&&A.img[cfg.img]) ctx.drawImage(A.img[cfg.img],B.x,B.y,B.w,B.h); else rr(ctx,B.x,B.y,B.w,B.h,cfg.r||20,cfg.fill||'#000');
      popAt(ctx,lt-tTxt,cx,cy,()=>boxLines(ctx,B.lines,F.bk,B.x,B.y,B.w,B.h,cfg.cor)); }); };
  caixa(L.limite,C.limite,T.limite,T.limiteTexto);
  // caixa do clube
  const K=C.clube, bx=K.x, by=K.y;
  let bs=1;
  if(precoLt!=null&&model.precoPulo) bs=1+(model.precoPulo.escala||0.2)*puloCurva(lt-(precoLt-(model.precoPulo.antes??0.15)));
  popAt(ctx,lt-T.clube,bx+K.w/2,by+K.h/2,()=>{
    if(K.img&&A.img[K.img]) ctx.drawImage(A.img[K.img],bx,by,K.w,K.h); else rr(ctx,bx,by,K.w,K.h,K.r||16,K.fill||'#000');
    if(L.club&&K.logo&&A.img[K.logo.img]){ const g=K.logo; popAt(ctx,lt-T.logo,bx+g.x+g.w/2,by+g.y+g.h/2,()=>ctx.drawImage(A.img[g.img],bx+g.x,by+g.y,g.w,g.h)); }
    const ar=L.club?K.area:{x:K.area.x,y:K.area.y-60,w:K.area.w,h:K.area.h+50};
    const Q=clubLayout(ctx,L.boxVal,L.unit,{x:bx+ar.x,y:by+ar.y,w:ar.w,h:ar.h});
    ctx.save(); if(bs!==1){ const gx=Q.x0+Q.W/2, gy=Q.base-Q.H/2; ctx.translate(gx,gy); ctx.scale(bs,bs); ctx.translate(-gx,-gy); }
    ctx.fillStyle=K.cor;
    popAt(ctx,lt-T.inteiro,Q.x0,Q.base,()=>{ ctx.fillStyle=K.cor; setF(ctx,F.bk,Q.F*0.267); ctx.fillText('R$',Q.x0,Q.base); setF(ctx,F.bk,Q.F); ctx.fillText(Q.p.int,Q.ix,Q.base);
      ctx.textAlign='center'; setF(ctx,F.bk,Q.F); ctx.letterSpacing='0px'; ctx.fillText('.',Q.colX+Q.D.w*0.45,Q.base); ctx.textAlign='left'; });
    popAt(ctx,lt-T.centavos,Q.cx,Q.top+Q.C.a,()=>{ ctx.fillStyle=K.cor; ctx.textAlign='center'; setF(ctx,F.bk,Q.F*0.33); ctx.fillText(Q.p.cents,Q.cx,Q.top+Q.C.a);
      setF(ctx,F.bk,Q.uz); ctx.fillText(L.unit,Q.cx,Q.top+Q.C.a+Q.F*0.05+Q.U.a); ctx.textAlign='left'; });
    ctx.restore();
  });
  caixa(L.obs,C.obs,T.obs,T.obsTexto);
}
// oferta sem clube no layout "caixa": preço grande + nome ao lado
function drawSemClube(ctx,L,lt,A,precoLt,model){
  const C=model.caixa, T=model.entra||{}, Q=L.sem.Q, N=L.sem.nome, cor=C.semClube&&C.semClube.cor||C.clube.cor||'#fff', ncor=C.semClube&&C.semClube.nomeCor||C.nome.cor;
  let bs=1;
  if(precoLt!=null&&model.precoPulo) bs=1+(model.precoPulo.escala||0.2)*puloCurva(lt-(precoLt-(model.precoPulo.antes??0.15)));
  ctx.save(); if(bs!==1){ const gx=Q.x0+Q.W/2, gy=Q.base-Q.H/2; ctx.translate(gx,gy); ctx.scale(bs,bs); ctx.translate(-gx,-gy); }
  popAt(ctx,lt-T.preco,Q.x0,Q.base,()=>{ ctx.fillStyle=cor; setF(ctx,F.bk,Q.F*0.267); ctx.fillText('R$',Q.x0,Q.base); setF(ctx,F.bk,Q.F); ctx.fillText(Q.p.int,Q.ix,Q.base);
    ctx.textAlign='center'; ctx.letterSpacing='0px'; ctx.fillText('.',Q.colX+Q.D.w*0.45,Q.base); ctx.textAlign='left'; });
  popAt(ctx,lt-(T.preco+0.12),Q.cx,Q.top+Q.C.a,()=>{ ctx.fillStyle=cor; ctx.textAlign='center'; setF(ctx,F.bk,Q.F*0.33); ctx.fillText(Q.p.cents,Q.cx,Q.top+Q.C.a);
    setF(ctx,F.bk,Q.uz); ctx.fillText(L.unit,Q.cx,Q.top+Q.C.a+Q.F*0.05+Q.U.a); ctx.textAlign='left'; });
  ctx.restore();
  popAt(ctx,lt-T.nome,N.x+60,(N.top+N.bottom)/2,()=>{ ctx.fillStyle=ncor; let yy=N.top+N.cap; for(const l of N.lines){ setF(ctx,F.sb,N.z); ctx.fillText(l,N.x,yy); yy+=N.lh; } });
  const caixa=(B,cfg,tIn,tTxt)=>{ if(!B) return; const cx=B.x+B.w/2, cy=B.y+B.h/2;
    popAt(ctx,lt-tIn,cx,cy,()=>{ if(cfg.img&&A.img[cfg.img]) ctx.drawImage(A.img[cfg.img],B.x,B.y,B.w,B.h); else rr(ctx,B.x,B.y,B.w,B.h,cfg.r||20,cfg.fill||'#000');
      popAt(ctx,lt-tTxt,cx,cy,()=>boxLines(ctx,B.lines,F.bk,B.x,B.y,B.w,B.h,cfg.cor)); }); };
  caixa(L.limite,C.limite,T.limite,T.limiteTexto); caixa(L.obs,C.obs,T.obs,T.obsTexto);
}
export function drawValidity(ctx,model,datas){
  if(!datas) return;
  const l1=model.validade.linha1.replace('{datas}',datas), l2=model.validade.linha2;
  ctx.save(); ctx.fillStyle=model.validade.cor||'#fff'; ctx.translate(0,960); ctx.rotate(-Math.PI/2); ctx.textAlign='center';
  let fs=17.5; ctx.font=`${fs}px ${F.val}`; ctx.letterSpacing='0.5px'; const w=ctx.measureText(l1).width; if(w>1500){ fs*=1500/w; ctx.font=`${fs}px ${F.val}`; }
  ctx.transform(1,0,-0.2,1,0,0);
  ctx.fillText(l1,0,74); ctx.fillText(l2,0,74+fs*1.15);
  ctx.restore();
}

// ---------------- vídeos de base ----------------
export async function openVideo(src){
  // o arquivo inteiro fica na memória: o fundo volta ao começo a cada oferta e, se a oferta for mais longa, para no último quadro
  const blob=typeof src==='string'?await (await fetch(src)).blob():src;
  const input=new Input({source:new BlobSource(blob),formats:ALL_FORMATS});
  const track=await input.getPrimaryVideoTrack(); const dur=await track.computeDuration();
  const sink=new CanvasSink(track,{poolSize:3});
  return {input,track,sink,dur};
}
export async function loadAssets(base,model,onStep=()=>{}){
  const A={};
  onStep('vídeos');
  [A.intro,A.fundo,A.assina]=await Promise.all(['intro','fundo','assina'].map(k=>openVideo(base+model[k].src)));
  onStep('transição');
  A.tr=await Promise.all([...Array(model.transicao.frames)].map(async(_,i)=>createImageBitmap(await (await fetch(`${base}${model.transicao.pasta}/${String(i).padStart(2,'0')}.webp`)).blob())));
  if(model.tag) A.tag=await createImageBitmap(await (await fetch(base+model.tag)).blob());
  // imagens do layout "caixa" (caixa do clube, selo, caixas de limite/observação)
  A.img={}; const want=new Set();
  if(model.detona&&model.detona.logos) for(const g of model.detona.logos) want.add(g.img);
  if(model.caixa){ const C=model.caixa; for(const k of ['limite','clube','obs']) if(C[k]&&C[k].img) want.add(C[k].img); if(C.clube&&C.clube.logo) want.add(C.clube.logo.img); }
  await Promise.all([...want].map(async f=>{ A.img[f]=await createImageBitmap(await (await fetch(base+f)).blob()); }));
  onStep('trilha');
  const aud=async f=>f?decodeAudio(await (await fetch(base+f)).arrayBuffer()):null;
  [A.music,A.clipIntro,A.clipAssina,A.clipTr]=await Promise.all([aud(model.trilha.src),aud(model.intro.audio),aud(model.assina.audio),aud(model.transicao.audio)]);
  A.clips={intro:A.clipIntro,assina:A.clipAssina,tr:A.clipTr};
  await Promise.all([...Object.values(F),'MontB'].map(f=>document.fonts.load(`40px ${f}`)));
  return A;
}

// quadro único (para conferir o layout) no tempo t
export async function drawFrameAt(ctx,tl,model,A,imgs,datas,t){
  const p=tl.parts.find(p=>t>=p.start&&t<p.end)||tl.parts[tl.parts.length-1];
  const src=p.type==='intro'?A.intro:p.type==='assina'?A.assina:A.fundo;
  let lt=t-p.start; lt=Math.min(lt,src.dur-1/60);   // oferta mais longa que o fundo: fica parado no último quadro
  const c=await src.sink.getCanvas(lt);
  ctx.clearRect(0,0,model.w,model.h); if(c) ctx.drawImage(c.canvas,0,0,model.w,model.h);
  overlay(ctx,tl,model,A,imgs,datas,t,p);
}
const LCACHE=new WeakMap();
function overlay(ctx,tl,model,A,imgs,datas,t,p){
  if(p.type==='oferta'){
    let L=LCACHE.get(p.item); if(!L){ L=layoutFor(ctx,p.item,model); LCACHE.set(p.item,L); }
    drawValidity(ctx,model,datas);
    drawFor(ctx,p.item,imgs[p.idx],L,t-p.start,A,p.precoAt!=null?p.precoAt-p.start:null,model);
  }
  const trFps=model.transicao.fps||model.fps;
  for(const tr of tl.trans){ const f=Math.floor((t-tr.start)*trFps+1e-6); if(f>=0&&f<A.tr.length) ctx.drawImage(A.tr[f],0,0,model.w,model.h); }
}
export function resetLayouts(items){ for(const it of items) LCACHE.delete(it); }

// ---------------- MP4 ----------------
export async function renderMp4({tl,model,A,imgs,datas,audio,onProgress=()=>{},signal}){
  const {w,h,fps}=model;
  if(!(await canEncodeVideo('avc',{width:w,height:h}))) throw new Error('Este navegador não consegue gerar vídeo H.264. Use o Chrome ou o Edge atualizados.');
  const aCodec=(await canEncodeAudio('aac',{numberOfChannels:2,sampleRate:SR}))?'aac':'opus';
  const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h; const ctx=canvas.getContext('2d',{alpha:false}); ctx.imageSmoothingQuality='high';
  const output=new Output({format:new Mp4OutputFormat({fastStart:'in-memory'}),target:new BufferTarget()});
  const vsrc=new CanvasSource(canvas,{codec:'avc',bitrate:10e6,keyFrameInterval:2,latencyMode:'quality'});
  output.addVideoTrack(vsrc,{frameRate:fps});
  const asrc=new AudioBufferSource({codec:aCodec,bitrate:192e3});
  output.addAudioTrack(asrc);
  await output.start();
  const N=tl.frames; let curPart=null, it=null;
  const t0=performance.now();
  for(let f=0;f<N;f++){
    if(signal&&signal.aborted){ await output.cancel(); throw new Error('cancelado'); }
    const t=f/fps;
    const p=tl.parts.find(p=>t>=p.start-1e-6&&t<p.end-1e-6)||tl.parts[tl.parts.length-1];
    if(p!==curPart){
      if(it&&it.return) await it.return();
      curPart=p; const src=p.type==='intro'?A.intro:p.type==='assina'?A.assina:A.fundo;
      const nf=Math.round((p.end-p.start)*fps);
      const ts=function*(){ for(let i=0;i<nf+2;i++){ let lt=i/fps; yield Math.min(lt,src.dur-1/60); } };
      it=src.sink.canvasesAtTimestamps(ts());
    }
    const r=await it.next(); const wc=r.value;
    if(wc) ctx.drawImage(wc.canvas,0,0,w,h);
    overlay(ctx,tl,model,A,imgs,datas,t,p);
    await vsrc.add(t,1/fps);
    if(f%10===0) onProgress(f/N,(performance.now()-t0)/1000);
  }
  if(it&&it.return) await it.return();
  vsrc.close();
  await asrc.add(audio); asrc.close();
  await output.finalize();
  onProgress(1,(performance.now()-t0)/1000);
  return new Blob([output.target.buffer],{type:'video/mp4'});
}
