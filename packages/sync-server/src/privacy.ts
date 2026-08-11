import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';

export const PRIVACY_LABELS = Object.freeze({
  A: 'Angerona',
  B: 'Fides',
  C: 'Sancus',
} as const);

export const ROLE_LABELS = Object.freeze({
  student: 'Lar',
  teacher: 'Janus',
  admin: 'Luppiter',
} as const);

export type PrivacyTier = keyof typeof PRIVACY_LABELS;

function masterKey(): Buffer {
  const configured = config.BINGO_DATA_ENCRYPTION_KEY;
  if (configured) return Buffer.from(configured, 'hex');
  return createHash('sha256').update(config.BINGO_TOKEN_SECRET).digest();
}

export function privacyLabel(tier: string): string {
  return PRIVACY_LABELS[tier as PrivacyTier] ?? '未分级';
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? '未知角色';
}

export function dataCategoryForEntity(entityType: string): string {
  const normalized = entityType.toLowerCase();
  if (normalized === 'client-state') return 'private';
  if (normalized.includes('classroom')) return 'classroom-definition';
  if (normalized.includes('memory') || normalized.includes('chat')) return 'classroom-memory';
  if (normalized.includes('activity') || normalized.includes('event')) return 'classroom-activity';
  if (normalized.includes('homework')) return 'homework';
  if (normalized.includes('document') || normalized.includes('pdf')) return 'document';
  if (normalized.includes('whiteboard')) return 'whiteboard';
  if (normalized.includes('setting')) return 'settings';
  if (normalized.includes('profile')) return 'profile';
  return 'private';
}

export function canAdminDirectRead(tier: string, category: string): boolean {
  if (tier === 'A') return true;
  if (tier === 'B') return category === 'classroom-definition';
  return false;
}

export function encryptPayload(payload: unknown): { encryptedPayload: string; iv: string; tag: string; keyVersion: number } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    encryptedPayload: encrypted.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    keyVersion: 1,
  };
}

export function decryptPayload(row: { encrypted_payload?: string | null; encryption_iv?: string | null; encryption_tag?: string | null; payload?: unknown }): unknown {
  if (!row.encrypted_payload || !row.encryption_iv || !row.encryption_tag) return row.payload ?? null;
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(row.encryption_iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(row.encryption_tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(row.encrypted_payload, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}
