import express from 'express';
import { pool } from './db.js';

const app = express();
const PORT = 3001;

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ service: 'production-service', status: 'ok' });
});

app.get('/api/machines', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, code, name, status, created_at FROM machines ORDER BY id'
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(503).json({ message: 'Makine kayıtlarına erişilemedi.' });
  }
});

app.post('/api/machines', async (req, res) => {
  const body = req.body ?? {};
  const code = typeof body.code === 'string'
    ? body.code.trim().toUpperCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const status = body.status ?? 'idle';

  if (!code || code.length > 30 || !name || name.length > 100) {
    return res.status(400).json({
      message: 'Kod (en fazla 30 karakter) ve makine adı (en fazla 100 karakter) gerekli.'
    });
  }

  if (!['idle', 'running', 'maintenance'].includes(status)) {
    return res.status(400).json({ message: 'Geçersiz makine durumu.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO machines (code, name, status)
       VALUES ($1, $2, $3)
       RETURNING id, code, name, status, created_at`,
      [code, name, status]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        message: 'Bu makine kodu zaten kayıtlı.'
      });
    }

    console.error(error);
    res.status(503).json({ message: 'Makine kaydedilemedi.' });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Üretim servisi: http://localhost:${PORT}`);
});
