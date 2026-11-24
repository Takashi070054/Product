'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const client=fs.readFileSync('ExtensionClient.html','utf8').match(/<script>([\s\S]*)<\/script>/)[1];
new vm.Script(client);
const start=client.indexOf("let extFailureStage='';"),end=client.indexOf('function extResetOcr',start);
let status,diagnostic;
const sandbox={window:{},console:{error(){}},busy:false,tab:'仕入',extTabs:['棚卸','AI'],
 setBusy:v=>sandbox.busy=v,showStatus:(message,kind)=>{status={message,kind};},document:{querySelector:()=>({})}};
vm.createContext(sandbox);vm.runInContext(client.slice(start,end),sandbox);
assert.equal(sandbox.extErrorText('文字列の例外'),'文字列の例外');
assert.equal(sandbox.extErrorText({message:'Googleの失敗'}),'Googleの失敗');
assert.equal(sandbox.extErrorText({error:'応答エラー'}),'応答エラー');
for(const e of [undefined,null,{},Object.create(null)])assert.ok(!sandbox.extErrorText(e).includes('undefined'));
async function main(){
 await sandbox.extRun(async()=>{throw undefined;});
 assert.equal(status.kind,'error');assert.ok(!status.message.includes('undefined'));assert.equal(sandbox.busy,false);
 sandbox.google={script:{run:{withSuccessHandler(){return this;},withFailureHandler(){return this;},reportExtensionClientError(input){diagnostic=input;}}}};
 sandbox.window.google=sandbox.google;
 await sandbox.extRun(async()=>{vm.runInContext("extFailureStage='2枚目：OCR実行'",sandbox);throw '権限がありません';});
 assert.equal(diagnostic.stage,'2枚目：OCR実行');assert.equal(diagnostic.message,'権限がありません');assert.ok(status.message.includes('権限がありません'));
 let log;
 const server={extEnvironment_(){},extText_:(v,max)=>String(v||'').slice(0,max),console:{error:v=>log=v}};
 vm.createContext(server);vm.runInContext(fs.readFileSync('ExtensionOcr.gs','utf8'),server);
 assert.equal(server.reportExtensionClientError({stage:'OCR受信',message:'結果が空'}).logged,true);
 assert.ok(log.includes('OCR受信'));assert.ok(log.includes('結果が空'));
 console.log('Error diagnostics passed: string/object/undefined errors, stage reporting, server logging, busy release');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
