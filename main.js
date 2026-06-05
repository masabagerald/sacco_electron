require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const DB_CONFIG = {
  host:     process.env.DB_HOST     || 'localhost',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'sacco_db',
  waitForConnections: true,
  connectionLimit: 10,
};

let pool;
function getPool() {
  if (!pool) pool = mysql.createPool(DB_CONFIG);
  return pool;
}

const today = () => new Date().toISOString().slice(0, 10);

async function logActivity(action, details = '') {
  await getPool().execute(
    'INSERT INTO activity_log (action, details) VALUES (?, ?)', [action, details]
  );
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
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

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
  const [rows] = await getPool().execute(
    `SELECT DATE_FORMAT(date,'%Y-%m') AS month,
       SUM(CASE WHEN transaction_type='deposit' THEN amount ELSE 0 END) AS deposits,
       SUM(CASE WHEN transaction_type='withdrawal' THEN amount ELSE 0 END) AS withdrawals
     FROM savings
     WHERE date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
     GROUP BY month ORDER BY month`, [months]
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
  const [rows] = await getPool().execute(
    'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?', [limit]
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
