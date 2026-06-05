require('dotenv').config();
const mysql = require('mysql2/promise');

const { DB_HOST='localhost', DB_USER='root', DB_PASSWORD='', DB_NAME='sacco_db' } = process.env;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS members (
    id          INT           PRIMARY KEY AUTO_INCREMENT,
    name        VARCHAR(255)  NOT NULL,
    phone       VARCHAR(50),
    email       VARCHAR(255),
    address     TEXT,
    national_id VARCHAR(100)  UNIQUE,
    date_joined DATE          NOT NULL,
    status      VARCHAR(20)   NOT NULL DEFAULT 'active'
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS savings (
    id               INT           PRIMARY KEY AUTO_INCREMENT,
    member_id        INT           NOT NULL,
    amount           DECIMAL(15,2) NOT NULL,
    transaction_type VARCHAR(20)   NOT NULL,
    date             DATE          NOT NULL,
    notes            TEXT,
    FOREIGN KEY (member_id) REFERENCES members(id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS loans (
    id               INT           PRIMARY KEY AUTO_INCREMENT,
    member_id        INT           NOT NULL,
    amount_requested DECIMAL(15,2) NOT NULL,
    amount_approved  DECIMAL(15,2),
    interest_rate    DECIMAL(5,2)  NOT NULL DEFAULT 12.0,
    duration_months  INT           NOT NULL DEFAULT 12,
    purpose          TEXT,
    status           VARCHAR(20)   NOT NULL DEFAULT 'pending',
    date_applied     DATE          NOT NULL,
    date_approved    DATE,
    FOREIGN KEY (member_id) REFERENCES members(id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS loan_repayments (
    id          INT           PRIMARY KEY AUTO_INCREMENT,
    loan_id     INT           NOT NULL,
    amount_paid DECIMAL(15,2) NOT NULL,
    date_paid   DATE          NOT NULL,
    notes       TEXT,
    FOREIGN KEY (loan_id) REFERENCES loans(id)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS activity_log (
    id        INT          PRIMARY KEY AUTO_INCREMENT,
    action    VARCHAR(100) NOT NULL,
    details   TEXT,
    created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS users (
    id            INT           PRIMARY KEY AUTO_INCREMENT,
    username      VARCHAR(100)  NOT NULL UNIQUE,
    password_hash VARCHAR(255)  NOT NULL,
    role          VARCHAR(50)   NOT NULL DEFAULT 'user',
    created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`,
];

async function main() {
  console.log(`Connecting to MySQL at ${DB_HOST} as '${DB_USER}' ...`);
  let conn;
  try {
    conn = await mysql.createConnection({ host: DB_HOST, user: DB_USER, password: DB_PASSWORD });
  } catch (e) {
    console.error('ERROR: Could not connect to MySQL.\n', e.message);
    process.exit(1);
  }

  console.log(`Creating database '${DB_NAME}' if it does not exist ...`);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.query(`USE \`${DB_NAME}\``);

  const names = ['members', 'savings', 'loans', 'loan_repayments', 'activity_log'];
  for (let i = 0; i < TABLES.length; i++) {
    await conn.execute(TABLES[i]);
    // attempt to print a name if available
    console.log(`  [OK] table ${i + 1}`);
  }

  // create default admin if not exists
  try {
    const bcrypt = require('bcryptjs');
    const adminUser = 'admin';
    const adminPass = 'admin123';
    const [[exists]] = await conn.execute('SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema=? AND table_name=?', [DB_NAME, 'users']);
    // Ensure users table exists before inserting
    const [[ucheck]] = await conn.execute('SELECT COUNT(*) AS cnt FROM users WHERE username=?', [adminUser]).catch(()=>[[]]);
    if (!ucheck || ucheck.cnt === 0) {
      const hash = bcrypt.hashSync(adminPass, 10);
      await conn.execute('INSERT IGNORE INTO users (username,password_hash,role) VALUES (?,?,?)', [adminUser, hash, 'admin']);
      console.log('  [OK] default admin created (username: admin, password: admin123)');
    } else {
      console.log('  [OK] admin user already exists');
    }
  } catch (e) {
    console.warn('Could not create default admin:', e.message);
  }

  await conn.end();
  console.log('\nSetup complete. Run: npm start');
}

main();
