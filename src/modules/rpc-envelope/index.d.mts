export type RpcDiagnostic = { code: string; path: string; message: string };
export interface RpcOptions { kind?: 'request'|'response'; maxBytes?: number; maxBatch?: number }
export interface RpcValidation { ok: boolean; kind: string; count: number; notifications: number; diagnostics: RpcDiagnostic[] }
export declare const DEFAULT_MAX_BYTES: number;
export declare const DEFAULT_MAX_BATCH: number;
export declare function validateRpcEnvelope(input: unknown, options?: RpcOptions): RpcValidation;
export declare function validateRpcRequest(input: unknown, options?: Omit<RpcOptions,'kind'>): RpcValidation;
export declare function validateRpcResponse(input: unknown, options?: Omit<RpcOptions,'kind'>): RpcValidation;
