const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'inventory',
  password: process.env.DB_PASSWORD || 'inventory',
  database: process.env.DB_NAME || 'inventorydb',
});

const SEED = [
  ['RM-STEEL-01', 'Steel Sheet 2mm', 'Raw Material', 'KG', 85.0, 500],
  ['RM-PAINT-02', 'Industrial Paint (Grey)', 'Raw Material', 'LTR', 420.0, 120],
  ['FG-CHAIR-10', 'Office Chair - Ergo', 'Finished Good', 'NOS', 6500.0, 40],
  ['FG-DESK-20', 'Workstation Desk 5ft', 'Finished Good', 'NOS', 12500.0, 15],
  ['SP-BOLT-M8', 'Hex Bolt M8 x 40', 'Spare Part', 'NOS', 6.5, 5000],
];

async function init(retries = 20) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
          id          SERIAL PRIMARY KEY,
          sku         VARCHAR(40) UNIQUE NOT NULL,
          name        VARCHAR(120) NOT NULL,
          category    VARCHAR(60),
          uom         VARCHAR(10) DEFAULT 'NOS',
          unit_price  NUMERIC(12,2) NOT NULL,
          stock       INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
          updated_at  TIMESTAMPTZ DEFAULT now()
        )`);
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
      if (rows[0].n === 0) {
        for (const p of SEED) {
          await pool.query(
            'INSERT INTO products (sku, name, category, uom, unit_price, stock) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (sku) DO NOTHING',
            p
          );
        }
        console.log('Seeded product master');
      }
      return;
    } catch (err) {
      console.log(`DB not ready (attempt ${i}/${retries}): ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('Could not connect to database');
}

module.exports = { pool, init };
