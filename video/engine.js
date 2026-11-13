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
  const mStart=introVideo?parts[0].end:0;
  const songStart=introVideo?(model.intro.musicaDesde+parts[0].end):model.trilha.inicio;
  let mus=null;
  if(music){
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
  return {parts,T,trans,music:mus,frames:Math.round(T*fps),introVideo,fimVideo};
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
    master.gain.setValueAtTime(g,0); master.gain.setValueAtTime(g,T-0.3); master.gain.linearRampToValueAtTime(0,T);
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
const F={int:'AntonX',desc:'MontR',old:'MontXB',val:'MontR'};
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
  const top=600;
  const L={club,p,unit};
  L.intSize=270/capRatio(ctx,F.int,'8'); ctx.font=`${L.intSize}px ${F.int}`; ctx.letterSpacing='0px'; L.intW=ctx.measureText(p.int).width;
  L.cSize=95/capRatio(ctx,F.int,'8'); ctx.font=`${L.cSize}px ${F.int}`; L.cW=ctx.measureText(p.cents).width;
  L.uSize=75/capRatio(ctx,F.int,'U'); ctx.font=`${L.uSize}px ${F.int}`; L.uW=ctx.measureText(unit).width;
  if(L.uW>L.cW*1.45){ L.uSize*=L.cW*1.45/L.uW; L.uW=L.cW*1.45; }
  L.colW=Math.max(L.cW,L.uW,60);
  // descrição
  const desc=(it.tela||it.name||'').toUpperCase().replace(/\s+/g,' ').trim();
  let ds=47, lines; const maxW=380;
  for(;;){ ctx.font=`${ds}px ${F.desc}`; ctx.letterSpacing=(ds*0.05)+'px'; lines=wrap(ctx,desc,maxW); if(lines.length<=(club?4:5)||ds<32) break; ds*=0.92; }
  L.ds=ds; L.lines=lines; L.lineH=ds*1.235; L.descW=Math.max(...lines.map(l=>ctx.measureText(l).width),0);
  L.old=club&&parseMoney(it.price)?precoTela(parseMoney(it.price)):null;
  if(L.old){ ctx.font=`${ds*0.98}px ${F.old}`; ctx.letterSpacing='0px'; L.oldW=ctx.measureText(L.old).width; L.descW=Math.max(L.descW,L.oldW); }
  L.gap1=23; L.gap2=20;
  const W=L.intW+L.gap1+L.colW+L.gap2+L.descW;
  L.x0=Math.max(118,Math.round(540-W/2)); L.top=top;
  return L;
}
function drawSkewText(ctx,text,x,y,skew=-0.2){ ctx.save(); ctx.translate(x,y); ctx.transform(1,0,skew,1,0,0); ctx.fillText(text,0,0); ctx.restore(); }
// desenha uma oferta no tempo local lt (segundos desde o corte da transição)
export function drawOffer(ctx,it,img,L,lt,A,precoLt=null,pulo=null){
  const intB=L.top+270, x0=L.x0;
  ctx.fillStyle='#fff'; ctx.textBaseline='alphabetic'; ctx.textAlign='left';
  // produto: cresce com um leve passo além (0,12 → 0,30 s)
  if(img){
    const ar=img.width/img.height; let h=Math.min(980,880/ar,Math.sqrt(250000/ar)); const w=h*ar;
    const k=easeBack(prog(lt,0.12,0.32),1.6);
    if(k>0.001){ ctx.save(); ctx.translate(540,1390); ctx.scale(k,k); ctx.drawImage(img,-w/2,-h/2,w,h); ctx.restore(); }
  }
  const colX=x0+L.intW+L.gap1, cX=colX+L.colW/2;
  // quando o locutor fala o preço: o preço cresce um pouco e volta (ênfase)
  let bs=1;
  if(precoLt!=null&&pulo){ const u=(lt-(precoLt-pulo.antes))/pulo.dur; if(u>0&&u<1) bs=1+pulo.escala*Math.sin(Math.PI*u)*(u<0.5?1:1); }
  ctx.save();
  if(bs!==1){ const gx=x0+(L.intW+L.gap1+L.colW)/2, gy=L.top+135; ctx.translate(gx,gy); ctx.scale(bs,bs); ctx.translate(-gx,-gy); }
  // inteiro do preço: entra crescendo
  { const q=prog(lt,0.30,0.44); if(q>0){ const s=0.35+0.65*easeBack(q,2.2); const cx=x0+L.intW/2, cy=intB-135;
    ctx.save(); ctx.globalAlpha=clamp(q*3); ctx.translate(cx,cy); ctx.scale(s,s); ctx.translate(-cx,-cy);
    ctx.font=`${L.intSize}px ${F.int}`; ctx.letterSpacing='0px'; ctx.fillText(L.p.int,x0,intB);
    const colX=x0+L.intW+L.gap1; ctx.fillRect(colX-10,intB-53,55,53); ctx.restore(); } }
  // centavos e unidade: pulam no lugar
  const pop=(a,b,fn)=>{ const q=prog(lt,a,b); if(q<=0) return; const s=easeBack(q,2); ctx.save(); ctx.globalAlpha=clamp(q*2); fn(s); ctx.restore(); };
  pop(0.46,0.58,s=>{ const cy=L.top+52; ctx.translate(cX,cy); ctx.scale(s,s); ctx.translate(-cX,-cy); ctx.font=`${L.cSize}px ${F.int}`; ctx.textAlign='center'; ctx.fillText(L.p.cents,cX,L.top+100); });
  pop(0.66,0.78,s=>{ const cy=L.top+152; ctx.translate(cX,cy); ctx.scale(s,s); ctx.translate(-cX,-cy); ctx.font=`${L.uSize}px ${F.int}`; ctx.textAlign='center'; ctx.fillText(L.unit,cX,L.top+190); });
  ctx.textAlign='left';
  ctx.restore();
  // descrição e preço antigo: entram deslizando
  { const q=easeOut(prog(lt,0.56,0.74)); if(q>0){ const dx=(1-q)*40, x=colX+L.colW+L.gap2+dx;
    ctx.save(); ctx.globalAlpha=q;
    ctx.font=`${L.ds}px ${F.desc}`; ctx.letterSpacing=(L.ds*0.05)+'px';
    let y=L.top+L.ds*0.72+10; for(const ln of L.lines){ drawSkewText(ctx,ln,x,y); y+=L.lineH; }
    if(L.old){ ctx.font=`${L.ds*0.98}px ${F.old}`; ctx.letterSpacing='0px'; drawSkewText(ctx,L.old,x,y+2); }
    ctx.restore(); } }
  // "no CLUBE": chega girando pela direita
  if(L.club&&A.tag){ const q=prog(lt,0.74,0.92); if(q>0){ const e=easeBack(q,1.4), tw=A.tag.width, th=A.tag.height;
    const cx=598+tw/2, cy=862+th/2;
    ctx.save(); ctx.globalAlpha=clamp(q*2.5); ctx.translate(cx+(1-e)*420,cy-(1-e)*120); ctx.rotate((1-e)*0.5); ctx.scale(0.6+0.4*e,0.6+0.4*e);
    ctx.drawImage(A.tag,-tw/2,-th/2); ctx.restore(); } }
}
export function drawValidity(ctx,model,datas){
  if(!datas) return;
  const l1=model.validade.linha1.replace('{datas}',datas), l2=model.validade.linha2;
  ctx.save(); ctx.fillStyle='#fff'; ctx.translate(0,960); ctx.rotate(-Math.PI/2); ctx.textAlign='center';
  let fs=17.5; ctx.font=`${fs}px ${F.val}`; ctx.letterSpacing='0.5px'; const w=ctx.measureText(l1).width; if(w>1500){ fs*=1500/w; ctx.font=`${fs}px ${F.val}`; }
  ctx.transform(1,0,-0.2,1,0,0);
  ctx.fillText(l1,0,74); ctx.fillText(l2,0,74+fs*1.15);
  ctx.restore();
}

// ---------------- vídeos de base ----------------
export async function openVideo(src){
  // o arquivo inteiro fica na memória: o fundo volta ao começo a cada oferta
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
  onStep('trilha');
  const aud=async f=>f?decodeAudio(await (await fetch(base+f)).arrayBuffer()):null;
  [A.music,A.clipIntro,A.clipAssina,A.clipTr]=await Promise.all([aud(model.trilha.src),aud(model.intro.audio),aud(model.assina.audio),aud(model.transicao.audio)]);
  A.clips={intro:A.clipIntro,assina:A.clipAssina,tr:A.clipTr};
  await Promise.all(Object.values(F).map(f=>document.fonts.load(`40px ${f}`)));
  return A;
}

// quadro único (para conferir o layout) no tempo t
export async function drawFrameAt(ctx,tl,model,A,imgs,datas,t){
  const p=tl.parts.find(p=>t>=p.start&&t<p.end)||tl.parts[tl.parts.length-1];
  const src=p.type==='intro'?A.intro:p.type==='assina'?A.assina:A.fundo;
  let lt=t-p.start; if(p.type==='oferta') lt=lt%A.fundo.dur; lt=Math.min(lt,src.dur-1/60);
  const c=await src.sink.getCanvas(lt);
  ctx.clearRect(0,0,model.w,model.h); if(c) ctx.drawImage(c.canvas,0,0,model.w,model.h);
  overlay(ctx,tl,model,A,imgs,datas,t,p);
}
const LCACHE=new WeakMap();
function overlay(ctx,tl,model,A,imgs,datas,t,p){
  if(p.type==='oferta'){
    let L=LCACHE.get(p.item); if(!L){ L=layoutOffer(ctx,p.item,model); LCACHE.set(p.item,L); }
    drawValidity(ctx,model,datas);
    drawOffer(ctx,p.item,imgs[p.idx],L,t-p.start,A,p.precoAt!=null?p.precoAt-p.start:null,model.precoPulo);
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
  const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h; const ctx=canvas.getContext('2d',{alpha:false});
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
      const ts=function*(){ for(let i=0;i<nf+2;i++){ let lt=i/fps; if(p.type==='oferta') lt=lt%src.dur; yield Math.min(lt,src.dur-1/60); } };
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
