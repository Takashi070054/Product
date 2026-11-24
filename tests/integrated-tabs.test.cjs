
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const script=fs.readFileSync('ExtensionClient.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.value='';this.hidden=false;this.attributes={};this.classList={toggle(){}};this.style={};this.parentElement=null;}
 append(...elements){elements.forEach(e=>{if(typeof e==='string')return;if(e.parentElement)e.parentElement.children=e.parentElement.children.filter(x=>x!==e);e.parentElement=this;this.children.push(e);});}
 replaceChildren(...elements){this.children.forEach(e=>e.parentElement=null);this.children=[];this.append(...elements);}
 setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}addEventListener(){}scrollIntoView(){}showModal(){this.open=true;}close(){this.open=false;}remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(e=>e!==this);}
 querySelectorAll(selector){const all=this.children.flatMap(e=>[e,...e.querySelectorAll('*')]);if(selector==='*')return all;
 if(selector==='[data-key]')return all.filter(e=>e.dataset.key);return all.filter(e=>e.tag===selector);}
}
const elements={},el=id=>elements[id]||(elements[id]=new Element()),nav=new Element('nav'),actions=new Element();
const sections=['売上','仕入','小口','入金','棚卸','AI'].map(id=>el(id));
const calls=[];
const context={suppliers:['キタニ水産'],products:[],invoices:[],legacy:[],taxes:[]};
const listeners={};
const sandbox={window:{location:{origin:'https://example-script.googleusercontent.com'},addEventListener(name,fn){listeners[name]=fn;}},console,crypto,structuredClone,URL,URLSearchParams,Blob,File,setTimeout,clearTimeout,$:el,document:{getElementById:el,createElement:t=>new Element(t),
 querySelector:s=>s==='nav'?nav:actions,
 querySelectorAll:s=>s==='section'?sections:s==='nav button'?nav.children:[]},
 render(){sections.forEach(e=>e.hidden=e!==el(sandbox.tab));},capture(){},current(){return {date:sandbox.activeDate};},
 save(){calls.push('legacySave');},setBusy:v=>{sandbox.busy=v;},showStatus:(...v)=>calls.push(v),confirm:()=>true,
 rpc:async(name,arg)=>{calls.push({name,arg});return name==='extensionContext'?structuredClone(context):{};},
 row(){},totals(){},PAY:['現金','クレジット'],tab:'売上',activeDate:'2026-11-20',day:{},busy:false};
vm.createContext(sandbox);vm.runInContext(script,sandbox);
const run=s=>vm.runInContext(s,sandbox);
async function main(){
 assert.equal(el('extInvoicePanel').parentElement,el('extPurchaseInvoiceHost'));
 assert.deepEqual(nav.children.map(e=>e.dataset.tab),['棚卸','AI']);
 sandbox.render();await Promise.resolve();
 assert.equal(el('extOcrPanel').parentElement,el('extJournalOcrHost'));
 assert.equal(el('extOcrKind').value,'journal');assert.equal(el('extOcrPanel').hidden,true);
 sandbox.tab='仕入';sandbox.render();await Promise.resolve();
 assert.equal(el('extOcrPanel').parentElement,el('extPurchaseOcrHost'));assert.equal(el('extOcrKind').value,'invoice');
 assert.equal(el('extManualPurchase').hidden,true);assert.equal(el('extOcrPanel').hidden,false);
 assert.equal(el('entryDate').hidden,true);
 run('extEditInvoice(null)');
 el('extManualMode').onclick();
 assert.equal(el('entryDate').hidden,false);
 assert.equal(el('extManualPurchase').hidden,false);assert.equal(el('extPurchaseOcrHost').hidden,true);
 assert.equal(el('extInvoicePanel').hidden,false);assert.equal(actions.hidden,false);
 assert.equal(el('save').textContent,'仕入先・金額を保存');
 el('extSupplier').value='キタニ水産';el('extTotal').value='5079';
 sandbox.capture();sandbox.tab='売上';sandbox.render();sandbox.tab='仕入';sandbox.render();await Promise.resolve();
 assert.equal(el('extTotal').value,'5079');
 el('extOpenInvoiceOcr').onclick();
 assert.equal(el('entryDate').hidden,true);
 sandbox.tab='売上';sandbox.render();await Promise.resolve();
 assert.equal(el('entryDate').hidden,false);
 sandbox.tab='仕入';sandbox.render();await Promise.resolve();

 // Different dates remain independent; the modal renders editable table rows.
 run("extReceiptQueue.push({id:'receipt_oct',kind:'invoice',status:'ready',uploads:[{file:{name:'oct.jpg'}}],sources:[{id:'raw_oct',url:'https://drive.google.com/file/d/oct/view'}],texts:['原文'],draft:{kind:'invoice',date:'2026-10-31',supplier:'キタニ水産',printedTotal:100,type:'delivery',taxMode:'gross',tax:null,lines:[],warnings:[]}});");
 run("extOpenReceiptReview('receipt_oct')");
 assert.equal(el('extReceiptDialog').open,true);assert.equal(el('extReviewDate').value,'2026-10-31');
 assert.equal(el('extReviewHead').children[0].children[0].textContent,'資材');
 assert.equal(el('extReviewHead').children[0].children[1].textContent,'税率');
 const classification=sandbox.extLineClassification({rate:8},'カクヤス');
 const classRow=new Element('tr');
 classRow.append(classification.category,classification.material,classification.rate);
 classification.category.extSyncLineType('delivery');
 assert.equal(classification.category.value,'飲料');
 assert.equal(sandbox.extLineClassification({},'丸安商店').category.value,'食材');
 classification.material.checked=true;
 classification.material.onchange();
 assert.equal(classification.rate.value,'10');
 assert.deepEqual({...sandbox.extReadInvoiceLine(classRow)},{category:'雑費',rate:'10',baseCategory:'飲料',baseRate:'8'});
 classification.material.checked=false;
 classification.material.onchange();
 assert.equal(classification.rate.value,'8');
 classification.category.extSyncLineType('return');
 assert.equal(classification.category.value,'容器');
 assert.equal(classification.material.hidden,true);
 await el('extReviewConfirm').onclick();
 assert.equal(run("extReceiptQueue[0].status"),'confirmed');
 run("extReceiptQueue.push({id:'receipt_nov',kind:'invoice',status:'confirmed',uploads:[{file:{name:'nov.jpg'}}],sources:[{id:'raw_nov'}],texts:[],draft:{kind:'invoice',date:'2026-11-02',supplier:'西原',printedTotal:200,type:'delivery',taxMode:'gross',tax:null,adjustment:0,reason:'',lines:[],warnings:[]}})");
 const requests=[];let attempts=0;
 sandbox.rpc=async(name,arg)=>{
  if(name==='saveExtensionReceiptBatch'){
   requests.push(structuredClone(arg));attempts++;
   return {results:arg.records.map((r,i)=>attempts===1&&i===1?{id:r.id,status:'failed',error:'一時エラー'}:{id:r.id,status:'saved',invoice:{...r,version:1}})};
  }
  return name==='extensionContext'?structuredClone(context):{};
 };
 await el('extSaveBatch').onclick();
 assert.equal(requests[0].records[0].date,'2026-10-31');assert.equal(requests[0].records[1].date,'2026-11-02');
 assert.equal(run('extReceiptQueue[0].status'),'saved');assert.equal(run('extReceiptQueue[1].status'),'saveFailed');
 const retryToken=requests[0].records[1].opId;
 await el('extSaveBatch').onclick();assert.equal(requests[1].records.length,1);
 assert.equal(requests[1].records[0].opId,retryToken);assert.equal(run('extReceiptQueue[1].status'),'saved');
 // Grouping is explicit and never sums all printed totals.
 const page=(id,total,date='2026-10-31')=>({id,kind:'invoice',uploads:[],sources:[],texts:[],draft:{date,supplier:'maruyasu',printedTotal:total,tax:null,invoiceNumber:'001',lines:[],warnings:[]}});
 const grouped=sandbox.extMergeReceiptModels([page('p1',null),page('p2',2640)],'grouped');
 assert.equal(grouped.draft.printedTotal,2640);
 const ambiguous=sandbox.extMergeReceiptModels([page('p1',100),page('p2',200,'2026-11-01')],'ambiguous');
 assert.equal(ambiguous.draft.printedTotal,null);assert.equal(ambiguous.draft.date,'');
 const firstPage=page('page-one',null),lastPage=page('page-two',5018);
 Object.assign(firstPage.draft,{pageNumber:1,pageCount:2});
 Object.assign(lastPage.draft,{pageNumber:2,pageCount:2});
 firstPage.draft.lines=[{name:'first'}];lastPage.draft.lines=[{name:'last'}];
 const complete=sandbox.extMergeReceiptModels([lastPage,firstPage],'complete');
 assert.equal(complete.draft.printedTotal,5018);
 assert.equal(complete.draft.lines.map(line=>line.name).join(','),'first,last');
 assert.throws(()=>sandbox.extMergeReceiptModels([firstPage,firstPage],'duplicate'),/重複なし/);
 lastPage.draft.type='return';
 assert.throws(()=>sandbox.extMergeReceiptModels([firstPage,lastPage],'mixed'),/容器回収票/);
 assert.doesNotThrow(()=>sandbox.extValidateReviewDraft({
  date:'2026-10-31',supplier:'カクヤス',type:'delivery',taxMode:'monthly',printedTotal:858,adjustment:0,
  requiresQuantityReview:true,lines:[{name:'ビール',qty:null,amount:858,unit:'本',price:286}]
 },'invoice'));
 // Pool starts at most two jobs and makes progress while another job is unfinished.
 let active=0,max=0,done=0;const releases=[];
 const pool=sandbox.extReceiptPool([1,2,3],()=>new Promise(resolve=>{active++;max=Math.max(max,active);releases.push(()=>{active--;done++;resolve();});}));
 assert.equal(active,2);releases[1]();for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(done,1);assert.equal(releases.length,3);assert.equal(active,2);
 releases[0]();releases[2]();await pool;assert.equal(max,2);assert.equal(done,3);
 // A failed read uses the original already in storage on retry, with no OCR mode selector or override.
 const previousRpc=sandbox.rpc;
 const retryCalls=[];
 sandbox.extReadFile=async()=> 'fixture-bytes';
 const precoSource={id:'preco-file',name:'preco.pdf',mime:'application/pdf'};
 const geminiDraft={date:'2026-10-30',supplier:'プレコフーズ',invoiceNumber:'02154640',type:'delivery',
  taxMode:'net',printedTotal:12869,tax:1029,lines:[
   {name:'まぐろ',amount:3614},{name:'真鯛',amount:2160},{name:'サーモン',amount:5605},{name:'ぶり切身',qty:1,amount:1490}
  ],warnings:[]};
 const recognized={text:'構造化データ',draft:geminiDraft,source:precoSource};
 sandbox.rpc=async(name,arg)=>{
  if(name==='reportExtensionClientError')return;
  retryCalls.push([name,arg.kind,arg.engine]);
  if(name==='processExtensionReceipt')return {ok:false,stage:'OCR',error:'一時エラー',source:precoSource};
  if(name==='readExtensionOcr')return recognized;
 };
 const precoEntry={id:'preco-retry',kind:'invoice',uploads:[{id:'fixture',file:{name:'fixture.pdf',type:'application/pdf'}}],sources:[]};
 await sandbox.extProcessReceipt(precoEntry);
 assert.equal(precoEntry.status,'failed');
 assert.equal(precoEntry.sources[0].id,precoSource.id);
 await sandbox.extProcessReceipt(precoEntry);
 assert.equal(precoEntry.status,'ready');
 assert.deepEqual(retryCalls,[['processExtensionReceipt','invoice',undefined],['readExtensionOcr','invoice',undefined]]);
 assert.doesNotMatch(fs.readFileSync('Extension.html','utf8'),/extInvoiceOcrEngine|extOcrRotation/);
 sandbox.precoEntry=precoEntry;
 run('extReceiptQueue.push(precoEntry);extOpenReceiptReview(precoEntry.id);');
 assert.equal(el('extReviewNumber').value,'02154640');
 assert.equal(String(el('extReviewTotal').value),'12869');
 assert.equal(String(el('extReviewTax').value),'1029');
 assert.equal(el('extReviewLines').children.length,4);
 el('extReceiptClose').onclick();
 run('extReceiptQueue.pop()');

 const retakeEntry={...sandbox.precoEntry,id:'preco-retake',status:'ready',uploads:[{id:'fixture',file:{name:'preco.jpg',type:'image/jpeg'}}]};
 sandbox.retakeEntry=retakeEntry;
 run('extReceiptQueue.push(retakeEntry);extOpenReceiptReview(retakeEntry.id);');
 assert.equal(el('extReviewRetakeActions').hidden,false);
 let replacementId;
 sandbox.rpc=async(name,arg)=>{
  if(name==='processExtensionReceipt'){
   replacementId=arg.id;
   return {ok:false,stage:'OCR',error:'画像を読み取れません'};
  }
 };
 const retakenPhoto={name:'new.jpg',type:'image/jpeg'};
 await sandbox.extReplaceReceiptPhoto(retakeEntry,retakenPhoto);
 assert.equal(retakeEntry.sources[0].id,precoSource.id);
 assert.match(el('extReviewError').textContent,/撮り直した写真を読み取れません/);
 const failedId=replacementId;
 sandbox.rpc=async(name,arg)=>{
  assert.equal(name,'processExtensionReceipt');
  replacementId=arg.id;
  return {...recognized,
   source:{id:replacementId,name:arg.name},ok:true};
 };
 await sandbox.extReplaceReceiptPhoto(retakeEntry,retakenPhoto);
 assert.notEqual(replacementId,failedId);
 assert.equal(retakeEntry.sources[0].id,replacementId);
 assert.equal(retakeEntry.id,'preco-retake');
 assert.equal(el('extReviewLines').children.length,4);
 assert.equal(el('extReceiptDialog').open,true);
 el('extReceiptClose').onclick();
 run('extReceiptQueue.pop()');

 sandbox.rpc=previousRpc;

 // Only the opened camera page may deliver a photo for the active capture.
 const replies=[];
 const popup={closed:false,postMessage:(message,origin)=>replies.push([message,origin]),close(){this.closed=true;}};
 let cameraUrl;
 sandbox.window.open=url=>{cameraUrl=new URL(url);return popup;};
 const savedAccept=sandbox.extAcceptCameraPhoto;
 const photos=[];
 sandbox.extAcceptCameraPhoto=file=>{photos.push(file);return true;};
 el('extOpenCamera').onclick();
 const event={source:popup,origin:cameraUrl.origin,data:{type:'receipt-camera-photo',
  token:new URLSearchParams(cameraUrl.hash.slice(1)).get('token'),blob:new Blob(['photo'],{type:'image/jpeg'})}};
 assert.equal(el('extCameraDialog').open,true);
 listeners.message({...event,origin:'https://example.com'});
 listeners.message({...event,source:{}});
 listeners.message({...event,data:{...event.data,token:'wrong'}});
 assert.equal(photos.length,0);
 listeners.message(event);
 listeners.message(event);
 assert.equal(photos.length,1);
 assert.equal(photos[0].type,'image/jpeg');
 assert.equal(replies[0][0].ok,true);
 assert.equal(replies[0][1],cameraUrl.origin);
 assert.equal(el('extCameraDialog').open,false);
 let nativeAttempts=0;
 el('extCamera').showPicker=()=>{nativeAttempts++;};
 sandbox.window.open=()=>null;
 el('extOpenCamera').onclick();
 assert.equal(nativeAttempts,1);
 assert.equal(el('extNativeCamera').hidden,true);
 assert.match(el('extCameraMessage').textContent,/標準カメラを開きます/);
 el('extCloseCamera').onclick();
 el('extCamera').showPicker=()=>{throw Error('requires activation');};
 el('extOpenCamera').onclick();
 assert.equal(el('extNativeCamera').hidden,false);
 el('extCloseCamera').onclick();
 sandbox.extAcceptCameraPhoto=savedAccept;

 // Journal confirmation writes to the existing form and retains the source link.
 sandbox.tab='売上';sandbox.render();
 run("extReceiptQueue.push({id:'journal_one',kind:'journal',status:'ready',uploads:[],sources:[{id:'raw_journal'}],texts:[],draft:{date:'2026-11-20',total:3900,tax:354,groups:1,guests:1,payments:[{name:'現金',amount:3900}],warnings:[]}});extOpenReceiptReview('journal_one');");
 await el('extReviewConfirm').onclick();
 assert.equal(el('tax').value,354);assert.equal(el('guests').value,1);assert.equal(sandbox.current().journalFiles[0],'raw_journal');
 assert.equal(run("extReceiptQueue.find(r=>r.id==='journal_one').status"),'applied');

 // Automatic merging runs when the last page arrives, in either upload order.
 sandbox.tab='仕入';
 const previousProcess=sandbox.extProcessReceipt;
 sandbox.extProcessReceipt=async entry=>{entry.status='ready';};
 const queue=run('extReceiptQueue');
 const a=page('auto-one',null),b=page('auto-two',5018);
 for(const [index,entry] of [a,b].entries()){
  entry.status='ready';
  Object.assign(entry.draft,{type:'delivery',taxMode:'monthly',pageNumber:index+1,pageCount:2,invoiceNumber:'auto-001'});
 }
 a.draft.lines=[{name:'first'}];
 b.draft.lines=[{name:'last'}];
 queue.push(b);
 await sandbox.extReadReceiptEntries([b]);
 assert.equal(b.status,'ready');
 queue.push(a);
 await sandbox.extReadReceiptEntries([a]);
 const merged=queue[queue.length-1];
 assert.equal(merged.status,'ready');
 assert.equal(merged.draft.printedTotal,5018);
 assert.equal(merged.draft.lines.map(line=>line.name).join(','),'first,last');
 assert.equal(a.status,'merged');assert.equal(b.status,'merged');
 assert.equal(run('extReceiptReviewId'),merged.id);
 await el('extUnmergeReceipt').onclick();
 assert.equal(sandbox.extGroupNumberedReceipts([a,b]).length,0);
 sandbox.extProcessReceipt=previousProcess;
 console.log('Batch UI: table modal, cross-month dates, partial saves, retry IDs, manual grouping, bounded parallelism and journal reflection passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
