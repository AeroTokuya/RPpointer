// ── State ────────────────────────────────────────────────────────────────────
let wpDB = [];
let selWp = null;
let pos = null;
let gs = 120;
let watchId = null;
let filtered = [];
let searchQ = '';
let track = null;   // 進行方向（磁方位トラック、null=不明）
let lastFix = null; // トラック算出用の前回位置
const MAGVAR = 7;   // 磁気偏差（西偏7° → 磁方位=真方位+7）※calcBrgにも同値が組み込み済み
let gpsKt = null;   // GPS対地速度（kt、null=不明）
let gsAuto = false; // trueのときGPS速度でETE/ETAを自動計算（60kt超でON、55kt未満でOFF）

// ── Math ─────────────────────────────────────────────────────────────────────
function calcNM(la1,lo1,la2,lo2){
  const R=3440.065,dLa=(la2-la1)*Math.PI/180,dLo=(lo2-lo1)*Math.PI/180;
  const a=Math.sin(dLa/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function calcBrg(la1,lo1,la2,lo2){
  const dLo=(lo2-lo1)*Math.PI/180;
  const y=Math.sin(dLo)*Math.cos(la2*Math.PI/180);
  const x=Math.cos(la1*Math.PI/180)*Math.sin(la2*Math.PI/180)-Math.sin(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.cos(dLo);
  return((Math.atan2(y,x)*180/Math.PI)+360+7+360)%360;
}
function fmtCoord(v,ax){
  const d=v>=0?ax[0]:ax[1],a=Math.abs(v),deg=Math.floor(a);
  return`${d}${String(deg).padStart(ax==='NS'?2:3,'0')}°${((a-deg)*60).toFixed(2)}'`;
}
function fmtEte(nm,g){
  if(!nm||!g||g<=0||nm<=0)return'--:--';
  const tot=Math.round(nm/g*60);
  return`${Math.floor(tot/60)}h${String(tot%60).padStart(2,'0')}m`;
}

// ── GPS ──────────────────────────────────────────────────────────────────────
function startGPS(){
  if(!navigator.geolocation){
    document.getElementById('gps-coords').textContent='GPS非対応';
    document.getElementById('gps-coords').style.color='#ff5555';
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    p=>{
      pos={lat:p.coords.latitude,lon:p.coords.longitude,acc:Math.round(p.coords.accuracy)};
      // 進行方向（トラック）: GPSのheadingを優先、無い端末は位置の変化から算出
      const h=p.coords.heading;
      if(h!=null && !isNaN(h)){
        track=(h+MAGVAR)%360;
      } else if(lastFix && calcNM(lastFix.lat,lastFix.lon,pos.lat,pos.lon)>0.005){
        // 約9m以上移動したら方位を計算（GPS誤差によるブレを抑制）
        track=calcBrg(lastFix.lat,lastFix.lon,pos.lat,pos.lon);
      }
      if(!lastFix || calcNM(lastFix.lat,lastFix.lon,pos.lat,pos.lon)>0.005){
        lastFix={lat:pos.lat,lon:pos.lon};
      }
      // GPS対地速度（m/s → kt）。60kt超なら手動GSの代わりに自動使用
      const spd=p.coords.speed;
      gpsKt=(spd!=null && !isNaN(spd)) ? spd*1.94384 : null;
      if(gpsKt==null){ gsAuto=false; }
      else if(gpsKt>60){ gsAuto=true; }
      else if(gpsKt<55){ gsAuto=false; }
      updateGsDisplay();
      document.getElementById('gps-coords').style.color='var(--green)';
      document.getElementById('gps-coords').textContent=fmtCoord(pos.lat,'NS')+' '+fmtCoord(pos.lon,'EW');
      document.getElementById('gps-acc').textContent='±'+pos.acc+'m';
      document.getElementById('col-nm-hdr').style.display='';
      updateHSI();
      if(currentTab==='map') updateMap();
      if(currentTab==='hsi') renderHsiList();
      renderList();
    },
    e=>{
      const msg=e.code===1?'GPS許可が必要':'GPS取得失敗';
      document.getElementById('gps-coords').textContent=msg;
      document.getElementById('gps-coords').style.color='#ff5555';
    },
    {enableHighAccuracy:true,maximumAge:0}
  );
}

// ── HSI Canvas ───────────────────────────────────────────────────────────────
const canvas = document.getElementById('hsi-canvas');
const ctx = canvas.getContext('2d');

function drawHSI(trk, brg, hasWp){
  // trk: 進行方向（磁方位トラック、null=不明→ノースアップ表示）
  // brg: 目的地への磁方位（hasWpのとき矢印で表示）
  const rot = trk==null ? 0 : trk;
  const W=canvas.width,H=canvas.height,cx=W/2,cy=H/2,r=W/2-6;
  ctx.clearRect(0,0,W,H);

  // Bezel
  const bz=ctx.createRadialGradient(cx,cy,r*0.88,cx,cy,r+5);
  bz.addColorStop(0,'#18283a');bz.addColorStop(1,'#080e16');
  ctx.beginPath();ctx.arc(cx,cy,r+5,0,Math.PI*2);ctx.fillStyle=bz;ctx.fill();
  ctx.beginPath();ctx.arc(cx,cy,r+5,0,Math.PI*2);
  ctx.strokeStyle='#243648';ctx.lineWidth=2;ctx.stroke();

  // Face
  const face=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
  face.addColorStop(0,'#091520');face.addColorStop(1,'#030a10');
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle=face;ctx.fill();

  // Grid
  ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
  for(let i=-r;i<r;i+=28){
    ctx.beginPath();ctx.moveTo(cx+i,cy-r);ctx.lineTo(cx+i,cy+r);
    ctx.strokeStyle='rgba(0,212,255,0.025)';ctx.lineWidth=1;ctx.stroke();
    ctx.beginPath();ctx.moveTo(cx-r,cy+i);ctx.lineTo(cx+r,cy+i);ctx.stroke();
  }
  ctx.restore();

  // Rotating compass rose（進行方向が上＝トラックアップ）
  ctx.save();ctx.translate(cx,cy);ctx.rotate(-rot*Math.PI/180);
  for(let i=0;i<360;i+=5){
    const a=i*Math.PI/180,isCard=i%90===0,isMaj=i%10===0;
    const len=isCard?14:isMaj?9:5,ri=r-2,ro=ri-len;
    ctx.beginPath();
    ctx.moveTo(Math.sin(a)*ri,-Math.cos(a)*ri);
    ctx.lineTo(Math.sin(a)*ro,-Math.cos(a)*ro);
    ctx.strokeStyle=isCard?'rgba(0,212,255,0.95)':isMaj?'rgba(0,212,255,0.5)':'rgba(0,212,255,0.18)';
    ctx.lineWidth=isCard?2:isMaj?1.2:0.5;ctx.stroke();
  }
  const lbls=[['N',0],['3',30],['6',60],['E',90],['12',120],['15',150],['S',180],['21',210],['24',240],['W',270],['30',300],['33',330]];
  lbls.forEach(([lbl,deg])=>{
    const a=deg*Math.PI/180,tr=r*0.71;
    ctx.save();ctx.translate(Math.sin(a)*tr,-Math.cos(a)*tr);ctx.rotate(a);
    ctx.font=`bold ${deg%90===0?13:10}px 'Share Tech Mono',monospace`;
    ctx.fillStyle=deg%90===0?'#00d4ff':'rgba(130,185,215,0.7)';
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(lbl,0,0);
    ctx.restore();
  });
  ctx.restore();

  // 目的地方向の矢印（緑、進行方向に対する相対方位。真上＝目的地に向かっている）
  if(hasWp){
    const rel=(brg-rot)*Math.PI/180;
    const ar=r*0.80;
    ctx.save();ctx.translate(cx,cy);ctx.rotate(rel);
    ctx.strokeStyle='#00e676';ctx.fillStyle='#00e676';
    ctx.shadowColor='#00e676';ctx.shadowBlur=12;
    // 矢印の軸
    ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(0,ar*0.45);ctx.lineTo(0,-ar+14);ctx.stroke();
    // 矢じり
    ctx.beginPath();ctx.moveTo(0,-ar);ctx.lineTo(-9,-ar+20);ctx.lineTo(0,-ar+13);ctx.lineTo(9,-ar+20);ctx.closePath();ctx.fill();
    // 尾翼
    ctx.lineWidth=2.5;
    ctx.beginPath();ctx.moveTo(-7,ar*0.45);ctx.lineTo(7,ar*0.45);ctx.stroke();
    ctx.shadowBlur=0;ctx.restore();
  }

  // Heading bug (orange triangle, fixed at top = 進行方向)
  ctx.save();ctx.translate(cx,cy);
  ctx.beginPath();
  ctx.moveTo(-6.5,-(r-2));ctx.lineTo(-6.5,-(r-13));
  ctx.lineTo(0,-(r-22));ctx.lineTo(6.5,-(r-13));
  ctx.lineTo(6.5,-(r-2));ctx.closePath();
  ctx.fillStyle='#ff6b35';ctx.shadowColor='#ff6b35';ctx.shadowBlur=10;ctx.fill();ctx.shadowBlur=0;
  ctx.restore();

  // Aircraft symbol
  ctx.save();ctx.translate(cx,cy);
  ctx.strokeStyle='#ffffff';ctx.lineWidth=2;
  ctx.shadowColor='rgba(255,255,255,0.5)';ctx.shadowBlur=4;
  ctx.beginPath();ctx.moveTo(0,-16);ctx.lineTo(0,18);ctx.stroke();
  ctx.beginPath();ctx.moveTo(-16,5);ctx.lineTo(16,5);ctx.stroke();
  ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(-8,16);ctx.lineTo(8,16);ctx.stroke();
  ctx.shadowBlur=0;ctx.restore();

  // TRK readout（現在の進行方位）
  ctx.font="bold 20px 'Share Tech Mono',monospace";
  ctx.fillStyle='#ff6b35';ctx.textAlign='center';
  ctx.shadowColor='#ff6b35';ctx.shadowBlur=12;
  ctx.fillText(trk!=null?String(Math.round(rot)%360).padStart(3,'0')+'°':'---°',cx,cy+r*0.38);
  ctx.shadowBlur=0;

  // inner ring
  ctx.beginPath();ctx.arc(cx,cy,r-2,0,Math.PI*2);
  ctx.strokeStyle='rgba(0,212,255,0.18)';ctx.lineWidth=1;ctx.stroke();
}

function updateHSI(){
  const active = !!(pos && selWp);
  const brg  = active ? calcBrg(pos.lat,pos.lon,selWp.lat,selWp.lon) : 0;
  const dist = active ? calcNM(pos.lat,pos.lon,selWp.lat,selWp.lon) : 0;
  const g    = effGs();
  const ete  = fmtEte(dist, g);

  drawHSI(track, brg, active);

  document.getElementById('d-brg').textContent  = active ? String(Math.round(brg)).padStart(3,'0')+'°' : '---°';
  document.getElementById('d-dist').textContent = active ? dist.toFixed(1) : '---';
  document.getElementById('d-ete').textContent  = active ? ete : '--:--';
  // ETA JST
  if(active && g>0 && dist>0){
    const arrMs = Date.now() + (dist/g)*3600000;
    const jst = new Date(arrMs + 9*3600000);
    document.getElementById('d-eta').textContent =
      String(jst.getUTCHours()).padStart(2,'0')+':'+String(jst.getUTCMinutes()).padStart(2,'0');
  } else {
    document.getElementById('d-eta').textContent = '--:--';
  }
}

// ── Select / Clear WP ────────────────────────────────────────────────────────
function selectWP(wp){
  selWp = wp;
  // DEST row
  document.getElementById('dest-none').style.display='none';
  document.getElementById('dest-id').style.display='';
  document.getElementById('dest-name').style.display='';
  document.getElementById('dest-clr').style.display='';
  document.getElementById('dest-id').textContent = wp.id;
  document.getElementById('dest-name').textContent = wp.name;
  document.getElementById('dest-row').style.borderColor='var(--accent)';
  // selected row highlight
  document.querySelectorAll('.wp-row').forEach(el=>{
    el.classList.toggle('selected', el.dataset.id===wp.id);
  });
  updateHSI();
  if(currentTab==='map') updateMap();
  renderHsiList();
  showToast(wp.id+' を選択');
  // Save
  try{localStorage.setItem('dispatch-sel',wp.id);}catch(e){}
}

function clearSel(){
  selWp=null;
  document.getElementById('dest-none').style.display='';
  document.getElementById('dest-id').style.display='none';
  document.getElementById('dest-name').style.display='none';
  document.getElementById('dest-clr').style.display='none';
  document.getElementById('dest-row').style.borderColor='var(--border)';
  document.querySelectorAll('.wp-row').forEach(el=>el.classList.remove('selected'));
  updateHSI();
  try{localStorage.removeItem('dispatch-sel');}catch(e){}
}

// ── GS ───────────────────────────────────────────────────────────────────────
// ETE/ETA計算に使う実効GS: GPS速度が60kt超のときはGPS実速度、それ以外は手動設定値
function effGs(){
  return (gsAuto && gpsKt!=null) ? gpsKt : gs;
}
function onGsChange(){
  gs = parseInt(document.getElementById('gs-input').value)||1;
  updateHSI();
}
function updateGsDisplay(){
  const inp=document.getElementById('gs-input');
  const lbl=document.getElementById('gs-lbl');
  if(gsAuto && gpsKt!=null){
    inp.value=Math.round(gpsKt);
    inp.disabled=true;
    inp.style.color='var(--green)';
    lbl.textContent='GS(GPS)';
    lbl.style.color='var(--green)';
  }else{
    if(inp.disabled){ inp.disabled=false; inp.value=gs; }
    inp.style.color='var(--accent)';
    lbl.textContent='GS';
    lbl.style.color='';
  }
}

// ── File Import ───────────────────────────────────────────────────────────────
// タグ名に名前空間が付いていても取れるヘルパー
function getTagText(el, tag){
  // 完全一致
  let found = el.querySelector(tag);
  if(found) return found.textContent.trim();
  // 名前空間付き（例: kml:name）を総当たり
  for(const c of el.getElementsByTagName('*')){
    if(c.localName===tag) return c.textContent.trim();
  }
  return '';
}

function parseXml(text){
  // BOM・宣言前のゴミを除去してからパース
  const clean=text.replace(/^\uFEFF/,'').replace(/^[^<]+/,'');
  return new DOMParser().parseFromString(clean,'application/xml');
}

function parseGPX(text){
  const doc=parseXml(text);
  // パースエラー確認
  if(doc.querySelector('parsererror')) throw new Error('GPXファイルの解析に失敗しました');
  let nodes=[...doc.getElementsByTagNameNS('*','wpt')];
  if(nodes.length===0){
    nodes=[...doc.getElementsByTagNameNS('*','rtept')];
  }
  if(nodes.length===0){
    nodes=[...doc.getElementsByTagNameNS('*','trkpt')];
  }
  const res=[];
  for(const w of nodes){
    const lat=parseFloat(w.getAttribute('lat')),lon=parseFloat(w.getAttribute('lon'));
    if(isNaN(lat)||isNaN(lon)) continue;
    const name=getTagText(w,'name')||`WPT${res.length+1}`;
    const desc=getTagText(w,'desc')||getTagText(w,'cmt')||'';
    const id=name.replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,8)||`W${String(res.length+1).padStart(4,'0')}`;
    res.push({id,name,lat,lon,desc});
    if(res.length>=10000) break;
  }
  return res;
}

function parseKML(text){
  // 名前空間を保持したままパースし、localName（getElementsByTagNameNS）で検索する
  // ※以前のxmlns削除方式は gx: 等のプレフィックス付き要素が残るとXML不正になり失敗していた
  const doc=parseXml(text);
  if(doc.querySelector('parsererror')) throw new Error('KMLファイルの解析に失敗しました');
  const res=[];
  const placemarks=[...doc.getElementsByTagNameNS('*','Placemark')];
  for(const pm of placemarks){
    const name=getTagText(pm,'name')||`WPT${res.length+1}`;
    // coordinates タグを探す（Point下でなくても拾う）
    let coordsText='';
    for(const c of pm.getElementsByTagNameNS('*','coordinates')){
      coordsText=c.textContent.trim();
      if(coordsText) break;
    }
    // gx:Track等、coordinatesが無い場合は coord（"lon lat alt"）を探す
    if(!coordsText){
      for(const c of pm.getElementsByTagNameNS('*','coord')){
        coordsText=c.textContent.trim();
        if(coordsText) break;
      }
    }
    if(!coordsText) continue;
    // "lon,lat,alt" または "lon lat alt" 形式
    const parts=coordsText.trim().split(/[\s,]+/);
    const lon=parseFloat(parts[0]),lat=parseFloat(parts[1]);
    if(isNaN(lat)||isNaN(lon)) continue;
    const desc=getTagText(pm,'description')||'';
    const id=name.replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,8)||`K${String(res.length+1).padStart(4,'0')}`;
    res.push({id,name,lat,lon,desc});
    if(res.length>=10000) break;
  }
  return res;
}

async function handleFile(e){
  const file=e.target.files[0]; if(!file) return;
  const btn=document.getElementById('btn-import');
  btn.textContent='読み込み中...'; btn.disabled=true;
  await new Promise(r=>setTimeout(r,50));
  try{
    const ext=file.name.split('.').pop().toLowerCase();
    let wps=[];
    if(ext==='gpx'){
      const text=await file.text();
      wps=parseGPX(text);
    } else if(ext==='kmz' || ext==='kml'){
      // まずZIP(KMZ)として試みる
      let kmlText=null;
      try{
        const buf=await file.arrayBuffer();
        const zip=await JSZip.loadAsync(buf);
        // doc.kml または最初の.kmlファイルを探す
        const kmlFile=zip.file('doc.kml') || zip.file(/\.kml$/i)[0];
        if(kmlFile) kmlText=await kmlFile.async('string');
      }catch(zipErr){ /* ZIPでなければ通常KMLとして処理 */ }
      if(!kmlText) kmlText=await file.text();
      wps=parseKML(kmlText);
    } else{ showToast('GPX / KML / KMZを選択してください',true); return; }

    if(wps.length===0){ showToast('WPが見つかりません（フォーマット確認）',true); return; }

    // 既存データを保持したまま追記する（完全重複はスキップ・ID衝突は連番で解決）
    const usedIds=new Set(wpDB.map(w=>w.id));
    const dupKey=w=>`${w.name}|${w.lat.toFixed(6)}|${w.lon.toFixed(6)}`;
    const existing=new Set(wpDB.map(dupKey));
    let added=0,skipped=0;
    for(const w of wps){
      const k=dupKey(w);
      if(existing.has(k)){ skipped++; continue; }
      existing.add(k);
      let id=w.id,n=2;
      while(usedIds.has(id)){ id=`${w.id.slice(0,6)}${String(n).padStart(2,'0')}`; n++; }
      usedIds.add(id);
      wpDB.push({...w,id});
      added++;
    }
    saveDB();
    document.getElementById('import-hint').style.display='none';
    document.getElementById('import-info').style.display='';
    document.getElementById('import-info').textContent=`📄 ${file.name}  |  +${added.toLocaleString()}件  |  計 ${wpDB.length.toLocaleString()} waypoints`;
    document.getElementById('btn-clrdb').style.display='block';
    document.getElementById('wp-section').style.display='block';
    document.getElementById('hsi-wp-section').style.display = currentTab==='hsi' ? 'block' : 'none';
    hsiFiltered=[...wpDB]; onHsiSearch(); onSearch();
    if(added===0){
      showToast('追加なし（すべて既存WPと重複）',true);
    }else{
      showToast(`${added.toLocaleString()}件を追加（計${wpDB.length.toLocaleString()}件${skipped?`・重複${skipped}件スキップ`:''}）`);
    }
  }catch(err){
    showToast('エラー: '+err.message, true);
    console.error(err);
  }finally{
    btn.textContent='📂  GPX / KML / KMZ インポート'; btn.disabled=false;
    e.target.value='';
  }
}

// ── WP List Render ────────────────────────────────────────────────────────────
function onSearch(){
  searchQ=document.getElementById('search-input').value.trim();
  const q=searchQ.toUpperCase();
  filtered=wpDB.filter(w=>
    !q||w.id.includes(q)||w.name.toUpperCase().includes(q)||(w.desc&&w.desc.toUpperCase().includes(q))
  );
  const placeholder=`SEARCH  (${filtered.length.toLocaleString()} / ${wpDB.length.toLocaleString()} WPs)`;
  document.getElementById('search-input').placeholder=placeholder;
  renderList();
}

function renderList(){
  const list=document.getElementById('wp-list');
  const hasDist=!!pos;
  document.getElementById('col-nm-hdr').style.display=hasDist?'':'none';

  list.innerHTML='';
  const show=filtered.slice(0,500);
  for(const wp of show){
    const isSel=selWp&&selWp.id===wp.id;
    const d=hasDist?calcNM(pos.lat,pos.lon,wp.lat,wp.lon):null;

    const row=document.createElement('div');
    row.className='wp-row'+(isSel?' selected':'');
    row.dataset.id=wp.id;

    const idSpan=document.createElement('span');
    idSpan.className='wp-row-id';
    idSpan.textContent=wp.id;

    const info=document.createElement('div');
    info.className='wp-row-info';

    const nameDiv=document.createElement('div');
    nameDiv.className='wp-row-name';
    nameDiv.textContent=wp.name;
    info.appendChild(nameDiv);

    if(wp.desc){
      const descDiv=document.createElement('div');
      descDiv.className='wp-row-desc';
      descDiv.textContent=wp.desc;
      info.appendChild(descDiv);
    }

    row.appendChild(idSpan);
    row.appendChild(info);

    if(hasDist){
      const nmSpan=document.createElement('span');
      nmSpan.className='wp-row-nm';
      nmSpan.textContent=d.toFixed(1);
      row.appendChild(nmSpan);
    }

    row.addEventListener('click',()=>selectWP(wp));
    list.appendChild(row);
  }
  document.getElementById('wp-overflow').style.display=filtered.length>500?'':'none';
}

// ── Custom WP ────────────────────────────────────────────────────────────────
function openModal(){document.getElementById('modal-overlay').classList.add('active');}
function closeModal(){document.getElementById('modal-overlay').classList.remove('active');}
function addCustomWP(){
  const id=document.getElementById('f-id').value.trim().toUpperCase();
  const name=document.getElementById('f-name').value.trim();
  const lat=parseFloat(document.getElementById('f-lat').value);
  const lon=parseFloat(document.getElementById('f-lon').value);
  if(!id||!name||isNaN(lat)||isNaN(lon)){showToast('全項目入力してください',true);return;}
  if(wpDB.find(w=>w.id===id)){showToast(id+' は既登録',true);return;}
  wpDB.push({id,name,lat,lon,desc:''});
  saveDB();
  document.getElementById('wp-section').style.display='block';
  hsiFiltered=[...wpDB]; renderHsiList();
  document.getElementById('hsi-wp-section').style.display = currentTab==='hsi' ? 'block' : 'none';
  document.getElementById('btn-clrdb').style.display='block';
  onSearch();
  closeModal();
  ['f-id','f-name','f-lat','f-lon'].forEach(i=>document.getElementById(i).value='');
  showToast(id+' を追加');
}

// ── Clear DB ─────────────────────────────────────────────────────────────────
function clearDB(){
  if(!confirm(`読み込み済みの全${wpDB.length.toLocaleString()}件のWPを削除しますか？`))return;
  wpDB=[];clearSel();saveDB();
  document.getElementById('wp-section').style.display='none';
  document.getElementById('hsi-wp-section').style.display='none';
  document.getElementById('btn-clrdb').style.display='none';
  document.getElementById('import-info').style.display='none';
  document.getElementById('import-hint').style.display='';
  showToast('WPをクリアしました');
}

// ── LocalStorage ─────────────────────────────────────────────────────────────
function saveDB(){
  try{localStorage.setItem('dispatch-db',JSON.stringify(wpDB));}catch(e){}
}
function loadDB(){
  try{
    const d=localStorage.getItem('dispatch-db');
    if(d){
      wpDB=JSON.parse(d);
      if(wpDB.length>0){
        document.getElementById('wp-section').style.display='block';
        document.getElementById('btn-clrdb').style.display='block';
        document.getElementById('import-hint').style.display='none';
        document.getElementById('import-info').style.display='';
        document.getElementById('import-info').textContent=`💾 保存済み  |  ${wpDB.length.toLocaleString()} waypoints`;
        onSearch();
      }
    }
    const s=localStorage.getItem('dispatch-sel');
    if(s){const wp=wpDB.find(w=>w.id===s);if(wp)selectWP(wp);}
  }catch(e){}
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer=null;
function showToast(msg,err=false){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.style.borderColor=err?'#ff4444':'var(--green)';
  t.style.color=err?'var(--red)':'var(--green)';
  t.classList.add('show');
  if(toastTimer)clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),2400);
}

// ── UTC clock (GPS bar右に表示) ───────────────────────────────────────────────
function tickClock(){
  const n=new Date();
  const jst=new Date(n.getTime()+9*3600000);
  const ts=[jst.getUTCHours(),jst.getUTCMinutes(),jst.getUTCSeconds()].map(x=>String(x).padStart(2,'0')).join(':');
  const off=!navigator.onLine;
  const el=document.getElementById('sync-txt');
  el.textContent=ts+' JST'+(off?' | OFFLINE':'');
  el.style.color=off?'#ffcc02':'';
}
setInterval(tickClock,1000);tickClock();

// HSI idle animation when no GPS/WP
setInterval(()=>{if(!pos||!selWp)drawHSI(track,0,false);},100);



// ── HSI inline search ─────────────────────────────────────────────────────────
let hsiFiltered = [];
let hsiSearch = '';

function onHsiSearch(){
  hsiSearch = document.getElementById('hsi-s-input').value.trim();
  const q = hsiSearch.toUpperCase();
  hsiFiltered = wpDB.filter(w=>
    !q || w.id.includes(q) || w.name.toUpperCase().includes(q) || (w.desc && w.desc.toUpperCase().includes(q))
  );
  document.getElementById('hsi-s-input').placeholder =
    'SEARCH  ('+hsiFiltered.length.toLocaleString()+' / '+wpDB.length.toLocaleString()+' WPs)';
  renderHsiList();
}

function renderHsiList(){
  const list = document.getElementById('hsi-list');
  const hasDist = !!pos;
  document.getElementById('hsi-nm-hdr').style.display = hasDist ? '' : 'none';
  list.innerHTML = '';
  const show = hsiFiltered.slice(0,500);
  for(const wp of show){
    const isSel = selWp && selWp.id === wp.id;
    const d = hasDist ? calcNM(pos.lat,pos.lon,wp.lat,wp.lon) : null;

    const row = document.createElement('div');
    row.className = 'wp-row' + (isSel ? ' selected' : '');
    row.dataset.id = wp.id;

    const idSpan = document.createElement('span');
    idSpan.className = 'wp-row-id';
    idSpan.textContent = wp.id;

    const info = document.createElement('div');
    info.className = 'wp-row-info';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'wp-row-name';
    nameDiv.textContent = wp.name;
    info.appendChild(nameDiv);
    if(wp.desc){
      const descDiv = document.createElement('div');
      descDiv.className = 'wp-row-desc';
      descDiv.textContent = wp.desc;
      info.appendChild(descDiv);
    }

    row.appendChild(idSpan);
    row.appendChild(info);

    if(hasDist){
      const nmSpan = document.createElement('span');
      nmSpan.className = 'wp-row-nm';
      nmSpan.textContent = d.toFixed(1);
      row.appendChild(nmSpan);
    }

    row.addEventListener('click', ()=>selectWP(wp));
    list.appendChild(row);
  }
  document.getElementById('hsi-overflow').style.display = hsiFiltered.length>500 ? '' : 'none';
}

// ── Tab switching ────────────────────────────────────────────────────────────
let currentTab = 'hsi';
let map = null;
let posMarker = null;
let wpMarker = null;
let routeLine = null;
let mapTracking = false; // trueのとき現在地追従
let airspaceStore = null; // OpenAIPから取得した空域 {fetchedAt, items:[...]}
let airspaceCtl = null;   // 空域レイヤーコントロール
let airspaceGroups = [];  // 表示中の空域レイヤー群
let gsiLayerRef = null;

function switchTab(tab){
  currentTab = tab;
  // タブボタン
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  // パネル表示切替
  document.getElementById('hsi-block').style.display          = tab==='hsi'  ? 'flex'  : 'none';
  document.getElementById('hsi-wp-section').style.display  = (tab==='hsi' && wpDB.length>0) ? 'block' : 'none';
  document.getElementById('map-block').style.display           = tab==='map'  ? 'block' : 'none';
  document.getElementById('import-bar').style.display          = tab==='list' ? 'block' : 'none';
  document.getElementById('wp-section').style.display          = (tab==='list' && wpDB.length>0) ? 'block' : 'none';

  if(tab==='map'){
    initMap();
    if(!map) return;
    setTimeout(()=>{
      if(!map) return;
      map.invalidateSize();
      updateMap();
      // 初回表示時は経路全体を表示（トラッキングはOFF）
      const hasSel = !!selWp;
      const hasPos = !!pos;
      if(hasPos && hasSel){
        map.fitBounds([[pos.lat,pos.lon],[selWp.lat,selWp.lon]], {padding:[60,60]});
      } else if(hasSel){
        map.setView([selWp.lat,selWp.lon], 12);
      } else if(hasPos){
        map.setView([pos.lat,pos.lon], 12);
      }
    }, 150);
  }
  if(tab==='hsi' && wpDB.length>0){ hsiFiltered=[...wpDB]; onHsiSearch(); }
}

// ── Leaflet Map ───────────────────────────────────────────────────────────────
function initMap(){
  if(map) return; // 既に初期化済み
  if(typeof L==='undefined'){
    // 初回アクセスがオフライン等でLeafletが読み込めていない
    showToast('地図ライブラリ未読込（一度オンラインで開くとオフラインでも使用可）',true);
    return;
  }

  map = L.map('map', {
    center: [35.68, 139.76],
    zoom: 10,
    zoomControl: true,
    attributionControl: true,
    tap: false, // iOS Safari のタップ遅延を防ぐ
  });

  // ユーザーが手動でパン/ズームしたらトラッキング解除
  map.on('dragstart', () => { if(mapTracking) setTracking(false); });
  map.on('zoomstart', (e) => {
    // プログラムからのズームは無視、ユーザー操作のみ検知
    if(e.originalEvent) { if(mapTracking) setTracking(false); }
  });

  // 国土地理院タイル（標準地図）
  const gsiLayer = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>',
    maxZoom: 18,
    minZoom: 5,
  }).addTo(map);

  gsiLayerRef = gsiLayer;
  buildAirspace();

  // 現在地マーカー（青い点）
  const posIcon = L.divIcon({
    html: '<div style="width:14px;height:14px;border-radius:50%;background:#00d4ff;border:2px solid #fff;box-shadow:0 0 10px rgba(0,212,255,0.8);"></div>',
    className: '',
    iconSize: [14,14],
    iconAnchor: [7,7],
  });

  // WPマーカー（オレンジ三角）
  const wpIcon = L.divIcon({
    html: '<div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:16px solid #ff6b35;filter:drop-shadow(0 0 4px rgba(255,107,53,0.8));"></div>',
    className: '',
    iconSize: [16,16],
    iconAnchor: [8,16],
  });

  posMarker = L.marker([35.68,139.76], {icon:posIcon, zIndexOffset:1000});
  wpMarker  = L.marker([35.68,139.76], {icon:wpIcon,  zIndexOffset:999});
  routeLine = L.polyline([], {color:'#9b5de5', weight:3, opacity:0.9});

  routeLine.addTo(map);
}

// ── 空域描画 ──────────────────────────────────────────────────────────────────
function clearAirspace(){
  airspaceGroups.forEach(g=>{ if(map.hasLayer(g)) map.removeLayer(g); });
  airspaceGroups=[];
  if(airspaceCtl){ map.removeControl(airspaceCtl); airspaceCtl=null; }
}
function addAirspaceControl(overlays){
  airspaceCtl=L.control.layers(
    { '国土地理院': gsiLayerRef },
    overlays,
    { position:'topright', collapsed:true }
  ).addTo(map);
}
// OpenAIPデータがあればそれを、無ければ内蔵データ（参考）を描画
function buildAirspace(){
  if(!map) return;
  clearAirspace();
  if(airspaceStore && airspaceStore.items && airspaceStore.items.length){
    buildOpenAipAirspace(airspaceStore);
  }else{
    buildEmbeddedAirspace();
  }
  updateMapInfo();
}
function updateMapInfo(){
  const el=document.getElementById('map-info');
  if(airspaceStore && airspaceStore.items && airspaceStore.items.length){
    const d=new Date(airspaceStore.fetchedAt);
    const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    el.textContent=`空域: OpenAIP ${airspaceStore.items.length}件 (${ds}取得)`;
    el.style.color='var(--green)';
  }else{
    el.textContent='空域: 内蔵データ（参考・要更新）';
    el.style.color='var(--orange)';
  }
  el.style.display='block';
}

// OpenAIP空域タイプ → 表示設定（未知タイプは「その他」として必ず描画する）
const AS_TYPES={
  4:{label:'管制圏 (CTR)',color:'#4444ff'},
  13:{label:'ATZ',color:'#4444ff'},
  23:{label:'情報圏 (TIZ)',color:'#99ff99'},
  24:{label:'情報空域 (TIA)',color:'#99ff99'},
  3:{label:'禁止空域 (P)',color:'#ff2222'},
  1:{label:'制限空域 (R)',color:'#ff2222'},
  2:{label:'危険空域 (D)',color:'#ff8800'},
  7:{label:'進入管制区 (TMA)',color:'#00d4ff'},
  26:{label:'管制区 (CTA)',color:'#00d4ff'},
  5:{label:'TMZ',color:'#33ff66'},
  6:{label:'RMZ',color:'#33ff66'},
  8:{label:'訓練空域 (TRA)',color:'#33ff66'},
  9:{label:'訓練空域 (TSA)',color:'#33ff66'},
  25:{label:'軍訓練空域 (MTA)',color:'#33ff66'},
  21:{label:'滑空空域',color:'#66ffcc'},
  17:{label:'警報空域 (ALERT)',color:'#ff8800'},
  18:{label:'注意空域 (WARNING)',color:'#ff8800'},
};
const AS_OTHER={label:'その他空域',color:'#8899aa'};
const escHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function buildOpenAipAirspace(store){
  const groups=new Map();
  for(const a of store.items){
    const t=AS_TYPES[a.type]||AS_OTHER;
    if(!groups.has(t.label)) groups.set(t.label,{t,feats:[]});
    groups.get(t.label).feats.push({
      type:'Feature',
      properties:{name:a.name,band:(a.lower||a.upper)?`${a.lower||'?'} - ${a.upper||'?'}`:''},
      geometry:a.geometry,
    });
  }
  const overlays={};
  let first=true;
  for(const {t,feats} of groups.values()){
    const gl=L.geoJSON({type:'FeatureCollection',features:feats},{
      style:{color:t.color,weight:2,opacity:0.95,fill:false},
      attribution:first?'空域: <a href="https://www.openaip.net" target="_blank" rel="noopener">OpenAIP</a>':'',
      onEachFeature:(f,lyr)=>{
        const p=f.properties;
        lyr.bindTooltip(`<b>${escHtml(p.name)}</b>${p.band?'<br>'+escHtml(p.band):''}`,{sticky:true,opacity:0.9});
      }
    }).addTo(map);
    overlays[`${t.label} [${feats.length}]`]=gl;
    airspaceGroups.push(gl);
    first=false;
  }
  addAirspaceControl(overlays);
}

// 内蔵データ（従来の埋め込みGeoJSON・参考表示）
function buildEmbeddedAirspace(){
  // 空域タイプ略称マップ
  const AIRSPACE_TYPE_CHAR = {
    infoZone:    {char:'I', color:'#99ff99'},
    controlZone: {char:'C', color:'#4444ff'},
    airRes:      {char:'R', color:'#ff2222'},
    civTrng:     {char:'T', color:'#33ff66'},
    tokubetsu:   {char:'P', color:'#ff8800'},
  };

  // 高度文字列をパース
  function parseAlt(str) {
    const flMatch = str.match(/FL(\d+)[^\d]+FL(\d+)/);
    if(flMatch) return {lower:'FL'+flMatch[1], upper:'FL'+flMatch[2]};
    // SFC/GRD/GND と数字の組み合わせを先にチェック
    const sfcMatch = str.match(/(SFC|GRD|GND)[^\d]+([\d]+)\s*f(?:eet|t)?/i);
    if(sfcMatch) return {lower:sfcMatch[1].toUpperCase(), upper:sfcMatch[2]};
    const sfcMatch2 = str.match(/([\d]+)\s*f(?:eet|t)?[^\d]+(SFC|GRD|GND)/i);
    if(sfcMatch2) return {lower:sfcMatch2[2].toUpperCase(), upper:sfcMatch2[1]};
    const sfcUnl = str.match(/(SFC|GRD|GND)[^\w]*(UNL)/i);
    if(sfcUnl) return {lower:sfcUnl[1].toUpperCase(), upper:'UNL'};
    const ftMatch = str.match(/(SFC|[\d]+)[^\d]+(SFC|[\d]+)\s*feet/i);
    if(ftMatch) return {lower:ftMatch[1], upper:ftMatch[2]};
    const ft2 = str.match(/([\d]+)[^\d]+([\d]+)/);
    if(ft2) return {lower:ft2[1], upper:ft2[2]};
    return {lower:'', upper:str.replace(/feet/i,'').trim()};
  }

  const overlayLayers = {};
  AIRSPACE_LAYERS.forEach(layer => {
    const typeInfo = AIRSPACE_TYPE_CHAR[layer.id] || {char:'?', color:layer.color};

    // ポリゴン：塗りつぶしなし・境界線のみ
    const gl = L.geoJSON(layer.geojson, {
      style: {
        color: layer.color,
        weight: 2,
        opacity: 0.95,
        fill: false,
      },
      onEachFeature: (feature, lyr) => {
        if (feature.properties && feature.properties.name) {
          lyr.bindTooltip(feature.properties.name, {sticky: true, opacity: 0.85});
        }
      }
    }).addTo(map);

    // 高度ラベル（PCA・管制圏・空域制限のみ）
    if((layer.id === 'tokubetsu' || layer.id === 'controlZone' || layer.id === 'airRes') && layer.points && layer.points.features.length > 0){
      const makeAltIcon = (name) => {
        const alt = parseAlt(name);
        const c = typeInfo.color;
        const html =
          '<div style="display:flex;align-items:stretch;font-family:monospace;font-size:11px;line-height:1;pointer-events:none;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.9))">'
          + '<div style="background:'+c+';color:#fff;font-weight:bold;font-size:13px;padding:3px 6px;display:flex;align-items:center;justify-content:center;min-width:18px;">'+typeInfo.char+'</div>'
          + '<div style="background:rgba(8,8,8,0.85);border:1.5px solid '+c+';border-left:none;padding:2px 7px;color:#fff;text-align:center;white-space:nowrap;">'
          + '<div style="border-bottom:1px solid rgba(255,255,255,0.45);padding-bottom:2px;margin-bottom:2px;">'+alt.upper+'</div>'
          + '<div>'+alt.lower+'</div>'
          + '</div></div>';
        return L.divIcon({html, className:'', iconAnchor:[0,10]});
      };

      const ptLayer = L.geoJSON(layer.points, {
        pointToLayer: (feature, latlng) => L.marker(latlng, {
          icon: makeAltIcon(feature.properties.name),
          interactive: false,
        })
      }).addTo(map);
      overlayLayers[layer.label + ' 高度'] = ptLayer;
      airspaceGroups.push(ptLayer);
    }

    overlayLayers[layer.label] = gl;
    airspaceGroups.push(gl);
  });
  addAirspaceControl(overlayLayers);
}


// ── OpenAIP同期 ───────────────────────────────────────────────────────────────
// IndexedDB（空域データは数MBになりlocalStorageに収まらないため）
function idbOpen(){
  return new Promise((ok,ng)=>{
    const r=indexedDB.open('rppointer',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('kv');
    r.onsuccess=()=>ok(r.result);
    r.onerror=()=>ng(r.error);
  });
}
async function idbGet(k){
  const db=await idbOpen();
  return new Promise((ok,ng)=>{
    const q=db.transaction('kv').objectStore('kv').get(k);
    q.onsuccess=()=>ok(q.result);
    q.onerror=()=>ng(q.error);
  });
}
async function idbSet(k,v){
  const db=await idbOpen();
  return new Promise((ok,ng)=>{
    const q=db.transaction('kv','readwrite').objectStore('kv').put(v,k);
    q.onsuccess=()=>ok();
    q.onerror=()=>ng(q.error);
  });
}

// OpenAIPの高度表現 → 表示文字列 (unit: 1=ft,2=m,6=FL / referenceDatum: 0=GND,1=MSL,2=STD)
function fmtLimit(lim){
  if(!lim) return '';
  if(lim.unit===6) return 'FL'+lim.value;
  if(lim.value===0 && lim.referenceDatum===0) return 'SFC';
  const u={1:'ft',2:'m'}[lim.unit]||'';
  const d={0:'GND',1:'MSL',2:'STD'}[lim.referenceDatum]||'';
  return `${lim.value}${u}${d?' '+d:''}`;
}

async function fetchOpenAIP(key){
  const items=[];
  let page=1,totalPages=1;
  do{
    const res=await fetch('https://api.core.openaip.net/api/airspaces?country=JP&limit=1000&page='+page+'&apiKey='+encodeURIComponent(key));
    if(res.status===401||res.status===403) throw new Error('APIキーが無効です');
    if(!res.ok) throw new Error('HTTP '+res.status);
    const j=await res.json();
    totalPages=j.totalPages||1;
    for(const a of (j.items||[])){
      if(!a.geometry) continue;
      // FIR/UIR/ADIZ/ACCセクターは日本全体を覆う巨大空域のため描画対象外
      if([10,11,12,27].includes(a.type)) continue;
      items.push({
        name:a.name||'',
        type:a.type,
        lower:fmtLimit(a.lowerLimit),
        upper:fmtLimit(a.upperLimit),
        geometry:a.geometry,
      });
    }
    page++;
  }while(page<=totalPages && page<=30);
  return items;
}

async function syncAirspace(){
  const key=document.getElementById('as-key').value.trim();
  if(!key){ showToast('OpenAIPのAPIキーを入力してください',true); return; }
  try{localStorage.setItem('openaip-key',key);}catch(e){}
  const btn=document.getElementById('as-update');
  btn.disabled=true; btn.textContent='取得中...';
  try{
    const items=await fetchOpenAIP(key);
    if(items.length===0) throw new Error('データが0件でした');
    airspaceStore={fetchedAt:Date.now(),items};
    await idbSet('openaip-airspaces',airspaceStore);
    if(map) buildAirspace();
    updateAsStatus();
    showToast(`空域データ ${items.length.toLocaleString()}件を取得しました`);
  }catch(err){
    showToast('空域取得エラー: '+err.message,true);
    console.error(err);
  }finally{
    btn.disabled=false; btn.textContent='最新データを取得';
  }
}

function openAsModal(){
  document.getElementById('as-key').value=localStorage.getItem('openaip-key')||'';
  updateAsStatus();
  document.getElementById('as-overlay').classList.add('active');
}
function closeAsModal(){document.getElementById('as-overlay').classList.remove('active');}
function updateAsStatus(){
  const el=document.getElementById('as-status');
  if(airspaceStore && airspaceStore.items && airspaceStore.items.length){
    const d=new Date(airspaceStore.fetchedAt);
    el.textContent=`OpenAIPデータ使用中: ${airspaceStore.items.length.toLocaleString()}件（${d.toLocaleDateString('ja-JP')}取得）`;
    el.style.color='var(--green)';
  }else{
    el.textContent='内蔵データ（参考・鮮度不明）を表示中。APIキーを設定して最新の空域データを取得してください。';
    el.style.color='var(--orange)';
  }
}

function calcEta(nm, g){
  if(!nm||!g||g<=0||nm<=0) return '--:--';
  const arrMs = Date.now() + (nm/g)*3600000;
  const jst = new Date(arrMs + 9*3600000);
  return String(jst.getUTCHours()).padStart(2,'0')+':'+String(jst.getUTCMinutes()).padStart(2,'0')+' JST';
}
function updateMap(){
  if(!map) return;
  const hasSel = !!selWp;
  const hasPos = !!pos;

  // 現在地マーカー
  if(hasPos){
    posMarker.setLatLng([pos.lat, pos.lon]);
    if(!map.hasLayer(posMarker)) posMarker.addTo(map);
  } else {
    if(map.hasLayer(posMarker)) map.removeLayer(posMarker);
  }

  // WPマーカー
  if(hasSel){
    wpMarker.setLatLng([selWp.lat, selWp.lon]);
    wpMarker.bindTooltip(selWp.id, {permanent:true, direction:'top', offset:[0,-10], className:'wp-label', opacity:0.9});
    if(!map.hasLayer(wpMarker)) wpMarker.addTo(map);
  } else {
    if(map.hasLayer(wpMarker)) map.removeLayer(wpMarker);
  }

  // 経路ライン
  if(hasPos && hasSel){
    routeLine.setLatLngs([[pos.lat,pos.lon],[selWp.lat,selWp.lon]]);
    const brg  = calcBrg(pos.lat,pos.lon,selWp.lat,selWp.lon);
    const dist = calcNM(pos.lat,pos.lon,selWp.lat,selWp.lon);
    const ete  = fmtEte(dist,effGs());
    const eta  = calcEta(dist,effGs());
    document.getElementById('mc-brg').textContent  = String(Math.round(brg)).padStart(3,'0')+'°M';
    document.getElementById('mc-dist').textContent = dist.toFixed(1);
    document.getElementById('mc-ete').textContent  = ete;
    document.getElementById('mc-eta').textContent  = eta;
    // トラッキングモード時のみ地図を自動移動
    if(mapTracking) map.setView([pos.lat, pos.lon], map.getZoom());
  } else if(hasSel){
    routeLine.setLatLngs([]);
    document.getElementById('mc-brg').textContent='---°';
    document.getElementById('mc-dist').textContent='---';
    document.getElementById('mc-ete').textContent='--:--';
    document.getElementById('mc-eta').textContent='--:--';
  } else if(hasPos){
    routeLine.setLatLngs([]);
    document.getElementById('mc-brg').textContent='---°';
    document.getElementById('mc-dist').textContent='---';
    document.getElementById('mc-ete').textContent='--:--';
    document.getElementById('mc-eta').textContent='--:--';
    if(mapTracking) map.setView([pos.lat, pos.lon], map.getZoom());
  } else {
    routeLine.setLatLngs([]);
    document.getElementById('mc-brg').textContent='---°';
    document.getElementById('mc-dist').textContent='---';
    document.getElementById('mc-ete').textContent='--:--';
    document.getElementById('mc-eta').textContent='--:--';
  }
}

// 経路全体表示
function fitRoute(){
  if(!map) return;
  const hasSel = !!selWp;
  const hasPos = !!pos;
  if(hasPos && hasSel){
    map.fitBounds([[pos.lat,pos.lon],[selWp.lat,selWp.lon]], {padding:[60,60]});
  } else if(hasSel){
    map.setView([selWp.lat,selWp.lon], 12);
  } else if(hasPos){
    map.setView([pos.lat,pos.lon], 12);
  }
  // fitRouteを押したらトラッキングは解除
  if(mapTracking) setTracking(false);
  // ボタンを一瞬点灯させる
  const btn = document.getElementById('btn-fit-route');
  btn.classList.add('active');
  setTimeout(()=>btn.classList.remove('active'), 600);
}

// トラッキングON/OFF
function toggleTracking(){
  setTracking(!mapTracking);
}
function setTracking(on){
  mapTracking = on;
  const btn = document.getElementById('btn-track');
  if(btn) btn.classList.toggle('active', on);
  if(on && pos && map){
    map.setView([pos.lat, pos.lon], map.getZoom());
  }
}

// ── Service Worker（オフライン対応） ─────────────────────────────────────────
// アプリ本体・Leaflet/JSZip/フォント・表示済み地図タイルをキャッシュし、
// 一度オンラインで開いた後はオフラインでも起動・地図表示できるようにする
if('serviceWorker' in navigator && (location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname))){
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

// ── Init ──────────────────────────────────────────────────────────────────────
drawHSI(null,0,false);
loadDB();
startGPS();
switchTab('hsi'); // 初期タブ
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();closeAsModal();}});
// 保存済みのOpenAIP空域データを読み込み（マップ初期化済みなら再描画）
idbGet('openaip-airspaces').then(s=>{
  if(s && s.items && s.items.length){
    airspaceStore=s;
    if(map) buildAirspace();
  }
}).catch(e=>console.error(e));
