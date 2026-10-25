export type TransportErrorCode = 'NETWORK_DISABLED'|'INVALID_URL'|'TLS_REQUIRED'|'PRIVATE_HOST'|'DISALLOWED_ORIGIN'|'ABORTED'|'TIMEOUT'|'NETWORK_FAILURE'|'BAD_RESPONSE'|'INVALID_METHOD'|'REDIRECT_NOT_ALLOWED'|'REDIRECT_LIMIT'|'REDIRECT_INVALID'|'HTTP_ERROR'|'RESPONSE_TOO_LARGE';
export class TransportError extends Error { readonly code: TransportErrorCode; readonly status?: number; }
export interface TransportOptions {
  enabled?: boolean;
  allowedOrigins?: readonly string[];
  allowHttp?: boolean;
  allowPrivateHosts?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: ()=>number;
  sleep?: (ms:number,signal?:AbortSignal)=>Promise<void>;
  fetchImpl?: typeof fetch;
}
export function createHttpTransport(options?:TransportOptions): {
  request(url:string,init?:RequestInit):Promise<{status:number;url:string;body:Uint8Array}>;
};
