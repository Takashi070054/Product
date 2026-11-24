// スクリプトプロパティ: TEMPLATE_ID / FOLDER_ID / LINE_CHANNEL_ACCESS_TOKEN / LINE_GROUP_ID
const PAYMENT = ['現金','クレジット','QR決済（Airペイ QR）','交通系電子マネー','iD','QUICPay','UnionPay 銀聯','世田谷ペイ','ポイント（ホットペッパーグルメ）','売掛'];
const FOOD = ['キタニ水産','maruyasu','プレコフーズ','西原'];
const DRINK = ['島崎','カクヤス'];
const CATEGORIES = ['通信費','人件費','カラオケ代','備品費','旅費交通費','食材費','飲料費','福利厚生費','研修費','修繕費','光熱費','雑費'];
function doGet() { return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('店舗日報').addMetaTag('viewport','width=device-width, initial-scale=1'); }
function date_(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Error('日付を確認してください'); const d=new Date(s+'T12:00:00+09:00'); if(Utilities.formatDate(d,'Asia/Tokyo','yyyy-MM-dd')!==s) throw Error('日付が不正です'); return d; }
function amount_(v) { const x=Number(v); if(v===null || v===undefined || !Number.isSafeInteger(x)||x<0) throw Error('金額・人数は0以上の整数で入力してください'); return x; }
function text_(v) { const s=String(v||''); if(s.length>500) throw Error('文字数は500文字以内です'); return s; }
function safe_(s) { return /^[=+\-@]/.test(s) ? "'"+s : s; }
function locked_(fn) { const l=LockService.getScriptLock(); l.waitLock(30000); try{return fn();}finally{SpreadsheetApp.flush(); l.releaseLock();} }
function month_(key,create) {
 extEnvironment_();
 const p=PropertiesService.getScriptProperties(), id=p.getProperty('MONTH_'+key);
 if(id) { extOwnedFile_(id); return SpreadsheetApp.openById(id); }
 if(!create) return null;
 const template=p.getProperty('TEMPLATE_ID'),folder=p.getProperty('FOLDER_ID');
 if(!template||!folder) throw Error('TEMPLATE_ID と FOLDER_ID を設定してください');
 const f=DriveApp.getFileById(template).makeCopy('売上台帳'+key.replace('-',''),DriveApp.getFolderById(folder)), b=SpreadsheetApp.openById(f.getId());
 const sales=b.getSheetByName('売上収支表'),purchase=b.getSheetByName('仕入れ'),petty=b.getSheetByName('小口その他'),deposit=b.getSheetByName('入金台帳');
 if(!sales||!purchase||!petty||!deposit) { f.setTrashed(true); throw Error('ひな形の4シート名を確認してください'); }
 sales.getRange('C7:L37').clearContent(); sales.getRange('M7:P37').clearContent(); sales.getRange('R7:R37').clearContent(); sales.getRange('T7:X37').clearContent();
 purchase.getRange('C3:K33').clearContent(); petty.getRange('B3:F97').clearContent(); deposit.getRange('D5:E35').clearContent();
 const [y,m]=key.split('-').map(Number); sales.getRange('A1').setValue(y); sales.getRange('A2').setValue(m); petty.getRange('H1').setValue(y);
 applyMonthDates_(b,key);
 deposit.getRange('F1').setValue(0); deposit.getRange('F2').setValue(0);
 ['_売上記録','_仕入記録','_小口記録','_入金記録'].forEach(name=> { const s=b.getSheetByName(name)||b.insertSheet(name); s.clear(); s.appendRow(['ID','日付','JSON']); s.hideSheet(); });
 p.setProperty('MONTH_'+key,b.getId());
 return b;
}
function records_(b,tab) { if(!b)return []; const s=b.getSheetByName('_'+tab+'記録'); if(!s||s.getLastRow()<2)return []; return s.getRange(2,1,s.getLastRow()-1,3).getValues().map(r=>JSON.parse(r[2])); }
function loadDay(date) { date_(date); return locked_(()=>{const b=month_(date.slice(0,7),false), out={}; ['売上','仕入','小口','入金'].forEach(t=>out[t]=records_(b,t).filter(x=>x.date===date)); out.vendorSuggestions=vendorSuggestions_(b); return out;}); }
function vendorSuggestions_(currentBook) {
 const names=[],seen=new Set();
 const add=records=>records.slice().reverse().forEach(r=>{const name=String(r.vendor||'').trim();if(name&&!seen.has(name)&&names.length<100){seen.add(name);names.push(name);}});
 add(records_(currentBook,'小口'));
 const props=PropertiesService.getScriptProperties().getProperties();
 const keys=Object.keys(props).filter(k=>/^MONTH_\d{4}-\d{2}$/.test(k)).sort().reverse().slice(0,12);
 for(const key of keys){
  if(names.length>=100)break;
  if(currentBook&&props[key]===currentBook.getId())continue;
  try{add(records_(SpreadsheetApp.openById(props[key]),'小口'));}catch(_){/* 削除済み・アクセス不可の過去台帳は候補取得のみスキップ */}
 }
 return names;
}
function saveRecord(input) {
 extEnvironment_();
 if(input.tab==='仕入' && Object.values(extState_().invoice).some(i=>i.legacyLink&&i.legacyLink.recordId===input.id&&i.legacyLink.month===String(input.date).slice(0,7)))throw Error('納品伝票に連携済みです。納品伝票タブから修正してください');
 if(input.tab==='入金')return saveDeposit_(input);
 if(input.tab==='小口'&&Array.isArray(input.items))return savePettyBatch_(input);
 return locked_(()=> {
  const date=String(input.date); date_(date); const tab=input.tab;
  if(!['売上','仕入','小口','入金'].includes(tab))throw Error('入力区分が不正です');
  const r={date, id: tab==='売上'||tab==='入金'?date: text_(input.id)||Utilities.getUuid()};
  if(tab==='売上') {
   if(!Array.isArray(input.payments)||input.payments.length>10)throw Error('決済方法を確認してください');
   const seen={}; r.payments=input.payments.map(x=>{if(!PAYMENT.includes(x.name)||seen[x.name])throw Error('決済方法の重複・選択を確認してください');seen[x.name]=true;return {name:x.name,amount:amount_(x.amount)};});
   ['tax','groups','guests','labor'].forEach(k=>r[k]=amount_(input[k]));
   for(const [key] of RESERVATION_FIELDS){
    if(input[key]!==undefined)r[key]=amount_(input[key]);
   }
   r.journalFiles=(input.journalFiles||[]).map(id=>{if(!extState_().file[id])throw Error('ジャーナル原本が見つかりません');return id;});
   r.reporter=text_(input.reporter).trim(); r.impression=text_(input.impression).trim();
   if(!r.reporter)throw Error('報告者を入力してください');
   if(r.tax>r.payments.reduce((s,x)=>s+x.amount,0))throw Error('消費税が総売上を超えています');
  }
  if(tab==='仕入') {
   if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)throw Error('仕入明細を入力してください');
   r.items=input.items.map(x=>{const names=x.kind==='食材'?FOOD:x.kind==='飲料'?DRINK:[];if(!names.includes(x.name))throw Error('仕入先を確認してください');return {kind:x.kind,name:x.name,amount:amount_(x.amount)};});
  }
  if(tab==='小口') { if(!CATEGORIES.includes(input.category))throw Error('勘定科目を確認してください');r.category=input.category;r.vendor=text_(input.vendor);if(!r.vendor.trim())throw Error('購入先を入力してください');r.amount=amount_(input.amount);r.note=text_(input.note); }
  if(tab==='入金')r.amount=amount_(input.amount);
  const b=month_(date.slice(0,7),true),s=b.getSheetByName('_'+tab+'記録'), rows=records_(b,tab),index=rows.findIndex(x=>x.id===r.id);
  if(index>=0&&rows[index].date!==date)throw Error('修正時に日付は変更できません');
  if(tab==='売上') {
   const previous=index>=0?rows[index]:null,message=lineMessage_(r);
   r.line=previous&&previous.line&&previous.line.message===message?previous.line:{message,retryKey:Utilities.getUuid(),status:'pending'};
  }
  if(index<0)rows.push(r);else rows[index]=r;
  if(tab==='小口'&&rows.length>95)throw Error('台帳の小口欄は月95件までです。保存されていません');
  s.getRange(index<0?s.getLastRow()+1:index+2,1,1,3).setValues([[r.id,date,JSON.stringify(r)]]);
  rebuild_(b,date.slice(0,7));
  let notification=null;
  if(tab==='売上') {
   notification=notifySavedRecord_(r,input.sendLine,'売上');
   s.getRange(index<0?s.getLastRow():index+2,3).setValue(JSON.stringify(r));
   reportSheet_(b,records_(b,'売上'));
  }
  return {message:'保存しました',id:r.id,notification};
 });
}
function savePettyBatch_(input) {
 const date=String(input.date);date_(date);
 if(!input.items.length||input.items.length>95)throw Error('小口明細は1〜95件で入力してください');
 const seen={};
 const batch=input.items.map((x,i)=>{
  const id=text_(x.id)||Utilities.getUuid();
  if(seen[id])throw Error('明細IDが重複しています');seen[id]=true;
  if(!CATEGORIES.includes(x.category))throw Error((i+1)+'件目：勘定科目を確認してください');
  const vendor=text_(x.vendor).trim();if(!vendor)throw Error((i+1)+'件目：購入先を入力してください');
  if(x.amount==='')throw Error((i+1)+'件目：金額を入力してください');
  return {id,date,category:x.category,vendor,amount:amount_(x.amount),note:text_(x.note)};
 });
 return locked_(()=>{
  const b=month_(date.slice(0,7),true),s=b.getSheetByName('_小口記録'),records=records_(b,'小口');
  batch.forEach(r=>{const i=records.findIndex(x=>x.id===r.id);if(i>=0){if(records[i].date!==date)throw Error('修正時に日付は変更できません');records[i]=r;}else records.push(r);});
  if(records.length>95)throw Error('台帳の小口欄は月95件までです。今回の明細は保存されていません');
  s.getRange(2,1,records.length,3).setValues(records.map(r=>[r.id,r.date,JSON.stringify(r)]));
  rebuild_(b,date.slice(0,7));return {message:batch.length+'件の小口明細を保存しました',count:batch.length};
 });
}
function lineMessage_(r) {
 const total=r.payments.reduce((sum,x)=>sum+x.amount,0);
 return '◆売上報告◆\n営業日：'+r.date.replace(/-/g,'/')+'\n報告者：'+r.reporter+'\n売上金額(税込)：'+total.toLocaleString('ja-JP')+'円\n来店人数：'+r.guests+'人\n所感：'+(r.impression||'');
}
function deleteDetail(input) {
 extEnvironment_();if(input.tab==='仕入'&&Object.values(extState_().invoice).some(i=>i.legacyLink&&i.legacyLink.recordId===input.id&&i.legacyLink.month===String(input.date).slice(0,7)))throw Error('連携済み伝票は納品伝票タブから修正してください');
 const {tab,date,id,itemIndex,expectedItems}=input;
 date_(date);
 if(!['小口','仕入'].includes(tab)||typeof id!=='string'||!id)throw Error('削除対象を確認してください');
 if(tab==='仕入'&&(!Array.isArray(expectedItems)||!Number.isInteger(itemIndex)||itemIndex<0||itemIndex>=expectedItems.length))throw Error('削除する仕入れの行を選択してください');
 return locked_(()=>{
  const key=date.slice(0,7),book=month_(key,false);
  if(!book)return null;
  const records=records_(book,tab);
  const index=records.findIndex(record=>record.id===id&&record.date===date);
  let remaining=null;
  if(index>=0){
   if(tab==='仕入'){
    const record=records[index];
    const matches=record.items.length===expectedItems.length&&record.items.every((item,i)=>{
     const expected=expectedItems[i];
     return expected&&item.kind===expected.kind&&item.name===expected.name&&item.amount===expected.amount;
    });
    if(!matches){
     rebuild_(book,key);
     throw Error('仕入れの内容が変わりました。画面を開き直してから操作してください');
    }
    record.items.splice(itemIndex,1);
    if(record.items.length)remaining=record;
   }
   if(!remaining)records.splice(index,1);
   const rows=records.map(record=>[record.id,record.date,JSON.stringify(record)]);
   if(!remaining)rows.push(['','','']);
   book.getSheetByName('_'+tab+'記録').getRange(2,1,rows.length,3).setValues(rows);
   SpreadsheetApp.flush();
  }
  rebuild_(book,key);
  return remaining;
 });
}
function notifySavedRecord_(record,sendLine,label) {
 if(EXTENSION_TEST_BUILD || PropertiesService.getScriptProperties().getProperty('LINE_DISABLED')==='true')return {status:'skipped',message:label+'を保存しました（テスト環境：LINE停止中）'};
 if(sendLine===false){
  if(record.line.status!=='accepted')record.line.status='skipped';
  return {status:'skipped',message:label+'を保存しました（LINE投稿なし）'};
 }
 let result;
 try {
  result=notifyLine_(record);
  result.message=result.message.replace(/売上/g,label);
 }catch(e){
  result={status:'failed',message:label+'は保存済みですが、LINE通知を完了できませんでした。同じ内容で再保存して再試行してください。'};
 }
 record.line.status=result.status;
 return result;
}
function notifyLine_(r) {
 if(EXTENSION_TEST_BUILD || PropertiesService.getScriptProperties().getProperty('LINE_DISABLED')==='true')return {status:'skipped',message:'テスト環境：LINE送信は停止中です'};
 if(r.line.status==='accepted')return {status:'accepted',message:'売上を保存しました（同じ報告はLINE受付済みです）'};
 const p=PropertiesService.getScriptProperties(),token=p.getProperty('LINE_CHANNEL_ACCESS_TOKEN'),group=p.getProperty('LINE_GROUP_ID');
 if(!token||!group)return {status:'unconfigured',message:'売上は保存済みです。LINE通知は未設定です。LINE_CHANNEL_ACCESS_TOKEN と LINE_GROUP_ID を設定してください。'};
 if(!/^C[0-9a-f]{32}$/i.test(group))return {status:'failed',message:'売上は保存済みです。LINE_GROUP_ID の形式を確認してください。'};
 const response=UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push',{
  method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token,'X-Line-Retry-Key':r.line.retryKey},
  payload:JSON.stringify({to:group,messages:[{type:'text',text:r.line.message}]}),muteHttpExceptions:true
 });
 const code=response.getResponseCode(),headers=response.getAllHeaders();
 const already=code===409&&Object.keys(headers).some(k=>k.toLowerCase()==='x-line-accepted-request-id');
 if(code===200||already)return {status:'accepted',message:'売上を保存し、LINE通知が受け付けられました'};
 return {status:'failed',message:'売上は保存済みですが、LINE通知に失敗しました（HTTP '+code+'）。LINEの設定・送信上限を確認し、同じ内容で再保存してください。'};
}
const RESERVATION_FIELDS=[
 ['hotpepperGroups','ホットペッパー予約組数'],['hotpepperGuests','ホットペッパー予約人数'],
 ['tabelogGroups','食べログ予約組数'],['tabelogGuests','食べログ予約人数'],
 ['ikyuGroups','一休予約組数'],['ikyuGuests','一休予約人数'],
 ['directGroups','直予約組数'],['directGuests','直予約人数'],
 ['walkInGuests','ウォークイン人数'],
 ['otherGroups','その他予約組数'],['otherGuests','その他予約人数'],
];
function reportSheet_(b,records) {
 const s=b.getSheetByName('売上報告')||b.insertSheet('売上報告');
 s.getRange(1,1,1,6).setValues([['営業日','報告者','売上金額(税込)','来店人数','所感','LINE通知状態']]);
 if(s.getLastRow()>1)s.getRange(2,1,s.getLastRow()-1,6).clearContent();
 const data=records.slice().sort((a,c)=>a.date.localeCompare(c.date)).map(r=>[r.date,safe_(r.reporter||''),r.payments.reduce((sum,x)=>sum+x.amount,0),r.guests,safe_(r.impression||''),({accepted:'LINE受付済み',failed:'通知失敗',pending:'未送信',unconfigured:'未設定'})[r.line&&r.line.status]||'未送信']);
 if(data.length){s.getRange(2,1,data.length,6).setValues(data);s.getRange(2,3,data.length,1).setNumberFormat('#,##0');s.getRange(2,5,data.length,1).setWrap(true);}
 const journalCol=7+RESERVATION_FIELDS.length;s.getRange(1,journalCol).setValue('ジャーナル原本ID');if(records.length)s.getRange(2,journalCol,records.length,1).setValues(records.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(r=>[(r.journalFiles||[]).join(',')]));
 const reservationRows=[RESERVATION_FIELDS.map(([,label])=>label),...records.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(record=>RESERVATION_FIELDS.map(([key])=>record[key]??''))];
 s.getRange(1,7,reservationRows.length,RESERVATION_FIELDS.length).setValues(reservationRows);
 s.setFrozenRows(1);s.setColumnWidth(5,360);
}
function rebuild_(b,key) {
 applyMonthDates_(b,key);
 const sales=b.getSheetByName('売上収支表'),buy=b.getSheetByName('仕入れ'),petty=b.getSheetByName('小口その他'),dep=b.getSheetByName('入金台帳');
 const sr=records_(b,'売上'),pr=records_(b,'仕入'),cr=records_(b,'小口'),dr=records_(b,'入金');
 sales.getRange('C7:L37').clearContent();sales.getRange('R7:R37').clearContent();sales.getRange('U7:X37').clearContent();buy.getRange('C3:K33').clearContent();petty.getRange('B3:F97').clearContent();dep.getRange('D5:E35').clearContent();
 sr.forEach(r=>{const row=Number(r.date.slice(8))+6;r.payments.forEach(x=>sales.getRange(row,3+PAYMENT.indexOf(x.name)).setValue(x.amount));sales.getRange(row,18).setValue(r.tax);sales.getRange(row,21,1,4).setValues([[r.groups,r.guests,'',r.labor]]);});
 const matrix=Array.from({length:31},()=>Array(9).fill(0)),cols={'キタニ水産':0,maruyasu:1,'プレコフーズ':2,'西原':3,'島崎':6,'カクヤス':7};
 pr.forEach(r=>r.items.forEach(x=>matrix[Number(r.date.slice(8))-1][cols[x.name]]+=x.amount));
 cr.sort((a,c)=>a.date.localeCompare(c.date)||a.id.localeCompare(c.id)).forEach((r,i)=>{const day=Number(r.date.slice(8));petty.getRange(i+3,2,1,5).setValues([[day,r.category,safe_(r.vendor),r.amount,safe_(r.note)]]);if(r.category==='食材費')matrix[day-1][4]+=r.amount;if(r.category==='飲料費')matrix[day-1][8]+=r.amount;});
 extOverlayPurchases_(b,key,matrix);
 // 小口補充は日次入力から除外。レジ金残高は表示対象外とし、誤った残高を出さない。
 dr.forEach(r=>dep.getRange(Number(r.date.slice(8))+4,5).setValue(r.amount));
 dep.getRange('F5:F35').clearContent();
 SpreadsheetApp.flush();
}
// 日付はタイムゾーンで前後しない「日付シリアル値」で保存します。
function monthDateRows_(key){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))throw Error('対象月が不正です');
 const [year,month]=key.split('-').map(Number),count=new Date(Date.UTC(year,month,0)).getUTCDate();
 return Array.from({length:31},(_,i)=>i<count?[Date.UTC(year,month-1,i+1)/86400000+25569,'日月火水木金土'[new Date(Date.UTC(year,month-1,i+1)).getUTCDay()]]:['','']);
}
function applyMonthDates_(book,key){
 const rows=monthDateRows_(key);
 const targets=[['売上収支表',7],['仕入れ',3],['入金台帳',5]].map(([name,start])=>{const sheet=book.getSheetByName(name);if(!sheet)throw Error(name+'シートが見つかりません');return {sheet,start};});
 book.setSpreadsheetTimeZone('Asia/Tokyo');
 targets.forEach(({sheet,start})=>{sheet.getRange(start,1,31,2).setValues(rows);sheet.getRange(start,1,31,1).setNumberFormat('m/d');});
}
// エディタで一度実行。金額・内部記録は変更せず、日付欄だけ修復します。
function repairRegisteredMonthDates(){return locked_(()=>{
 const props=PropertiesService.getScriptProperties().getProperties(),keys=Object.keys(props).filter(k=>/^MONTH_\d{4}-\d{2}$/.test(k)).sort();
 if(!keys.length){console.log('登録済み月別台帳がありません');return;}
 if(!props.FOLDER_ID)throw Error('保存先フォルダの設定がありません');
 const backup=DriveApp.getFolderById(props.FOLDER_ID).createFolder('日付修復前バックアップ_'+Utilities.formatDate(new Date(),'Asia/Tokyo','yyyyMMdd_HHmmss'));
 keys.forEach(key=>{const file=DriveApp.getFileById(props[key]);file.makeCopy(file.getName()+'_日付修復前',backup);applyMonthDates_(SpreadsheetApp.openById(props[key]),key.slice(6));console.log(key.slice(6)+'：日付修復完了');});
 console.log('修復前バックアップ：'+backup.getUrl());
});}
