const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.tyxtcutpcakngtlbmhdz:L4L454Lin45jim3n3z&@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
  ssl: {
    rejectUnauthorized: false // importante para Supabase
  }
});

module.exports = pool;
