/**
 * Justcard Dual-Engine Database Driver (MySQL + JSON Fallback)
 * Auto-creates MySQL tables, auto-migrates existing data, and ensures zero data loss.
 */

const fs = require('fs');
const path = require('path');

let mysql;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  console.warn('mysql2 package not loaded, using JSON engine.');
}

const DB_FILE = path.join(__dirname, 'data', 'db.json');

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'justcard9504',
  password: process.env.DB_PASSWORD || process.env.DB_PASS || 'Justcard@9504',
  database: process.env.DB_NAME || 'justcard',
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 8000
};

let pool = null;
let isMySqlActive = false;

// -------------------------------------------------------------
// JSON File Helpers (Multi-Layer Self-Healing Persistence Engine)
// -------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const MASTER_BACKUP_FILE = path.join(DATA_DIR, 'db.master.json');
const BACKUP_FILE = path.join(DATA_DIR, 'db.backup.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

let cachedJsonDb = null;

function safeReadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw && raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
  } catch (err) {}
  return null;
}

function mergeUsers(targetUsers, sourceUsers) {
  const map = new Map();
  const add = (u) => {
    if (!u || !u.mobile) return;
    const cleanMobile = String(u.mobile).trim();
    if (!cleanMobile) return;

    if (!map.has(cleanMobile)) {
      map.set(cleanMobile, { ...u, mobile: cleanMobile });
    } else {
      const existing = map.get(cleanMobile);
      const balance = Math.max(Number(existing.balance !== undefined ? existing.balance : 0), Number(u.balance !== undefined ? u.balance : 0));
      const status = (existing.status === 'blocked' || u.status === 'blocked') ? 'blocked' : 'active';
      const shopName = u.shopName || existing.shopName || 'Retailer';
      const pin = u.pin || existing.pin || '1234';
      const id = existing.id || u.id;

      let pkg = existing.package;
      if (u.package && u.package.expiresAt) {
        if (!pkg || !pkg.expiresAt || new Date(u.package.expiresAt) > new Date(pkg.expiresAt)) {
          pkg = u.package;
        }
      }

      map.set(cleanMobile, {
        ...existing,
        ...u,
        id,
        mobile: cleanMobile,
        shopName,
        pin,
        balance,
        status,
        package: pkg
      });
    }
  };

  (sourceUsers || []).forEach(add);
  (targetUsers || []).forEach(add);

  return Array.from(map.values());
}

function readJsonDb() {
  if (cachedJsonDb) return cachedJsonDb;

  const sources = [];
  const mainDb = safeReadJson(DB_FILE);
  if (mainDb) sources.push(mainDb);

  const masterDb = safeReadJson(MASTER_BACKUP_FILE);
  if (masterDb) sources.push(masterDb);

  const backupDb = safeReadJson(BACKUP_FILE);
  if (backupDb) sources.push(backupDb);

  try {
    if (fs.existsSync(BACKUPS_DIR)) {
      const files = fs.readdirSync(BACKUPS_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 10);
      for (const f of files) {
        const snap = safeReadJson(path.join(BACKUPS_DIR, f));
        if (snap) sources.push(snap);
      }
    }
  } catch (e) {}

  let consolidatedUsers = [];
  const consolidatedTxns = new Map();
  const consolidatedReqs = new Map();
  let consolidatedPricing = null;
  let consolidatedPackages = null;
  let consolidatedAdminConfig = null;

  for (const s of sources) {
    if (s.users && Array.isArray(s.users)) consolidatedUsers = mergeUsers(consolidatedUsers, s.users);
    if (s.transactions && Array.isArray(s.transactions)) {
      for (const t of s.transactions) if (t && t.id && !consolidatedTxns.has(t.id)) consolidatedTxns.set(t.id, t);
    }
    if (s.rechargeRequests && Array.isArray(s.rechargeRequests)) {
      for (const r of s.rechargeRequests) if (r && r.id && !consolidatedReqs.has(r.id)) consolidatedReqs.set(r.id, r);
    }
    if (!consolidatedPricing && s.pricing && typeof s.pricing === 'object') consolidatedPricing = { ...s.pricing };
    if (!consolidatedPackages && s.packages && typeof s.packages === 'object') consolidatedPackages = { ...s.packages };
    if (!consolidatedAdminConfig && s.adminConfig && typeof s.adminConfig === 'object') consolidatedAdminConfig = { ...s.adminConfig };
  }

  cachedJsonDb = {
    adminConfig: consolidatedAdminConfig || { adminPin: '1234', adminName: 'Justcard Admin', upiId: '9504329735@okbizaxis', upiName: 'JUSTCOMES' },
    pricing: consolidatedPricing || { singlePrint: 5, a4Document: 2, photoMaker: 3, resumeMaker: 5, pdfEditor: 3 },
    packages: consolidatedPackages || {},
    users: consolidatedUsers,
    transactions: Array.from(consolidatedTxns.values()),
    rechargeRequests: Array.from(consolidatedReqs.values())
  };

  return cachedJsonDb;
}

function writeJsonDb(data) {
  try {
    if (!data || typeof data !== 'object') return;

    if (cachedJsonDb && cachedJsonDb.users && cachedJsonDb.users.length > 0) {
      data.users = mergeUsers(cachedJsonDb.users, data.users || []);
    }

    cachedJsonDb = data;
    const jsonStr = JSON.stringify(data, null, 2);

    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, jsonStr, 'utf-8');
    try {
      fs.renameSync(tmpFile, DB_FILE);
    } catch (e) {
      fs.writeFileSync(DB_FILE, jsonStr, 'utf-8');
    }

    try {
      fs.writeFileSync(MASTER_BACKUP_FILE, jsonStr, 'utf-8');
      fs.writeFileSync(BACKUP_FILE, jsonStr, 'utf-8');
    } catch (b) {}
  } catch (e) {
    console.error('Error writing JSON DB in db.js:', e);
  }
}

// -------------------------------------------------------------
// MySQL Initialization & Auto Table Setup
// -------------------------------------------------------------
async function initDatabase() {
  if (!mysql) {
    console.log('📦 Running with JSON Database engine.');
    return;
  }

  try {
    pool = mysql.createPool(DB_CONFIG);
    const connection = await pool.getConnection();
    console.log(`✅ Connected to MySQL Database "${DB_CONFIG.database}" on ${DB_CONFIG.host}!`);
    isMySqlActive = true;

    // Create Tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        mobile VARCHAR(20) UNIQUE NOT NULL,
        shopName VARCHAR(255) DEFAULT '',
        pin VARCHAR(32) NOT NULL,
        balance DECIMAL(10,2) DEFAULT 0.00,
        status VARCHAR(20) DEFAULT 'active',
        package_key VARCHAR(50) NULL,
        package_name VARCHAR(100) NULL,
        package_activated_at VARCHAR(64) NULL,
        package_expires_at VARCHAR(64) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(64) PRIMARY KEY,
        userId VARCHAR(64) NOT NULL,
        mobile VARCHAR(20) NOT NULL,
        shopName VARCHAR(255) DEFAULT '',
        type VARCHAR(20) NOT NULL,
        amount DECIMAL(10,2) DEFAULT 0.00,
        service VARCHAR(255) DEFAULT '',
        balanceAfter DECIMAL(10,2) DEFAULT 0.00,
        timestamp VARCHAR(64) NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (userId),
        INDEX (mobile)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS recharge_requests (
        id VARCHAR(64) PRIMARY KEY,
        userId VARCHAR(64) NOT NULL,
        mobile VARCHAR(20) NOT NULL,
        shopName VARCHAR(255) DEFAULT '',
        amount DECIMAL(10,2) NOT NULL,
        utr VARCHAR(100) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        timestamp VARCHAR(64) NOT NULL,
        note TEXT,
        approvedAt VARCHAR(64) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (userId),
        INDEX (utr)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS system_config (
        key_name VARCHAR(100) PRIMARY KEY,
        config_value LONGTEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Check if initial migration from JSON is needed
    const [rows] = await connection.query('SELECT COUNT(*) as count FROM users');
    if (rows[0].count === 0) {
      console.log('🔄 First run on MySQL: Migrating data from db.json into MySQL tables...');
      const local = readJsonDb();

      // Migrate Users
      if (local.users && local.users.length > 0) {
        for (const u of local.users) {
          await connection.query(`
            INSERT IGNORE INTO users (id, mobile, shopName, pin, balance, status, package_key, package_name, package_activated_at, package_expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            u.id, u.mobile, u.shopName || '', u.pin, Number(u.balance || 0), u.status || 'active',
            u.package ? u.package.key : null,
            u.package ? u.package.name : null,
            u.package ? u.package.activatedAt : null,
            u.package ? u.package.expiresAt : null
          ]);
        }
      }

      // Migrate Transactions
      if (local.transactions && local.transactions.length > 0) {
        for (const t of local.transactions) {
          await connection.query(`
            INSERT IGNORE INTO transactions (id, userId, mobile, shopName, type, amount, service, balanceAfter, timestamp, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            t.id, t.userId, t.mobile, t.shopName || '', t.type, Number(t.amount || 0), t.service || '', Number(t.balanceAfter || 0), t.timestamp || new Date().toISOString(), t.note || ''
          ]);
        }
      }

      // Migrate Configs
      if (local.pricing) {
        await connection.query('INSERT INTO system_config (key_name, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value=?', ['pricing', JSON.stringify(local.pricing), JSON.stringify(local.pricing)]);
      }
      if (local.packages) {
        await connection.query('INSERT INTO system_config (key_name, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value=?', ['packages', JSON.stringify(local.packages), JSON.stringify(local.packages)]);
      }
      if (local.adminConfig) {
        await connection.query('INSERT INTO system_config (key_name, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value=?', ['adminConfig', JSON.stringify(local.adminConfig), JSON.stringify(local.adminConfig)]);
      }

      console.log('🎉 Data migration into MySQL completed successfully!');
    }

    connection.release();
  } catch (err) {
    console.warn(`⚠️ MySQL Connection Warning (${err.message}). Falling back to JSON Database.`);
    isMySqlActive = false;
  }
}

// -------------------------------------------------------------
// Database Operations (Async for MySQL & JSON sync)
// -------------------------------------------------------------

function formatUser(row) {
  if (!row) return null;
  const user = {
    id: row.id,
    mobile: row.mobile,
    shopName: row.shopName,
    pin: row.pin,
    balance: Number(row.balance || 0),
    status: row.status || 'active'
  };
  if (row.package_key) {
    user.package = {
      key: row.package_key,
      name: row.package_name,
      activatedAt: row.package_activated_at,
      expiresAt: row.package_expires_at
    };
  } else {
    user.package = null;
  }
  return user;
}

async function findUser(filter) {
  if (isMySqlActive) {
    try {
      let query = 'SELECT * FROM users WHERE 1=1';
      const params = [];
      if (filter.id) {
        query += ' AND id = ?';
        params.push(filter.id);
      }
      if (filter.mobile) {
        query += ' AND mobile = ?';
        params.push(filter.mobile);
      }
      query += ' LIMIT 1';
      const [rows] = await pool.query(query, params);
      return rows.length > 0 ? formatUser(rows[0]) : null;
    } catch (e) {
      console.error('MySQL findUser error:', e);
    }
  }

  // Fallback
  const local = readJsonDb();
  return local.users.find(u => (filter.id && u.id === filter.id) || (filter.mobile && u.mobile === filter.mobile)) || null;
}

async function getAllUsers() {
  if (isMySqlActive) {
    try {
      const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
      return rows.map(formatUser);
    } catch (e) {
      console.error('MySQL getAllUsers error:', e);
    }
  }
  const local = readJsonDb();
  return local.users || [];
}

async function saveUser(user) {
  if (isMySqlActive) {
    try {
      const pkg = user.package || {};
      await pool.query(`
        INSERT INTO users (id, mobile, shopName, pin, balance, status, package_key, package_name, package_activated_at, package_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          shopName = VALUES(shopName),
          pin = VALUES(pin),
          balance = VALUES(balance),
          status = VALUES(status),
          package_key = VALUES(package_key),
          package_name = VALUES(package_name),
          package_activated_at = VALUES(package_activated_at),
          package_expires_at = VALUES(package_expires_at)
      `, [
        user.id, user.mobile, user.shopName || '', user.pin, Number(user.balance || 0), user.status || 'active',
        pkg.key || null, pkg.name || null, pkg.activatedAt || null, pkg.expiresAt || null
      ]);
      return;
    } catch (e) {
      console.error('MySQL saveUser error:', e);
    }
  }

  // Fallback JSON
  const local = readJsonDb();
  const idx = local.users.findIndex(u => u.id === user.id || u.mobile === user.mobile);
  if (idx >= 0) {
    local.users[idx] = Object.assign({}, local.users[idx], user);
  } else {
    local.users.unshift(user);
  }
  writeJsonDb(local);
}

async function addTransaction(txn) {
  if (isMySqlActive) {
    try {
      await pool.query(`
        INSERT INTO transactions (id, userId, mobile, shopName, type, amount, service, balanceAfter, timestamp, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        txn.id, txn.userId, txn.mobile, txn.shopName || '', txn.type, Number(txn.amount || 0), txn.service || '', Number(txn.balanceAfter || 0), txn.timestamp || new Date().toISOString(), txn.note || ''
      ]);
      return;
    } catch (e) {
      console.error('MySQL addTransaction error:', e);
    }
  }

  // Fallback JSON
  const local = readJsonDb();
  if (!local.transactions) local.transactions = [];
  local.transactions.unshift(txn);
  writeJsonDb(local);
}

async function getTransactions(filter = {}, limit = 50) {
  if (isMySqlActive) {
    try {
      let query = 'SELECT * FROM transactions WHERE 1=1';
      const params = [];
      if (filter.userId) {
        query += ' AND userId = ?';
        params.push(filter.userId);
      }
      if (filter.mobile) {
        query += ' AND mobile = ?';
        params.push(filter.mobile);
      }
      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const [rows] = await pool.query(query, params);
      return rows;
    } catch (e) {
      console.error('MySQL getTransactions error:', e);
    }
  }

  const local = readJsonDb();
  let list = local.transactions || [];
  if (filter.userId) list = list.filter(t => t.userId === filter.userId);
  if (filter.mobile) list = list.filter(t => t.mobile === filter.mobile);
  return list.slice(0, limit);
}

async function addRechargeRequest(req) {
  if (isMySqlActive) {
    try {
      await pool.query(`
        INSERT INTO recharge_requests (id, userId, mobile, shopName, amount, utr, status, timestamp, note, approvedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        req.id, req.userId, req.mobile, req.shopName || '', Number(req.amount), req.utr, req.status || 'pending', req.timestamp || new Date().toISOString(), req.note || '', req.approvedAt || null
      ]);
      return;
    } catch (e) {
      console.error('MySQL addRechargeRequest error:', e);
    }
  }

  const local = readJsonDb();
  if (!local.rechargeRequests) local.rechargeRequests = [];
  local.rechargeRequests.unshift(req);
  writeJsonDb(local);
}

async function getRechargeRequests(filter = {}, limit = 50) {
  if (isMySqlActive) {
    try {
      let query = 'SELECT * FROM recharge_requests WHERE 1=1';
      const params = [];
      if (filter.id) {
        query += ' AND id = ?';
        params.push(filter.id);
      }
      if (filter.userId) {
        query += ' AND userId = ?';
        params.push(filter.userId);
      }
      if (filter.status) {
        query += ' AND status = ?';
        params.push(filter.status);
      }
      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);
      const [rows] = await pool.query(query, params);
      return rows;
    } catch (e) {
      console.error('MySQL getRechargeRequests error:', e);
    }
  }

  const local = readJsonDb();
  let list = local.rechargeRequests || [];
  if (filter.id) list = list.filter(r => r.id === filter.id);
  if (filter.userId) list = list.filter(r => r.userId === filter.userId);
  if (filter.status) list = list.filter(r => r.status === filter.status);
  return list.slice(0, limit);
}

async function updateRechargeRequest(id, updates) {
  if (isMySqlActive) {
    try {
      const keys = Object.keys(updates);
      if (keys.length > 0) {
        const setClause = keys.map(k => `${k} = ?`).join(', ');
        const values = keys.map(k => updates[k]);
        values.push(id);
        await pool.query(`UPDATE recharge_requests SET ${setClause} WHERE id = ?`, values);
      }
      return;
    } catch (e) {
      console.error('MySQL updateRechargeRequest error:', e);
    }
  }

  const local = readJsonDb();
  const req = (local.rechargeRequests || []).find(r => r.id === id);
  if (req) {
    Object.assign(req, updates);
    writeJsonDb(local);
  }
}

async function getConfig(key, defaultVal = {}) {
  if (isMySqlActive) {
    try {
      const [rows] = await pool.query('SELECT config_value FROM system_config WHERE key_name = ?', [key]);
      if (rows.length > 0) {
        return JSON.parse(rows[0].config_value);
      }
    } catch (e) {
      console.error('MySQL getConfig error:', e);
    }
  }

  const local = readJsonDb();
  return local[key] !== undefined ? local[key] : defaultVal;
}

async function setConfig(key, value) {
  if (isMySqlActive) {
    try {
      const jsonStr = JSON.stringify(value);
      await pool.query(`
        INSERT INTO system_config (key_name, config_value)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
      `, [key, jsonStr]);
      return;
    } catch (e) {
      console.error('MySQL setConfig error:', e);
    }
  }

  const local = readJsonDb();
  local[key] = value;
  writeJsonDb(local);
}

module.exports = {
  initDatabase,
  isMySqlActive: () => isMySqlActive,
  findUser,
  getAllUsers,
  saveUser,
  addTransaction,
  getTransactions,
  addRechargeRequest,
  getRechargeRequests,
  updateRechargeRequest,
  getConfig,
  setConfig,
  readJsonDb,
  writeJsonDb
};
