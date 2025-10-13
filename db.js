import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE === '1' ? false : { rejectUnauthorized: false }
});

export async function query(q, params) {
  const c = await pool.connect();
  try {
    return await c.query(q, params);
  } finally {
    c.release();
  }
}
