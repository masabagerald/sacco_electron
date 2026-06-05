/* ============================================================
   SACCO Pro – Renderer
   ============================================================ */

// ── Utilities ────────────────────────────────────────────────
const fmt = {
  currency: n => `UGX ${Number(n || 0).toLocaleString('en-UG', { minimumFractionDigits: 0 })}`,
  date:     d => d ? String(d).slice(0, 10) : '—',
  num:      n => Number(n || 0).toLocaleString(),
};

function toast(msg, type = 'info') {
  const icons = { success: 'fa-check-circle', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<i class="fa-solid ${icons[type]}"></i>${msg}`;
  document.getElementById('toast-container').append(t);
  setTimeout(() => t.remove(), 3500);
}

function openModal(title, bodyHTML, wide = false) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-box').style.width = wide ? '700px' : '500px';
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function statusChip(status) {
  const map = { active:'chip-active', inactive:'chip-inactive', pending:'chip-pending',
                approved:'chip-approved', rejected:'chip-rejected', paid:'chip-paid' };
  return `<span class="status-chip ${map[status] || ''}">${status}</span>`;
}

function tableHTML(cols, rows, emptyMsg = 'No records found.') {
  if (!rows.length) return `<div class="empty-state"><i class="fa-solid fa-inbox"></i><p>${emptyMsg}</p></div>`;
  const head = cols.map(c => `<th>${c.label}</th>`).join('');
  const body = rows.map(r =>
    `<tr>${cols.map(c => `<td>${c.render ? c.render(r) : (r[c.key] ?? '—')}</td>`).join('')}</tr>`
  ).join('');
  return `<div class="overflow-x-auto"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function countUp(el, target, duration = 800) {
  const start = 0, step = (target - start) / (duration / 16);
  let current = start;
  const tick = () => {
    current = Math.min(current + step, target);
    el.textContent = Math.round(current).toLocaleString();
    if (current < target) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function csvFromTable(tableEl) {
  const rows = [];
  tableEl.querySelectorAll('tr').forEach(tr => {
    rows.push([...tr.querySelectorAll('th,td')].map(c => `"${c.textContent.trim()}"`).join(','));
  });
  return rows.join('\n');
}

// ── Router ───────────────────────────────────────────────────
let activePage = 'dashboard';

async function navigate(page) {
  activePage = page;
  document.getElementById('page-title').textContent =
    page.charAt(0).toUpperCase() + page.slice(1);
  document.querySelectorAll('.nav-link').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  const content = document.getElementById('content');
  content.innerHTML = '<div class="flex items-center justify-center h-32 text-gray-400"><i class="fa-solid fa-spinner fa-spin text-3xl"></i></div>';
  try {
    content.innerHTML = await pages[page].render();
    await pages[page].mount();
  } catch (err) {
    console.error(`Navigation error [${page}]:`, err);
    content.innerHTML = `<div class="section-card text-center py-12">
      <i class="fa-solid fa-triangle-exclamation text-4xl text-red-400 mb-3"></i>
      <p class="text-red-600 font-semibold">Failed to load ${page}</p>
      <p class="text-gray-400 text-sm mt-1">${err.message || err}</p>
    </div>`;
    toast(`Error loading ${page}: ${err.message || err}`, 'error');
  }
}

// ── Dashboard Page ───────────────────────────────────────────
const Dashboard = {
  charts: {},
  async render() {
    return `
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6" id="stat-cards">
      ${this._card('members','fa-users','#dbeafe','#2563eb','Active Members')}
      ${this._card('savings','fa-piggy-bank','#dcfce7','#16a34a','Total Savings')}
      ${this._card('activeLoans','fa-file-invoice-dollar','#fef9c3','#ca8a04','Active Loans')}
      ${this._card('pendingLoans','fa-hourglass-half','#fee2e2','#dc2626','Pending Approvals')}
      ${this._card('loanBook','fa-building-columns','#f3e8ff','#7c3aed','Loan Book')}
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="chart-card">
        <h3 class="font-bold mb-4 text-gray-700 dark:text-gray-200">Savings Trend (6 months)</h3>
        <canvas id="chart-savings" height="200"></canvas>
      </div>
      <div class="chart-card">
        <h3 class="font-bold mb-4 text-gray-700 dark:text-gray-200">Loan Portfolio</h3>
        <canvas id="chart-loans" height="200"></canvas>
      </div>
    </div>
    <div class="section-card">
      <div class="page-header"><h2>Recent Transactions</h2></div>
      <div id="recent-txns"></div>
    </div>
    `;
  },
  _card(key, icon, bg, color, label) {
    return `<div class="stat-card">
      <div class="stat-icon" style="background:${bg}">
        <i class="fa-solid ${icon}" style="color:${color}"></i>
      </div>
      <div class="stat-value" id="stat-${key}">—</div>
      <div class="stat-label">${label}</div>
    </div>`;
  },
  async mount() {
    const [stats, trend, statusCounts, txns] = await Promise.all([
      api.getDashboardStats(), api.getSavingsTrend(6),
      api.getLoanStatusCounts(), api.getAllTransactions(),
    ]);

    const animate = (key, val, prefix = '') => {
      const el = document.getElementById(`stat-${key}`);
      if (!el) return;
      if (prefix) { el.textContent = prefix + val.toLocaleString(); return; }
      countUp(el, val);
    };
    animate('members', stats.totalMembers);
    animate('savings', 0);
    document.getElementById('stat-savings').textContent = fmt.currency(stats.totalSavings);
    animate('activeLoans', stats.activeLoans);
    animate('pendingLoans', stats.pendingLoans);
    document.getElementById('stat-loanBook').textContent = fmt.currency(stats.totalLoanBook);

    this._savingsChart(trend);
    this._loansChart(statusCounts);

    const recent = txns.slice(0, 15);
    document.getElementById('recent-txns').innerHTML = tableHTML([
      { label: 'Date',   key: 'date',             render: r => fmt.date(r.date) },
      { label: 'Member', key: 'member_name' },
      { label: 'Type',   key: 'transaction_type',  render: r => statusChip(r.transaction_type) },
      { label: 'Amount', key: 'amount',             render: r => fmt.currency(r.amount) },
      { label: 'Notes',  key: 'notes',              render: r => r.notes || '' },
    ], recent);
  },
  _savingsChart(trend) {
    const ctx = document.getElementById('chart-savings');
    if (!ctx) return;
    if (this.charts.savings) this.charts.savings.destroy();
    this.charts.savings = new Chart(ctx, {
      type: 'line',
      data: {
        labels: trend.map(r => r.month),
        datasets: [
          { label: 'Deposits', data: trend.map(r => Number(r.deposits)),
            borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.1)', tension: 0.4, fill: true },
          { label: 'Withdrawals', data: trend.map(r => Number(r.withdrawals)),
            borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.1)', tension: 0.4, fill: true },
        ],
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } },
                 scales: { y: { beginAtZero: true } } },
    });
  },
  _loansChart(counts) {
    const ctx = document.getElementById('chart-loans');
    if (!ctx) return;
    if (this.charts.loans) this.charts.loans.destroy();
    const colors = { pending:'#ca8a04', active:'#2563eb', paid:'#16a34a', rejected:'#dc2626' };
    this.charts.loans = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: counts.map(r => r.status),
        datasets: [{ data: counts.map(r => r.count),
          backgroundColor: counts.map(r => colors[r.status] || '#9ca3af') }],
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
    });
  },
};

// ── Members Page ─────────────────────────────────────────────
const Members = {
  async render() {
    return `
    <div class="section-card">
      <div class="page-header">
        <h2>Members</h2>
        <div class="flex gap-2">
          <input id="member-search" class="form-input" style="width:220px"
                 placeholder="Search name, ID, phone…">
          <button class="btn btn-primary" id="btn-add-member">
            <i class="fa-solid fa-plus"></i> Add Member
          </button>
        </div>
      </div>
      <div id="members-table"></div>
    </div>`;
  },
  async mount() {
    await this.load();
    document.getElementById('btn-add-member').onclick = () => this.openDialog();
    let timer;
    document.getElementById('member-search').oninput = e => {
      clearTimeout(timer);
      timer = setTimeout(() => this.load(e.target.value), 300);
    };
  },
  async load(search = '') {
    const members = await api.getMembers(search);
    document.getElementById('members-table').innerHTML = tableHTML([
      { label: 'ID',    key: 'id' },
      { label: 'Name',  key: 'name' },
      { label: 'Phone', key: 'phone', render: r => r.phone || '—' },
      { label: 'Email', key: 'email', render: r => r.email || '—' },
      { label: 'National ID', key: 'national_id', render: r => r.national_id || '—' },
      { label: 'Joined', key: 'date_joined', render: r => fmt.date(r.date_joined) },
      { label: 'Status', key: 'status', render: r => statusChip(r.status) },
      { label: 'Actions', key: '_', render: r =>
        `<button class="btn btn-sm btn-ghost" onclick="Members.openDialog(${r.id})">
          <i class="fa-solid fa-pen"></i></button>
         <button class="btn btn-sm btn-danger" onclick="Members.delete(${r.id},'${r.name.replace(/'/g,"\\'")}')">
          <i class="fa-solid fa-trash"></i></button>` },
    ], members, 'No members found.');
  },
  async openDialog(id = null) {
    const m = id ? await api.getMember(id) : null;
    const v = f => m ? (m[f] || '') : '';
    openModal(id ? 'Edit Member' : 'Add Member', `
      <form id="member-form">
        <div class="grid grid-cols-2 gap-3">
          <div class="form-group col-span-2">
            <label class="form-label">Full Name *</label>
            <input class="form-input" name="name" value="${v('name')}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input class="form-input" name="phone" value="${v('phone')}">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input class="form-input" type="email" name="email" value="${v('email')}">
          </div>
          <div class="form-group col-span-2">
            <label class="form-label">Address</label>
            <input class="form-input" name="address" value="${v('address')}">
          </div>
          <div class="form-group">
            <label class="form-label">National ID</label>
            <input class="form-input" name="national_id" value="${v('national_id')}">
          </div>
          ${id ? `<div class="form-group">
            <label class="form-label">Status</label>
            <select class="form-select" name="status">
              <option ${m?.status==='active'?'selected':''}>active</option>
              <option ${m?.status==='inactive'?'selected':''}>inactive</option>
            </select>
          </div>` : ''}
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`);
    document.getElementById('member-form').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd);
      try {
        if (id) await api.updateMember(id, data);
        else     await api.addMember(data);
        closeModal();
        toast(id ? 'Member updated.' : 'Member added.', 'success');
        await this.load(document.getElementById('member-search')?.value || '');
      } catch (err) { toast(err.message, 'error'); }
    };
  },
  async delete(id, name) {
    if (!confirm(`Delete member "${name}"? This cannot be undone.`)) return;
    try {
      await api.deleteMember(id);
      toast('Member deleted.', 'success');
      await this.load();
    } catch (err) { toast(err.message, 'error'); }
  },
};

// ── Users Page (Admin) ─────────────────────────────────────────
const Users = {
  async render() {
    return `
    <div class="section-card">
      <div class="page-header">
        <h2>Users</h2>
        <div class="flex gap-2">
          <button class="btn btn-primary" id="btn-add-user"><i class="fa-solid fa-plus"></i> Add User</button>
        </div>
      </div>
      <div id="users-table"></div>
    </div>`;
  },
  async mount() {
    await this.load();
    document.getElementById('btn-add-user').onclick = () => this.openDialog();
  },
  async load() {
    const users = await api.getUsers();
    document.getElementById('users-table').innerHTML = tableHTML([
      { label: 'ID', key: 'id' },
      { label: 'Username', key: 'username' },
      { label: 'Role', key: 'role' },
      { label: 'Created', key: 'created_at', render: r => new Date(r.created_at).toLocaleString() },
      { label: 'Actions', key: '_', render: r =>
        `<button class="btn btn-sm btn-ghost" onclick="Users.openDialog(${r.id})"><i class="fa-solid fa-pen"></i></button>
         <button class="btn btn-sm btn-danger" onclick="Users.delete(${r.id},'${r.username.replace(/'/g,"\\'")}')"><i class="fa-solid fa-trash"></i></button>` },
    ], users, 'No users found.');
  },
  async openDialog(id = null) {
    const u = id ? await api.getUser(id) : null;
    const v = f => u ? (u[f] || '') : '';
    openModal(id ? 'Edit User' : 'Add User', `
      <form id="user-form">
        <div class="form-group">
          <label class="form-label">Username *</label>
          <input class="form-input" name="username" value="${v('username')}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Password ${id? '(leave blank to keep)' : '*'}</label>
          <input class="form-input" type="password" name="password">
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select class="form-select" name="role">
            <option ${v('role')==='admin'?'selected':''}>admin</option>
            <option ${v('role')==='user'?'selected':''}>user</option>
          </select>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>`);
    document.getElementById('user-form').onsubmit = async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      try {
        if (id) await api.updateUser(id, data);
        else     await api.addUser(data);
        closeModal(); toast(id ? 'User updated.' : 'User added.', 'success');
        await this.load();
      } catch (err) { toast(err.message, 'error'); }
    };
  },
  async delete(id, username) {
    if (!confirm(`Delete user "${username}"?`)) return;
    await api.deleteUser(id);
    toast('User deleted.', 'success');
    await this.load();
  },
};

// ── Savings Page ─────────────────────────────────────────────
const Savings = {
  async render() {
    return `
    <div class="section-card mb-4">
      <div class="page-header">
        <h2>Savings Overview</h2>
        <div class="flex gap-2">
          <select id="sav-member-filter" class="form-select" style="width:220px">
            <option value="">All members</option>
          </select>
          <button class="btn btn-success" id="btn-deposit">
            <i class="fa-solid fa-plus"></i> Deposit
          </button>
          <button class="btn btn-danger" id="btn-withdraw">
            <i class="fa-solid fa-minus"></i> Withdraw
          </button>
        </div>
      </div>
      <div id="savings-table"></div>
    </div>`;
  },
  async mount() {
    const members = await api.getMembers();
    const sel = document.getElementById('sav-member-filter');
    members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name;
      sel.appendChild(opt);
    });
    await this.load();
    document.getElementById('btn-deposit').onclick  = () => this.txnDialog('deposit');
    document.getElementById('btn-withdraw').onclick = () => this.txnDialog('withdrawal');
    sel.onchange = async e => {
      await this.load(e.target.value || null);
    };
  },
  async load(memberId = null) {
    const rows = memberId
      ? await api.getMemberTransactions(memberId)
      : await api.getAllTransactions();
    document.getElementById('savings-table').innerHTML = tableHTML([
      { label: 'Date',   key: 'date',             render: r => fmt.date(r.date) },
      { label: 'Member', key: 'member_name',       render: r => r.member_name || '—' },
      { label: 'Type',   key: 'transaction_type',  render: r => statusChip(r.transaction_type) },
      { label: 'Amount', key: 'amount',             render: r => fmt.currency(r.amount) },
      { label: 'Notes',  key: 'notes',              render: r => r.notes || '' },
    ], rows, 'No transactions yet.');
  },
  async txnDialog(type) {
    const members = await api.getMembers();
    const opts = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    openModal(type === 'deposit' ? 'Record Deposit' : 'Record Withdrawal', `
      <form id="txn-form">
        <div class="form-group">
          <label class="form-label">Member *</label>
          <select class="form-select" name="member_id" id="txn-member" required>${opts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Current Balance</label>
          <div id="txn-balance" class="text-lg font-bold text-blue-600">—</div>
        </div>
        <div class="form-group">
          <label class="form-label">Amount (UGX) *</label>
          <input class="form-input" name="amount" type="number" min="1" step="1" required>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" name="notes">
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn ${type==='deposit'?'btn-success':'btn-danger'}">
            ${type==='deposit'?'Deposit':'Withdraw'}
          </button>
        </div>
      </form>`);
    const balEl = document.getElementById('txn-balance');
    const loadBal = async id => {
      const b = await api.getMemberBalance(id);
      balEl.textContent = fmt.currency(b);
    };
    const sel = document.getElementById('txn-member');
    await loadBal(sel.value);
    sel.onchange = () => loadBal(sel.value);
    document.getElementById('txn-form').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = { ...Object.fromEntries(fd), transaction_type: type };
      try {
        await api.addTransaction(data);
        closeModal();
        toast(`${type.charAt(0).toUpperCase()+type.slice(1)} recorded.`, 'success');
        await this.load();
      } catch (err) { toast(err.message, 'error'); }
    };
  },
};

// ── Loans Page ───────────────────────────────────────────────
const Loans = {
  currentFilter: 'all',
  async render() {
    return `
    <div class="section-card">
      <div class="page-header">
        <h2>Loans</h2>
        <div class="flex gap-2">
          <select id="loan-filter" class="form-select" style="width:160px">
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="active">Active</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
          <button class="btn btn-primary" id="btn-apply-loan">
            <i class="fa-solid fa-plus"></i> Apply for Loan
          </button>
        </div>
      </div>
      <div id="loans-table"></div>
    </div>
    <div class="section-card" id="overdue-section"></div>`;
  },
  async mount() {
    await this.load('all');
    document.getElementById('loan-filter').onchange = e => this.load(e.target.value);
    document.getElementById('btn-apply-loan').onclick = () => this.applyDialog();
    await this.loadOverdue();
  },
  async load(filter) {
    this.currentFilter = filter;
    const loans = await api.getLoans(filter);
    document.getElementById('loans-table').innerHTML = tableHTML([
      { label: 'ID',       key: 'id' },
      { label: 'Member',   key: 'member_name' },
      { label: 'Requested',key: 'amount_requested', render: r => fmt.currency(r.amount_requested) },
      { label: 'Approved', key: 'amount_approved',  render: r => r.amount_approved ? fmt.currency(r.amount_approved) : '—' },
      { label: 'Rate',     key: 'interest_rate',    render: r => `${r.interest_rate}%` },
      { label: 'Months',   key: 'duration_months' },
      { label: 'Status',   key: 'status',            render: r => statusChip(r.status) },
      { label: 'Applied',  key: 'date_applied',      render: r => fmt.date(r.date_applied) },
      { label: 'Actions',  key: '_',                 render: r => this._actions(r) },
    ], loans, 'No loans found.');
  },
  _actions(r) {
    const btns = [`<button class="btn btn-sm btn-ghost" onclick="Loans.viewLoan(${r.id})">
                    <i class="fa-solid fa-eye"></i></button>`];
    if (r.status === 'pending') {
      btns.push(`<button class="btn btn-sm btn-success" onclick="Loans.approveDialog(${r.id},${r.amount_requested})">
                   <i class="fa-solid fa-check"></i></button>`);
      btns.push(`<button class="btn btn-sm btn-danger" onclick="Loans.reject(${r.id})">
                   <i class="fa-solid fa-xmark"></i></button>`);
    }
    if (r.status === 'active') {
      btns.push(`<button class="btn btn-sm btn-warning" onclick="Loans.repayDialog(${r.id})">
                   <i class="fa-solid fa-money-bill-wave"></i> Repay</button>`);
    }
    return btns.join(' ');
  },
  async loadOverdue() {
    const overdue = await api.getOverdueLoans();
    const sec = document.getElementById('overdue-section');
    if (!overdue.length) { sec.innerHTML = ''; return; }
    sec.innerHTML = `
      <div class="page-header">
        <h2 class="text-red-600"><i class="fa-solid fa-triangle-exclamation"></i> Overdue Loans (${overdue.length})</h2>
      </div>
      ${tableHTML([
        { label: 'Member',      key: 'member_name' },
        { label: 'Approved',    key: 'amount_approved', render: r => fmt.currency(r.amount_approved) },
        { label: 'Days Overdue',key: 'days_overdue',    render: r => `<span class="text-red-600 font-bold">${r.days_overdue}</span>` },
        { label: 'Actions',     key: '_',               render: r =>
            `<button class="btn btn-sm btn-warning" onclick="Loans.repayDialog(${r.id})">Repay</button>` },
      ], overdue)}`;
  },
  async applyDialog() {
    const members = await api.getMembers();
    const opts = members.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    openModal('Apply for Loan', `
      <form id="loan-form">
        <div class="form-group">
          <label class="form-label">Member *</label>
          <select class="form-select" name="member_id" required>${opts}</select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="form-group">
            <label class="form-label">Amount (UGX) *</label>
            <input class="form-input" name="amount_requested" type="number" min="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">Interest Rate (%) *</label>
            <input class="form-input" name="interest_rate" type="number" value="12" step="0.1" required>
          </div>
          <div class="form-group">
            <label class="form-label">Duration (months) *</label>
            <input class="form-input" name="duration_months" type="number" value="12" min="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">Purpose</label>
            <input class="form-input" name="purpose">
          </div>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Submit Application</button>
        </div>
      </form>`);
    document.getElementById('loan-form').onsubmit = async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      try {
        await api.applyLoan(data);
        closeModal();
        toast('Loan application submitted.', 'success');
        await this.load(this.currentFilter);
        await updatePendingBadge();
      } catch (err) { toast(err.message, 'error'); }
    };
  },
  async approveDialog(id, requested) {
    openModal('Approve Loan', `
      <form id="approve-form">
        <div class="form-group">
          <label class="form-label">Amount to Approve (UGX) *</label>
          <input class="form-input" name="amount" type="number" value="${requested}" min="1" required>
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-success">Approve</button>
        </div>
      </form>`);
    document.getElementById('approve-form').onsubmit = async e => {
      e.preventDefault();
      const amount = new FormData(e.target).get('amount');
      try {
        await api.approveLoan(id, amount);
        closeModal();
        toast('Loan approved.', 'success');
        await this.load(this.currentFilter);
        await updatePendingBadge();
      } catch (err) { toast(err.message, 'error'); }
    };
  },
  async reject(id) {
    if (!confirm('Reject this loan application?')) return;
    await api.rejectLoan(id);
    toast('Loan rejected.', 'info');
    await this.load(this.currentFilter);
    await updatePendingBadge();
  },
  async repayDialog(loanId) {
    const [loan, balance] = await Promise.all([api.getLoan(loanId), api.getLoanBalance(loanId)]);
    openModal('Record Repayment', `
      <p class="mb-3 text-sm text-gray-500">Loan for <strong>${loan.member_name}</strong></p>
      <p class="mb-4 text-sm">Outstanding Balance: <strong class="text-red-600">${fmt.currency(balance)}</strong></p>
      <form id="repay-form">
        <div class="form-group">
          <label class="form-label">Amount Paid (UGX) *</label>
          <input class="form-input" name="amount_paid" type="number" max="${balance}" min="1" required>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input class="form-input" name="notes">
        </div>
        <div class="flex justify-end gap-2 mt-4">
          <button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-warning">Record Payment</button>
        </div>
      </form>`);
    document.getElementById('repay-form').onsubmit = async e => {
      e.preventDefault();
      const data = { ...Object.fromEntries(new FormData(e.target)), loan_id: loanId };
      try {
        await api.addRepayment(data);
        closeModal();
        toast('Repayment recorded.', 'success');
        await this.load(this.currentFilter);
        await this.loadOverdue();
      } catch (err) { toast(err.message, 'error'); }
    };
  },
  async viewLoan(id) {
    const [loan, repayments, balance] = await Promise.all([
      api.getLoan(id), api.getLoanRepayments(id), api.getLoanBalance(id),
    ]);
    const totalDue = (Number(loan.amount_approved || 0)) * (1 + Number(loan.interest_rate) / 100);
    const rTable = repayments.length
      ? `<table class="data-table amort-table mt-3">
           <thead><tr><th>Date</th><th>Amount</th><th>Notes</th></tr></thead>
           <tbody>${repayments.map(r =>
             `<tr><td>${fmt.date(r.date_paid)}</td><td>${fmt.currency(r.amount_paid)}</td><td>${r.notes||''}</td></tr>`
           ).join('')}</tbody>
         </table>`
      : '<p class="text-gray-400 mt-3 text-sm">No repayments yet.</p>';
    openModal('Loan Details', `
      <div class="grid grid-cols-2 gap-3 text-sm mb-4">
        <div><span class="text-gray-500">Member:</span> <strong>${loan.member_name}</strong></div>
        <div><span class="text-gray-500">Status:</span> ${statusChip(loan.status)}</div>
        <div><span class="text-gray-500">Approved:</span> <strong>${fmt.currency(loan.amount_approved)}</strong></div>
        <div><span class="text-gray-500">Total Due:</span> <strong>${fmt.currency(totalDue)}</strong></div>
        <div><span class="text-gray-500">Outstanding:</span> <strong class="text-red-600">${fmt.currency(balance)}</strong></div>
        <div><span class="text-gray-500">Rate:</span> ${loan.interest_rate}% / ${loan.duration_months} months</div>
        <div><span class="text-gray-500">Applied:</span> ${fmt.date(loan.date_applied)}</div>
        <div><span class="text-gray-500">Approved:</span> ${fmt.date(loan.date_approved)}</div>
        <div class="col-span-2"><span class="text-gray-500">Purpose:</span> ${loan.purpose||'—'}</div>
      </div>
      <h3 class="font-bold">Repayment History</h3>${rTable}`, true);
  },
};

// ── Loan Calculator (Innovative) ─────────────────────────────
const Calculator = {
  chart: null,
  async render() {
    return `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="section-card lg:col-span-1">
        <h2 class="text-lg font-bold mb-4">Loan Calculator</h2>
        <div class="form-group">
          <label class="form-label">Principal (UGX)</label>
          <input class="form-input" id="calc-principal" type="number" value="5000000" min="1">
        </div>
        <div class="form-group">
          <label class="form-label">Annual Interest Rate (%)</label>
          <input class="form-input" id="calc-rate" type="number" value="12" step="0.1" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Duration (months)</label>
          <input class="form-input" id="calc-months" type="number" value="12" min="1">
        </div>
        <button class="btn btn-primary w-full mt-2" id="btn-calc">
          <i class="fa-solid fa-calculator"></i> Calculate
        </button>
        <div id="calc-summary" class="mt-4 hidden">
          <div class="grid grid-cols-1 gap-3">
            <div class="stat-card text-center">
              <div class="text-xs text-gray-500 mb-1">Monthly Payment</div>
              <div class="text-2xl font-bold text-blue-600" id="calc-monthly">—</div>
            </div>
            <div class="stat-card text-center">
              <div class="text-xs text-gray-500 mb-1">Total Repayable</div>
              <div class="text-xl font-bold text-gray-700 dark:text-gray-200" id="calc-total">—</div>
            </div>
            <div class="stat-card text-center">
              <div class="text-xs text-gray-500 mb-1">Total Interest</div>
              <div class="text-xl font-bold text-red-600" id="calc-interest">—</div>
            </div>
          </div>
        </div>
      </div>
      <div class="lg:col-span-2">
        <div class="chart-card mb-4 hidden" id="calc-chart-card">
          <canvas id="calc-chart" height="160"></canvas>
        </div>
        <div class="section-card hidden" id="calc-schedule-card">
          <div class="page-header">
            <h2>Amortization Schedule</h2>
            <button class="btn btn-ghost btn-sm" id="btn-export-calc">
              <i class="fa-solid fa-download"></i> Export CSV
            </button>
          </div>
          <div id="calc-schedule" class="overflow-x-auto max-h-96 overflow-y-auto"></div>
        </div>
      </div>
    </div>`;
  },
  async mount() {
    document.getElementById('btn-calc').onclick = () => this.calculate();
    this.calculate();
  },
  calculate() {
    const P = Number(document.getElementById('calc-principal').value);
    const r = Number(document.getElementById('calc-rate').value);
    const n = Number(document.getElementById('calc-months').value);
    if (!P || !n) return;

    const monthly = r === 0 ? P / n : P * (r/100/12) / (1 - Math.pow(1 + r/100/12, -n));
    const totalPay = monthly * n;
    const totalInt = totalPay - P;

    document.getElementById('calc-monthly').textContent  = fmt.currency(monthly);
    document.getElementById('calc-total').textContent    = fmt.currency(totalPay);
    document.getElementById('calc-interest').textContent = fmt.currency(totalInt);
    document.getElementById('calc-summary').classList.remove('hidden');
    document.getElementById('calc-chart-card').classList.remove('hidden');
    document.getElementById('calc-schedule-card').classList.remove('hidden');

    // build schedule
    const schedule = [];
    let balance = P;
    for (let i = 1; i <= n; i++) {
      const intPart  = balance * (r/100/12);
      const prinPart = monthly - intPart;
      balance = Math.max(0, balance - prinPart);
      schedule.push({ month: i, payment: monthly, principal: prinPart, interest: intPart, balance });
    }

    // chart
    const ctx = document.getElementById('calc-chart');
    if (this.chart) this.chart.destroy();
    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: schedule.map(s => `M${s.month}`),
        datasets: [
          { label: 'Principal', data: schedule.map(s => s.principal.toFixed(0)),
            backgroundColor: '#2563eb' },
          { label: 'Interest',  data: schedule.map(s => s.interest.toFixed(0)),
            backgroundColor: '#fca5a5' },
        ],
      },
      options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
                 plugins: { legend: { position: 'bottom' } } },
    });

    // table
    document.getElementById('calc-schedule').innerHTML = `
      <table class="data-table amort-table" id="amort-table">
        <thead><tr>
          <th>Month</th><th>Payment</th><th>Principal</th><th>Interest</th><th>Balance</th>
        </tr></thead>
        <tbody>${schedule.map(s => `<tr>
          <td>${s.month}</td>
          <td>${fmt.currency(s.payment)}</td>
          <td>${fmt.currency(s.principal)}</td>
          <td>${fmt.currency(s.interest)}</td>
          <td>${fmt.currency(s.balance)}</td>
        </tr>`).join('')}</tbody>
      </table>`;

    document.getElementById('btn-export-calc').onclick = async () => {
      const csv = csvFromTable(document.getElementById('amort-table'));
      const res = await api.saveCSV(csv, 'amortization-schedule.csv');
      if (res.success) toast('Exported successfully.', 'success');
    };
  },
};

// ── Reports Page ─────────────────────────────────────────────
const Reports = {
  async render() {
    return `
    <div class="grid grid-cols-1 gap-6">
      <!-- Member Statement -->
      <div class="section-card">
        <div class="page-header">
          <h2>Member Statement</h2>
          <div class="flex gap-2">
            <select id="stmt-member" class="form-select" style="width:240px">
              <option value="">Select member…</option>
            </select>
            <button class="btn btn-primary" id="btn-gen-stmt">Generate</button>
            <button class="btn btn-ghost" id="btn-print">
              <i class="fa-solid fa-print"></i> PDF
            </button>
            <button class="btn btn-ghost" id="btn-export-stmt">
              <i class="fa-solid fa-download"></i> CSV
            </button>
          </div>
        </div>
        <div id="stmt-info" class="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm hidden"></div>
        <div id="stmt-table"></div>
      </div>
      <!-- Savings Summary -->
      <div class="section-card">
        <div class="page-header">
          <h2>Savings Summary — All Active Members</h2>
          <button class="btn btn-ghost" id="btn-export-summary">
            <i class="fa-solid fa-download"></i> CSV
          </button>
        </div>
        <div id="summary-table"></div>
      </div>
    </div>`;
  },
  async mount() {
    const members = await api.getMembers();
    const sel = document.getElementById('stmt-member');
    members.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.name;
      sel.appendChild(opt);
    });
    await this.loadSummary();
    document.getElementById('btn-gen-stmt').onclick = () => this.generateStatement();
    document.getElementById('btn-print').onclick = async () => {
      const res = await api.printToPDF();
      if (res.success) toast('PDF saved.', 'success');
    };
    document.getElementById('btn-export-stmt').onclick = async () => {
      const t = document.querySelector('#stmt-table table');
      if (!t) return toast('Generate a statement first.', 'error');
      const res = await api.saveCSV(csvFromTable(t), 'member-statement.csv');
      if (res.success) toast('Exported.', 'success');
    };
    document.getElementById('btn-export-summary').onclick = async () => {
      const t = document.querySelector('#summary-table table');
      if (!t) return;
      const res = await api.saveCSV(csvFromTable(t), 'savings-summary.csv');
      if (res.success) toast('Exported.', 'success');
    };
  },
  async generateStatement() {
    const mid = document.getElementById('stmt-member').value;
    if (!mid) return toast('Please select a member.', 'error');
    const [member, balance, txns] = await Promise.all([
      api.getMember(mid), api.getMemberBalance(mid), api.getMemberTransactions(mid),
    ]);
    const info = document.getElementById('stmt-info');
    info.classList.remove('hidden');
    info.innerHTML = `<strong>${member.name}</strong> &nbsp;|&nbsp; Joined: ${fmt.date(member.date_joined)}
      &nbsp;|&nbsp; Balance: <strong class="text-green-600">${fmt.currency(balance)}</strong>
      &nbsp;|&nbsp; Transactions: ${txns.length}`;
    document.getElementById('stmt-table').innerHTML = tableHTML([
      { label: 'Date',   key: 'date',            render: r => fmt.date(r.date) },
      { label: 'Type',   key: 'transaction_type', render: r => statusChip(r.transaction_type) },
      { label: 'Amount', key: 'amount',            render: r => fmt.currency(r.amount) },
      { label: 'Notes',  key: 'notes',             render: r => r.notes || '' },
    ], txns, 'No transactions.');
  },
  async loadSummary() {
    const rows = await api.getSavingsSummary();
    document.getElementById('summary-table').innerHTML = tableHTML([
      { label: 'Member',  key: 'name' },
      { label: 'Balance', key: 'balance', render: r => fmt.currency(r.balance) },
    ], rows, 'No active members.');
  },
};

// ── Activity Log Page ────────────────────────────────────────
const Activity = {
  async render() {
    return `
    <div class="section-card">
      <div class="page-header">
        <h2>Activity Log</h2>
        <div class="flex gap-2">
          <input id="activity-search" class="form-input" style="width:220px" placeholder="Filter…">
          <button class="btn btn-ghost" id="btn-export-activity">
            <i class="fa-solid fa-download"></i> CSV
          </button>
        </div>
      </div>
      <div id="activity-table"></div>
    </div>`;
  },
  async mount() {
    await this.load();
    document.getElementById('btn-export-activity').onclick = async () => {
      const t = document.querySelector('#activity-table table');
      if (!t) return;
      const res = await api.saveCSV(csvFromTable(t), 'activity-log.csv');
      if (res.success) toast('Exported.', 'success');
    };
    document.getElementById('activity-search').oninput = e => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('#activity-table tbody tr').forEach(tr => {
        tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    };
  },
  async load() {
    const logs = await api.getActivityLog(200);
    const actionColors = {
      ADD_MEMBER:'bg-green-100 text-green-700', UPDATE_MEMBER:'bg-blue-100 text-blue-700',
      DELETE_MEMBER:'bg-red-100 text-red-700', TRANSACTION:'bg-purple-100 text-purple-700',
      LOAN_APPLY:'bg-yellow-100 text-yellow-700', LOAN_APPROVE:'bg-green-100 text-green-700',
      LOAN_REJECT:'bg-red-100 text-red-700', REPAYMENT:'bg-blue-100 text-blue-700',
    };
    document.getElementById('activity-table').innerHTML = tableHTML([
      { label: 'Time',    key: 'created_at', render: r => new Date(r.created_at).toLocaleString() },
      { label: 'Action',  key: 'action',      render: r => {
        const cls = actionColors[r.action] || 'bg-gray-100 text-gray-600';
        return `<span class="status-chip ${cls} text-xs">${r.action}</span>`;
      }},
      { label: 'Details', key: 'details' },
    ], logs, 'No activity yet.');
  },
};

// ── Settings / DB Connection Page ────────────────────────────
const Settings = {
  async render() {
    const cfg = await api.getConfig();
    return `
    <div class="section-card" style="max-width:520px;margin:0 auto">
      <div class="page-header"><h2>Database Connection</h2></div>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-5">
        Configure the MySQL connection. Changes take effect immediately after saving.
      </p>
      <form id="db-cfg-form" autocomplete="off">
        <div class="form-group">
          <label class="form-label">Host</label>
          <input class="form-input" id="cfg-host" value="${cfg.host}" placeholder="localhost">
        </div>
        <div class="form-group">
          <label class="form-label">Port <span class="text-gray-400 font-normal">(optional)</span></label>
          <input class="form-input" id="cfg-port" value="${cfg.port || ''}" placeholder="3306">
        </div>
        <div class="form-group">
          <label class="form-label">Username</label>
          <input class="form-input" id="cfg-user" value="${cfg.user}" placeholder="root">
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <div style="position:relative">
            <input class="form-input" id="cfg-password" type="password"
                   value="${cfg.password}" placeholder="Leave blank if none" style="padding-right:2.5rem">
            <button type="button" id="cfg-toggle-pw"
                    style="position:absolute;right:.6rem;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:#9ca3af">
              <i class="fa-solid fa-eye"></i>
            </button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Database Name</label>
          <input class="form-input" id="cfg-db" value="${cfg.database}" placeholder="sacco_db">
        </div>

        <div id="cfg-status" class="hidden text-sm rounded px-3 py-2 mb-4"></div>

        <div class="flex gap-3 flex-wrap">
          <button type="button" id="btn-test-cfg" class="btn btn-ghost">
            <i class="fa-solid fa-plug-circle-check"></i> Test Connection
          </button>
          <button type="submit" class="btn btn-primary">
            <i class="fa-solid fa-floppy-disk"></i> Save &amp; Connect
          </button>
        </div>
      </form>
    </div>`;
  },

  async mount() {
    document.getElementById('cfg-toggle-pw').onclick = () => {
      const inp = document.getElementById('cfg-password');
      const ico = document.querySelector('#cfg-toggle-pw i');
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      ico.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
    };

    document.getElementById('btn-test-cfg').onclick = async () => {
      this._setStatus('info', '<i class="fa-solid fa-spinner fa-spin"></i> Testing…');
      const result = await api.testConfig(this._vals());
      result.success
        ? this._setStatus('success', '<i class="fa-solid fa-circle-check"></i> Connection successful')
        : this._setStatus('error', `<i class="fa-solid fa-circle-xmark"></i> ${result.error}`);
    };

    document.getElementById('db-cfg-form').onsubmit = async e => {
      e.preventDefault();
      this._setStatus('info', '<i class="fa-solid fa-spinner fa-spin"></i> Connecting…');
      const result = await api.applyConfig(this._vals());
      if (result.success) {
        this._setStatus('success', '<i class="fa-solid fa-circle-check"></i> Connected and database ready');
        toast('Database connected successfully', 'success');
      } else {
        this._setStatus('error', `<i class="fa-solid fa-circle-xmark"></i> ${result.error}`);
        toast('Connection failed', 'error');
      }
    };
  },

  _vals() {
    return {
      host:     document.getElementById('cfg-host').value.trim()     || 'localhost',
      port:     document.getElementById('cfg-port').value.trim()     || '',
      user:     document.getElementById('cfg-user').value.trim()     || 'root',
      password: document.getElementById('cfg-password').value,
      database: document.getElementById('cfg-db').value.trim()       || 'sacco_db',
    };
  },

  _setStatus(type, html) {
    const el = document.getElementById('cfg-status');
    el.className = {
      info:    'text-sm rounded px-3 py-2 mb-4 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      success: 'text-sm rounded px-3 py-2 mb-4 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
      error:   'text-sm rounded px-3 py-2 mb-4 bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300',
    }[type];
    el.innerHTML = html;
  },
};

const pages = { dashboard: Dashboard, members: Members, savings: Savings,
                loans: Loans, calculator: Calculator, reports: Reports,
                activity: Activity, users: Users, settings: Settings };

// ── Pending badge ────────────────────────────────────────────
async function updatePendingBadge() {
  const n = await api.getPendingCount();
  const badge = document.getElementById('pending-badge');
  if (n > 0) {
    badge.textContent = n;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ── Dark mode ────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.classList.toggle('dark', saved === 'dark');
  document.getElementById('theme-btn').innerHTML =
    saved === 'dark' ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  document.getElementById('theme-btn').innerHTML =
    isDark ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}

// ── Overdue alert ────────────────────────────────────────────
async function updateOverdueAlert() {
  const overdue = await api.getOverdueLoans();
  const el = document.getElementById('overdue-alert');
  if (overdue.length) {
    document.getElementById('overdue-count').textContent = overdue.length;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

// ── Session / Login helpers ───────────────────────────────────
function getCurrentUser() { try { return JSON.parse(sessionStorage.getItem('user')); } catch { return null; } }
function setCurrentUser(u) { sessionStorage.setItem('user', JSON.stringify(u)); }
function clearCurrentUser() { sessionStorage.removeItem('user'); }
function showLoginOverlay() { const el = document.getElementById('login-overlay'); if (el) el.style.display = 'flex'; }
function hideLoginOverlay() { const el = document.getElementById('login-overlay'); if (el) el.style.display = 'none'; }
async function doLogin(username, password) { const user = await api.login(username, password); setCurrentUser(user); return user; }
function updateTopbarUser() { const u = getCurrentUser(); const el = document.getElementById('current-user'); if (!el) return; el.textContent = u ? `${u.username} (${u.role})` : ''; }

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  document.getElementById('date-display').textContent = new Date().toLocaleDateString('en-UG', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });

  document.getElementById('theme-btn').onclick = toggleTheme;
  document.getElementById('modal-close').onclick = closeModal;
  document.getElementById('modal-overlay').onclick = e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  };

  // Login form wiring
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.onsubmit = async e => {
      e.preventDefault();
      const user = document.getElementById('login-username').value.trim();
      const pass = document.getElementById('login-password').value;
      try {
        const u = await doLogin(user, pass);
        console.log('Login success', u);
        hideLoginOverlay();
        updateTopbarUser();
        toast('Signed in.', 'success');
        await navigate('dashboard');
      } catch (err) { toast(err.message || 'Login failed', 'error'); }
    };
  }

  // Logout
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.onclick = () => { clearCurrentUser(); updateTopbarUser(); showLoginOverlay(); toast('Signed out.', 'info'); };

  // show login if not signed in
  const cur = getCurrentUser();
  if (!cur) showLoginOverlay(); else updateTopbarUser();

  document.querySelectorAll('.nav-link').forEach(el => {
    el.onclick = () => navigate(el.dataset.page);
  });

  // keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // If main process reports a DB connection failure, go straight to settings
  api.onDbConnectFailed(msg => {
    toast(`Database connection failed — check settings. ${msg}`, 'error');
    navigate('settings');
  });

  await Promise.all([updatePendingBadge(), updateOverdueAlert()]);
  await navigate('dashboard');
});

// expose to inline onclick handlers
window.Members    = Members;
window.Loans      = Loans;
window.Users      = Users;
window.Settings   = Settings;
window.closeModal = closeModal;
