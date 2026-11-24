
/** Authoritative events contain the entire invoice; visible sheets are projections. */
function extCatalog_(state) {
 const products={};
 Object.values(state.invoice).filter(x=>x.status==='confirmed').forEach(inv=>inv.lines.forEach(l=>{
  products[l.productId]={id:l.productId,supplier:inv.supplier.name,name:l.name,sku:l.sku,unit:l.unit,aliases:[],conversions:{}};
 }));
 Object.values(state.product).forEach(p=>{products[p.id]={...products[p.id],...p};});
 return products;
}
function saveExtensionProduct(input) { return locked_(()=>{
 extEnvironment_(); const supplier=extSupplier_(input.supplier), name=extText_(input.name,150);
 if(!name)throw Error('品名を入力してください');
 const sku=extText_(input.sku,100),id=extId_('p_',supplier.id+'|'+(sku?'sku:'+sku:'name:'+extNormalize_(name)));
 const conversions={};
 Object.entries(input.conversions||{}).forEach(([unit,factor])=>{const n=extNumber_(factor,true);if(n<=0)throw Error('換算係数は0より大きい値です');conversions[extText_(unit,30)]=n;});
 const value={id,supplier:supplier.name,name,sku,unit:extText_(input.unit,30),aliases:(input.aliases||[]).map(x=>extText_(x,100)).slice(0,30),conversions};
 const result=extWrite_('product',id,input.version,input,value);extProject_();return result.value;
 });}
function extLinkKey_(link) {return link ? link.month+'|'+link.recordId+'|'+link.itemIndex : '';}
function extValidateLink_(link,state,invoiceId) {
 if(!link)return null;
 const month=extMonth_(link.month),book=month_(month,false),record=records_(book,'仕入').find(r=>r.id===link.recordId);
 const item=record&&record.items[Number(link.itemIndex)];
 if(!item||!Number.isInteger(Number(link.itemIndex))||JSON.stringify(item)!==link.fingerprint)throw Error('連携する簡易仕入れが変わりました');
 const key=extLinkKey_(link);
 if(Object.values(state.invoice).some(i=>i.id!==invoiceId&&extLinkKey_(i.legacyLink)===key))throw Error('この簡易仕入れは別の伝票に連携済みです');
 return {month,recordId:record.id,itemIndex:Number(link.itemIndex),fingerprint:JSON.stringify(item),date:record.date,item};
}
function saveExtensionInvoice(input) {return locked_(()=>{
 extEnvironment_();date_(input.date);const replay=extReplay_('invoice',input.id,input);if(replay){extProject_();rebuild_(month_(input.date.slice(0,7),true),input.date.slice(0,7));return {invoice:replay,message:'保存済みの伝票を再集計しました'};}const state=extState_(),supplier=extSupplier_(input.supplier),id=extText_(input.id,100);
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(id))throw Error('伝票IDが不正です');
 const old=state.invoice[id];
 if(old&&old.date.slice(0,7)!==input.date.slice(0,7))throw Error('月の変更は取消後に新規登録してください');
 const type=input.type==='return'?'return':'delivery',status=input.status==='cancelled'?'cancelled':'confirmed';
 const taxMode=extText_(input.taxMode);
 if(!['gross','net','monthly'].includes(taxMode))throw Error('税込・税別・月締税を選択してください');
 const usesUnit=supplier.name!=='カクヤス';
 const lines=(input.lines||[]).map((x,index)=>{
  const name=extText_(x.name,150),sku=extText_(x.sku,100),unit=usesUnit?extText_(x.unit,30):'',category=extText_(x.category||'食材');
  if(!name||!['食材','飲料','雑費','容器'].includes(category))throw Error((index+1)+'行目の品名・分類を確認してください');
  const qty=extNumber_(x.qty,false);
  const credit=!usesUnit&&type==='delivery'&&/廃油回収/.test(name)&&Number(x.amount)<0;
  const price=credit&&Number(x.price)<0?-extNumber_(-Number(x.price),true):extNumber_(x.price,false);
  const amount=credit?-extNumber_(-Number(x.amount),true):extNumber_(x.amount,true);
  if(credit&&(price!==null&&price>=0||qty!==null&&price!==null&&Math.abs(qty*price-amount)>0.000001))throw Error('廃油回収の数量×単価と明細金額を確認してください');
  const rate=x.rate===''||x.rate==null?null:Number(x.rate);
  if(rate!==null&&![0,8,10].includes(rate))throw Error('税率を確認してください');
  if(qty!==null&&price!==null&&Math.abs(qty*price-amount)>1&&!extText_(x.reason))throw Error('数量×単価と明細金額が違います。行の理由を入力してください');
  return {productId:extId_('p_',supplier.id+'|'+(sku?'sku:'+sku:'name:'+extNormalize_(name))),sku,name,qty,unit,price,amount,category:credit?'雑費':category,rate,...(category==='雑費'&&!credit&&['食材','飲料'].includes(x.baseCategory)?{
   baseCategory:x.baseCategory,baseRate:['','0','8','10'].includes(String(x.baseRate??''))?String(x.baseRate??''):''
  }:{}),reason:extText_(x.reason)};
 });
 if(lines.length>100)throw Error('明細は100行以内です');
 const printedTotal=extNumber_(input.printedTotal,true),tax=extNumber_(input.tax,false),adjustment=Number(input.adjustment||0);
 if(!Number.isFinite(adjustment)||Math.abs(adjustment)>1e9)throw Error('調整額を確認してください');
 if(taxMode==='net'&&tax===null)throw Error('税別伝票の税額を入力してください');
 const total=printedTotal+(taxMode==='net'?tax:0);
 const sum=lines.reduce((s,l)=>s+l.amount,0)+adjustment;
 const reason=extText_(input.reason);
 if(lines.length&&Math.abs(sum-printedTotal)>1&&!reason)throw Error('明細合計と伝票金額の差の理由を入力してください');
 if(type==='return'&&lines.some(l=>l.category!=='容器'))throw Error('容器回収の分類は容器です');
 const invoiceNumber=extText_(input.invoiceNumber,100);
 const duplicate=Object.values(state.invoice).filter(i=>i.id!==id&&i.status==='confirmed'&&i.supplier.id===supplier.id&&
  (invoiceNumber?i.invoiceNumber===invoiceNumber:i.date===input.date&&i.printedTotal===printedTotal));
 if(duplicate.length&&!input.duplicateConfirmed) return {needsDuplicateConfirmation:true,candidates:duplicate.map(i=>({id:i.id,date:i.date,invoiceNumber:i.invoiceNumber}))};
 const files=(input.fileIds||[]).map(fid=>{const f=state.file[fid];if(!f)throw Error('添付原本が見つかりません');return {id:f.id,url:f.url,name:f.name};});
 const legacyLink=extValidateLink_(input.legacyLink||old&&old.legacyLink,state,id);
 if(legacyLink&&(legacyLink.item.name!==supplier.name||legacyLink.date!==input.date))throw Error('簡易仕入れと日付・仕入先を合わせてください');
 const value={id,date:input.date,supplier,invoiceNumber,type,status,taxMode,tax,printedTotal,total,adjustment,reason,lines,files,
  legacyLink,detailsMissing:lines.length===0,updatedAt:new Date().toISOString()};
 const result=extWrite_('invoice',id,input.version,input,value);
 extProject_();const b=month_(input.date.slice(0,7),true);rebuild_(b,input.date.slice(0,7));
 return {invoice:result.value,message:'伝票を保存しました'};
 });}
function extGrossLine_(invoice,line) {
 if(invoice.taxMode==='gross')return line.amount;
 if(line.rate===null)return null;
 return line.amount*(1+line.rate/100);
}
function extInvoiceBuckets_(invoice) {
 const buckets={食材:0,飲料:0,雑費:0,容器:0},sign=invoice.type==='return'?-1:1;
 if(!invoice.lines.length){buckets[invoice.supplier.name==='カクヤス'||invoice.supplier.name==='島崎'?'飲料':'食材']=sign*invoice.total;return buckets;}

 invoice.lines.forEach(l=>{const gross=extGrossLine_(invoice,l);buckets[l.category]+=invoice.taxMode==='net'&&gross!==null?gross:l.amount;});
 const basis=Object.values(buckets).reduce((a,b)=>a+b,0),keys=Object.keys(buckets).filter(k=>buckets[k]!==0),target=invoice.total;
 if(!keys.length){buckets.雑費=sign*target;return buckets;}
 // Preserve known per-line tax rates. Allocate only rounding/explicit adjustments across categories.
 const delta=target-basis;let allocated=0;
 keys.forEach((key,index)=>{const add=index===keys.length-1?delta-allocated:(basis?Math.round(delta*buckets[key]/basis):0);allocated+=add;buckets[key]=sign*(buckets[key]+add);});

 return buckets;
}
function extOverlayPurchases_(book,key,matrix) {
 const state=extState_(),cols={'キタニ水産':0,maruyasu:1,'プレコフーズ':2,'西原':3,'島崎':6,'カクヤス':7};
 Object.values(state.invoice).filter(i=>i.date.slice(0,7)===key).forEach(i=>{
  if(i.legacyLink){const l=i.legacyLink;matrix[Number(l.date.slice(8))-1][cols[l.item.name]]-=l.item.amount;}
  if(i.status!=='confirmed')return;
  const b=extInvoiceBuckets_(i),column=cols[i.supplier.name];
  if(column!==undefined)matrix[Number(i.date.slice(8))-1][column]+=b.食材+b.飲料+b.容器;
 });
 Object.values(state.tax).filter(t=>t.month===key).forEach(t=>{
  const col=cols[t.supplier];if(extTaxFresh_(t,state)&&col!==undefined)matrix[Number(extEnd_(key).slice(8))-1][col]+=t.foodTax+t.drinkTax;
 });
 book.getSheetByName('仕入れ').getRange('C3:K33').setValues(matrix);
}
function saveExtensionMonthlyTax(input){return locked_(()=>{
 const month=extMonth_(input.month),supplier=extSupplier_(input.supplier),state=extState_();
 const pending=Object.values(state.invoice).filter(i=>i.status==='confirmed'&&i.taxMode==='monthly'&&i.date.slice(0,7)===month&&i.supplier.id===supplier.id);
 if(!pending.length)throw Error('月締税待ちの伝票がありません');
 const value={id:supplier.id+'_'+month,month,supplier:supplier.name,
  foodTax:extNumber_(input.foodTax,true),drinkTax:extNumber_(input.drinkTax,true),miscTax:extNumber_(input.miscTax,true),
  invoiceVersions:pending.map(i=>i.id+':'+i.version).sort(),note:extText_(input.note)};
 const result=extWrite_('tax',value.id,input.version,input,value);extProject_();rebuild_(month_(month,true),month);return result.value;
 });}
function extTaxFresh_(tax,state){
 const pending=Object.values(state.invoice).filter(i=>i.status==='confirmed'&&i.taxMode==='monthly'&&i.date.slice(0,7)===tax.month&&i.supplier.name===tax.supplier).map(i=>i.id+':'+i.version).sort();
 return JSON.stringify(pending)===JSON.stringify(tax.invoiceVersions);
}
function extProject_(targetBook,projectionState){
 const state=projectionState||extState_(),book=targetBook||extBook_(),invoices=Object.values(state.invoice);
 extTable_(book,EXT_SCHEMA.invoices,['伝票ID','版','納品日','仕入先','伝票番号','種別','状態','税区分','伝票印字額','税額','記録合計','食材','飲料','雑費','容器','明細状態','原本','理由'],invoices.map(i=>{
  const b=extInvoiceBuckets_(i);return [i.id,i.version,i.date,i.supplier.name,i.invoiceNumber,i.type,i.status,i.taxMode,i.printedTotal,i.tax,i.total,b.食材,b.飲料,b.雑費,b.容器,i.detailsMissing?'明細未入力':'明細あり',i.files.map(f=>f.url).join('\n'),i.reason];
 }));
 extTable_(book,EXT_SCHEMA.lines,['伝票ID','状態','納品日','仕入先','品目ID','商品コード','品名','数量','単位','単価','明細金額','税区分','税率','分類','理由'],invoices.flatMap(i=>i.lines.map(l=>[i.id,i.status,i.date,i.supplier.name,l.productId,l.sku,l.name,l.qty,l.unit,l.price,l.amount,i.taxMode,l.rate,l.category,l.reason])));
 extTable_(book,EXT_SCHEMA.catalog,['品目ID','仕入先','商品コード','品名','棚卸単位','検索別名','換算JSON'],Object.values(extCatalog_(state)).map(p=>[p.id,p.supplier,p.sku,p.name,p.unit,p.aliases.join('、'),JSON.stringify(p.conversions)]));
 extTable_(book,EXT_SCHEMA.taxes,['ID','対象月','仕入先','食材税額','飲料税額','雑費税額','状態','備考'],Object.values(state.tax).map(t=>[t.id,t.month,t.supplier,t.foodTax,t.drinkTax,t.miscTax,extTaxFresh_(t,state)?'確認済み':'要再確認',t.note]));
 extTable_(book,EXT_SCHEMA.files,['ID','対象月','ファイル名','原本URL'],Object.values(state.file).map(f=>[f.id,f.month,f.name,f.url]));
 if(typeof extProjectStock_==='function')extProjectStock_(book,state);
 if(!targetBook)extProjectMonthly_(state);
}
function rebuildExtensionViews(){return locked_(()=>{extProject_();const p=extEnvironment_().getProperties();Object.keys(p).filter(k=>/^MONTH_/.test(k)).forEach(k=>rebuild_(month_(k.slice(6),false),k.slice(6)));return '再集計しました';});}

function extProjectMonthly_(state){
 const months=new Set([...Object.values(state.invoice).map(i=>i.date.slice(0,7)),...Object.values(state.stock).map(s=>s.month),...Object.values(state.tax).map(t=>t.month)]);
 months.forEach(month=>{
  const book=month_(month,true);if(!book)return;
  const subset={...state,invoice:Object.fromEntries(Object.entries(state.invoice).filter(([,i])=>i.date.slice(0,7)===month)),
   tax:Object.fromEntries(Object.entries(state.tax).filter(([,t])=>t.month===month)),file:Object.fromEntries(Object.entries(state.file).filter(([,f])=>f.month===month))};
  // Include previous months only for inventory freshness validation, but display target-month rows.
  extProject_(book,{...subset,stock:{}});
  const allStocks={...state.stock};Object.values(allStocks).filter(s=>s.month!==month).forEach(s=>delete allStocks[s.month]);
  const data=Object.values(allStocks).flatMap(s=>s.rows.map(r=>[s.month,s.date,s.version,s.status,extStockFresh_(s,state)?'':'要再確認',s.implementer,s.reviewer,s.requestedAt,s.confirmedAt,r.productId,r.supplier,r.name,r.qty,r.unit,r.price,r.amount,r.zeroStreak,r.priceSource]));
  extTable_(book,EXT_SCHEMA.inventory,['対象月','基準日','版','状態','再確認','実施者','確認者','確認依頼日時','確定日時','品目ID','仕入先','品名','数量','単位','税込単価','棚卸金額','連続ゼロ月数','単価採用元'],data);
 });
}

/** Independent transactions: one failed invoice cannot roll back other saved invoices. */
function saveExtensionReceiptBatch(input){
 extEnvironment_();
 if(!input||!Array.isArray(input.records)||!input.records.length||input.records.length>20)throw Error('一度の保存は1〜20伝票です');
 const ids=new Set();
 input.records.forEach(r=>{if(ids.has(r.id))throw Error('保存する伝票IDが重複しています');ids.add(r.id);});
 return {results:input.records.map(record=>{
  try{
   const result=saveExtensionInvoice(record);
   if(result.needsDuplicateConfirmation)return {id:record.id,status:'duplicate',candidates:result.candidates};
   return {id:record.id,status:'saved',invoice:result.invoice};
  }catch(error){return {id:record.id,status:'failed',error:error&&error.message||String(error||'保存に失敗しました')};}
 })};
}
