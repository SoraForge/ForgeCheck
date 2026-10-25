import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {evaluateBenchmark,evaluateBenchmarkFiles,checkThresholds} from '../tools/benchmark/index.mjs';
const dir=new URL('../tools/benchmark/fixtures/',import.meta.url);
const manifest=new URL('../tools/benchmark/fixtures/manifest.json',import.meta.url);
const baseline=evaluateBenchmarkFiles(manifest,dir);
test('five synthetic cases produce deterministic TP/FP/FN and per-rule scores',()=>{
  assert.deepEqual([baseline.cases,baseline.evaluated,baseline.excluded,baseline.notEvaluated],[5,4,0,1]);
  assert.deepEqual(baseline.overall,{tp:1,fp:1,fn:1,precision:0.5,recall:0.5});
  assert.deepEqual(baseline.perRule['sdk.version'],{tp:1,fp:0,fn:0,precision:1,recall:1});
  assert.deepEqual(baseline.perRule['rpc.method'],{tp:0,fp:1,fn:1,precision:0,recall:0});
  assert.deepEqual([baseline.intentionalNegatives,baseline.trueNegativeCases],[2,1]);
  assert.equal(JSON.stringify(evaluateBenchmarkFiles(manifest,dir)),JSON.stringify(baseline));
});
test('empty dataset and zero denominators are undefined (null), not fabricated perfect scores',()=>{
  const r=evaluateBenchmark({schemaVersion:1,cases:[]},{});
  assert.equal(r.overall.precision,null);assert.equal(r.overall.recall,null);
  assert.equal(checkThresholds(r,{minPrecision:0}),false);
  assert.equal(checkThresholds(baseline,{minPrecision:0.5,minRecall:0.5}),true);
  assert.equal(checkThresholds(baseline,{minPrecision:0.51}),false);
});
test('missing reports and unavailable outcomes are excluded or not evaluated',()=>{
  const c={id:'caseX',operation:'scan',versions:{sdk:'1'},expectedFindingIds:['r'],intentionalNegative:false,reportFile:'caseX.json'};
  const m={schemaVersion:1,cases:[c]};
  assert.equal(evaluateBenchmark(m,{}).excluded,1);
  assert.equal(evaluateBenchmark(m,{caseX:{status:'unavailable',reason:'offline'}}).notEvaluated,1);
  assert.equal(evaluateBenchmark(m,{caseX:{status:'complete',findings:[{ruleId:'r',confidence:'not-evaluated'}]}}).notEvaluated,1);
});
test('invalid manifest/report and duplicate case IDs fail instead of producing scores',()=>{
  const c={id:'x',operation:'scan',versions:{sdk:'1'},expectedFindingIds:[],intentionalNegative:true,reportFile:'x.json'};
  assert.throws(()=>evaluateBenchmark({schemaVersion:1,cases:[c,c]},{}),/duplicated/);
  assert.throws(()=>evaluateBenchmark({schemaVersion:1,cases:[{...c,reportFile:'../bad.json'}]},{}),/safe relative/);
  assert.throws(()=>evaluateBenchmark({schemaVersion:1,cases:[c]},{x:{status:'complete',findings:[{ruleId:'r',confidence:'invalid'}]}}),/invalid finding/);
});
test('report path symlinks cannot escape the allowed report directory',()=>{
  const root=mkdtempSync(join(tmpdir(),'forgecheck-bench-'));
  try{
    symlinkSync(new URL('file:///etc/passwd'),join(root,'escaped.json'));
    const m={schemaVersion:1,cases:[{id:'caseX',operation:'scan',versions:{sdk:'1'},expectedFindingIds:[],intentionalNegative:true,reportFile:'escaped.json'}]};
    const f=join(root,'manifest.json');writeFileSync(f,JSON.stringify(m));
    assert.throws(()=>evaluateBenchmarkFiles(f,root),/escapes/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('CLI threshold exit status and JSON output are reproducible',()=>{
  const cli=new URL('../tools/benchmark/cli.mjs',import.meta.url).pathname;
  const args=['--manifest',manifest.pathname,'--reports',dir.pathname,'--json'];
  const ok=spawnSync(process.execPath,[cli,...args,'--min-precision','0.5'],{encoding:'utf8'});
  assert.equal(ok.status,0,ok.stderr);assert.equal(JSON.parse(ok.stdout).overall.precision,0.5);
  assert.equal(spawnSync(process.execPath,[cli,...args,'--min-recall','0.8']).status,1);
  assert.equal(spawnSync(process.execPath,[cli,...args,'--min-precision','1.1']).status,2);
});
