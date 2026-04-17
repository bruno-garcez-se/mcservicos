import { pool } from "../../db/pool";
import { AuthUser } from "../../types/auth";
import { decryptSecret, encryptSecret } from "../../utils/crypto";

export type ExtraField = {
  name: string;
  value: string;
};

export type CredentialResponse = {
  id: number;
  systemName: string;
  linkUrl: string;
  username: string;
  password: string;
  updatedAt: string;
  groupIds: number[];
  extraFields: ExtraField[];
};

function normalizeCredentialRow(
  row: {
    id: number;
    system_name: string;
    link_url: string;
    username: string;
    password_encrypted: string;
    extra_fields: unknown;
    updated_at: string;
    group_ids: number[] | null;
  },
): CredentialResponse {
  const extraFields = Array.isArray(row.extra_fields)
    ? row.extra_fields
        .filter(
          (item): item is { name: string; value: string } =>
            typeof item === "object" &&
            item !== null &&
            "name" in item &&
            "value" in item &&
            typeof (item as { name: unknown }).name === "string" &&
            typeof (item as { value: unknown }).value === "string",
        )
        .map((item) => ({ name: item.name, value: item.value }))
    : [];

  return {
    id: row.id,
    systemName: row.system_name,
    linkUrl: row.link_url ?? "",
    username: row.username,
    password: decryptCredentialValue(row.password_encrypted),
    updatedAt: row.updated_at,
    groupIds: row.group_ids ?? [],
    extraFields,
  };
}

function decryptCredentialValue(rawValue: string): string {
  try {
    return decryptSecret(rawValue);
  } catch {
    // Compatibilidade com dados legados que possam ter sido gravados sem criptografia.
    return rawValue;
  }
}

export async function listCredentialsForUser(
  user: AuthUser,
): Promise<CredentialResponse[]> {
  const params: unknown[] = [];
  let whereClause = "";

  if (user.role !== "admin") {
    params.push(user.groupIds);
    whereClause = `WHERE cg.group_id = ANY($1::int[])`;
  }

  const result = await pool.query(
    `SELECT c.id, c.system_name, c.link_url, c.username, c.password_encrypted, c.extra_fields, c.updated_at,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT cg.group_id), NULL) AS group_ids
     FROM credentials c
     LEFT JOIN credential_groups cg ON cg.credential_id = c.id
     ${whereClause}
     GROUP BY c.id
     ORDER BY c.system_name ASC`,
    params,
  );

  return result.rows.map(normalizeCredentialRow);
}

export async function createCredential(input: {
  systemName: string;
  linkUrl: string;
  username: string;
  password: string;
  groupIds: number[];
  extraFields: ExtraField[];
  actorUserId: number;
}): Promise<CredentialResponse> {
  const created = await pool.query(
    `INSERT INTO credentials (system_name, link_url, username, password_encrypted, extra_fields, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, system_name, link_url, username, password_encrypted, extra_fields, updated_at`,
    [
      input.systemName,
      input.linkUrl,
      input.username,
      encryptSecret(input.password),
      JSON.stringify(input.extraFields),
      input.actorUserId,
    ],
  );

  const cred = created.rows[0] as {
    id: number;
    system_name: string;
    link_url: string;
    username: string;
    password_encrypted: string;
    extra_fields: unknown;
    updated_at: string;
  };

  if (input.groupIds.length > 0) {
    await pool.query(
      `INSERT INTO credential_groups (credential_id, group_id)
       SELECT $1, UNNEST($2::int[])`,
      [cred.id, input.groupIds],
    );
  }

  return {
    ...normalizeCredentialRow({ ...cred, group_ids: input.groupIds }),
    groupIds: input.groupIds,
  };
}

export async function updateCredential(input: {
  id: number;
  systemName: string;
  linkUrl: string;
  username: string;
  password: string;
  groupIds: number[];
  extraFields: ExtraField[];
  actorUserId: number;
}): Promise<CredentialResponse | null> {
  const updated = await pool.query(
    `UPDATE credentials
     SET system_name = $1,
         link_url = $2,
         username = $3,
         password_encrypted = $4,
         extra_fields = $5,
         updated_by = $6,
         updated_at = NOW()
     WHERE id = $7
     RETURNING id, system_name, link_url, username, password_encrypted, extra_fields, updated_at`,
    [
      input.systemName,
      input.linkUrl,
      input.username,
      encryptSecret(input.password),
      JSON.stringify(input.extraFields),
      input.actorUserId,
      input.id,
    ],
  );

  if (updated.rowCount === 0) {
    return null;
  }

  await pool.query(`DELETE FROM credential_groups WHERE credential_id = $1`, [input.id]);
  if (input.groupIds.length > 0) {
    await pool.query(
      `INSERT INTO credential_groups (credential_id, group_id)
       SELECT $1, UNNEST($2::int[])`,
      [input.id, input.groupIds],
    );
  }

  const cred = updated.rows[0] as {
    id: number;
    system_name: string;
    link_url: string;
    username: string;
    password_encrypted: string;
    extra_fields: unknown;
    updated_at: string;
  };

  return {
    ...normalizeCredentialRow({ ...cred, group_ids: input.groupIds }),
    groupIds: input.groupIds,
  };
}

export async function deleteCredential(id: number): Promise<number[] | null> {
  const groupsResult = await pool.query(
    `SELECT group_id FROM credential_groups WHERE credential_id = $1`,
    [id],
  );
  const groupIds = groupsResult.rows.map((row) => Number(row.group_id));

  const deleted = await pool.query(`DELETE FROM credentials WHERE id = $1`, [id]);
  if (deleted.rowCount === 0) {
    return null;
  }

  return groupIds;
}
