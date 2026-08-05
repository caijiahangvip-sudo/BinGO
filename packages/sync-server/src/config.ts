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
  BINGO_BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BINGO_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).optional(),
});

export const config = envSchema.parse(process.env);
