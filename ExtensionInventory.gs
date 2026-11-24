
function extStockSources_(month,state){
 const prev=state.stock[extShift_(month,-1)],catalog=extCatalog_(state),chosen={},rows={};
 if(prev&&prev.status==='confirmed')prev.rows.forEach(r=>{
  if(r.zeroStreak>=2)return;
  rows[r.productId]={...r,qty:null,previousQty:r.qty,priceSource:'前月確定',zeroStreak:r.zeroStreak||0};
 });
 const invoices=Object.values(state.invoice).filter(i=>i.status==='confirmed'&&i.type==='delivery'&&i.date.slice(0,7)===month)
  .sort((a,b)=>a.date.localeCompare(b.date)||a.updatedAt.localeCompare(b.updatedAt)||a.id.localeCompare(b.id));
 invoices.forEach(i=>i.lines.filter(l=>['食材','飲料'].includes(l.category)).forEach(l=>{
  const p=catalog[l.productId],unit=p&&p.unit||l.unit;
  let price=l.price,problem='';
  if(price===null)problem='単価未入力';
  if(price!==null&&i.taxMode!=='gross'){if(l.rate===null){price=null;problem='税率未確認';}else price*=1+l.rate/100;}
  if(price!==null&&unit!==l.unit){
   const factor=p&&p.conversions[l.unit];
   if(!factor){price=null;problem='単位換算未登録';}else price/=factor;
  }
  chosen[l.productId]=i.id+':'+i.version;
  rows[l.productId]={productId:l.productId,name:l.name,supplier:i.supplier.name,unit,qty:null,price,
   priceSource:i.id,sourceUrl:i.files[0]&&i.files[0].url||'',problem,zeroStreak:rows[l.productId]&&rows[l.productId].zeroStreak||0};
 }));
 const fingerprint=extHash_(JSON.stringify({
  invoices:invoices.map(i=>i.id+':'+i.version),products:extStockProductVersions_(invoices,prev,state),
  previous:prev?prev.version:0,previousFresh:prev?extStockFresh_(prev,state):true
 }));
 return {rows:Object.values(rows),fingerprint,previous:prev||null};
}
function extStockFresh_(stock,state,seen){
 if(!stock||!stock.sourceFingerprint)return false;
 seen=seen||{};if(seen[stock.month])return false;seen[stock.month]=true;
 const prev=state.stock[extShift_(stock.month,-1)];
 const invoices=Object.values(state.invoice).filter(i=>i.status==='confirmed'&&i.type==='delivery'&&i.date.slice(0,7)===stock.month)
  .sort((a,b)=>a.date.localeCompare(b.date)||a.updatedAt.localeCompare(b.updatedAt)||a.id.localeCompare(b.id));
 const fingerprint=extHash_(JSON.stringify({invoices:invoices.map(i=>i.id+':'+i.version),products:Object.values(state.product).map(p=>p.id+':'+p.version).sort(),
  previous:prev?prev.version:0,previousFresh:prev?extStockFresh_(prev,state,seen):true}));
 return fingerprint===stock.sourceFingerprint;
}
function getExtensionStock(input){return locked_(()=>{
 const month=extMonth_(input.month),state=extState_(),source=extStockSources_(month,state),saved=state.stock[month];
 if(saved)return {...saved,fresh:extStockFresh_(saved,state),latestRows:source.rows,latestFingerprint:source.fingerprint};
 return {month,date:extEnd_(month),version:0,status:'draft',rows:source.rows,sourceFingerprint:source.fingerprint,fresh:true};
 });}
function saveExtensionStock(input){return locked_(()=>{
 const month=extMonth_(input.month),replay=extReplay_('stock',month,input);if(replay){extProject_();return {...replay,fresh:extStockFresh_(replay,extState_())};}const state=extState_(),old=state.stock[month],source=extStockSources_(month,state);
 const action=input.action||'draft',names=['高杉','荒川'];
 if(!['draft','review','confirm','return','reopen','refresh'].includes(action))throw Error('棚卸操作が不正です');
 if(input.sourceFingerprint!==source.fingerprint&&action!=='refresh'&&!['reopen','return'].includes(action))throw Error('仕入れ・前月棚卸が変わりました。「最新の単価を反映」してください');
 if(old&&['review','confirmed'].includes(old.status)&&!['confirm','return','reopen'].includes(action))throw Error('確認中・確定済みの棚卸は差戻しまたは再開してください');
 if(action==='confirm'&&(!old||old.status!=='review'))throw Error('先に確認依頼してください');
 if(action==='reopen'&&(!old||old.status!=='confirmed'))throw Error('確定済みのみ再開できます');
 if(action==='return'&&(!old||old.status!=='review'))throw Error('確認待ちのみ差し戻せます');
 const sourceMap=Object.fromEntries(source.rows.map(r=>[r.productId,r])),oldMap=Object.fromEntries((old&&old.rows||[]).map(r=>[r.productId,r]));
 let rows=(input.rows||[]).map(x=>{
  const ref=sourceMap[x.productId]||oldMap[x.productId],p=extCatalog_(state)[x.productId];
  if(!ref&&!p)throw Error('品目台帳へ先に登録してください');
  const row={...ref,productId:x.productId,name:ref&&ref.name||p.name,supplier:ref&&ref.supplier||p.supplier,
   unit:ref&&ref.unit||p.unit,qty:extNumber_(x.qty,false)};
  // Prices obtained from confirmed purchases cannot be overwritten by the browser.
  if(!sourceMap[x.productId]){row.price=extNumber_(x.price,false);row.priceSource='手動';row.problem='';row.zeroStreak=0;}
  if(action==='refresh'&&sourceMap[x.productId])Object.assign(row,sourceMap[x.productId],{qty:extNumber_(x.qty,false)});
  return row;
 });
 if(new Set(rows.map(r=>r.productId)).size!==rows.length)throw Error('同じ品目が重複しています');
 if(source.rows.some(r=>!rows.some(x=>x.productId===r.productId)))throw Error('対象品目が不足しています。最新の一覧を読み込んでください');
 let status='draft',implementer=extText_(input.implementer),reviewer=extText_(input.reviewer),requestedAt=old&&old.requestedAt||'';
 if(['review','confirm'].includes(action)){
  if(!names.includes(implementer)||!names.includes(reviewer)||implementer===reviewer)throw Error('実施者と確認者は異なる2名を選択してください');
  if(!rows.length||rows.some(r=>r.qty===null||r.price===null||r.price===undefined||!r.unit||r.problem))throw Error('全品目の数量・単位・税込単価・換算を確認してください');
  if(source.previous&&source.previous.status!=='confirmed')throw Error('前月棚卸を確定してください');
  if(source.previous&&!extStockFresh_(source.previous,state))throw Error('前月棚卸を再確認・確定してください');
  status=action==='review'?'review':'confirmed';if(action==='review')requestedAt=new Date().toISOString();
 }
 if(action==='confirm'){
  if(JSON.stringify(input.rows.map(r=>[r.productId,r.qty]))!==JSON.stringify(old.rows.map(r=>[r.productId,r.qty]))||implementer!==old.implementer||reviewer!==old.reviewer)throw Error('確認依頼後に数量・担当者を変更できません');
  rows=old.rows.map(r=>({...r}));implementer=old.implementer;reviewer=old.reviewer;
 }
 rows.forEach(r=>{
  const previous=source.previous&&source.previous.status==='confirmed'&&source.previous.rows.find(x=>x.productId===r.productId);
  r.zeroStreak=r.qty===0?(previous&&previous.qty===0?(previous.zeroStreak||1)+1:1):0;
  r.amount=r.qty===null||r.price===null||r.price===undefined?null:Math.round(r.qty*r.price);
 });
 const value={month,date:extEnd_(month),status,implementer,reviewer,requestedAt,
  confirmedAt:status==='confirmed'?new Date().toISOString():'',rows,sourceFingerprint:source.fingerprint};
 const result=extWrite_('stock',month,input.version,input,value);extProject_();return {...result.value,fresh:true};
 });}
function extProjectStock_(book,state){
 extTable_(book,EXT_SCHEMA.inventory,['対象月','基準日','版','状態','再確認','実施者','確認者','確認依頼日時','確定日時','品目ID','仕入先','品名','数量','単位','税込単価','棚卸金額','連続ゼロ月数','単価採用元'],
 Object.values(state.stock).flatMap(s=>s.rows.map(r=>[s.month,s.date,s.version,s.status,extStockFresh_(s,state)?'':'要再確認',s.implementer,s.reviewer,s.requestedAt,s.confirmedAt,r.productId,r.supplier,r.name,r.qty,r.unit,r.price,r.amount,r.zeroStreak,r.priceSource])));
}

function extStockProductVersions_(invoices,previous,state){
 const ids=new Set(invoices.flatMap(i=>i.lines.map(l=>l.productId)));
 if(previous)previous.rows.forEach(r=>ids.add(r.productId));
 return Object.values(state.product).filter(p=>ids.has(p.id)).map(p=>p.id+':'+p.version).sort();
}
