require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

// ── Config file (stored in user's app data directory) ─────────────────────────
const DEFAULT_DB = { host: 'localhost', user: 'root', password: '', database: 'sacco_db' };
let CONFIG_PATH; // set after app ready

function loadConfig() {
  try {
    if (CONFIG_PATH && fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_DB, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch {}
  return { ...DEFAULT_DB };
}

function saveConfigFile(cfg) {
  if (!CONFIG_PATH) return;
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

// ── DB pool ───────────────────────────────────────────────────────────────────
const DB_CONFIG = { ...DEFAULT_DB, waitForConnections: true, connectionLimit: 10 };

let pool;
function getPool() {
  if (!pool) pool = mysql.createPool(DB_CONFIG);
  return pool;
}

function applyConfig(cfg) {
  DB_CONFIG.host     = cfg.host;
  DB_CONFIG.user     = cfg.user;
  DB_CONFIG.password = cfg.password;
  DB_CONFIG.database = cfg.database;
  if (pool) { pool.end().catch(() => {}); pool = null; }
}

const today = () => new Date().toISOString().slice(0, 10);

async function logActivity(action, details = '') {
  await getPool().execute(
    'INSERT INTO activity_log (action, details) VALUES (?, ?)', [action, details]
  );
}

// ── Database bootstrap (runs on every startup, all statements are idempotent) ─
async function setupDatabase() {
  const { host, user, password, database } = DB_CONFIG;
  let conn;
  try {
    conn = await mysql.createConnection({ host, user, password });
  } catch (err) {
    return { success: false, error: `Cannot connect to MySQL at ${host} as '${user}': ${err.message}` };
  }

  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE \`${database}\``);

    const tables = [
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
        id         INT          PRIMARY KEY AUTO_INCREMENT,
        action     VARCHAR(100) NOT NULL,
        details    TEXT,
        created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`,

      `CREATE TABLE IF NOT EXISTS users (
        id            INT          PRIMARY KEY AUTO_INCREMENT,
        username      VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role          VARCHAR(50)  NOT NULL DEFAULT 'user',
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`,
    ];

    for (const sql of tables) await conn.execute(sql);

    // Create default admin account if it doesn't exist yet
    const [[{ cnt }]] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM users WHERE username = ?', ['admin']
    );
    if (cnt === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      await conn.execute(
        'INSERT IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)',
        ['admin', hash, 'admin']
      );
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await conn.end();
  }
}

// ── Window ───────────────────────────────────────────────────────────────────
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1000, minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // Run DB setup after the page loads; on failure notify renderer to show settings
  win.webContents.once('did-finish-load', async () => {
    const result = await setupDatabase();
    if (!result.success) {
      win.webContents.send('db:connect-failed', result.error);
    }
  });
}

app.whenReady().then(() => {
  CONFIG_PATH = path.join(app.getPath('userData'), 'sacco-config.json');
  applyConfig(loadConfig());
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC: Config ───────────────────────────────────────────────────────────────
ipcMain.handle('config:get', () => {
  const { host, user, password, database } = DB_CONFIG;
  return { host, user, password, database };
});

ipcMain.handle('config:test', async (_, cfg) => {
  try {
    const conn = await mysql.createConnection({ host: cfg.host, user: cfg.user, password: cfg.password });
    await conn.ping();
    await conn.end();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config:apply', async (_, cfg) => {
  saveConfigFile(cfg);
  applyConfig(cfg);
  return await setupDatabase();
});

// ── IPC: Members ─────────────────────────────────────────────────────────────
ipcMain.handle('db:getMembers', async (_, search = '') => {
  const p = getPool();
  if (search) {
    const like = `%${search}%`;
    const [rows] = await p.execute(
      'SELECT * FROM members WHERE name LIKE ? OR national_id LIKE ? OR phone LIKE ? ORDER BY name',
      [like, like, like]
    );
    return rows;
  }
  const [rows] = await p.execute('SELECT * FROM members ORDER BY name');
  return rows;
});

ipcMain.handle('db:getMember', async (_, id) => {
  const [[row]] = await getPool().execute('SELECT * FROM members WHERE id=?', [id]);
  return row;
});

ipcMain.handle('db:addMember', async (_, data) => {
  const { name, phone, email, address, national_id, status = 'active' } = data;
  await getPool().execute(
    'INSERT INTO members (name,phone,email,address,national_id,date_joined,status) VALUES (?,?,?,?,?,?,?)',
    [name, phone, email, address, national_id, today(), status]
  );
  await logActivity('ADD_MEMBER', `Added member: ${name}`);
});

ipcMain.handle('db:updateMember', async (_, id, data) => {
  const { name, phone, email, address, national_id, status } = data;
  await getPool().execute(
    'UPDATE members SET name=?,phone=?,email=?,address=?,national_id=?,status=? WHERE id=?',
    [name, phone, email, address, national_id, status, id]
  );
  await logActivity('UPDATE_MEMBER', `Updated member ID ${id}: ${name}`);
});

ipcMain.handle('db:deleteMember', async (_, id) => {
  const [[m]] = await getPool().execute('SELECT name FROM members WHERE id=?', [id]);
  await getPool().execute('DELETE FROM members WHERE id=?', [id]);
  await logActivity('DELETE_MEMBER', `Deleted member: ${m?.name}`);
});

// ── IPC: Savings ─────────────────────────────────────────────────────────────
ipcMain.handle('db:addTransaction', async (_, data) => {
  const { member_id, amount, transaction_type, notes = '' } = data;
  await getPool().execute(
    'INSERT INTO savings (member_id,amount,transaction_type,date,notes) VALUES (?,?,?,?,?)',
    [member_id, amount, transaction_type, today(), notes]
  );
  await logActivity('TRANSACTION', `${transaction_type} UGX ${Number(amount).toLocaleString()} for member ID ${member_id}`);
});

ipcMain.handle('db:getMemberBalance', async (_, id) => {
  const [[row]] = await getPool().execute(
    `SELECT COALESCE(SUM(CASE WHEN transaction_type='deposit' THEN amount ELSE -amount END),0) AS balance
     FROM savings WHERE member_id=?`, [id]
  );
  return Number(row.balance);
});

ipcMain.handle('db:getMemberTransactions', async (_, id) => {
  const [rows] = await getPool().execute(
    'SELECT * FROM savings WHERE member_id=? ORDER BY date DESC', [id]
  );
  return rows;
});

ipcMain.handle('db:getAllTransactions', async () => {
  const [rows] = await getPool().execute(
    `SELECT s.*, m.name AS member_name FROM savings s
     JOIN members m ON s.member_id=m.id ORDER BY s.date DESC, s.id DESC`
  );
  return rows;
});

ipcMain.handle('db:getSavingsSummary', async () => {
  const [rows] = await getPool().execute(
    `SELECT m.id, m.name,
       COALESCE(SUM(CASE WHEN s.transaction_type='deposit' THEN s.amount ELSE -s.amount END),0) AS balance
     FROM members m LEFT JOIN savings s ON m.id=s.member_id
     WHERE m.status='active' GROUP BY m.id, m.name ORDER BY m.name`
  );
  return rows;
});

ipcMain.handle('db:getSavingsTrend', async (_, months = 6) => {
  const n = parseInt(months, 10) || 6;
  const [rows] = await getPool().query(
    `SELECT DATE_FORMAT(date,'%Y-%m') AS month,
       SUM(CASE WHEN transaction_type='deposit' THEN amount ELSE 0 END) AS deposits,
       SUM(CASE WHEN transaction_type='withdrawal' THEN amount ELSE 0 END) AS withdrawals
     FROM savings
     WHERE date >= DATE_SUB(CURDATE(), INTERVAL ${n} MONTH)
     GROUP BY month ORDER BY month`
  );
  return rows;
});

// ── IPC: Loans ────────────────────────────────────────────────────────────────
ipcMain.handle('db:getLoans', async (_, filter = 'all') => {
  const p = getPool();
  if (filter === 'all') {
    const [rows] = await p.execute(
      `SELECT l.*, m.name AS member_name FROM loans l
       JOIN members m ON l.member_id=m.id ORDER BY l.date_applied DESC`
    );
    return rows;
  }
  const [rows] = await p.execute(
    `SELECT l.*, m.name AS member_name FROM loans l
     JOIN members m ON l.member_id=m.id WHERE l.status=? ORDER BY l.date_applied DESC`, [filter]
  );
  return rows;
});

ipcMain.handle('db:getLoan', async (_, id) => {
  const [[row]] = await getPool().execute(
    `SELECT l.*, m.name AS member_name FROM loans l JOIN members m ON l.member_id=m.id WHERE l.id=?`, [id]
  );
  return row;
});

ipcMain.handle('db:applyLoan', async (_, data) => {
  const { member_id, amount_requested, interest_rate, duration_months, purpose } = data;
  await getPool().execute(
    `INSERT INTO loans (member_id,amount_requested,interest_rate,duration_months,purpose,date_applied)
     VALUES (?,?,?,?,?,?)`,
    [member_id, amount_requested, interest_rate, duration_months, purpose, today()]
  );
  await logActivity('LOAN_APPLY', `Loan application UGX ${Number(amount_requested).toLocaleString()} for member ID ${member_id}`);
});

ipcMain.handle('db:approveLoan', async (_, id, amount) => {
  await getPool().execute(
    `UPDATE loans SET status='active', amount_approved=?, date_approved=? WHERE id=?`,
    [amount, today(), id]
  );
  await logActivity('LOAN_APPROVE', `Approved loan ID ${id}, UGX ${Number(amount).toLocaleString()}`);
});

ipcMain.handle('db:rejectLoan', async (_, id) => {
  await getPool().execute(`UPDATE loans SET status='rejected' WHERE id=?`, [id]);
  await logActivity('LOAN_REJECT', `Rejected loan ID ${id}`);
});

ipcMain.handle('db:addRepayment', async (_, data) => {
  const { loan_id, amount_paid, notes = '' } = data;
  const p = getPool();
  const conn = await p.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      'INSERT INTO loan_repayments (loan_id,amount_paid,date_paid,notes) VALUES (?,?,?,?)',
      [loan_id, amount_paid, today(), notes]
    );
    const [[loan]] = await conn.execute('SELECT * FROM loans WHERE id=?', [loan_id]);
    const [[{ total }]] = await conn.execute(
      'SELECT COALESCE(SUM(amount_paid),0) AS total FROM loan_repayments WHERE loan_id=?', [loan_id]
    );
    const totalDue = Number(loan.amount_approved || 0) * (1 + Number(loan.interest_rate) / 100);
    if (Number(total) >= totalDue) {
      await conn.execute(`UPDATE loans SET status='paid' WHERE id=?`, [loan_id]);
    }
    await conn.commit();
    await logActivity('REPAYMENT', `Repayment UGX ${Number(amount_paid).toLocaleString()} for loan ID ${loan_id}`);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
});

ipcMain.handle('db:getLoanRepayments', async (_, id) => {
  const [rows] = await getPool().execute(
    'SELECT * FROM loan_repayments WHERE loan_id=? ORDER BY date_paid DESC', [id]
  );
  return rows;
});

ipcMain.handle('db:getLoanBalance', async (_, id) => {
  const [[loan]] = await getPool().execute('SELECT * FROM loans WHERE id=?', [id]);
  if (!loan || !loan.amount_approved) return 0;
  const totalDue = Number(loan.amount_approved) * (1 + Number(loan.interest_rate) / 100);
  const [[{ paid }]] = await getPool().execute(
    'SELECT COALESCE(SUM(amount_paid),0) AS paid FROM loan_repayments WHERE loan_id=?', [id]
  );
  return Math.max(0, totalDue - Number(paid));
});

ipcMain.handle('db:getOverdueLoans', async () => {
  const [rows] = await getPool().execute(
    `SELECT l.*, m.name AS member_name,
       DATEDIFF(CURDATE(), DATE_ADD(l.date_approved, INTERVAL l.duration_months MONTH)) AS days_overdue
     FROM loans l JOIN members m ON l.member_id=m.id
     WHERE l.status='active'
       AND DATE_ADD(l.date_approved, INTERVAL l.duration_months MONTH) < CURDATE()
     ORDER BY days_overdue DESC`
  );
  return rows;
});

ipcMain.handle('db:getLoanStatusCounts', async () => {
  const [rows] = await getPool().execute(
    'SELECT status, COUNT(*) AS count FROM loans GROUP BY status'
  );
  return rows;
});

ipcMain.handle('db:getPendingCount', async () => {
  const [[row]] = await getPool().execute(
    "SELECT COUNT(*) AS cnt FROM loans WHERE status='pending'"
  );
  return Number(row.cnt);
});

// ── IPC: Users & Auth ─────────────────────────────────────────────────────
ipcMain.handle('db:authLogin', async (_, username, password) => {
  console.log('Auth attempt for', username);
  const [[user]] = await getPool().execute('SELECT id,username,password_hash,role FROM users WHERE username=?', [username]);
  if (!user) {
    console.log('Auth failed: user not found', username);
    throw new Error('Invalid username or password');
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    console.log('Auth failed: bad password for', username);
    throw new Error('Invalid username or password');
  }
  console.log('Auth success for', username);
  // don't return password_hash
  return { id: user.id, username: user.username, role: user.role };
});

ipcMain.handle('db:getUsers', async () => {
  const [rows] = await getPool().execute('SELECT id,username,role,created_at FROM users ORDER BY username');
  return rows;
});

ipcMain.handle('db:getUser', async (_, id) => {
  const [[row]] = await getPool().execute('SELECT id,username,role,created_at FROM users WHERE id=?', [id]);
  return row;
});

ipcMain.handle('db:addUser', async (_, data) => {
  const { username, password, role = 'user' } = data;
  const hash = bcrypt.hashSync(password, 10);
  await getPool().execute('INSERT INTO users (username,password_hash,role) VALUES (?,?,?)', [username, hash, role]);
  await logActivity('ADD_USER', `Added user: ${username}`);
});

ipcMain.handle('db:updateUser', async (_, id, data) => {
  const { username, password, role } = data;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    await getPool().execute('UPDATE users SET username=?, password_hash=?, role=? WHERE id=?', [username, hash, role, id]);
  } else {
    await getPool().execute('UPDATE users SET username=?, role=? WHERE id=?', [username, role, id]);
  }
  await logActivity('UPDATE_USER', `Updated user ID ${id}: ${username}`);
});

ipcMain.handle('db:deleteUser', async (_, id) => {
  const [[u]] = await getPool().execute('SELECT username FROM users WHERE id=?', [id]);
  await getPool().execute('DELETE FROM users WHERE id=?', [id]);
  await logActivity('DELETE_USER', `Deleted user: ${u?.username}`);
});

// ── IPC: Dashboard ────────────────────────────────────────────────────────────
ipcMain.handle('db:getDashboardStats', async () => {
  const p = getPool();
  const [[members]]   = await p.execute("SELECT COUNT(*) AS n FROM members WHERE status='active'");
  const [[savings]]   = await p.execute(
    "SELECT COALESCE(SUM(CASE WHEN transaction_type='deposit' THEN amount ELSE -amount END),0) AS n FROM savings"
  );
  const [[active]]    = await p.execute("SELECT COUNT(*) AS n FROM loans WHERE status='active'");
  const [[pending]]   = await p.execute("SELECT COUNT(*) AS n FROM loans WHERE status='pending'");
  const [[loanBook]]  = await p.execute("SELECT COALESCE(SUM(amount_approved),0) AS n FROM loans WHERE status='active'");
  return {
    totalMembers:  Number(members.n),
    totalSavings:  Number(savings.n),
    activeLoans:   Number(active.n),
    pendingLoans:  Number(pending.n),
    totalLoanBook: Number(loanBook.n),
  };
});

// ── IPC: Activity ─────────────────────────────────────────────────────────────
ipcMain.handle('db:getActivityLog', async (_, limit = 100) => {
  const n = parseInt(limit, 10) || 100;
  const [rows] = await getPool().query(
    `SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ${n}`
  );
  return rows;
});

// ── IPC: System ───────────────────────────────────────────────────────────────
ipcMain.handle('dialog:saveCSV', async (_, csvContent, defaultName = 'export.csv') => {
  const { filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (filePath) {
    fs.writeFileSync(filePath, csvContent, 'utf8');
    return { success: true, path: filePath };
  }
  return { success: false };
});

ipcMain.handle('app:printToPDF', async () => {
  const { filePath } = await dialog.showSaveDialog(win, {
    defaultPath: 'sacco-report.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (filePath) {
    const data = await win.webContents.printToPDF({ printBackground: true });
    fs.writeFileSync(filePath, data);
    return { success: true, path: filePath };
  }
  return { success: false };
});
