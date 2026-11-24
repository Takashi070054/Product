/** Extension test build. Install in a separate GAS project. */
const EXTENSION_TEST_BUILD = true;
const EXT_SCHEMA = {
  invoices: '納品伝票', lines: '仕入明細', catalog: '品目台帳',
  taxes: '月締税額', inventory: '棚卸', history: '変更履歴', files: '原本管理'
};
function extText_(value, max) {
  const s = String(value == null ? '' : value).trim();
  if (s.length > (max || 500)) throw Error('文字数が上限を超えています');
  return s;
}
function extNumber_(value, required) {
  if (value === '' || value === null || value === undefined) {
    if (required) throw Error('数量・金額・単価を入力してください');
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e10 || Math.abs(n * 1e6 - Math.round(n * 1e6)) > 0.001) {
    throw Error('数量・金額・単価は0以上、小数6桁以内で入力してください');
  }
  return n;
}
function extMonth_(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('対象月を確認してください');
  return month;
}
function extEnd_(month) {
  extMonth_(month);
  const [y,m] = month.split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(y,m,0,3)), 'Asia/Tokyo','yyyy-MM-dd');
}
function extShift_(month, n) {
  extMonth_(month);
  const [y,m] = month.split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(y,m-1+n,1,3)), 'Asia/Tokyo','yyyy-MM');
}
function extToday_() { return Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd'); }
function extNormalize_(text) {
  return extText_(text).normalize('NFKC').toLowerCase().replace(/\s+/g,'');
}
function extHash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(b => ('0'+((b+256)%256).toString(16)).slice(-2)).join('');
}
function extId_(prefix, text) { return prefix + extHash_(text).slice(0,24); }
function extEnvironment_() {
  const p = PropertiesService.getScriptProperties();
  if (EXTENSION_TEST_BUILD && (p.getProperty('APP_ENV') !== 'test' ||
      !p.getProperty('TEST_ROOT_ID') || p.getProperty('TEST_ROOT_ID') !== p.getProperty('FOLDER_ID'))) {
    throw Error('別のテストプロジェクトでsetupExtensionTestを実行してください');
  }
  return p;
}
function extOwnedFile_(id) {
  const p = extEnvironment_(), file = DriveApp.getFileById(id);
  if (EXTENSION_TEST_BUILD) {
    const parents = file.getParents();
    let owned = false;
    while (parents.hasNext()) if (parents.next().getId() === p.getProperty('TEST_ROOT_ID')) owned = true;
    if (!owned) throw Error('テスト保存先の外にあるファイルは操作できません');
  }
  return file;
}
function extBook_() {
  const p = extEnvironment_(), id = p.getProperty('EXTENSION_BOOK_ID');
  if (!id) throw Error('拡張台帳を初期設定してください');
  extOwnedFile_(id);
  return SpreadsheetApp.openById(id);
}
function extEvents_() {
  const s = extBook_().getSheetByName(EXT_SCHEMA.history);
  if (!s || s.getLastRow() < 2) return [];
  return s.getRange(2,1,s.getLastRow()-1,7).getValues().filter(r=>r[0]).map(r=>({
    opId:r[0], kind:r[1], id:r[2], version:Number(r[3]), at:r[4], hash:r[5], value:JSON.parse(r[6])
  }));
}
function extState_(events) {
  const state = {invoice:{}, product:{}, tax:{}, stock:{}, file:{}};
  (events || extEvents_()).forEach(e => { state[e.kind][e.id] = {...e.value, version:e.version}; });
  return state;
}
function extWrite_(kind, id, version, input, value) {
  const events = extEvents_(), opId = extText_(input.opId,100);
  if (!opId) throw Error('保存IDがありません。画面を開き直してください');
  const hash = extHash_(JSON.stringify(input));
  const done = events.find(e=>e.opId === opId);
  if (done) {
    if (done.kind !== kind || done.id !== id || done.hash !== hash) throw Error('保存済みの操作IDです。再読み込みしてください');
    return {value:{...done.value,version:done.version}, repeated:true};
  }
  const current = events.filter(e=>e.kind===kind && e.id===id).pop();
  if (Number(version || 0) !== (current ? current.version : 0)) throw Error('他の保存により内容が変わりました。再読み込みしてください');
  const json = JSON.stringify(value);
  if (json.length > 43000) throw Error('1件のデータが大きすぎます。明細数・備考を減らしてください');
  const next = (current ? current.version : 0)+1;
  extBook_().getSheetByName(EXT_SCHEMA.history).appendRow([
    safe_(opId),kind,safe_(id),next,new Date().toISOString(),hash,json
  ]);
  SpreadsheetApp.flush();
  return {value:{...value,version:next}, repeated:false};
}
function extTable_(book, name, headers, rows) {
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  if (sheet.getMaxRows() < rows.length+1) sheet.insertRowsAfter(sheet.getMaxRows(), rows.length+1-sheet.getMaxRows());
  if (sheet.getMaxColumns() < headers.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length-sheet.getMaxColumns());
  sheet.clearContents();
  sheet.getRange(1,1,1,headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2,1,rows.length,headers.length).setValues(rows.map(row=>row.map(v=>typeof v==='string'?safe_(v):v==null?'':v)));
  sheet.setFrozenRows(1);
}
function extSuppliers_() { return ['キタニ水産','maruyasu','プレコフーズ','西原','島崎','カクヤス']; }
function extSupplier_(name) {
  const n = extText_(name,100);
  if (!n) throw Error('仕入先を入力してください');
  return {id:extId_('s_',extNormalize_(n)),name:n};
}
function setupExtensionTest() {
  return locked_(()=>{
    const p = PropertiesService.getScriptProperties(), all = p.getProperties();
    if (all.APP_ENV || all.FOLDER_ID || all.EXTENSION_BOOK_ID || Object.keys(all).some(k=>/^MONTH_/.test(k))) {
      throw Error('既存設定があります。新しいGASプロジェクトで実行してください');
    }
    const template = extText_(all.TEMPLATE_ID);
    if (!template) throw Error('TEMPLATE_IDにひな形IDを設定してください');
    SpreadsheetApp.openById(template);
    const imports = JSON.parse(all.TEST_IMPORT_MONTHS || '{}');
    Object.keys(imports).forEach(key=>{extMonth_(key);SpreadsheetApp.openById(imports[key]);});
    const folder = DriveApp.createFolder('かさ原_拡張テスト_'+Utilities.formatDate(new Date(),'Asia/Tokyo','yyyyMMdd_HHmmss'));
    const book = SpreadsheetApp.create('かさ原_拡張テスト台帳');
    DriveApp.getFileById(book.getId()).moveTo(folder);
    book.setSpreadsheetTimeZone('Asia/Tokyo');
    book.getSheets()[0].setName(EXT_SCHEMA.history);
    book.getSheets()[0].appendRow(['操作ID','種別','ID','版','日時','入力ハッシュ','JSON']);
    p.setProperties({APP_ENV:'test',TEST_ROOT_ID:folder.getId(),FOLDER_ID:folder.getId(),EXTENSION_BOOK_ID:book.getId(),LINE_DISABLED:'true'});
    Object.keys(imports).forEach(key=>{
      const copy = DriveApp.getFileById(imports[key]).makeCopy('【テストコピー】売上台帳'+key,folder);
      p.setProperty('MONTH_'+key,copy.getId());
    });
    console.log('テスト保存先 '+folder.getUrl());
    console.log('拡張台帳 '+book.getUrl());
    return {folder:folder.getUrl(),book:book.getUrl()};
  });
}
function extensionContext(input) {
  date_(input.date);
  return locked_(()=>{
    const state = extState_(), b = month_(input.date.slice(0,7),false);
    return {environment:'test',suppliers:extSuppliers_(), products:Object.values(extCatalog_(state)),
      invoices:Object.values(state.invoice).filter(r=>r.date===input.date),
      legacy:records_(b,'仕入').filter(r=>r.date===input.date),taxes:Object.values(state.tax), files:Object.values(state.file).filter(f=>f.month===input.date.slice(0,7))};
  });
}

function extReplay_(kind,id,input){
 const event=extEvents_().find(e=>e.opId===input.opId);
 if(!event)return null;
 if(event.kind!==kind||event.id!==id||event.hash!==extHash_(JSON.stringify(input)))throw Error('保存IDの内容が変わりました。再読み込みしてください');
 return {...event.value,version:event.version};
}
