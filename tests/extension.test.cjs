
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const sourceFiles=['Code.gs','ExtensionStore.gs','ExtensionPurchases.gs','ExtensionInventory.gs','ExtensionAssistant.gs','ExtensionOcr.gs'];
function harness(){
 const sheets=new Map(),props={APP_ENV:'test',TEST_ROOT_ID:'root',FOLDER_ID:'root',EXTENSION_BOOK_ID:'master'};
 class Sheet{
  constructor(){this.data=[];}getLastRow(){return this.data.length;}getMaxRows(){return 1000;}getMaxColumns(){return 50;}
  setFrozenRows(){}clearContents(){this.data=[];}appendRow(r){this.data.push(r);}
  getRange(row,col,count=1,width=1){const self=this;return {getValues:()=>Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>self.data[row+i-1]?.[col+j-1]??'')),
   setValues:values=>values.forEach((r,i)=>{self.data[row+i-1]||=[];r.forEach((v,j)=>self.data[row+i-1][col+j-1]=v);})};}
 }
 const book={getSheetByName:n=>sheets.get(n),insertSheet:n=>{const s=new Sheet();sheets.set(n,s);return s;}};
 book.insertSheet('変更履歴').appendRow(['op','kind','id','version','at','hash','json']);
 let fetches=0;
 const ctx=vm.createContext({console,Date,JSON,Math,Set,Map,Number,String,Object,Array,Error,MimeType:{PLAIN_TEXT:'text/plain'},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],getUuid:()=>crypto.randomUUID(),
   formatDate:(d,tz,pattern)=>{const text=new Date(d.getTime()+9*3600000).toISOString();return pattern==='yyyy-MM'?text.slice(0,7):text.slice(0,10);}},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],getProperties:()=>({...props})})},
  DriveApp:{getFileById:()=>({getParents:()=>{let used=false;return {hasNext:()=>!used,next:()=>{used=true;return {getId:()=> 'root',getFilesByName:()=>({hasNext:()=>false}),createFile(){}};}};},getBlob:()=>({})})},
  SpreadsheetApp:{flush:()=>{},openById:()=>book},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  UrlFetchApp:{fetch:()=>{fetches++;throw Error('offline');}}
 });
 sourceFiles.forEach(f=>vm.runInContext(fs.readFileSync(f,'utf8'),ctx,{filename:f}));
 ctx.month_=()=>null;ctx.records_=()=>[];ctx.rebuild_=()=>{};
 ctx.testBook=book;ctx.testSheets=sheets;ctx.testProps=props;ctx.fetchCount=()=>fetches;
 return ctx;
}
function invoiceInput(ctx,overrides={}){
 return {opId:crypto.randomUUID(),id:crypto.randomUUID(),version:0,date:'2026-11-02',supplier:'キタニ水産',invoiceNumber:crypto.randomUUID(),
  type:'delivery',taxMode:'gross',printedTotal:200,tax:'',adjustment:0,reason:'',status:'confirmed',fileIds:[],
  lines:[{name:'ぶり',sku:'001',qty:2,unit:'kg',price:100,amount:200,rate:8,category:'食材',reason:''}],...overrides};
}
let passed=0;
function test(name,fn){fn();passed++;console.log('OK '+name);}
test('materials retain their original purchase class and tax rate when saved as expenses',()=>{
 const c=harness();
 const input=invoiceInput(c,{supplier:'カクヤス',lines:[
  {name:'資材',qty:1,price:200,amount:200,category:'雑費',rate:10,baseCategory:'飲料',baseRate:'8'}
 ]});
 const {invoice}=c.saveExtensionInvoice(input);
 assert.deepEqual([invoice.lines[0].category,invoice.lines[0].rate,invoice.lines[0].baseCategory,invoice.lines[0].baseRate],
  ['雑費',10,'飲料','8']);
 assert.equal(c.extInvoiceBuckets_(invoice).雑費,200);
});

test('supplier-specific products, invoice totals and detail comparison use different data',()=>{
 const c=harness(),a=invoiceInput(c,{printedTotal:300,reason:'送料100',adjustment:100});
 c.saveExtensionInvoice(a);c.saveExtensionInvoice(invoiceInput(c,{supplier:'西原',printedTotal:200}));
 const state=c.extState_(),ids=Object.values(state.invoice).map(i=>i.lines[0].productId);
 assert.notEqual(ids[0],ids[1]);
 const monthly=c.extRunQuery_('monthlyTotals',{supplier:'キタニ水産'},state,'2026-11-19');
 assert.equal(monthly.rows[2].total,300);
 const compare=c.extRunQuery_('itemComparison',{supplier:'キタニ水産'},state,'2026-11-19');
 assert.equal(compare.rows[0].current,200);
 assert.equal(c.extRunQuery_('latestPrices',{item:'鰤'},state,'2026-11-19').rows.length,2);
});
test('zero amount is different from no data; totals-only invoices mark missing detail',()=>{
 const c=harness();c.saveExtensionInvoice(invoiceInput(c,{printedTotal:0,lines:[]}));
 const state=c.extState_(),r=c.extRunQuery_('monthlyTotals',{supplier:'キタニ水産'},state,'2026-11-19');
 assert.equal(r.rows[0].total,null);assert.equal(r.rows[2].total,0);
 assert.equal(c.extRunQuery_('latestPrices',{item:'ぶり'},state,'2026-11-19').missingDetails,1);
});
test('save operation is idempotent and stale edits fail',()=>{
 const c=harness(),i=invoiceInput(c);c.saveExtensionInvoice(i);c.saveExtensionInvoice(i);
 assert.equal(c.extEvents_().filter(e=>e.kind==='invoice').length,1);
 assert.throws(()=>c.saveExtensionInvoice({...i,opId:crypto.randomUUID(),printedTotal:201,reason:'修正'}),/内容が変わりました/);
});
test('linked legacy amount is replaced once; cancelling excludes only that invoice',()=>{
 const c=harness(),item={kind:'食材',name:'キタニ水産',amount:200},legacy={id:'legacy-id',date:'2026-11-02',items:[item]};
 c.records_=()=>[legacy];const i=invoiceInput(c,{legacyLink:{month:'2026-11',recordId:legacy.id,itemIndex:0,fingerprint:JSON.stringify(item)}});
 const saved=c.saveExtensionInvoice(i).invoice;
 const fake={getSheetByName:()=>({getRange:()=>({setValues:v=>{fake.matrix=v;}})})};
 const matrix=()=>{const v=Array.from({length:31},()=>Array(9).fill(0));v[1][0]=200;return v;};
 c.extOverlayPurchases_(fake,'2026-11',matrix());assert.equal(fake.matrix[1][0],200);
 c.saveExtensionInvoice({...i,opId:crypto.randomUUID(),version:saved.version,status:'cancelled'});
 c.extOverlayPurchases_(fake,'2026-11',matrix());assert.equal(fake.matrix[1][0],0);
});
test('mixed expenses are separated; container return reduces total',()=>{
 const c=harness(),i=invoiceInput(c,{supplier:'西原',printedTotal:300,lines:[
 {name:'食材',qty:1,unit:'本',price:200,amount:200,rate:8,category:'食材'},
 {name:'袋',qty:1,unit:'P',price:100,amount:100,rate:10,category:'雑費'}]});
 const inv=c.saveExtensionInvoice(i).invoice,b=c.extInvoiceBuckets_(inv);assert.equal(b.食材,200);assert.equal(b.雑費,100);
 c.saveExtensionInvoice(invoiceInput(c,{supplier:'カクヤス',type:'return',printedTotal:5,lines:[{name:'容器',qty:1,unit:'本',price:5,amount:5,rate:0,category:'容器'}]}));
 assert.equal(c.extRunQuery_('monthlyTotals',{supplier:'カクヤス'},c.extState_(),'2026-11-19').rows[2].total,-5);
});
test('monthly tax pending is not zero; stale tax is not silently reused',()=>{
 const c=harness(),i=invoiceInput(c,{taxMode:'monthly'});c.saveExtensionInvoice(i);
 let r=c.extRunQuery_('monthlyTotals',{supplier:'キタニ水産'},c.extState_(),'2026-11-19');assert.equal(r.rows[2].state,'tax_pending');
 c.saveExtensionMonthlyTax({opId:crypto.randomUUID(),month:'2026-11',supplier:'キタニ水産',version:0,foodTax:16,drinkTax:0,miscTax:0});
 r=c.extRunQuery_('monthlyTotals',{supplier:'キタニ水産'},c.extState_(),'2026-11-19');assert.equal(r.rows[2].total,216);
 const old=c.extState_().invoice[i.id];c.saveExtensionInvoice({...i,opId:crypto.randomUUID(),version:old.version});
 assert.equal(c.extRunQuery_('monthlyTotals',{supplier:'キタニ水産'},c.extState_(),'2026-11-19').rows[2].state,'tax_pending');
});
test('inventory excludes two consecutive confirmed zero months and returns on repurchase',()=>{
 const c=harness();c.saveExtensionInvoice(invoiceInput(c,{date:'2026-09-20'}));
 function confirmMonth(month,qty){
  let s=c.getExtensionStock({month});const input={opId:crypto.randomUUID(),month,version:s.version,sourceFingerprint:s.sourceFingerprint,implementer:'高杉',reviewer:'荒川',rows:s.rows.map(r=>({...r,qty})),action:'review'};
  s=c.saveExtensionStock(input);const confirm={...input,opId:crypto.randomUUID(),version:s.version,action:'confirm'};s=c.saveExtensionStock(confirm);
  c.saveExtensionStock(confirm);return s;
 }
 const sep=confirmMonth('2026-09',0);assert.equal(sep.rows[0].zeroStreak,1);
 const oct=confirmMonth('2026-10',0);assert.equal(oct.rows[0].zeroStreak,2);
 assert.equal(c.getExtensionStock({month:'2026-11'}).rows.length,0);
 c.saveExtensionInvoice(invoiceInput(c,{date:'2026-11-04'}));
 assert.equal(c.getExtensionStock({month:'2026-11'}).rows.length,1);
 assert.equal(c.extState_().stock['2026-09'].date,'2026-09-30');
});
test('blank quantity, same reviewer, missing conversion cannot finalize; latest gross price wins',()=>{
 const c=harness();c.saveExtensionInvoice(invoiceInput(c,{taxMode:'net',tax:16}));
 let s=c.getExtensionStock({month:'2026-11'});assert.equal(s.rows[0].price,108);
 const base={opId:crypto.randomUUID(),month:s.month,version:0,sourceFingerprint:s.sourceFingerprint,action:'review',implementer:'高杉',reviewer:'荒川',rows:s.rows};
 assert.throws(()=>c.saveExtensionStock(base),/全品目/);
 assert.throws(()=>c.saveExtensionStock({...base,reviewer:'高杉',rows:s.rows.map(r=>({...r,qty:0}))}),/異なる2名/);
 const p=s.rows[0];c.saveExtensionProduct({opId:crypto.randomUUID(),supplier:p.supplier,name:p.name,sku:'001',unit:'g',aliases:[],conversions:{}});
 s=c.getExtensionStock({month:s.month});assert.equal(s.rows[0].problem,'単位換算未登録');
 c.saveExtensionProduct({opId:crypto.randomUUID(),version:1,supplier:p.supplier,name:p.name,sku:'001',unit:'g',aliases:[],conversions:{kg:1000}});
 s=c.getExtensionStock({month:s.month});assert.equal(s.rows[0].price,0.108);
});
test('confirmed snapshot becomes stale after source edit',()=>{
 const c=harness(),i=invoiceInput(c);const saved=c.saveExtensionInvoice(i).invoice;let s=c.getExtensionStock({month:'2026-11'});
 const input={opId:crypto.randomUUID(),month:s.month,version:0,sourceFingerprint:s.sourceFingerprint,action:'review',implementer:'高杉',reviewer:'荒川',rows:s.rows.map(r=>({...r,qty:1}))};
 s=c.saveExtensionStock(input);s=c.saveExtensionStock({...input,opId:crypto.randomUUID(),version:s.version,action:'confirm'});
 c.saveExtensionInvoice({...i,version:saved.version,opId:crypto.randomUUID()});
 s=c.getExtensionStock({month:s.month});assert.equal(s.fresh,false);assert.equal(s.rows[0].amount,100);
});
test('AI unavailable leaves deterministic query and manual save working; compound tools both execute',()=>{
 const c=harness(),i=invoiceInput(c);c.saveExtensionInvoice(i);
 const unavailable=c.askExtensionAssistant({question:'ぶりは？',asOf:'2026-11-19'});assert.equal(unavailable.available,false);
 c.saveExtensionInvoice(invoiceInput(c));assert.equal(Object.keys(c.extState_().invoice).length,2);
 c.extCF_=()=>({tool_calls:[{name:'monthlyTotals',arguments:{supplier:'キタニ水産'}},{name:'itemComparison',arguments:{supplier:'キタニ水産'}}]});
 const result=c.askExtensionAssistant({question:'推移と増えた品目',asOf:'2026-11-19'});assert.equal(result.results.length,2);
 assert.equal(result.results[0].tool,'monthlyTotals');assert.equal(result.results[1].tool,'itemComparison');
 assert.throws(()=>c.extRunQuery_('deleteAll',{},c.extState_(),'2026-11-19'),/許可/);
 c.testProps.CF_ACCOUNT_ID='a'.repeat(32);c.testProps.CF_API_TOKEN='fake';c.extCF_=undefined;
});
test('test build blocks LINE even with token; foreign month files are blocked',()=>{
 const c=harness();c.testProps.LINE_CHANNEL_ACCESS_TOKEN='test';c.testProps.LINE_GROUP_ID='C'+'a'.repeat(32);
 assert.equal(c.notifyLine_({line:{status:'pending'}}).status,'skipped');assert.equal(c.fetchCount(),0);
 c.testProps.FOLDER_ID='foreign';assert.throws(()=>c.extEnvironment_(),/テスト/);
});
test('journal labels distinguish item count and people; uncertain invoice columns stay empty',()=>{
 const c=harness(),j=c.extParseJournal_('対象期間 2026/11/03 21:57\n2026/11/05 22:09\n総売上 3,900円\n9個\n純売上 3,546円\n1人\n消費税総額 354円\n現金 1件 3,900円\n会計回数 1件');
 assert.equal(j.date,'2026-11-05');assert.equal(j.total,3900);assert.equal(j.guests,1);assert.equal(j.groups,1);
 assert.equal(j.payments[0].amount,3900);
 const draft=c.extParseInvoice_('納品日 2026年10月27日\n品名 数量 単価\n合計 1,765円','西原');assert.equal(draft.lines.length,0);
});

test('browser invoice OCR uses the stored image and rejects ambiguous numeric values',()=>{
 const c=harness();
 const input={fileId:'browser-image',supplier:'西原',text:'納品日 2026/11/22\n伝票番号 0071\n合計 1,800円',
  rowText:'商品名 数量 単価 金額\n豚 肩ロース｜１.５kg｜￥１,２００｜１,８００円\n豆腐 2 個 1O0 200\n合計 1,800円'};
 assert.throws(()=>c.parseExtensionBrowserInvoice_(input),/先に写真/);
 c.extWrite_('file','browser-image',0,{opId:'browser-image-op'},{id:'browser-image',mime:'image/png',name:'fixture.png'});
 const result=c.parseExtensionBrowserInvoice_(input);
 assert.equal(result.source.id,'browser-image');
 assert.equal(result.draft.date,'2026-11-22');
 assert.equal(result.draft.invoiceNumber,'0071');
 assert.equal(result.draft.printedTotal,1800);
 assert.equal(result.draft.lines.length,1);
 const [line]=result.draft.lines;
 assert.deepEqual([line.name,line.qty,line.unit,line.price,line.amount],['豚 肩ロース',1.5,'kg',1200,1800]);
});

test('supplier rules keep a blank page total and distinguish separate container returns',()=>{
 const c=harness(),heading='MARUYASU 2026年10月6日 0000123456';
 const first=c.extParseInvoice_(heading+' (1/2)','', '茄子|1.0|パック|330|330|5本いり\n合 計 ▶');
 const last=c.extParseInvoice_(heading+' (2/2)','', '合 計 ▶ 5,018');
 assert.equal(first.pageNumber,1);assert.equal(first.pageCount,2);assert.equal(first.printedTotal,null);
 assert.equal(first.lines[0].amount,330);assert.equal(last.printedTotal,5018);
 const receipt=c.extParseInvoice_('容 器 回 収 票\nカクヤス\n2026/10/19\nNo. 12345678','','合 計 20');
 assert.equal(receipt.type,'return');assert.equal(receipt.printedTotal,20);assert.equal(receipt.invoiceNumber,'12345678');
 const saved=c.saveExtensionInvoice(invoiceInput(c,receipt)).invoice;
 assert.equal(c.extInvoiceBuckets_(saved).飲料,-20);
});

test('Kakuyasu invoice number can follow the header on the next line',()=>{
 const c=harness();
 const text='株式会社 カクヤス\n日 付 |倉庫 伝票 No. @\n取引先名 様 26/10/31 790 83701234 26/10/31\n外10%| 20\n不明 | 858';
 const draft=c.extParseInvoice_(text,'',text);
 assert.equal(draft.invoiceNumber,'83701234');
 assert.equal(draft.printedTotal,null);
 assert.equal(draft.lines.length,0);
 assert.equal(c.extParseInvoice_(text.replace('伝票 No.','区分'),'').invoiceNumber,'');
});

test('Kakuyasu crop separates item counts from case size and reads only labeled totals',()=>{
 const c=harness();
 const text='カクヤス\n日 付 伝票 No.\n26/10/31 790 83701234 26/10/31';
 const items='33-33-33-33 テストビール 中瓶 500ML | 外10% | 20 | 3 | 286 | 858';
 const draft=c.extParseInvoice_(text,'',text,{items,totals:'売上合計 858\n| 合 計 | 858 |'});
 assert.equal(draft.printedTotal,858);
 assert.equal(draft.lines.length,1);
 const [line]=draft.lines;
 assert.deepEqual([line.name,line.qty,line.unit,line.price,line.amount],['テストビール 中瓶',null,'',286,858]);
 const incomplete=c.extParseInvoice_(text,'',text,{items:items.replace('286 | ',''),totals:'858'});
 assert.equal(incomplete.printedTotal,null);
 assert.equal(incomplete.lines.length,0);
 const cases=c.extParseInvoice_(text,'',text,{items:'テストビール 缶 外10% 20 2 3 10 430',totals:''});
 assert.equal(cases.lines[0].qty,3);
 assert.equal(cases.lines[0].unit,'');
});

test('Kakuyasu reread accepts an observed quantity only when it matches the row amount',()=>{
 const c=harness();
 c.extWrite_('file','crop-test',0,{opId:'crop-test-op'},{id:'crop-test',mime:'image/png',name:'test.png'});
 const read=qty=>c.parseExtensionBrowserInvoice_({fileId:'crop-test',supplier:'カクヤス',text:'カクヤス',rowText:'カクヤス',
  crops:{items:'中瓶',totals:'',cells:[{name:'テストビール 中瓶',qty,price:'286',amount:'858'}]}});
 assert.equal(read('3').draft.lines[0].qty,3);
 assert.equal(read('20').draft.lines[0].qty,null);
 assert.equal(read('').draft.lines[0].qty,null);
 assert.equal(read('').draft.requiresQuantityReview,true);
 assert.equal(read('3').draft.printedTotal,null);
});

test('wrapped Kakuyasu OCR keeps partial items without inferring quantities or totals',()=>{
 const c=harness(),text='カクヤス';
 const items='33-33-33-33 テス トビ 500ML\nー ル hik\n98 外 10% 286 858\n摘要';
 const parse=items=>c.extParseInvoice_(text,'',text,{items,totals:'容器 数量 金額 | 858'});
 const draft=parse(items);
 assert.equal(draft.lines.length,1);
 assert.deepEqual([draft.lines[0].qty,draft.lines[0].price,draft.lines[0].amount],[null,286,858]);
 assert.equal(draft.printedTotal,null);
 assert.equal(draft.requiresQuantityReview,true);
 assert.equal(parse(items.replace('ー ル hik','摘要')).lines.length,0);
});

test('Kakuyasu deliveries save loose quantity without a unit',()=>{
 const c=harness();
 const input=invoiceInput(c,{supplier:'カクヤス',printedTotal:858});
 Object.assign(input.lines[0],{name:'テストビール',qty:3,price:286,amount:858,unit:'',category:'飲料'});
 const saved=c.saveExtensionInvoice(input).invoice;
 assert.equal(saved.lines[0].unit,'');
 assert.equal(saved.lines[0].qty,3);
 const otherLine={...input.lines[0],qty:null,price:null};
 const other=c.saveExtensionInvoice(invoiceInput(c,{supplier:'西原',lines:[otherLine],printedTotal:858})).invoice;
 assert.deepEqual([other.lines[0].qty,other.lines[0].unit,other.lines[0].price],[null,'',null]);
 assert.equal(other.total,858);
});

test('Drive OCR split Kakuyasu columns produce a reconciled item and a labeled total',()=>{
 const c=harness();
 const text=['納品書','株式会社 カクヤス','日付 倉庫区分 26/10/31 790','伝票 No.','83701234','コード','商品名','規格 税区',
  '入数 ケース数 バラ数','単価','金 額','33-33-33-33','テストビール 中瓶','500ML','98','91-10%',
  '20','3','286','858','摘要','容器','売上合計 消費税','858','合計','858','差引合計'].join('\n');
 const result=c.extParseInvoice_(text,'');
 assert.equal(result.invoiceNumber,'83701234');
 assert.equal(result.printedTotal,858);
 assert.equal(result.lines[0].rate,10);
 assert.equal(c.extParseInvoice_(text.replace('91-10%','外 8%'),'').lines[0].rate,8);
 assert.equal(c.extParseInvoice_(text.replace('91-10%','110%'),'').lines[0].rate,'');
 assert.deepEqual(result.lines.map(line=>[line.name,line.qty,line.unit,line.price,line.amount]).join(','),'テストビール 中瓶,3,,286,858');
 assert.equal(c.extParseInvoice_(text.replace('20\n3\n','20\n'),'').lines.length,0);
});

test('Kakuyasu Drive OCR handles a missing price label and a stray header mark',()=>{
 const c=harness();
 const text='カクヤス\n日付 倉庫 区分 122 26/10/24\n伝票 No.\nO\n83701234\n26/10/24\nコード\n商品名\n規格\n税区\n入数 ケース数\nバラ数\n金額\n33-00-23-06\nテスト米焼酎 342710 25°\n720ML\n外 10%\n12\n2\n1,250\n2,500\n摘要\n合計\n2,500';
 const result=c.extParseInvoice_(text,'');
 assert.equal(result.date,'2026-10-24');
 assert.equal(result.invoiceNumber,'83701234');
 assert.equal(result.printedTotal,2500);
 const [line]=result.lines;
 assert.deepEqual([line.qty,line.unit,line.price,line.amount,line.rate],[2,'',1250,2500,10]);
});

test('Kakuyasu Drive OCR recovers three items when headings interrupt the first item',()=>{
 const c=harness();
 const text=[
  '納品書','株式会社 カクヤス','日付 倉庫 区分','伝票 No.','26/10/27','122','83700001','26/10/27','122032 0 B1回 23:13','PK',
  'コード','33-00-16-05','商 品 名 テスト トニックウォーターペット','規格','税区','入数 ケース数 バラ数','单','価','金額',
  '500ML','外8%','24','5','163','815','445153',
  '22-05-02-01','テスト 強炭酸水 500MLペット','500ML','外8%','24','3','74','222','236400',
  '22-01-02-01','テスト 緑茶 2L ペット','2L]','外8%','6','1','151','151','224225',
  '摘要','容器','数量','金額','売上合計','1, 188','ビール','消費税','函','ジュース','合 計 差引合計','1, 188','対象額','合計'
 ].join('\n');
 const parse=value=>c.extParseInvoice_(value,'');
 const result=parse(text);
 assert.equal(result.date,'2026-10-27');
 assert.equal(result.invoiceNumber,'83700001');
 assert.equal(result.printedTotal,1188);
 assert.deepEqual(JSON.parse(JSON.stringify(result.lines.map(({name,sku,qty,unit,price,amount,rate})=>[name,sku,qty,unit,price,amount,rate]))),[
  ['テスト トニックウォーターペット','445153',5,'',163,815,8],
  ['テスト 強炭酸水 500MLペット','236400',3,'',74,222,8],
  ['テスト 緑茶 2L ペット','224225',1,'',151,151,8]
 ]);
 assert.equal(parse(text.replace('5\n163\n815','5\n163\n816')).lines.length,2);
 assert.equal(parse(text.replace('売上合計\n1, 188','売上合計\n1, 188\n売上合計\n1, 189')).printedTotal,null);
});

test('Kakuyasu Drive OCR saves the printed oil collection credit exactly once',()=>{
 const c=harness();
 const text=[
  'カクヤス','日付 倉庫 区分 伝票 No. 26/10/23','83701234','26/10/23',
  'コード','商 品名','規格','税区','入数','ケース数','バラ数','金額',
  '22-01-02-01','テスト 緑茶','2L','224225','外8%','6','1','151','151',
  '22-05-02-01','テスト 強炭酸水','500ML','236400','91-8%','24','3','74','222',
  '00-00-00-00','【廃油回収】 テスト品','0','外10%','1','3','-3','-9',
  '摘要','売上合計','364'
 ].join('\n');
 const draft=c.extParseInvoice_(text,'');
 assert.equal(draft.invoiceNumber,'83701234');
 assert.equal(draft.lines.length,3);
 assert.equal(draft.lines.reduce((sum,line)=>sum+line.amount,0),364);
 const saved=c.saveExtensionInvoice(invoiceInput(c,draft)).invoice;
 assert.equal(saved.printedTotal,364);
 assert.equal(saved.adjustment,0);
 assert.equal(saved.lines[2].price,-3);
 assert.equal(saved.lines[2].amount,-9);
 assert.equal(saved.lines[2].rate,10);
 const buckets=c.extInvoiceBuckets_(saved);
 assert.equal(buckets.飲料,373);
 assert.equal(buckets.雑費,-9);
 const partial=invoiceInput(c,{...draft,date:'2026-10-24',invoiceNumber:'83701235',lines:draft.lines.map(line=>
  line.amount<0?{...line,qty:null,price:null}:line)});
 assert.equal(c.saveExtensionInvoice(partial).invoice.lines[2].amount,-9);
 const other=invoiceInput(c,{...draft,supplier:'西原',lines:draft.lines.map(line=>({...line,unit:'本'}))});
 assert.throws(()=>c.saveExtensionInvoice(other),/0以上/);
});

test('Kakuyasu container slips preserve split amounts and deduct once in the purchase total',()=>{
 const c=harness();
 const read=body=>c.extParseInvoice_('容器回収票\n2026/10/19\n'+body+'\n株式会社 カクヤス\nNo. 580000001','');
 const draft=read('ビール空容器中/20\n4バラ\n20\n合計\n20');
 assert.equal(draft.printedTotal,20);
 assert.equal(draft.invoiceNumber,'580000001');
 const [line]=draft.lines;
 assert.deepEqual([line.name,line.qty,line.unit,line.price,line.amount,line.category],['ビール空容器中/20',4,'',null,20,'容器']);
 const saved=c.saveExtensionInvoice(invoiceInput(c,draft)).invoice;
 assert.equal(c.extInvoiceBuckets_(saved).容器,-20);
 const daily=Array.from({length:31},()=>Array(9).fill(0));
 daily[18][7]=1000;
 daily[19][7]=500;
 daily[18][6]=300;
 const book={getSheetByName:()=>({getRange:()=>({setValues(){}})})};
 c.extOverlayPurchases_(book,'2026-10',daily);
 assert.deepEqual([daily[18][7],daily[19][7],daily[18][6]],[980,500,300]);
 const multiple=read('ビール空容器小/30\n1バラ 5\nビール空容器中/20\n2バラ\n10\n合 計 15');
 assert.deepEqual(multiple.lines.map(line=>line.amount).join(','),'5,10');
 assert.equal(multiple.printedTotal,15);
 assert.equal(read('ビール空容器中/20\n4バラ\n20\n合計').printedTotal,null);
});

test('Maruyasu Drive OCR rebuilds split detail lines and preserves the document total only where printed',()=>{
 const c=harness();
 const raw='MARUYASU\n0000123456\n(2/2)\n2026年10月6日\n品\n名\n数量\n単位\n金額 摘要\n生椎茸\n1.0 パック\n330\n330\n小松菜\n1.0 束\n220\n220\n毎度お引き立てを賜りありがとうございます。\n合計 ▶\n5,018';
 const last=c.extParseInvoice_(raw,'');
 assert.equal(last.pageNumber,2);
 assert.equal(last.printedTotal,5018);
 assert.equal(last.lines.map(line=>[line.name,line.qty,line.unit,line.price,line.amount].join('|')).join(';'),'生椎茸|1|パック|330|330;小松菜|1|束|220|220');
 const first=c.extParseInvoice_(raw.replace('(2/2)','(1/2)').replace('\n5,018',''),'');
 assert.equal(first.printedTotal,null);
 assert.equal(first.lines.length,2);
 assert.equal(c.extParseInvoice_(raw.replace('220\n220','220\n2211'),'').lines.length,1);
});

test('Maruyasu pages preserve spaced dates, inline remarks, and the final total',()=>{
 const c=harness(),heading='MARUYASU\n0000123456\n';
 const columns='品\n名\n数量\n单位\n単価\nFOODS MARUYASU\n丸安商店 金額\n摘要\n';
 const items=[
  ['1.0 パック',330,'330 5本いり'],['2.0 パック',380,760],['2.0 パック',195,390],['2.0 束',130,260],
  ['3.0 パック',350,'1,050'],['2.0 バック',115,230],['0.3kg',280,84],['1.1 kg',295,324],
  ['1.0 パック',145,145],['1.0 本',85,85],['1.0 袋',180,180],['1.0 パック',450,450],['2.0 個',90,180]
 ].map((item,index)=>['試験品'+(index+1),...item].join('\n')).join('\n');
 const first=c.extParseInvoice_(heading+'(1/2)\n2026年10月 6日\n'+columns+items+'\n合 計 ▶','');
 const last=c.extParseInvoice_(heading+'(2/2)\n2026年10月6日\n'+columns+'試験茸\n1.0 八唦\n330\n330\n試験菜\n1.0 束\n220\n220\n合計 ▶\n5,018','');
 assert.equal(first.date,last.date);
 assert.equal(first.date,'2026-10-06');
 assert.equal(first.lines.length,13);
 assert.equal(last.lines.length,2);
 assert.equal(first.lines[5].unit,'パック');
 assert.equal(first.lines[6].unit,'kg');
 assert.equal(last.lines[0].unit,'');
 assert.equal(last.lines[0].qty,1);
 assert.equal(first.printedTotal,null);
 assert.equal(last.printedTotal,5018);
 assert.equal([...first.lines,...last.lines].reduce((sum,line)=>sum+line.amount,0),5018);
 const saved=c.saveExtensionInvoice(invoiceInput(c,{...last,lines:[...first.lines,...last.lines]})).invoice;
 assert.equal(saved.lines.length,15);
 assert.equal(saved.total,5018);
 assert.equal(saved.lines[13].unit,'');
 assert.equal(saved.lines[14].unit,'束');
});

test('Preco split OCR reconciles the item, net subtotal, tax, and gross total',()=>{
 const c=harness();
 const text=[
  '2026年 10月 19日 コード:061627-061628','納品書','コード','品','名','03000','鳥もも正肉 (外国産/冷凍)','1,780','*',
  '伝票 NO.006580000','PRECO','量k','单','価','kg','890','期','金額','1,780','数','2','量','142','1,922','-',
  '合計金額','-','8%対象)','1,922','納品額','8%対象)','-','1,780','値引','8%対象)','*印は軽減税率対象商品',
  '1','消費稅','【8%対象)','142'
 ].join('\n');
 const parse=text=>c.extParseInvoice_(text,'');
 const draft=parse(text);
 assert.deepEqual([draft.date,draft.invoiceNumber,draft.printedTotal,draft.tax,draft.taxMode],['2026-10-19','006580000',1780,142,'net']);
 const [line]=draft.lines;
 assert.deepEqual([line.sku,line.qty,line.unit,line.price,line.amount,line.rate],['03000',2,'kg',890,1780,8]);
 const saved=c.saveExtensionInvoice(invoiceInput(c,draft)).invoice;
 assert.equal(saved.total,1922);
 assert.equal(parse(text.replace('数\n2\n量','数\n3\n量')).lines.length,0);
 assert.equal(parse(text.replace('【8%対象)\n142','【8%対象)\n145')).lines.length,0);
});

test('Preco column-block OCR reconciles four details even with a missing quantity',()=>{
 const c=harness();
 const text=require('node:fs').readFileSync('tests/fixtures/preco-column-ocr.txt','utf8').trimEnd();
 const draft=c.extParseInvoice_(text,'');
 assert.deepEqual([draft.invoiceNumber,draft.printedTotal,draft.tax],['02154640',12869,1029]);
 assert.deepEqual(Array.from(draft.lines,item=>[item.qty,item.amount]),[[0.65,3614],[1.08,2160],[1.9,5605],[null,1490]]);
 assert.deepEqual(Array.from(draft.lines,item=>item.sku),['001060','100205','309505','12437']);
 assert.match(draft.warnings.join(' '),/13,838/);
 assert.equal(c.saveExtensionInvoice(invoiceInput(c,draft)).invoice.total,13898);
 const mismatch=c.extParseInvoice_(text.replace('5,605','5,604'),'');
 assert.equal(mismatch.lines.length,0);
 assert.equal(mismatch.printedTotal,12869);
 const uncorroborated=c.extParseInvoice_(text.replace('12, 869','12, 879'),'');
 assert.equal(uncorroborated.printedTotal,null);
 assert.equal(uncorroborated.lines.length,0);
});

test('Preco retake OCR rejoins the detached amount column and split quantity',()=>{
 const c=harness();
 const text=require('node:fs').readFileSync('tests/fixtures/preco-retake-ocr.txt','utf8');
 const draft=c.extParseInvoice_(text,'');
 assert.deepEqual([draft.printedTotal,draft.tax],[12869,1029]);
 assert.deepEqual(Array.from(draft.lines,item=>[item.name.match(/メバチマグロ|真鯛半身|富士山サーモン半身|ぶり切身/)?.[0],
  item.sku,item.qty,item.unit,item.price,item.amount]),[
  ['メバチマグロ','',0.65,'kg',5560,3614],['真鯛半身','100205',1.08,'kg',2000,2160],
  ['富士山サーモン半身','309505',1.9,'kg',2950,5605],['ぶり切身','12437',1,'pc',1490,1490]
 ]);
 assert.match(draft.warnings.join(' '),/13,838/);
 assert.equal(c.saveExtensionInvoice(invoiceInput(c,draft)).invoice.total,13898);
 const wrongAmounts=text.replace('3,614','2,160').replace('2, 160','3,614');
 assert.equal(c.extParseInvoice_(wrongAmounts,'').lines.length,0);
});

test('Preco separate columns reconcile merged amounts and displaced subtotal labels',()=>{
 const c=harness();
 const text=require('node:fs').readFileSync('tests/fixtures/preco-separate-columns-ocr.txt','utf8');
 for(const rowText of [undefined,'品名 数量 単価 金額']){
  const draft=c.extParseInvoice_(text,'',rowText);
  assert.deepEqual([draft.invoiceNumber,draft.printedTotal,draft.tax],['00214634',7671,613]);
  assert.deepEqual(Array.from(draft.lines,item=>[item.sku,item.qty,item.unit,item.price,item.amount,item.rate]),
   [['100205',1,'kg',2000,2000,8],['001060',1.02,'kg',5560,5671,8]]);
 }
 assert.equal(c.saveExtensionInvoice(invoiceInput(c,c.extParseInvoice_(text,''))).invoice.total,8284);
 const wrongOrder=text.replace('2 000 5,671','5,671 2 000');
 assert.equal(c.extParseInvoice_(wrongOrder,'').lines.length,0);
});

test('Paddle Preco keeps independently printed values and reconciles detached footer totals',()=>{
 const c=harness();
 const parse=text=>{const {net,tax,gross}=c.extPaddlePrecoTotals_(text);return [net,tax,gross];};
 assert.deepEqual(parse('納 品 額\n12.869\n消 費 税 1, 029'),[12869,1029,null]);
 assert.deepEqual(parse('7,671 613 8 284\n納品額 値引 消費税 合計金額'),[7671,613,8284]);
 assert.deepEqual(parse('7,671 613 8 285\n納品額 値引 消費税 合計金額'),[null,null,null]);
 assert.deepEqual(parse('真鯛 1 kg 2,000 2,000'),[null,null,null]);
 assert.deepEqual(parse('納品額 100\n納品額 200'),[null,null,null]);
});

test('Paddle Preco keeps the fourth detail when its printed quantity drops out',()=>{
 const c=harness();
 c.extWrite_('file','paddle-preco',0,{opId:'paddle-preco-op'},{id:'paddle-preco',mime:'image/jpeg'});
 const text=[
  '2026年10月30日 【納品書】 ル-ト:60-11-255',
  'コ-ド:010993-010994 伝票NO.012154640','PRECO FAX 03',
  'コード 品 名 数量 单価 金額',
  '001060 【徳用】メバチマグロ(皮無/赤身/冷凍)·柵 * 0.65 kg 5,560 3,614',
  '100205 真鲷半身(国産/養殖/生) * 1.08 kg 2,000 2,160',
  '309505 富士山サーモン半身（静岡県産/養殖/生) * 1.9 kg 2,950 5,605',
  '12437 ぶり切身(骨無/外国産/冷凍）·70g×10枚 pC 1,490 1,490',
  '12.869 1,029 13,898','納品額 值引 消費税 合計金額',
  '(8%対象) 12,869 (8%対象) 8%对象） 1.029 8%对象） 13.8.18',
  '*印は軽减税率文象商品'
 ].join('\n');
 const {draft}=c.parseExtensionBrowserInvoice_({fileId:'paddle-preco',engine:'paddle',text,rowText:text});
 assert.equal(draft.lines.length,4);
 const line=draft.lines[3];
 assert.deepEqual([line.sku,line.qty,line.unit,line.price,line.amount],['12437',null,'pc',1490,1490]);
 assert.deepEqual([draft.printedTotal,draft.tax],[12869,1029]);
 assert.match(draft.warnings.join(' '),/数量を読み取れない/);
 assert.equal(c.saveExtensionInvoice(invoiceInput(c,draft)).invoice.total,13898);
});

test('Gemini comparison uses only the selected image, preserves partial details and verifies printed taxes',()=>{
 const c=harness();
 c.extWrite_('file','gemini-preco',0,{opId:'gemini-file-op'},
  {id:'gemini-preco',mime:'image/jpeg',driveId:'source-drive'});
 const request={fileId:'gemini-preco',kind:'invoice'};
 assert.throws(()=>c.readExtensionOcr(request),/GEMINI_API_KEY/);
 assert.equal(c.fetchCount(),0);
 c.testProps.GEMINI_API_KEY='test-key';
 const getFile=c.DriveApp.getFileById;
 c.DriveApp.getFileById=id=>{
  const file=getFile(id);
  return id==='source-drive'?{...file,getBlob:()=>({getBytes:()=>[1,2,3]})}:file;
 };
 let fallbackReads=0;
 c.Drive={Files:{create:()=>{fallbackReads++;return {id:'temporary'};},update:()=>{}}};
 c.DocumentApp={openById:()=>({getBody:()=>({getText:()=> '株式会社 プレコフーズ 2026年10月30日'})})};
 c.Utilities.base64Encode=bytes=>Buffer.from(bytes).toString('base64');
 let statuses=[503,200],requests=0,sleeps=0;
 c.Utilities.sleep=()=>{sleeps++;};
 const modelResult={supplier_name:'株式会社プレコフーズ',delivery_date:'2026-10-30',invoice_number:'02154640',
  document_type:'delivery',tax_mode:'net',subtotal:12869,tax:1029,total_amount:13898,adjustment:null,page_number:null,page_count:null,
  items:[{item_name:'ぶり切身',sku:'001060',quantity:null,unit:'pc',unit_price:1490,amount:1490,tax_rate:8}]};
 c.UrlFetchApp.fetch=(url,options)=>{
  assert.match(url,/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(url.includes('test-key'),false);
  assert.equal(options.headers['x-goog-api-key'],'test-key');
  const body=JSON.parse(options.payload);
  assert.equal(body.contents[0].parts[1].inlineData.data,'AQID');
  assert.equal(body.generationConfig.responseMimeType,'application/json');
  assert.equal(body.generationConfig.responseJsonSchema.properties.items.items.properties.quantity.type[1],'null');
  requests++;
  const status=statuses.shift();
  return {getResponseCode:()=>status,getContentText:()=>JSON.stringify({candidates:[{finishReason:'STOP',
   content:{parts:[{text:JSON.stringify(modelResult)}]}}]})};
 };
 const {draft,engine}=c.readExtensionOcr(request);
 assert.equal(engine,'gemini');
 assert.deepEqual([draft.supplier,draft.invoiceNumber,draft.printedTotal,draft.tax],['プレコフーズ','02154640',12869,1029]);
 assert.deepEqual([draft.lines[0].sku,draft.lines[0].qty,draft.lines[0].amount],['001060',null,1490]);
 assert.match(draft.warnings.join(' '),/印字合計が一致しません/);
 assert.deepEqual([requests,sleeps],[2,1]);
 statuses=[429];
 assert.equal(c.readExtensionOcr(request).draft.supplier,'プレコフーズ');
 assert.deepEqual([requests,sleeps],[3,1]);
 statuses=[503,503];
 assert.equal(c.readExtensionOcr(request).draft.supplier,'プレコフーズ');
 assert.deepEqual([requests,sleeps,fallbackReads],[5,2,2]);
 c.extWrite_('file','gemini-pdf',0,{opId:'gemini-pdf-op'},
  {id:'gemini-pdf',mime:'application/pdf',driveId:'source-drive'});
 statuses=[200];
 modelResult.page_number=1;modelResult.page_count=2;
 const pdf=c.readExtensionOcr({fileId:'gemini-pdf',kind:'invoice'});
 assert.equal(pdf.engine,'gemini');
 assert.equal(pdf.draft.pageCount,null);
 assert.equal(pdf.draft.printedTotal,12869);
 const returned=c.extGeminiInvoiceDraft_({...modelResult,supplier_name:'株式会社 カクヤス',document_type:'return',
  subtotal:20,items:[{item_name:'ビール空容器中',quantity:4,unit:'バラ',unit_price:null,amount:20}]},'');
 assert.deepEqual([returned.type,returned.taxMode,returned.tax,returned.printedTotal,returned.lines[0].category],
  ['return','monthly',null,20,'容器']);
 const paged=c.extGeminiInvoiceDraft_({...modelResult,supplier_name:'丸安商店',page_number:1,page_count:2,subtotal:null,tax_mode:'monthly'},'');
 assert.deepEqual([paged.supplier,paged.pageNumber,paged.pageCount,paged.printedTotal],['maruyasu',1,2,null]);
});

test('Nishihara applies 8 percent only for the reduced-rate marker in NO',()=>{
 const c=harness();
 const model={supplier_name:'西原商会',document_type:'delivery',tax_mode:'net',items:[
  {item_name:'だし',reduced_no_mark:true,tax_rate:10},
  {item_name:'備品 ※',reduced_no_mark:false,tax_rate:10}
 ]};
 assert.deepEqual(Array.from(c.extGeminiInvoiceDraft_(model,'').lines,line=>line.rate),[8,10]);
 assert.deepEqual(Array.from(c.extGeminiInvoiceDraft_({...model,supplier_name:'カクヤス'},'').lines,line=>line.rate),[10,10]);
 const drive='西原商会\nNO. | 品名 | 数量 | 単位 | 単価 | 金額\n※1 | だし | 1 | 袋 | 500 | 500\n2 | 備品 ※ | 1 | 個 | 800 | 800';
 assert.deepEqual(Array.from(c.extParseInvoice_(drive,'').lines,line=>line.rate),[8,'']);
});

test('OCR temporary documents are trashed on both success and text-read failure',()=>{
 const c=harness();c.extWrite_('file','file-test',0,{opId:'file-op'},{id:'file-test',driveId:'drive-file',url:'https://drive.google.com/file/d/drive-file/view'});
 let trashed=0;c.Drive={Files:{create:()=>({id:'temporary'}),update:(metadata,id)=>{assert.equal(metadata.trashed,true);assert.equal(id,'temporary');trashed++;}}};
 c.DocumentApp={openById:()=>({getBody:()=>({getText:()=> '総売上 0円'})})};
 assert.equal(c.readExtensionOcr({fileId:'file-test',kind:'journal'}).draft.total,0);assert.equal(trashed,1);
 c.DocumentApp.openById=()=>{throw Error('OCR read failed');};
 assert.throws(()=>c.readExtensionOcr({fileId:'file-test',kind:'journal'}),/OCR read failed/);assert.equal(trashed,2);
});
test('explicit periods are applied and historical simple entries are included once',()=>{
 const c=harness();c.testProps['MONTH_2026-10']='copy';
 c.month_=()=>({getId:()=> 'copy'});c.records_=()=>[{id:'old',date:'2026-10-02',items:[{kind:'食材',name:'キタニ水産',amount:500}]}];
 const result=c.queryExtensionData({name:'monthlyTotals',args:{supplier:'キタニ水産',start:'2026-10-01',end:'2026-10-31'},asOf:'2026-11-19'});
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].total,500);
});

test('batch saves isolate failure and reuse stable operation IDs across months',()=>{
 const c=harness(),oct=invoiceInput(c,{date:'2026-10-31'}),nov=invoiceInput(c,{date:'2026-11-02',supplier:''});
 let result=c.saveExtensionReceiptBatch({records:[oct,nov]});
 assert.equal(result.results[0].status,'saved');assert.equal(result.results[1].status,'failed');
 result=c.saveExtensionReceiptBatch({records:[oct,{...nov,supplier:'西原'}]});
 assert.equal(result.results[0].status,'saved');assert.equal(result.results[1].status,'saved');
 const values=Object.values(c.extState_().invoice);assert.equal(values.length,2);
 assert.equal(values.find(i=>i.id===oct.id).date,'2026-10-31');assert.equal(values.find(i=>i.id===nov.id).date,'2026-11-02');
});
test('journal OCR text cache skips repeat Drive conversion',()=>{
 const c=harness(),cache=new Map();
 c.extWrite_('file','cached-file',0,{opId:'cache-file-op'},{id:'cached-file',hash:'content-hash',driveId:'drive-file',url:'https://drive.google.com/file/d/x/view'});
 const folder={getId:()=> 'root',getFilesByName:name=>({hasNext:()=>cache.has(name),next:()=>({getBlob:()=>({getDataAsString:()=>cache.get(name)})})}),createFile:(name,text)=>cache.set(name,text)};
 c.DriveApp.getFileById=()=>({getBlob:()=>({}),getParents:()=>{let used=false;return {hasNext:()=>!used,next:()=>{used=true;return folder;}};}});
 let conversions=0,trashed=0;
 c.Drive={Files:{create:()=>{conversions++;return {id:'temp'};},update:()=>trashed++}};
 c.DocumentApp={openById:()=>({getBody:()=>({getText:()=> '総売上 0円'})})};
 assert.equal(c.readExtensionOcr({fileId:'cached-file',kind:'journal'}).timings.cached,false);
 assert.equal(c.readExtensionOcr({fileId:'cached-file',kind:'journal'}).timings.cached,true);
 assert.equal(conversions,1);assert.equal(trashed,1);
 c.readExtensionOcr({fileId:'cached-file',kind:'journal',force:true});assert.equal(conversions,2);assert.equal(trashed,2);
});
console.log(passed+' tests passed');


