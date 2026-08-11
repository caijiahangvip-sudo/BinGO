import { bearerToken, verifyActiveAccessToken, type AccessClaims } from './auth.js';

export class HTTPError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function requireAccount(request: {
  headers: { authorization?: string };
}): Promise<AccessClaims> {
  try {
    return await verifyActiveAccessToken(bearerToken(request.headers.authorization));
  } catch {
    throw new HTTPError(401, '登录已过期或设备已被撤销');
  }
}

export function requireRole(account: AccessClaims, ...roles: AccessClaims['role'][]): void {
  if (!roles.includes(account.role)) throw new HTTPError(403, '当前账号没有执行此操作的权限');
}
