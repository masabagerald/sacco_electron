const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  // Members
  getMembers:   (search)          => invoke('db:getMembers', search),
  getMember:    (id)              => invoke('db:getMember', id),
  addMember:    (data)            => invoke('db:addMember', data),
  updateMember: (id, data)        => invoke('db:updateMember', id, data),
  deleteMember: (id)              => invoke('db:deleteMember', id),

  // Savings
  addTransaction:        (data)     => invoke('db:addTransaction', data),
  getMemberBalance:      (id)       => invoke('db:getMemberBalance', id),
  getMemberTransactions: (id)       => invoke('db:getMemberTransactions', id),
  getAllTransactions:     ()         => invoke('db:getAllTransactions'),
  getSavingsSummary:     ()         => invoke('db:getSavingsSummary'),
  getSavingsTrend:       (months)   => invoke('db:getSavingsTrend', months),

  // Loans
  getLoans:          (filter)       => invoke('db:getLoans', filter),
  getLoan:           (id)           => invoke('db:getLoan', id),
  applyLoan:         (data)         => invoke('db:applyLoan', data),
  approveLoan:       (id, amount)   => invoke('db:approveLoan', id, amount),
  rejectLoan:        (id)           => invoke('db:rejectLoan', id),
  addRepayment:      (data)         => invoke('db:addRepayment', data),
  getLoanRepayments: (id)           => invoke('db:getLoanRepayments', id),
  getLoanBalance:    (id)           => invoke('db:getLoanBalance', id),
  getOverdueLoans:   ()             => invoke('db:getOverdueLoans'),
  getLoanStatusCounts: ()           => invoke('db:getLoanStatusCounts'),
  getPendingCount:   ()             => invoke('db:getPendingCount'),

  // Dashboard
  getDashboardStats: ()             => invoke('db:getDashboardStats'),

  // Activity
  getActivityLog: (limit)           => invoke('db:getActivityLog', limit),

  // Users & Auth
  login:         (username, password) => invoke('db:authLogin', username, password),
  getUsers:      ()                   => invoke('db:getUsers'),
  getUser:       (id)                 => invoke('db:getUser', id),
  addUser:       (data)               => invoke('db:addUser', data),
  updateUser:    (id, data)           => invoke('db:updateUser', id, data),
  deleteUser:    (id)                 => invoke('db:deleteUser', id),

  // System
  saveCSV:    (csv, name) => invoke('dialog:saveCSV', csv, name),
  printToPDF: ()          => invoke('app:printToPDF'),

  // DB connection config
  getConfig:   ()    => invoke('config:get'),
  testConfig:  (cfg) => invoke('config:test', cfg),
  applyConfig: (cfg) => invoke('config:apply', cfg),

  // Main → renderer events
  onDbConnectFailed: (cb) => {
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('db:connect-failed', (_, msg) => cb(msg));
  },
});
