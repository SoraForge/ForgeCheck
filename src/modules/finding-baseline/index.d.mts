import type { ScanFinding, ScanResult } from "../../contracts.js";

export declare class BaselinePolicyError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export interface BaselineEntry {
  readonly fingerprint: string;
  readonly rationale: string;
  readonly owner: string;
  readonly ruleId?: string;
  readonly file?: string;
  readonly expiresAt?: string;
  readonly allowConfirmedFailure?: boolean;
  readonly auditReference?: string;
}

export interface BaselineDocument {
  readonly entries: readonly BaselineEntry[];
}

export interface BaselineEvaluationOptions {
  readonly now?: string | number | Date;
  readonly clock?: () => string | number | Date;
  readonly allowConfirmedFailureOverride?: boolean;
}

export interface ActiveFindingRecord {
  readonly finding: ScanFinding;
  readonly fingerprint: string;
}

export interface MatchedBaselineRecord {
  readonly finding: ScanFinding;
  readonly fingerprint: string;
  readonly baseline: BaselineEntry;
}

export interface BaselineEvaluationResult {
  readonly evaluatedAt: string;
  readonly active: readonly ActiveFindingRecord[];
  readonly baselined: readonly MatchedBaselineRecord[];
  readonly expired: readonly MatchedBaselineRecord[];
  readonly unmatchedBaselineEntries: readonly BaselineEntry[];
  readonly summary: {
    readonly totalFindings: number;
    readonly activeCount: number;
    readonly baselinedCount: number;
    readonly expiredCount: number;
    readonly unmatchedBaselineCount: number;
  };
}

export declare function normalizeFindingPath(file?: string | null): string;
export declare function computeFindingFingerprint(finding: ScanFinding): string;
export declare function validateBaselineEntry(
  entry: unknown,
  index?: number
): BaselineEntry;
export declare function evaluateFindingBaseline(
  scanResult: ScanResult,
  baselineInput: readonly BaselineEntry[] | BaselineDocument,
  options?: BaselineEvaluationOptions
): BaselineEvaluationResult;
