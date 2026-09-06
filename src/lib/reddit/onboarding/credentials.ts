import { randomBytes } from "node:crypto";
import { redditVaultKeyId } from "./config.ts";
import type { SqlLike } from "./sql.ts";
import { decryptSecretStrict, encryptV2 } from "./vault.ts";

const PURPOSE = "temporary_signup_password";

export type CreatedAccountCredentials = {
  jobId: string;
  username: string;
  password: string;
};

export function generatedCreatePassword(): string {
  const raw = randomBytes(12).toString("base64url").replace(/[^a-zA-Z0-9]/g, "x");
  return `Rr1!${raw.slice(0, 12)}`;
}

export async function putJobSignupPassword(
  sql: SqlLike,
  opts: { userId: string; jobId: string; password: string },
): Promise<void> {
  const id = crypto.randomUUID();
  const ciphertext = encryptV2(opts.password, {
    userId: opts.userId,
    recordId: opts.jobId,
    purpose: PURPOSE,
  });
  await sql.query(
    `update reddit_secret_entries
        set deleted_at = now(), updated_at = now()
      where user_id = $1 and job_id = $2 and purpose = $3 and deleted_at is null`,
    [opts.userId, opts.jobId, PURPOSE],
  );
  await sql.query(
    `insert into reddit_secret_entries (
       id, user_id, purpose, job_id, ciphertext, envelope_version, key_id
     ) values ($1,$2,$3,$4,$5,'v2',$6)`,
    [id, opts.userId, PURPOSE, opts.jobId, ciphertext, redditVaultKeyId()],
  );
}

export async function readJobSignupPassword(
  sql: SqlLike,
  opts: { userId: string; jobId: string },
): Promise<string | null> {
  const rows = await sql.query<{ ciphertext: string }>(
    `select ciphertext from reddit_secret_entries
      where user_id = $1 and job_id = $2 and purpose = $3 and deleted_at is null
      order by created_at desc limit 1`,
    [opts.userId, opts.jobId, PURPOSE],
  );
  const blob = rows[0]?.ciphertext;
  if (!blob) return null;
  try {
    return decryptSecretStrict(blob, {
      userId: opts.userId,
      recordId: opts.jobId,
      purpose: PURPOSE,
    });
  } catch {
    return null;
  }
}

export async function listBatchCredentials(
  sql: SqlLike,
  opts: { userId: string; batchId: string },
): Promise<CreatedAccountCredentials[]> {
  const jobs = await sql.query<{
    id: string;
    expected_username: string | null;
    verified_username: string | null;
  }>(
    `select id, expected_username, verified_username
       from reddit_onboarding_jobs
      where user_id = $1 and batch_id = $2
      order by batch_index asc, created_at asc`,
    [opts.userId, opts.batchId],
  );
  const out: CreatedAccountCredentials[] = [];
  for (const job of jobs) {
    const username = job.verified_username || job.expected_username;
    if (!username) continue;
    const password = await readJobSignupPassword(sql, { userId: opts.userId, jobId: job.id });
    if (!password) continue;
    out.push({ jobId: job.id, username, password });
  }
  return out;
}
