/** Deterministic offline benchmark of user-supplied ScanResult reports, not a scanner. */
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const idPattern = /^[A-Za-z][A-Za-z0-9._-]{0,99}$/;
const MAX_CASES = 10000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function inspectManifest(manifest) {
  if (!isRecord(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.cases) || manifest.cases.length > MAX_CASES) throw new Error('Expected schemaVersion 1 and at most 10000 cases');
  const seen = new Set();
  for (const [index,c] of manifest.cases.entries()) {
    if (!isRecord(c) || typeof c.id!=='string' || !idPattern.test(c.id) || seen.has(c.id)) throw new Error(`Case ${index}: invalid or duplicated ID`);
    seen.add(c.id);
    if (typeof c.operation!=='string' || !idPattern.test(c.operation)) throw new Error(`Case ${c.id}: invalid operation`);
    if (!isRecord(c.versions) || !Object.keys(c.versions).length || Object.entries(c.versions).some(([k,v])=>!idPattern.test(k) || typeof v !== 'string' || !v || v.length>128)) throw new Error(`Case ${c.id}: invalid versions`);
    if (!Array.isArray(c.expectedFindingIds) || c.expectedFindingIds.length>1024 || c.expectedFindingIds.some(id=>typeof id!=='string'||!idPattern.test(id)) || new Set(c.expectedFindingIds).size!==c.expectedFindingIds.length) throw new Error(`Case ${c.id}: invalid expectedFindingIds`);
    if (typeof c.intentionalNegative!=='boolean' || (c.intentionalNegative && c.expectedFindingIds.length)) throw new Error(`Case ${c.id}: intentionalNegative requires empty expectations`);
    if (typeof c.reportFile !=='string'||!c.reportFile.endsWith('.json')||!safePath(c.reportFile)) throw new Error(`Case ${c.id}: reportFile must be a safe relative .json path`);
    if (Object.keys(c).some(k=>!['id','operation','versions','expectedFindingIds','intentionalNegative','reportFile'].includes(k))) throw new Error(`Case ${c.id}: unknown manifest property`);
  }
  if (Object.keys(manifest).some(k=>!['schemaVersion','cases'].includes(k))) throw new Error('Unknown manifest property');
  return manifest.cases;
}
function safePath(p) {return !isAbsolute(p) && !p.includes('\\') && !p.startsWith('~') && !p.includes(':') && !p.split('/').some(s=>!s||s==='.'||s==='..') && !/[\u0000-\u001f]/.test(p);}
function inside(root, candidate) { const rel=relative(root,candidate);return rel!=='' && !rel.startsWith('..')&&!isAbsolute(rel); }
function readBoundedJson(file) {if(statSync(file).size>MAX_FILE_BYTES)throw new Error('JSON exceeds 2 MiB');const bytes=readFileSync(file);if(bytes.length>MAX_FILE_BYTES)throw new Error('JSON exceeds 2 MiB');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function metrics(tp,fp,fn){return {tp,fp,fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null};}
/** Pure evaluator; reports is a Map or plain object keyed by case ID (null indicates absent). */
export function evaluateBenchmark(manifest,reports) {
  const cases=inspectManifest(manifest);
  const lookup=id=>reports instanceof Map ? reports.get(id):Object.prototype.hasOwnProperty.call(reports,id)?reports[id]:undefined;
  let excluded=0,notEvaluated=0,intentionalNegatives=0,trueNegativeCases=0;
  const perRule=new Map(), details=[];
  for(const c of [...cases].sort((a,b)=>a.id.localeCompare(b.id,'en'))){
    const r=lookup(c.id);
    if(r===undefined){excluded++;details.push({id:c.id,status:'missing'});continue;}
    if(!isRecord(r)|| !['complete','unavailable'].includes(r.status))throw new Error(`Case ${c.id}: invalid ScanResult status`);
    if(r.status==='unavailable'){
      if(typeof r.reason !== 'string' || !r.reason.trim())throw new Error(`Case ${c.id}: missing unavailable reason`);
      notEvaluated++;details.push({id:c.id,status:'unavailable'});continue;
    }
    if(!Array.isArray(r.findings)||r.findings.length>20000)throw new Error(`Case ${c.id}: invalid findings`);
    if(r.findings.some(f=>!isRecord(f)||typeof f.ruleId!=='string'||!idPattern.test(f.ruleId)||!['confirmed-failure','review-required','not-evaluated'].includes(f.confidence)))throw new Error(`Case ${c.id}: invalid finding fields`);
    if(r.findings.some(f=>f.confidence==='not-evaluated')){notEvaluated++;details.push({id:c.id,status:'not-evaluated'});continue;}
    const observed=new Set(r.findings.map(f=>f.ruleId));
    const expected=new Set(c.expectedFindingIds);
    const union=new Set([...observed,...expected]);
    let tp=0,fp=0,fn=0;
    for(const id of union){const match=observed.has(id)&&expected.has(id),falsePositive=observed.has(id)&&!expected.has(id),falseNegative=expected.has(id)&&!observed.has(id);
      const previous=perRule.get(id)??{tp:0,fp:0,fn:0}; previous.tp+=Number(match);previous.fp+=Number(falsePositive);previous.fn+=Number(falseNegative);perRule.set(id,previous);
      tp+=Number(match);fp+=Number(falsePositive);fn+=Number(falseNegative);
    }
    if(c.intentionalNegative){intentionalNegatives++;if(observed.size===0)trueNegativeCases++;}
    details.push({id:c.id,status:'evaluated',...metrics(tp,fp,fn)});
  }
  const sorted=Object.fromEntries([...perRule.entries()].sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>[k,metrics(v.tp,v.fp,v.fn)]));
  let tp=0,fp=0,fn=0;for(const v of perRule.values()){tp+=v.tp;fp+=v.fp;fn+=v.fn;}
  return {schemaVersion:1,cases:cases.length,evaluated:details.filter(d=>d.status==='evaluated').length,excluded,notEvaluated,intentionalNegatives,trueNegativeCases,overall:metrics(tp,fp,fn),perRule:sorted,details};
}
/** Read user-supplied manifest and report files; reject path escapes (including symlinks). */
export function evaluateBenchmarkFiles(manifestFile,reportDirectory) {
  const manifest=readBoundedJson(manifestFile);
  const cases=inspectManifest(manifest);
  const root=realpathSync(reportDirectory);
  const reports=new Map();
  for(const c of cases){
    const file=resolve(root,c.reportFile);
    if(!inside(root,file))throw new Error(`Unsafe path for ${c.id}`);
    let canonical;
    try{canonical=realpathSync(file);}catch(error){if(error.code==='ENOENT'){continue;}throw error;}
    if(!inside(root,canonical))throw new Error(`Report escapes directory for ${c.id}`);
    reports.set(c.id,readBoundedJson(canonical));
  }
  return evaluateBenchmark(manifest,reports);
}
export function checkThresholds(result,{minPrecision,minRecall}={}) {
  for(const [label,limit] of [['precision',minPrecision],['recall',minRecall]]) {
    if(limit===undefined)continue;
    if(typeof limit!=='number'||!Number.isFinite(limit)||limit<0||limit>1)throw new RangeError(`Invalid ${label} threshold`);
    if(result.overall[label]===null||result.overall[label]<limit)return false;
  }
  return true;
}
