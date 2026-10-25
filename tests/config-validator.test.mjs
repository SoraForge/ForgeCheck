import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateConfig,parseConfig} from '../src/modules/config-validator/index.mjs';
const invalid=(value,code)=>{const r=validateConfig(value);assert.equal(r.ok,false,JSON.stringify(r));assert.ok(r.diagnostics.some(x=>x.code===code),JSON.stringify(r));};
test('safe defaults and customized config normalize without mutation',()=>{
  assert.deepEqual(validateConfig({}).config,{schemaVersion:1,include:['**/*'],exclude:[],enabledRules:[],report:{mode:'json'},limits:{maxFiles:10000,maxFileBytes:1048576}});
  const sample={schemaVersion:1,include:['src/**/*.ts'],exclude:['**/test/*.ts'],enabledRules:['sdk.version'],report:{mode:'text',output:'reports/local.txt'},limits:{maxFiles:1,maxFileBytes:104857600}};
  assert.deepEqual(validateConfig(sample).config,sample);
  assert.equal(validateConfig(undefined).ok,true);
  assert.equal(parseConfig(JSON.stringify(sample)).ok,true);
});
test('rejects unknown and misspelled keys with suggestions',()=>{
  const r=validateConfig({inculde:['a']});assert.equal(r.ok,false);assert.match(r.diagnostics[0].message,/include/);
  invalid({network:true},'UNKNOWN_KEY');invalid({report:{upload:true}},'UNKNOWN_KEY');
});
test('unsupported schema, bad output, dangerous paths and glob structures fail',()=>{
  invalid({schemaVersion:2},'SCHEMA_VERSION');
  for(const output of ['/tmp/out','../secret','C:/windows/out','a\\b','a//b','./a','~/a'])invalid({report:{output}},'INVALID_OUTPUT');
  for(const glob of ['../**','/src/**','a/**x','**/../x','a/[abc','a/!foo','a/{x,y}'])invalid({include:[glob]},'INVALID_GLOB');
});
test('invalid rules, invalid bounds, boundary acceptance, unknown report modes',()=>{
  invalid({enabledRules:['bad id']},'INVALID_RULE');
  invalid({enabledRules:['valid','valid']},'DUPLICATE_RULE');
  invalid({include:['x','x']},'DUPLICATE_GLOB');
  invalid({limits:{maxFiles:0}},'INVALID_LIMIT');
  invalid({limits:{maxFiles:100001}},'INVALID_LIMIT');
  invalid({limits:{maxFileBytes:1.2}},'INVALID_LIMIT');
  invalid({report:{mode:'html'}},'INVALID_MODE');
  assert.equal(validateConfig({limits:{maxFiles:100000,maxFileBytes:1}}).ok,true);
});
test('malformed, oversized, invalid UTF8 and unsupported types fail closed',()=>{
  assert.equal(parseConfig('{').ok,false);
  assert.equal(parseConfig(' '.repeat(65537)).ok,false);
  assert.equal(parseConfig(Uint8Array.from([0xc3,0x28])).ok,false);
  invalid(null,'INVALID_TYPE');invalid([], 'INVALID_TYPE');invalid({report:[]},'INVALID_TYPE');
  invalid({include:'src/**'},'INVALID_LIST');invalid({include:null},'INVALID_LIST');invalid({report:null},'INVALID_TYPE');invalid({limits:null},'INVALID_TYPE');invalid({enabledRules:null},'INVALID_LIST');invalid({limits:{maxFiles:'30'}},'INVALID_LIMIT');
});
