const express = require('express');
const os = require('os');
const { pool, init } = require('./db');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const toProduct = (r) => r && { ...r, unit_price: Number(r.unit_price) };

// Tag every response with the pod that served it (handy to show load balancing across replicas)
app.use((req, res, next) => {
  res.set('X-Served-By', os.hostname());
  next();
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ service: 'inventory-service', status: 'UP', pod: os.hostname() });
  } catch (e) {
    res.status(503).json({ service: 'inventory-service', status: 'DOWN', error: e.message });
  }
});

// Query: list products (optional ?category=)
app.get('/products', async (req, res, next) => {
  try {
    const { category } = req.query;
    const { rows } = category
      ? await pool.query('SELECT * FROM products WHERE category = $1 ORDER BY id', [category])
      : await pool.query('SELECT * FROM products ORDER BY id');
    res.json(rows.map(toProduct));
  } catch (e) { next(e); }
});

// Query: get one product
app.get('/products/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json(toProduct(rows[0]));
  } catch (e) { next(e); }
});

// Query: check availability for a quantity
app.get('/products/:id/availability', async (req, res, next) => {
  try {
    const qty = Number(req.query.qty || 1);
    const { rows } = await pool.query('SELECT id, sku, stock FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json({ ...rows[0], requested: qty, available: rows[0].stock >= qty });
  } catch (e) { next(e); }
});

// Command: create product
app.post('/products', async (req, res, next) => {
  try {
    const { sku, name, category, uom = 'NOS', unit_price, stock = 0 } = req.body || {};
    if (!sku || !name || unit_price == null) {
      return res.status(400).json({ error: 'sku, name and unit_price are required' });
    }
    const { rows } = await pool.query(
      'INSERT INTO products (sku, name, category, uom, unit_price, stock) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [sku, name, category, uom, unit_price, stock]
    );
    res.status(201).json(toProduct(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'SKU already exists' });
    next(e);
  }
});

// Command: adjust stock (goods receipt / write-off). Body: { "delta": 50 }
app.patch('/products/:id/stock', async (req, res, next) => {
  try {
    const delta = Number(req.body && req.body.delta);
    if (!Number.isInteger(delta)) return res.status(400).json({ error: 'delta must be an integer' });
    const { rows } = await pool.query(
      'UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2 AND stock + $1 >= 0 RETURNING *',
      [delta, req.params.id]
    );
    if (!rows.length) return res.status(409).json({ error: 'Product not found or stock would go negative' });
    res.json(toProduct(rows[0]));
  } catch (e) { next(e); }
});

// Command: reserve stock for a sales order (called by sales-order-service). Atomic, safe across replicas.
app.post('/products/:id/reserve', async (req, res, next) => {
  try {
    const qty = Number(req.body && req.body.quantity);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be a positive integer' });
    const { rows } = await pool.query(
      'UPDATE products SET stock = stock - $1, updated_at = now() WHERE id = $2 AND stock >= $1 RETURNING *',
      [qty, req.params.id]
    );
    if (!rows.length) {
      const exists = await pool.query('SELECT stock FROM products WHERE id = $1', [req.params.id]);
      if (!exists.rows.length) return res.status(404).json({ error: 'Product not found' });
      return res.status(409).json({ error: 'Insufficient stock', available: exists.rows[0].stock, requested: qty });
    }
    res.json({ reserved: qty, product: toProduct(rows[0]) });
  } catch (e) { next(e); }
});

// Command: release previously reserved stock (order cancelled / compensation)
app.post('/products/:id/release', async (req, res, next) => {
  try {
    const qty = Number(req.body && req.body.quantity);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: 'quantity must be a positive integer' });
    const { rows } = await pool.query(
      'UPDATE products SET stock = stock + $1, updated_at = now() WHERE id = $2 RETURNING *',
      [qty, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json({ released: qty, product: toProduct(rows[0]) });
  } catch (e) { next(e); }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal error', detail: err.message });
});

init()
  .then(() => app.listen(PORT, () => console.log(`inventory-service listening on ${PORT}`)))
  .catch((e) => { console.error(e); process.exit(1); });
