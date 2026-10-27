import type { ScanResult } from "../../src/contracts.js";

export declare const SCHEMA_VERSION: "1.0.0";
export declare const SCHEMA_DRAFT: "https://json-schema.org/draft/2020-12/schema";
export declare const DEFAULT_MAX_REPORT_BYTES: number;
export declare const DEFAULT_MAX_FINDINGS: number;
export declare const MAX_LINE_NUMBER: number;
export declare const MAX_COLUMN_NUMBER: number;
export declare const ALLOWED_CONFIDENCES: readonly [
  "confirmed-failure",
  "review-required",
  "not-evaluated"
];
export declare const ALLOWED_SEVERITIES: readonly [
  "critical",
  "high",
  "medium",
  "low",
  "info"
];

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ValidationOptions {
  readonly maxBytes?: number;
  readonly maxFindings?: number;
}

export type ValidationOutcome =
  | {
      readonly valid: true;
      readonly schemaVersion: string;
      readonly errors: readonly [];
      readonly value: ScanResult;
    }
  | {
      readonly valid: false;
      readonly schemaVersion: string;
      readonly errors: readonly ValidationIssue[];
    };

export declare function loadScanResultSchema(): Record<string, unknown>;
export declare function validateScanResult(
  input: unknown,
  options?: ValidationOptions
): ValidationOutcome;
export declare function validateScanResultJson(
  rawJson: string | Buffer,
  options?: ValidationOptions
): ValidationOutcome;
