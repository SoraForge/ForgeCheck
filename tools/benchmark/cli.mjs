#!/usr/bin/env node
import { evaluateBenchmarkFiles,checkThresholds } from './index.mjs';
const args=process.argv.slice(2);
function option(flag){const i=args.indexOf(flag);if(i===-1)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(`Missing value for ${flag}`);return args[i+1];}
try {
  if(args.includes('--help')){console.log('node tools/benchmark/cli.mjs --manifest PATH --reports DIR [--json] [--min-precision 0..1] [--min-recall 0..1]');process.exit(0);}
  const manifest=option('--manifest'),reports=option('--reports');
  if(!manifest||!reports)throw new Error('Both --manifest and --reports are required');
  const allowed=['--manifest','--reports','--json','--min-precision','--min-recall'];
  if(args.some(arg=>arg.startsWith('--')&&!allowed.includes(arg)))throw new Error('Unknown flag');
  const minPrecision=option('--min-precision'),minRecall=option('--min-recall');
  const thresholds={...(minPrecision===undefined?{}:{minPrecision:Number(minPrecision)}),...(minRecall===undefined?{}:{minRecall:Number(minRecall)})};
  if(Object.values(thresholds).some(n=>!Number.isFinite(n)))throw new Error('Invalid numeric threshold');
  const result=evaluateBenchmarkFiles(manifest,reports);
  if(args.includes('--json'))console.log(JSON.stringify(result,null,2));
  else console.log(`Synthetic benchmark: ${result.evaluated}/${result.cases} evaluated; ${result.excluded} missing; ${result.notEvaluated} not evaluated\nTP=${result.overall.tp} FP=${result.overall.fp} FN=${result.overall.fn}\nPrecision=${result.overall.precision??'undefined'} Recall=${result.overall.recall??'undefined'}`);
  if(!checkThresholds(result,thresholds))process.exitCode=1;
}catch(error){console.error(`Benchmark error: ${error.message}`);process.exitCode=2;}
