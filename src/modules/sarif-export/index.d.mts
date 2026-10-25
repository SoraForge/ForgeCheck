export interface Finding {
  readonly ruleId: string;
  readonly message: string;
  readonly confidence: 'confirmed-failure' | 'review-required' | 'not-evaluated';
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
}
export type ScanResult = { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'complete'; readonly findings: readonly Finding[]; readonly filesScanned?: number; readonly rulesEvaluated?: number };
export function toSarif(scan: ScanResult): Record<string, unknown>;
