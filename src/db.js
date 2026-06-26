const { Pool, types } = require('pg');

// Return date columns as 'YYYY-MM-DD' strings, not JS Date objects
types.setTypeParser(1082, val => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.on('connect', client => {
  client.query('SET default_transaction_read_only = on');
});

const query = (text, params) => pool.query(text, params);

module.exports = { query };
