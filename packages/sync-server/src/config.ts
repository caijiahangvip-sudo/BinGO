import { z } from 'zod';

const envSchema = z.object({
  BINGO_SYNC_HOST: z.string().default('0.0.0.0'),
  BINGO_SYNC_PORT: z.coerce.number().int().positive().default(4100),
  BINGO_COLLAB_PORT: z.coerce.number().int().positive().default(4101),
  BINGO_DATABASE_URL: z
    .string()
    .default('postgres://bingo:bingo@127.0.0.1:5432/bingo'),
  BINGO_TOKEN_SECRET: z.string().min(32),
  BINGO_ACCESS_TOKEN_SECONDS: z.coerce.number().int().positive().default(3600),
  BINGO_REFRESH_TOKEN_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  BINGO_BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BINGO_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).optional(),
  BINGO_BOOTSTRAP_INVITE_CODE: z.string().min(4).max(64).optional(),
  BINGO_ADMIN_ORIGIN: z.string().url().default('https://admin.bingo.mido.site'),
  BINGO_ADMIN_AGENT_URL: z.string().url().default('http://admin-agent:4103'),
  BINGO_ADMIN_AGENT_SECRET: z.string().min(32).optional(),
  BINGO_DATA_ENCRYPTION_KEY: z.string().min(64).optional(),
  BINGO_OBJECT_STORAGE_DIR: z.string().default('/data/teacher-objects'),
  BINGO_RELEASE_VERSION: z.string().default('5.0.0'),
  BINGO_RELEASE_CODENAME: z.string().default('Rome'),
  BINGO_MODEL_PROFILE: z.string().default('rome-education-v1'),
});

export const config = envSchema.parse(process.env);
