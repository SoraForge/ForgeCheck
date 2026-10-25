export interface ConfigDiagnostic {
  code: string;
  path: string;
  message: string;
}
export interface NormalizedConfig {
  schemaVersion: 1;
  include: string[];
  exclude: string[];
  enabledRules: string[];
  report: { mode: 'json' | 'text'; output?: string };
  limits: { maxFiles: number; maxFileBytes: number };
}
export type ConfigResult =
  | { ok: true; diagnostics: []; config: NormalizedConfig }
  | { ok: false; diagnostics: ConfigDiagnostic[]; config?: never };
export declare function validateConfig(input?: unknown): ConfigResult;
export declare function parseConfig(input: string | Uint8Array): ConfigResult;
