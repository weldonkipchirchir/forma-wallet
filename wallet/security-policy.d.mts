export const DEFAULT_RPC: string;
export function validatePublicEnvironment(env: Record<string, string | undefined>, production?: boolean): URL;
export function securityHeaders(rpc: URL, production?: boolean): Record<string, string>;
