/** Standalone, offline validation of a versioned ForgeCheck scan configuration. */
const MAX_CONFIG_BYTES = 64 * 1024;
const DEFAULT_CONFIG = Object.freeze({schemaVersion:1,include:['**/*'],exclude:[],enabledRules:[],report:{mode:'json'},limits:{maxFiles:10000,maxFileBytes:1048576}});
const own = (value, key) => Object.prototype.hasOwnProperty.call(value,key);
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fields = {root:['schemaVersion','include','exclude','enabledRules','report','limits'],report:['mode','output'],limits:['maxFiles','maxFileBytes']};

function distance(a,b) {
  const row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){let prev=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=old;}}
  return row[b.length];
}
function suggestion(key,allowed){const found=allowed.map(k=>[k,distance(key,k)]).sort((a,b)=>a[1]-b[1])[0];return found&&found[1]<=3?` (did you mean "${found[0]}"?)`:'';}
function safeRelativePath(s) {
  return typeof s==='string' && s.length>0 && s.length<=512 && !s.includes('\\') && !/[\u0000-\u001f\u007f]/.test(s) && !s.startsWith('/') && !/^[A-Za-z]:/.test(s) && !s.startsWith('~') && !s.split('/').some(p=>p==='..'||p==='.') && !s.includes('//') && !s.includes(':');
}
function validGlob(pattern) {
  if (!safeRelativePath(pattern) || pattern.includes('!') || /[{}()]/.test(pattern)) return false;
  // Whole-segment ** is supported; embedded '**' and unterminated classes are not.
  for(const segment of pattern.split('/')){
    if (!segment || (segment.includes('**') && segment!=='**'))return false;
    let inside=false,seen=false;
    for(const ch of segment){
      if(ch==='['){if(inside)return false;inside=true;seen=false;}
      else if(ch===']'){if(!inside||!seen)return false;inside=false;}
      else if(inside)seen=true;
    }
    if(inside)return false;
  }
  return true;
}
function jsonCompatible(value) {
  try { const json=JSON.stringify(value); if(typeof json!=='string')return {error:'Input must be a JSON value'};if(Buffer.byteLength(json,'utf8')>MAX_CONFIG_BYTES)return {error:'Configuration exceeds 64 KiB'}; return {value:JSON.parse(json)}; }
  catch{return {error:'Configuration is not JSON-compatible'};}
}
/** Returns explicit diagnostics and a normalized immutable-shape plain object (only when valid). */
export function validateConfig(input) {
  const diagnostics=[];
  const fail=(code,path,message)=>diagnostics.push({code,path,message});
  if(input === undefined) input = {};
  const cloned=jsonCompatible(input);
  if(cloned.error){fail('INVALID_INPUT','$',cloned.error);return {ok:false,diagnostics};}
  const config=cloned.value;
  if(!record(config)){fail('INVALID_TYPE','$','Configuration must be a JSON object');return {ok:false,diagnostics};}
  function keys(obj,allowed,path){for(const key of Object.keys(obj))if(!allowed.includes(key))fail('UNKNOWN_KEY',`${path}.${key}`,`Unknown setting "${key}"${suggestion(key,allowed)}`);}
  keys(config,fields.root,'$');
  if (own(config,'schemaVersion') && config.schemaVersion!==1) fail('SCHEMA_VERSION','$.schemaVersion','Only schemaVersion 1 is supported');
  const paths={};
  for(const key of ['include','exclude']){
    const value=own(config,key)?config[key]:(key==='include'?DEFAULT_CONFIG.include:DEFAULT_CONFIG.exclude);
    if(!Array.isArray(value)||value.length>128){fail('INVALID_LIST',`$.${key}`,'Expected a list containing at most 128 glob patterns');continue;}
    paths[key]=[];
    for(let i=0;i<value.length;i++) {
      if(!validGlob(value[i]))fail('INVALID_GLOB',`$.${key}[${i}]`,'Expected a safe, relative, well-formed glob');
      else if(paths[key].includes(value[i])) fail('DUPLICATE_GLOB',`$.${key}[${i}]`,'Duplicate glob pattern');
      else paths[key].push(value[i]);
    }
  }
  const rules=own(config,'enabledRules')?config.enabledRules:[];
  const cleanRules=[];
  if(!Array.isArray(rules)||rules.length>256)fail('INVALID_LIST','$.enabledRules','Expected a list containing at most 256 rule IDs');
  else rules.forEach((rule,i)=>{
    if(typeof rule!=='string'|| !/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(rule))fail('INVALID_RULE',`$.enabledRules[${i}]`,'Rule ID has invalid characters or length');
    else if(cleanRules.includes(rule))fail('DUPLICATE_RULE',`$.enabledRules[${i}]`,'Duplicate rule ID');
    else cleanRules.push(rule);
  });
  const report=own(config,'report')?config.report:{};
  if(!record(report))fail('INVALID_TYPE','$.report','Report must be an object');
  else {
    keys(report,fields.report,'$.report');
    if(own(report,'mode')&&!['json','text'].includes(report.mode))fail('INVALID_MODE','$.report.mode','Report mode must be json or text');
    if(own(report,'output')&&!safeRelativePath(report.output))fail('INVALID_OUTPUT','$.report.output','Output path must be safe and project-relative');
  }
  const limits=own(config,'limits')?config.limits:{};
  if(!record(limits))fail('INVALID_TYPE','$.limits','Limits must be an object');
  else {
    keys(limits,fields.limits,'$.limits');
    for(const [key,min,max] of [['maxFiles',1,100000],['maxFileBytes',1,104857600]]){
      if(own(limits,key)&&(!Number.isSafeInteger(limits[key])||limits[key]<min||limits[key]>max)) fail('INVALID_LIMIT',`$.limits.${key}`,`Must be an integer from ${min} to ${max}`);
    }
  }
  if(diagnostics.length)return {ok:false,diagnostics};
  return {ok:true,diagnostics,config:{schemaVersion:1,include:paths.include,exclude:paths.exclude,enabledRules:cleanRules,report:{mode:report.mode??'json',...(own(report,'output')?{output:report.output}:{})},limits:{maxFiles:limits.maxFiles??10000,maxFileBytes:limits.maxFileBytes??1048576}}};
}
export function parseConfig(input) {
  if(typeof input!=='string'&&!(input instanceof Uint8Array))return {ok:false,diagnostics:[{code:'INVALID_INPUT',path:'$',message:'Expected JSON string or UTF-8 byte array'}]};
  let object;
  try {
    if(input instanceof Uint8Array){if(input.byteLength>MAX_CONFIG_BYTES)throw new Error('Configuration exceeds 64 KiB');input=new TextDecoder('utf-8',{fatal:true}).decode(input);}
    if(Buffer.byteLength(input,'utf8')>MAX_CONFIG_BYTES)throw new Error('Configuration exceeds 64 KiB');
    object=JSON.parse(input);
  }catch{return {ok:false,diagnostics:[{code:'INVALID_JSON',path:'$',message:'Invalid or oversized JSON configuration'}]};}
  return validateConfig(object);
}
