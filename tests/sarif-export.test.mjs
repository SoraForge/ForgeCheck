import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { toSarif } from '../src/modules/sarif-export/index.mjs';

const finding = (overrides={})=>({ ruleId:'STELLAR-001',message:'Check compatibility',confidence:'confirmed-failure',severity:'high',...overrides });
const complete = findings=>({status:'complete',findings});
test('complete empty reports produce valid successful SARIF runs',()=>{
  const report=toSarif(complete([]));
  assert.equal(report.version,'2.1.0');
  assert.equal(report.runs.length,1);
  assert.equal(report.runs[0].tool.driver.name,'ForgeCheck');
  assert.deepEqual(report.runs[0].results,[]);
  assert.equal(report.runs[0].invocations[0].executionSuccessful,true);
});
test('multiple findings generate deterministic rules and indexes with levels',()=>{
  const report=toSarif(complete([finding({ruleId:'Z'}),finding({ruleId:'A', confidence:'review-required',severity:'critical'}),finding({ruleId:'Z',confidence:'not-evaluated'})]));
  assert.deepEqual(report.runs[0].tool.driver.rules.map(x=>x.id),['A','Z']);
  assert.deepEqual(report.runs[0].results.map(x=>x.ruleIndex),[1,0,1]);
  assert.deepEqual(report.runs[0].results.map(x=>x.level),['error','warning','note']);
  assert.equal(JSON.stringify(report),JSON.stringify(toSarif(complete([finding({ruleId:'Z'}),finding({ruleId:'A', confidence:'review-required',severity:'critical'}),finding({ruleId:'Z',confidence:'not-evaluated'})]))));
});
test('handles missing locations and Unicode safely',()=>{
  const report=toSarif(complete([finding({file:'src/café 中.ts',line:3,column:2}),finding()]));
  assert.equal(report.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,'src/caf%C3%A9%20%E4%B8%AD.ts');
  assert.deepEqual(report.runs[0].results[0].locations[0].physicalLocation.region,{startLine:3,startColumn:2});
  assert.equal('locations' in report.runs[0].results[1],false);
});
test('malicious message content serialized, ANSI control sequences stripped',()=>{
  const report=toSarif(complete([finding({message:'<script>alert(1)</script>\x1b[31m'+String.fromCharCode(0)})]));
  const msg=report.runs[0].results[0].message.text;
  assert.equal(msg,'<script>alert(1)</script>');
  assert.doesNotThrow(()=>JSON.parse(JSON.stringify(report)));
});
test('unavailable scan is not empty successful report',()=>{
  const run=toSarif({status:'unavailable',reason:'Engine offline'}).runs[0];
  assert.equal(run.invocations[0].executionSuccessful,false);
  assert.equal(run.results,null);
  assert.equal(run.invocations[0].toolExecutionNotifications[0].message.text,'Engine offline');
});
test('rejects unsafe file traversal and absolute paths',()=>{
  for(const file of ['../secret','src/../secret','/etc/passwd','C:\\Users\\file','https://evil.test/a','src//file']) {
    assert.throws(()=>toSarif(complete([finding({file})])));
  }
});
test('rejects invalid ScanResult variants and findings',()=>{
  for(const scan of [null, {}, {status:'other'}, {status:'complete',findings:{}}, {status:'unavailable',reason:''}, {status:'unavailable',reason:'fail',findings:[]}]) {
    assert.throws(()=>toSarif(scan));
  }
  for(const bad of [{ruleId:''},{confidence:'yes'},{severity:'urgent'},{line:0,file:'src/a'},{column:1,file:'src/a'},{line:1}]) {
    assert.throws(()=>toSarif(complete([finding(bad)])));
  }
});
test('standalone CLI converts complete and unavailable sample fixtures',()=>{
  const cli='src/modules/sarif-export/cli.mjs';
  const ok=spawnSync(process.execPath,[cli,'src/modules/sarif-export/example-complete.json'],{encoding:'utf8'});
  assert.equal(ok.status,0,ok.stderr);
  assert.equal(JSON.parse(ok.stdout).runs[0].results.length,1);
  const fail=spawnSync(process.execPath,[cli,'src/modules/sarif-export/example-unavailable.json'],{encoding:'utf8'});
  assert.equal(fail.status,0,fail.stderr);
  assert.equal(JSON.parse(fail.stdout).runs[0].invocations[0].executionSuccessful,false);
  const missing=spawnSync(process.execPath,[cli,'missing.json'],{encoding:'utf8'});
  assert.equal(missing.status,1);
});
