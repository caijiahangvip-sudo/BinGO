import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';

const scrypt = promisify(scryptCallback);

export type AccountRole = 'admin' | 'teacher' | 'student';

export interface AccessClaims {
  sub: string;
  role: AccountRole;
  organizationId: string;
  exp: number;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function sign(unsignedToken: string): string {
  return createHmac('sha256', config.BINGO_TOKEN_SECRET).update(unsignedToken).digest('base64url');
}

export function issueAccessToken(input: Omit<AccessClaims, 'exp'>): string {
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = encode(
    JSON.stringify({
      ...input,
      exp: Math.floor(Date.now() / 1000) + config.BINGO_ACCESS_TOKEN_SECONDS,
    }),
  );
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyAccessToken(token: string): AccessClaims {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) throw new Error('Invalid access token');
  const expected = Buffer.from(sign(`${header}.${payload}`));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('Invalid access token');
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AccessClaims;
  if (!claims.sub || !claims.organizationId || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw new Error('Expired access token');
  }
  return claims;
}

export function bearerToken(value: string | undefined): string {
  if (!value?.startsWith('Bearer ')) throw new Error('Authorization required');
  return value.slice('Bearer '.length).trim();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
  const salt = Buffer.from(saltValue, 'base64url');
  const expected = Buffer.from(hashValue, 'base64url');
  const received = (await scrypt(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(expected, received);
}
