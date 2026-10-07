const http = require('http');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx !== -1) {
          const key = trimmed.slice(0, idx).trim();
          const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
          process.env[key] = val;
        }
      }
    } catch (e) {
      console.warn('Could not read .env file:', e.message);
    }
  }
}
loadEnv();

const dbManager = require('./db');

// Initialize Database (MySQL with auto-fallback to JSON)
dbManager.initDatabase();

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};

const DEFAULT_PACKAGES = {
  silver: {
    key: 'silver',
    name: 'Silver Plan',
    durationText: '1 Month',
    months: 1,
    price: 299,
    description: '1 Month All 4 Services Unlimited Free Print & Download',
    badgeColor: '#94a3b8'
  },
  gold: {
    key: 'gold',
    name: 'Gold Plan',
    durationText: '3 Months',
    months: 3,
    price: 699,
    description: '3 Months All 4 Services Unlimited Free Print & Download',
    badgeColor: '#f59e0b'
  },
  platinum: {
    key: 'platinum',
    name: 'Platinum Plan',
    durationText: '6 Months',
    months: 6,
    price: 1199,
    description: '6 Months All 4 Services Unlimited Free Print & Download',
    badgeColor: '#06b6d4'
  },
  diamond: {
    key: 'diamond',
    name: 'Diamond Plan',
    durationText: '1 Year (12 Months)',
    months: 12,
    price: 1999,
    description: '1 Year (12 Months) All 4 Services Unlimited Free Print & Download',
    badgeColor: '#a855f7'
  }
};

const DEFAULT_UPI_CONFIG = {
  upiId: '9504329735@okbizaxis',
  upiName: 'JUSTCOMES',
  phonePeMerchantId: 'M17LJKW0G8TA'
};

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MASTER_BACKUP_FILE = path.join(DATA_DIR, 'db.master.json');
const BACKUP_FILE = path.join(DATA_DIR, 'db.backup.json');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

// Ensure data folder & backups folder exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

function safeReadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (raw && raw.trim().length > 0) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    }
  } catch (err) {
    console.warn(`[SafeRead] Notice reading ${path.basename(filePath)}:`, err.message);
  }
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

function selfHealAndConsolidateDb() {
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
        .slice(0, 15);
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
    if (s.users && Array.isArray(s.users)) {
      consolidatedUsers = mergeUsers(consolidatedUsers, s.users);
    }
    if (s.transactions && Array.isArray(s.transactions)) {
      for (const t of s.transactions) {
        if (t && t.id && !consolidatedTxns.has(t.id)) consolidatedTxns.set(t.id, t);
      }
    }
    if (s.rechargeRequests && Array.isArray(s.rechargeRequests)) {
      for (const r of s.rechargeRequests) {
        if (r && r.id && !consolidatedReqs.has(r.id)) consolidatedReqs.set(r.id, r);
      }
    }
    if (!consolidatedPricing && s.pricing && typeof s.pricing === 'object' && Object.keys(s.pricing).length > 0) {
      consolidatedPricing = { ...s.pricing };
    }
    if (!consolidatedPackages && s.packages && typeof s.packages === 'object' && Object.keys(s.packages).length > 0) {
      consolidatedPackages = { ...s.packages };
    }
    if (!consolidatedAdminConfig && s.adminConfig && typeof s.adminConfig === 'object' && Object.keys(s.adminConfig).length > 0) {
      consolidatedAdminConfig = { ...s.adminConfig };
    }
  }

  // Preserve adminConfig
  if (!consolidatedAdminConfig) {
    consolidatedAdminConfig = {
      adminPin: '1234',
      adminName: 'Justcard Admin',
      upiId: DEFAULT_UPI_CONFIG.upiId,
      upiName: DEFAULT_UPI_CONFIG.upiName
    };
  } else {
    if (!consolidatedAdminConfig.upiId) consolidatedAdminConfig.upiId = DEFAULT_UPI_CONFIG.upiId;
    if (!consolidatedAdminConfig.upiName) consolidatedAdminConfig.upiName = DEFAULT_UPI_CONFIG.upiName;
    if (!consolidatedAdminConfig.adminPin) consolidatedAdminConfig.adminPin = '1234';
  }

  if (!consolidatedPricing) {
    consolidatedPricing = { singlePrint: 5, a4Document: 2, photoMaker: 3, resumeMaker: 5, pdfEditor: 3 };
  }

  if (!consolidatedPackages) {
    consolidatedPackages = JSON.parse(JSON.stringify(DEFAULT_PACKAGES));
  }

  const txnsArray = Array.from(consolidatedTxns.values()).sort((a, b) => {
    return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
  });

  const reqsArray = Array.from(consolidatedReqs.values()).sort((a, b) => {
    return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
  });

  // If no users at all across all sources, add standard initial demo user
  if (!consolidatedUsers || consolidatedUsers.length === 0) {
    consolidatedUsers = [
      {
        id: 'USR-1001',
        mobile: '9999999999',
        shopName: 'Demo Justcard Cyber Cafe',
        pin: '1234',
        balance: 100,
        createdAt: new Date().toISOString(),
        status: 'active',
        package: null
      }
    ];
  }

  const finalDb = {
    adminConfig: consolidatedAdminConfig,
    pricing: consolidatedPricing,
    packages: consolidatedPackages,
    users: consolidatedUsers,
    transactions: txnsArray,
    rechargeRequests: reqsArray
  };

  return finalDb;
}

let cachedDb = null;
let lastBackupTime = 0;

function readDb() {
  if (!cachedDb) {
    cachedDb = selfHealAndConsolidateDb();
    // Persist consolidated master state
    try {
      const jsonStr = JSON.stringify(cachedDb, null, 2);
      fs.writeFileSync(DB_FILE, jsonStr, 'utf8');
      fs.writeFileSync(MASTER_BACKUP_FILE, jsonStr, 'utf8');
      fs.writeFileSync(BACKUP_FILE, jsonStr, 'utf8');
    } catch (e) {}
  }
  return cachedDb;
}

// Auto-heal and warm up cache immediately on startup
readDb();

function writeDb(data) {
  try {
    if (!data || typeof data !== 'object') return false;

    // Deep merge with memory cache to make sure zero users or configurations are ever lost
    if (cachedDb && cachedDb.users && cachedDb.users.length > 0) {
      data.users = mergeUsers(cachedDb.users, data.users || []);
    }

    cachedDb = data;
    const jsonStr = JSON.stringify(data, null, 2);

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });

    // 1. Atomic write to main DB
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, jsonStr, 'utf8');
    try {
      fs.renameSync(tmpFile, DB_FILE);
    } catch (renameErr) {
      fs.writeFileSync(DB_FILE, jsonStr, 'utf8');
    }

    // 2. Save to Master Vault and Backup
    try {
      fs.writeFileSync(MASTER_BACKUP_FILE, jsonStr, 'utf8');
      fs.writeFileSync(BACKUP_FILE, jsonStr, 'utf8');
    } catch (bErr) {
      console.warn('Backup write warning:', bErr.message);
    }

    // 3. Create rolling snapshot backup (throttled to at most once every 30s)
    const now = Date.now();
    if (now - lastBackupTime > 30000) {
      lastBackupTime = now;
      try {
        const d = new Date();
        const stamp = d.toISOString().replace(/[:.]/g, '-');
        const snapFile = path.join(BACKUPS_DIR, `db_backup_${stamp}.json`);
        fs.writeFileSync(snapFile, jsonStr, 'utf8');

        // Prune oldest snapshots, retain last 30
        const files = fs.readdirSync(BACKUPS_DIR)
          .filter(f => f.startsWith('db_backup_') && f.endsWith('.json'))
          .sort();
        if (files.length > 30) {
          for (let i = 0; i < files.length - 30; i++) {
            try { fs.unlinkSync(path.join(BACKUPS_DIR, files[i])); } catch (err) {}
          }
        }
      } catch (snapErr) {}
    }

    if (dbManager && typeof dbManager.isMySqlActive === 'function' && dbManager.isMySqlActive()) {
      (async () => {
        try {
          if (data.users) {
            for (const u of data.users) await dbManager.saveUser(u);
          }
          if (data.transactions && data.transactions.length > 0) {
            await dbManager.addTransaction(data.transactions[0]);
          }
          if (data.rechargeRequests && data.rechargeRequests.length > 0) {
            await dbManager.addRechargeRequest(data.rechargeRequests[0]);
          }
          if (data.pricing) await dbManager.setConfig('pricing', data.pricing);
          if (data.packages) await dbManager.setConfig('packages', data.packages);
          if (data.adminConfig) await dbManager.setConfig('adminConfig', data.adminConfig);
        } catch (syncErr) {
          console.error('MySQL background sync error:', syncErr);
        }
      })();
    }
    return true;
  } catch (err) {
    console.error('Database write error:', err);
    return false;
  }
}

function getUserPackageStatus(user) {
  if (!user || !user.package || !user.package.expiresAt) {
    return { isActive: false, key: null, name: 'Pay-Per-Print', expiresAt: null, daysRemaining: 0 };
  }
  const now = new Date();
  const exp = new Date(user.package.expiresAt);
  if (exp > now) {
    const diffMs = exp - now;
    const daysRemaining = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    return {
      isActive: true,
      key: user.package.key || 'custom',
      name: user.package.name || 'Unlimited Plan',
      activatedAt: user.package.activatedAt,
      expiresAt: user.package.expiresAt,
      daysRemaining: daysRemaining
    };
  }
  return { isActive: false, key: user.package.key, name: 'Expired Plan', expiresAt: user.package.expiresAt, daysRemaining: 0 };
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) { // 5MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', err => reject(err));
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // -------------------------------------------------------------
  // 1. Remove.bg API Proxy
  // -------------------------------------------------------------
  if (pathname === '/api/remove-bg') {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'POST required' });
    }

    loadEnv();
    const key = process.env.REMOVE_BG_API_KEY;
    if (!key || key === 'YOUR_NEW_REMOVE_BG_KEY' || key.trim() === '') {
      return sendJson(res, 400, { error: 'REMOVE_BG_API_KEY is not configured in .env file.' });
    }

    let Busboy;
    try {
      Busboy = require('busboy');
    } catch (e) {
      return sendJson(res, 500, { error: 'busboy package not found. Run npm install.' });
    }

    try {
      const bb = Busboy({ headers: req.headers });
      const chunks = [];
      let filename = 'photo.png';
      let mime = 'image/png';

      bb.on('file', (_name, file, info) => {
        filename = info.filename || filename;
        mime = info.mimeType || mime;
        file.on('data', chunk => chunks.push(chunk));
      });

      bb.on('finish', async () => {
        const image = Buffer.concat(chunks);
        if (!image.length) {
          return sendJson(res, 400, { error: 'image_file is required' });
        }

        try {
          const form = new FormData();
          form.append('image_file', new Blob([image], { type: mime }), filename);
          form.append('size', 'auto');

          const upstream = await fetch('https://api.remove.bg/v1.0/removebg', {
            method: 'POST',
            headers: { 'X-Api-Key': key },
            body: form
          });

          const data = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(upstream.status, {
            'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(data);
        } catch (upstreamErr) {
          return sendJson(res, 502, { error: 'Remove.bg proxy error: ' + upstreamErr.message });
        }
      });

      bb.on('error', err => {
        return sendJson(res, 500, { error: 'Busboy error: ' + err.message });
      });

      req.pipe(bb);
    } catch (err) {
      return sendJson(res, 500, { error: 'Remove.bg server error: ' + err.message });
    }
    return;
  }

  // -------------------------------------------------------------
  // 2. Public Pricing & UPI Details Endpoint
  // -------------------------------------------------------------
  if (pathname === '/api/pricing' && req.method === 'GET') {
    const db = readDb();
    return sendJson(res, 200, {
      success: true,
      pricing: db.pricing || { singlePrint: 5, a4Document: 2, photoMaker: 3, resumeMaker: 5, pdfEditor: 3 },
      packages: db.packages || DEFAULT_PACKAGES,
      upiConfig: {
        upiId: (db.adminConfig && db.adminConfig.upiId) || DEFAULT_UPI_CONFIG.upiId,
        upiName: (db.adminConfig && db.adminConfig.upiName) || DEFAULT_UPI_CONFIG.upiName
      }
    });
  }

  // -------------------------------------------------------------
  // 3. Public Packages Endpoint
  // -------------------------------------------------------------
  if (pathname === '/api/packages' && req.method === 'GET') {
    const db = readDb();
    return sendJson(res, 200, {
      success: true,
      packages: db.packages || DEFAULT_PACKAGES,
      upiConfig: {
        upiId: (db.adminConfig && db.adminConfig.upiId) || DEFAULT_UPI_CONFIG.upiId,
        upiName: (db.adminConfig && db.adminConfig.upiName) || DEFAULT_UPI_CONFIG.upiName
      }
    });
  }

  // -------------------------------------------------------------
  // 4. User Self-Registration
  // -------------------------------------------------------------
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { mobile, shopName, pin } = body;

      if (!mobile || !pin || !shopName) {
        return sendJson(res, 400, { error: 'Mobile number, Shop Name, and PIN are required.' });
      }

      const cleanMobile = String(mobile).trim();
      const cleanPin = String(pin).trim();
      const cleanShop = String(shopName).trim();

      if (cleanMobile.length < 10) {
        return sendJson(res, 400, { error: 'Valid 10-digit mobile number required.' });
      }
      if (cleanPin.length < 4) {
        return sendJson(res, 400, { error: 'PIN must be at least 4 digits.' });
      }

      const db = readDb();
      const existing = db.users.find(u => u.mobile === cleanMobile);
      if (existing) {
        return sendJson(res, 409, { error: 'Account already exists with this mobile number. Please Login.' });
      }

      const newUserId = 'USR-' + (1000 + db.users.length + 1);
      const initialBonus = 10; // Welcome initial demo balance ₹10

      const newUser = {
        id: newUserId,
        mobile: cleanMobile,
        shopName: cleanShop,
        pin: cleanPin,
        balance: initialBonus,
        createdAt: new Date().toISOString(),
        status: 'active',
        package: null
      };

      db.users.push(newUser);

      if (initialBonus > 0) {
        db.transactions.unshift({
          id: 'TXN-' + Date.now().toString().slice(-6),
          userId: newUserId,
          mobile: cleanMobile,
          shopName: cleanShop,
          type: 'credit',
          amount: initialBonus,
          service: 'Welcome Bonus',
          balanceAfter: initialBonus,
          timestamp: new Date().toISOString(),
          note: 'New Account Welcome Balance'
        });
      }

      writeDb(db);

      return sendJson(res, 201, {
        success: true,
        message: 'Account created successfully!',
        user: {
          id: newUser.id,
          mobile: newUser.mobile,
          shopName: newUser.shopName,
          balance: newUser.balance,
          package: newUser.package,
          packageStatus: getUserPackageStatus(newUser)
        }
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 5. User Login
  // -------------------------------------------------------------
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { mobile, pin } = body;

      const cleanMobile = String(mobile || '').trim();
      const cleanPin = String(pin || '').trim();

      const db = readDb();
      const user = db.users.find(u => u.mobile === cleanMobile && u.pin === cleanPin);

      if (!user) {
        return sendJson(res, 401, { error: 'Invalid Mobile Number or PIN.' });
      }

      if (user.status === 'blocked') {
        return sendJson(res, 403, { error: 'Your account is disabled. Please contact Admin.' });
      }

      return sendJson(res, 200, {
        success: true,
        message: 'Login successful!',
        user: {
          id: user.id,
          mobile: user.mobile,
          shopName: user.shopName,
          balance: Number(user.balance || 0),
          package: user.package || null,
          packageStatus: getUserPackageStatus(user)
        }
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 6. Get User Profile & Balance (/api/auth/me)
  // -------------------------------------------------------------
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const userId = parsedUrl.searchParams.get('userId');
    const mobile = parsedUrl.searchParams.get('mobile');

    const db = readDb();
    const user = db.users.find(u => (userId && u.id === userId) || (mobile && u.mobile === mobile));

    if (!user) {
      return sendJson(res, 404, { error: 'User not found.' });
    }

    return sendJson(res, 200, {
      success: true,
      user: {
        id: user.id,
        mobile: user.mobile,
        shopName: user.shopName,
        balance: Number(user.balance || 0),
        status: user.status,
        package: user.package || null,
        packageStatus: getUserPackageStatus(user)
      }
    });
  }

  // -------------------------------------------------------------
  // 7. Buy / Activate Subscription Package (/api/package/buy)
  // -------------------------------------------------------------
  if (pathname === '/api/package/buy' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { userId, mobile, packageKey } = body;

      const db = readDb();
      const user = db.users.find(u => (userId && u.id === userId) || (mobile && u.mobile === mobile));

      if (!user) {
        return sendJson(res, 404, { error: 'Retailer account not found.' });
      }

      if (user.status === 'blocked') {
        return sendJson(res, 403, { error: 'Account is blocked. Contact administrator.' });
      }

      const packages = db.packages || DEFAULT_PACKAGES;
      const targetPkg = packages[packageKey];

      if (!targetPkg) {
        return sendJson(res, 400, { error: 'Invalid package selected.' });
      }

      const pkgPrice = Number(targetPkg.price || 0);
      const currentBalance = Number(user.balance || 0);

      if (currentBalance < pkgPrice) {
        return sendJson(res, 402, {
          error: `Insufficient Wallet Balance to buy ${targetPkg.name}! Required: ₹${pkgPrice.toFixed(2)}, Available: ₹${currentBalance.toFixed(2)}. Please recharge your wallet with PhonePe.`,
          requiredAmount: pkgPrice,
          availableBalance: currentBalance
        });
      }

      // Deduct package price
      const newBalance = Number((currentBalance - pkgPrice).toFixed(2));
      user.balance = newBalance;

      // Calculate expiration date
      const now = new Date();
      let startDate = now;
      if (user.package && user.package.expiresAt && new Date(user.package.expiresAt) > now) {
        startDate = new Date(user.package.expiresAt); // Extend from current expiration
      }

      const expiryDate = new Date(startDate.getTime());
      const monthsToAdd = targetPkg.months || 1;
      expiryDate.setMonth(expiryDate.getMonth() + monthsToAdd);

      user.package = {
        key: targetPkg.key || packageKey,
        name: targetPkg.name,
        activatedAt: now.toISOString(),
        expiresAt: expiryDate.toISOString()
      };

      const txnId = 'TXN-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 10);
      const txnRecord = {
        id: txnId,
        userId: user.id,
        mobile: user.mobile,
        shopName: user.shopName,
        type: 'debit',
        amount: pkgPrice,
        service: `Package Purchase: ${targetPkg.name}`,
        balanceAfter: newBalance,
        timestamp: now.toISOString(),
        note: `Unlimited 4 Services Free till ${expiryDate.toLocaleDateString('en-IN')}`
      };

      db.transactions.unshift(txnRecord);
      writeDb(db);

      const pkgStatus = getUserPackageStatus(user);

      return sendJson(res, 200, {
        success: true,
        message: `🎉 Congratulations! ${targetPkg.name} activated successfully. All 4 services are now 100% Unlimited Free till ${expiryDate.toLocaleDateString('en-IN')}.`,
        user: {
          id: user.id,
          mobile: user.mobile,
          shopName: user.shopName,
          balance: user.balance,
          package: user.package,
          packageStatus: pkgStatus
        },
        packageStatus: pkgStatus
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 8. Submit PhonePe UPI Recharge Request (/api/wallet/request-recharge)
  // -------------------------------------------------------------
  if (pathname === '/api/wallet/request-recharge' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { userId, mobile, amount, utr, note } = body;

      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return sendJson(res, 400, { error: 'Valid recharge amount is required.' });
      }

      const cleanUtr = String(utr || '').trim().toUpperCase();
      if (!cleanUtr || cleanUtr.length < 8) {
        return sendJson(res, 400, { 
          error: 'PhonePe 12-Digit UTR / Ref Number zaroori hai. Payment receipt se dekh kar UTR number enter karein.' 
        });
      }

      const db = readDb();
      const user = db.users.find(u => (userId && u.id === userId) || (mobile && u.mobile === mobile));

      if (!user) {
        return sendJson(res, 404, { error: 'Retailer account not found. Please log in.' });
      }

      // Check if UTR is already used in previous requests
      if (!db.rechargeRequests) db.rechargeRequests = [];
      const existingUtr = db.rechargeRequests.find(r => r.utr && r.utr.toUpperCase() === cleanUtr && r.status !== 'rejected');
      if (existingUtr) {
        return sendJson(res, 400, { 
          error: `Yeh UTR Number (${cleanUtr}) pehle hi submit ho chuka hai (Status: ${existingUtr.status}). Kripya apna sahi payment receipt UTR enter karein.` 
        });
      }

      const reqId = 'REQ-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 10);
      const nowIso = new Date().toISOString();

      const newRequest = {
        id: reqId,
        userId: user.id,
        mobile: user.mobile,
        shopName: user.shopName,
        amount: numAmount,
        utr: cleanUtr,
        status: 'pending',
        timestamp: nowIso,
        note: note || 'PhonePe QR Payment by Retailer'
      };

      db.rechargeRequests.unshift(newRequest);
      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        status: 'pending',
        message: `⏳ Recharge Request Submitted! Amount: ₹${numAmount.toFixed(2)}, UTR: ${cleanUtr}. Admin PhonePe check karke balance add karenge.`,
        request: newRequest
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 9. Deduct Wallet Balance on Service Usage (/api/wallet/deduct)
  // -------------------------------------------------------------
  if (pathname === '/api/wallet/deduct' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { userId, mobile, serviceKey, serviceTitle, note } = body;

      const db = readDb();
      const user = db.users.find(u => (userId && u.id === userId) || (mobile && u.mobile === mobile));

      if (!user) {
        return sendJson(res, 404, { error: 'User account not found. Please log in again.' });
      }

      if (user.status === 'blocked') {
        return sendJson(res, 403, { error: 'Account is blocked. Contact administrator.' });
      }

      const serviceNames = {
        singlePrint: 'Single Print PVC',
        a4Document: 'A4 Document Studio',
        photoMaker: 'Photo Maker Studio',
        resumeMaker: 'Resume Maker',
        pdfEditor: 'Online PDF Editor Studio'
      };

      const pkgStatus = getUserPackageStatus(user);

      // UNLIMITED PACKAGE ACTIVE -> 100% FREE USAGE!
      if (pkgStatus.isActive) {
        const txnId = 'TXN-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 10);
        const expDateStr = new Date(pkgStatus.expiresAt).toLocaleDateString('en-IN');
        const txnRecord = {
          id: txnId,
          userId: user.id,
          mobile: user.mobile,
          shopName: user.shopName,
          type: 'free',
          amount: 0,
          service: serviceTitle || serviceNames[serviceKey] || serviceKey,
          balanceAfter: Number(user.balance || 0),
          timestamp: new Date().toISOString(),
          note: `Free Unlimited (${pkgStatus.name} Active till ${expDateStr})`
        };

        db.transactions.unshift(txnRecord);
        writeDb(db);

        return sendJson(res, 200, {
          success: true,
          isUnlimited: true,
          packageName: pkgStatus.name,
          packageExpiresAt: pkgStatus.expiresAt,
          daysRemaining: pkgStatus.daysRemaining,
          deductedAmount: 0,
          newBalance: Number(user.balance || 0),
          transactionId: txnId,
          message: `Free Unlimited Print under ${pkgStatus.name} (Valid till ${expDateStr})`
        });
      }

      // NORMAL PAY-PER-PRINT DEDUCTION
      const pricing = db.pricing || { singlePrint: 5, a4Document: 2, photoMaker: 3, resumeMaker: 5, pdfEditor: 3 };
      const chargeAmount = Number(pricing[serviceKey] !== undefined ? pricing[serviceKey] : (body.customAmount || 0));
      const currentBalance = Number(user.balance || 0);

      if (currentBalance < chargeAmount) {
        return sendJson(res, 402, {
          error: `Insufficient Wallet Balance! Required: ₹${chargeAmount.toFixed(2)}, Available: ₹${currentBalance.toFixed(2)}. Please recharge your wallet with PhonePe.`,
          availableBalance: currentBalance,
          requiredAmount: chargeAmount
        });
      }

      // Deduct balance
      const newBalance = Number((currentBalance - chargeAmount).toFixed(2));
      user.balance = newBalance;

      const txnId = 'TXN-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 10);
      const txnRecord = {
        id: txnId,
        userId: user.id,
        mobile: user.mobile,
        shopName: user.shopName,
        type: 'debit',
        amount: chargeAmount,
        service: serviceTitle || serviceNames[serviceKey] || serviceKey,
        balanceAfter: newBalance,
        timestamp: new Date().toISOString(),
        note: note || `Service Used: ${serviceNames[serviceKey] || serviceKey}`
      };

      db.transactions.unshift(txnRecord);
      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        isUnlimited: false,
        message: `₹${chargeAmount.toFixed(2)} deducted successfully.`,
        deductedAmount: chargeAmount,
        newBalance: newBalance,
        transactionId: txnId
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 10. Get User Transactions (/api/wallet/transactions)
  // -------------------------------------------------------------
  if (pathname === '/api/wallet/transactions' && req.method === 'GET') {
    const userId = parsedUrl.searchParams.get('userId');
    const mobile = parsedUrl.searchParams.get('mobile');

    const db = readDb();
    let txns = db.transactions || [];

    if (userId) {
      txns = txns.filter(t => t.userId === userId);
    } else if (mobile) {
      txns = txns.filter(t => t.mobile === mobile);
    }

    return sendJson(res, 200, {
      success: true,
      transactions: txns.slice(0, 50)
    });
  }

  // -------------------------------------------------------------
  // 10.1 Get User Recharge Requests & Status (/api/wallet/my-recharge-requests)
  // -------------------------------------------------------------
  if (pathname === '/api/wallet/my-recharge-requests' && req.method === 'GET') {
    const userId = parsedUrl.searchParams.get('userId');
    const mobile = parsedUrl.searchParams.get('mobile');
    const requestId = parsedUrl.searchParams.get('requestId');

    const db = readDb();
    let requests = db.rechargeRequests || [];

    if (requestId) {
      const single = requests.find(r => r.id === requestId);
      return sendJson(res, 200, { success: true, request: single || null });
    }

    if (userId) {
      requests = requests.filter(r => r.userId === userId);
    } else if (mobile) {
      requests = requests.filter(r => r.mobile === mobile);
    }

    return sendJson(res, 200, {
      success: true,
      requests: requests.slice(0, 30)
    });
  }

  // -------------------------------------------------------------
  // 11. Admin Login (/api/admin/login)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { pin } = body;

      const db = readDb();
      const masterPin = (db.adminConfig && db.adminConfig.adminPin) ? String(db.adminConfig.adminPin).trim() : '1234';

      if (String(pin).trim() !== masterPin) {
        return sendJson(res, 401, { error: 'Incorrect Admin Master PIN.' });
      }

      return sendJson(res, 200, {
        success: true,
        message: 'Admin authenticated successfully.',
        adminToken: 'JUSTCARD_ADMIN_AUTH_' + Date.now()
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 12. Admin Data Overview (/api/admin/data)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/data' && req.method === 'GET') {
    const db = readDb();
    const users = (db.users || []).map(u => ({
      id: u.id,
      mobile: u.mobile,
      shopName: u.shopName,
      balance: Number(u.balance || 0),
      status: u.status || 'active',
      pin: u.pin,
      createdAt: u.createdAt,
      package: u.package || null,
      packageStatus: getUserPackageStatus(u)
    }));

    const transactions = db.transactions || [];
    const pricing = db.pricing || { singlePrint: 5, a4Document: 2, photoMaker: 3, resumeMaker: 5 };
    const packages = db.packages || DEFAULT_PACKAGES;
    const rechargeRequests = db.rechargeRequests || [];

    const totalWalletBalance = users.reduce((sum, u) => sum + Number(u.balance || 0), 0);
    const totalDeductions = transactions.filter(t => t.type === 'debit').reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const activeSubscriptions = users.filter(u => getUserPackageStatus(u).isActive).length;
    const pendingRecharges = rechargeRequests.filter(r => r.status === 'pending').length;

    return sendJson(res, 200, {
      success: true,
      stats: {
        totalUsers: users.length,
        totalWalletBalance: Number(totalWalletBalance.toFixed(2)),
        totalDeductions: Number(totalDeductions.toFixed(2)),
        totalTransactions: transactions.length,
        activeSubscriptions: activeSubscriptions,
        pendingRecharges: pendingRecharges
      },
      pricing,
      packages,
      upiConfig: {
        upiId: (db.adminConfig && db.adminConfig.upiId) || DEFAULT_UPI_CONFIG.upiId,
        upiName: (db.adminConfig && db.adminConfig.upiName) || DEFAULT_UPI_CONFIG.upiName
      },
      users,
      rechargeRequests: rechargeRequests.slice(0, 50),
      transactions: transactions.slice(0, 100)
    });
  }

  // -------------------------------------------------------------
  // 13. Admin Approve / Reject Recharge Request (/api/admin/approve-recharge)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/approve-recharge' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { requestId, action, note } = body;

      const db = readDb();
      const request = (db.rechargeRequests || []).find(r => r.id === requestId);

      if (!request) {
        return sendJson(res, 404, { error: 'Recharge request not found.' });
      }

      if (request.status !== 'pending') {
        return sendJson(res, 400, { error: `This request is already ${request.status}.` });
      }

      const user = db.users.find(u => u.id === request.userId);
      if (!user) {
        return sendJson(res, 404, { error: 'Associated retailer account not found.' });
      }

      if (action === 'approve') {
        const currentBalance = Number(user.balance || 0);
        const newBalance = Number((currentBalance + request.amount).toFixed(2));
        user.balance = newBalance;
        request.status = 'approved';
        request.approvedAt = new Date().toISOString();

        const txnId = 'TXN-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 10);
        db.transactions.unshift({
          id: txnId,
          userId: user.id,
          mobile: user.mobile,
          shopName: user.shopName,
          type: 'credit',
          amount: request.amount,
          service: 'PhonePe UPI Recharge',
          balanceAfter: newBalance,
          timestamp: new Date().toISOString(),
          note: `UTR: ${request.utr} · Approved by Admin`
        });

        writeDb(db);

        return sendJson(res, 200, {
          success: true,
          message: `✅ ₹${request.amount.toFixed(2)} credited successfully to ${user.shopName} (${user.mobile})! New Balance: ₹${newBalance.toFixed(2)}.`,
          request,
          userBalance: newBalance
        });
      } else {
        request.status = 'rejected';
        request.rejectedAt = new Date().toISOString();
        request.rejectReason = note || 'UTR not verified in PhonePe';
        writeDb(db);

        return sendJson(res, 200, {
          success: true,
          message: `Recharge request ${request.id} has been rejected.`,
          request
        });
      }
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 14. Admin Update Per-Service Pricing (/api/admin/pricing)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/pricing' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { pricing } = body;

      if (!pricing) {
        return sendJson(res, 400, { error: 'Pricing payload missing.' });
      }

      const db = readDb();
      db.pricing = {
        singlePrint: Number(pricing.singlePrint !== undefined ? pricing.singlePrint : db.pricing.singlePrint || 5),
        a4Document: Number(pricing.a4Document !== undefined ? pricing.a4Document : db.pricing.a4Document || 2),
        photoMaker: Number(pricing.photoMaker !== undefined ? pricing.photoMaker : db.pricing.photoMaker || 3),
        resumeMaker: Number(pricing.resumeMaker !== undefined ? pricing.resumeMaker : db.pricing.resumeMaker || 5),
        pdfEditor: Number(pricing.pdfEditor !== undefined ? pricing.pdfEditor : db.pricing.pdfEditor || 3)
      };

      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        message: 'Service pricing updated successfully!',
        pricing: db.pricing
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 15. Admin Update Packages Pricing (/api/admin/packages)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/packages' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { packages } = body;

      if (!packages) {
        return sendJson(res, 400, { error: 'Packages payload missing.' });
      }

      const db = readDb();
      const current = db.packages || DEFAULT_PACKAGES;

      db.packages = {
        silver: {
          ...current.silver,
          price: Number(packages.silver !== undefined ? packages.silver : (current.silver ? current.silver.price : 299))
        },
        gold: {
          ...current.gold,
          price: Number(packages.gold !== undefined ? packages.gold : (current.gold ? current.gold.price : 699))
        },
        platinum: {
          ...current.platinum,
          price: Number(packages.platinum !== undefined ? packages.platinum : (current.platinum ? current.platinum.price : 1199))
        },
        diamond: {
          ...current.diamond,
          price: Number(packages.diamond !== undefined ? packages.diamond : (current.diamond ? current.diamond.price : 1999))
        }
      };

      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        message: 'Subscription packages pricing updated successfully!',
        packages: db.packages
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 16. Admin Update UPI Config (/api/admin/upi-config)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/upi-config' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { upiId, upiName } = body;

      const db = readDb();
      if (!db.adminConfig) db.adminConfig = {};
      if (upiId) db.adminConfig.upiId = String(upiId).trim();
      if (upiName) db.adminConfig.upiName = String(upiName).trim();
      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        message: 'PhonePe UPI details updated successfully!',
        upiConfig: {
          upiId: db.adminConfig.upiId,
          upiName: db.adminConfig.upiName
        }
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 17. Admin Assign / Extend Package to Retailer (/api/admin/assign-package)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/assign-package' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { userId, packageKey, customDays, note } = body;

      const db = readDb();
      const user = db.users.find(u => u.id === userId);

      if (!user) {
        return sendJson(res, 404, { error: 'Retailer not found.' });
      }

      if (packageKey === 'none' || packageKey === 'remove') {
        user.package = null;
        writeDb(db);
        return sendJson(res, 200, {
          success: true,
          message: `Package removed for ${user.shopName}. User is now on Pay-Per-Print.`
        });
      }

      const packages = db.packages || DEFAULT_PACKAGES;
      const targetPkg = packages[packageKey];
      const now = new Date();
      let startDate = now;

      if (user.package && user.package.expiresAt && new Date(user.package.expiresAt) > now) {
        startDate = new Date(user.package.expiresAt);
      }

      const expiryDate = new Date(startDate.getTime());
      if (customDays && Number(customDays) > 0) {
        expiryDate.setDate(expiryDate.getDate() + Number(customDays));
      } else if (targetPkg) {
        expiryDate.setMonth(expiryDate.getMonth() + (targetPkg.months || 1));
      } else {
        expiryDate.setMonth(expiryDate.getMonth() + 1);
      }

      const pkgName = targetPkg ? targetPkg.name : (customDays ? `${customDays} Days Custom Plan` : 'Special Plan');

      user.package = {
        key: targetPkg ? targetPkg.key : 'custom',
        name: pkgName,
        activatedAt: now.toISOString(),
        expiresAt: expiryDate.toISOString()
      };

      const txnId = 'TXN-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 10);
      db.transactions.unshift({
        id: txnId,
        userId: user.id,
        mobile: user.mobile,
        shopName: user.shopName,
        type: 'credit',
        amount: 0,
        service: `Admin Package Activation: ${pkgName}`,
        balanceAfter: Number(user.balance || 0),
        timestamp: now.toISOString(),
        note: note || `Admin Activated ${pkgName} till ${expiryDate.toLocaleDateString('en-IN')}`
      });

      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        message: `✅ ${pkgName} successfully assigned to ${user.shopName} (${user.mobile})! Valid till ${expiryDate.toLocaleDateString('en-IN')}.`,
        user: {
          id: user.id,
          mobile: user.mobile,
          shopName: user.shopName,
          package: user.package,
          packageStatus: getUserPackageStatus(user)
        }
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 18. Admin Direct Recharge / Balance Adjust (/api/admin/recharge)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/recharge' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { userId, amount, type, note } = body;

      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return sendJson(res, 400, { error: 'Valid amount is required.' });
      }

      const db = readDb();
      const user = db.users.find(u => u.id === userId);

      if (!user) {
        return sendJson(res, 404, { error: 'Retailer not found.' });
      }

      const currentBalance = Number(user.balance || 0);
      let newBalance = currentBalance;

      if (type === 'debit') {
        newBalance = Math.max(0, currentBalance - numAmount);
      } else {
        newBalance = currentBalance + numAmount;
      }
      newBalance = Number(newBalance.toFixed(2));
      user.balance = newBalance;

      const txnId = 'TXN-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 10);
      db.transactions.unshift({
        id: txnId,
        userId: user.id,
        mobile: user.mobile,
        shopName: user.shopName,
        type: type || 'credit',
        amount: numAmount,
        service: type === 'debit' ? 'Admin Balance Adjustment' : 'Wallet Recharge (Admin)',
        balanceAfter: newBalance,
        timestamp: new Date().toISOString(),
        note: note || (type === 'debit' ? 'Admin Deducted Balance' : 'Admin Wallet Top-Up')
      });

      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        message: `Wallet ${type === 'debit' ? 'deducted' : 'recharged'} with ₹${numAmount.toFixed(2)}. New Balance: ₹${newBalance.toFixed(2)}`,
        user: {
          id: user.id,
          mobile: user.mobile,
          shopName: user.shopName,
          balance: newBalance
        }
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 19. Admin Change Master PIN (/api/admin/change-pin)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/change-pin' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { newPin } = body;

      if (!newPin || String(newPin).trim().length < 4) {
        return sendJson(res, 400, { error: 'PIN must be at least 4 digits.' });
      }

      const db = readDb();
      if (!db.adminConfig) db.adminConfig = {};
      db.adminConfig.adminPin = String(newPin).trim();
      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        message: 'Admin Master PIN updated successfully!'
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 19.1 Admin Add / Restore Retailer (/api/admin/add-user)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/add-user' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { mobile, shopName, pin, balance, packageKey } = body;

      const cleanMobile = String(mobile || '').trim();
      const cleanShop = String(shopName || '').trim();
      const cleanPin = String(pin || '1234').trim();
      const numBalance = Number(balance || 0);

      if (!cleanMobile || cleanMobile.length < 10) {
        return sendJson(res, 400, { error: 'Valid 10-digit mobile number is required.' });
      }
      if (!cleanShop) {
        return sendJson(res, 400, { error: 'Shop Name is required.' });
      }

      const db = readDb();
      if (!db.users) db.users = [];

      const existingIndex = db.users.findIndex(u => u.mobile === cleanMobile);
      let targetUser;

      if (existingIndex >= 0) {
        targetUser = db.users[existingIndex];
        targetUser.shopName = cleanShop;
        targetUser.pin = cleanPin;
        targetUser.balance = numBalance;
        targetUser.status = 'active';
      } else {
        const newUserId = 'USR-' + (1000 + db.users.length + 1);
        targetUser = {
          id: newUserId,
          mobile: cleanMobile,
          shopName: cleanShop,
          pin: cleanPin,
          balance: numBalance,
          createdAt: new Date().toISOString(),
          status: 'active',
          package: null
        };
        db.users.push(targetUser);
      }

      if (packageKey && packageKey !== 'none') {
        const packages = db.packages || DEFAULT_PACKAGES;
        const targetPkg = packages[packageKey];
        if (targetPkg) {
          const now = new Date();
          const expiryDate = new Date(now.getTime());
          expiryDate.setMonth(expiryDate.getMonth() + (targetPkg.months || 1));
          targetUser.package = {
            key: targetPkg.key || packageKey,
            name: targetPkg.name,
            activatedAt: now.toISOString(),
            expiresAt: expiryDate.toISOString()
          };
        }
      }

      if (numBalance > 0) {
        db.transactions.unshift({
          id: 'TXN-' + Date.now().toString().slice(-6),
          userId: targetUser.id,
          mobile: cleanMobile,
          shopName: cleanShop,
          type: 'credit',
          amount: numBalance,
          service: 'Admin Account Setup',
          balanceAfter: numBalance,
          timestamp: new Date().toISOString(),
          note: 'Account Created / Restored by Admin'
        });
      }

      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        message: `✅ Retailer "${cleanShop}" (${cleanMobile}) successfully saved!`,
        user: targetUser
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 20. Admin Toggle User Status (/api/admin/toggle-user)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/toggle-user' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { userId, status } = body;

      const db = readDb();
      const user = db.users.find(u => u.id === userId);

      if (!user) {
        return sendJson(res, 404, { error: 'Retailer not found.' });
      }

      user.status = status === 'blocked' ? 'blocked' : 'active';
      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        message: `Retailer status updated to ${user.status}`,
        user: { id: user.id, status: user.status }
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 21. Admin Reset Retailer PIN (/api/admin/reset-user-pin)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/reset-user-pin' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { userId, newPin } = body;

      if (!userId || !newPin || String(newPin).trim().length < 4) {
        return sendJson(res, 400, { error: 'Valid Retailer ID and at least 4-digit PIN required.' });
      }

      const db = readDb();
      const user = db.users.find(u => u.id === userId);

      if (!user) {
        return sendJson(res, 404, { error: 'Retailer not found.' });
      }

      user.pin = String(newPin).trim();
      writeDb(db);

      return sendJson(res, 200, {
        success: true,
        message: `PIN for ${user.shopName} (${user.mobile}) has been successfully reset to ${user.pin}`,
        user: {
          id: user.id,
          mobile: user.mobile,
          shopName: user.shopName,
          pin: user.pin
        }
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 21.1 Admin Delete Retailer (/api/admin/delete-user)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/delete-user' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { userId, mobile } = body;

      if (!userId && !mobile) {
        return sendJson(res, 400, { error: 'Retailer ID or Mobile is required.' });
      }

      const db = readDb();
      const userIndex = db.users.findIndex(u => (userId && u.id === userId) || (mobile && u.mobile === mobile));

      if (userIndex === -1) {
        return sendJson(res, 404, { error: 'Retailer not found.' });
      }

      const deletedUser = db.users.splice(userIndex, 1)[0];

      // Update memory cache and write directly to all vault files
      cachedDb = db;
      const jsonStr = JSON.stringify(db, null, 2);
      fs.writeFileSync(DB_FILE, jsonStr, 'utf8');
      fs.writeFileSync(MASTER_BACKUP_FILE, jsonStr, 'utf8');
      fs.writeFileSync(BACKUP_FILE, jsonStr, 'utf8');

      return sendJson(res, 200, {
        success: true,
        message: `✅ Retailer "${deletedUser.shopName}" (${deletedUser.mobile}) successfully deleted!`,
        deletedUser
      });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 22. Admin Get Recharge Requests (/api/admin/recharge-requests)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/recharge-requests' && req.method === 'GET') {
    const db = readDb();
    const requests = db.rechargeRequests || [];
    return sendJson(res, 200, {
      success: true,
      rechargeRequests: requests
    });
  }

  // -------------------------------------------------------------
  // 23. Admin Approve / Reject Recharge (/api/admin/approve-recharge)
  // -------------------------------------------------------------
  if (pathname === '/api/admin/approve-recharge' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { requestId, action, note } = body; // action: 'approve' | 'reject'

      if (!requestId || !action) {
        return sendJson(res, 400, { error: 'Request ID and action (approve/reject) are required.' });
      }

      const db = readDb();
      if (!db.rechargeRequests) db.rechargeRequests = [];
      const reqItem = db.rechargeRequests.find(r => r.id === requestId);

      if (!reqItem) {
        return sendJson(res, 404, { error: 'Recharge request not found.' });
      }

      if (reqItem.status === 'approved' && action === 'approve') {
        return sendJson(res, 400, { error: 'This recharge request has already been approved.' });
      }

      const user = db.users.find(u => u.id === reqItem.userId || u.mobile === reqItem.mobile);

      if (action === 'approve') {
        if (!user) {
          return sendJson(res, 404, { error: 'Associated retailer account not found.' });
        }

        const addAmount = Number(reqItem.amount || 0);
        const currentBalance = Number(user.balance || 0);
        const newBalance = Number((currentBalance + addAmount).toFixed(2));
        user.balance = newBalance;

        const txnId = 'TXN-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 10);
        const nowIso = new Date().toISOString();

        db.transactions.unshift({
          id: txnId,
          userId: user.id,
          mobile: user.mobile,
          shopName: user.shopName,
          type: 'credit',
          amount: addAmount,
          service: 'PhonePe QR Recharge Approved',
          balanceAfter: newBalance,
          timestamp: nowIso,
          note: `UTR: ${reqItem.utr || 'N/A'}${note ? ' - ' + note : ''}`
        });

        reqItem.status = 'approved';
        reqItem.approvedAt = nowIso;
        reqItem.adminNote = note || 'Approved by Admin';
        reqItem.txnId = txnId;

        writeDb(db);

        return sendJson(res, 200, {
          success: true,
          message: `✅ Recharge of ₹${addAmount.toFixed(2)} successfully APPROVED for ${user.shopName} (${user.mobile})! New Balance: ₹${newBalance.toFixed(2)}`,
          request: reqItem,
          user: {
            id: user.id,
            mobile: user.mobile,
            shopName: user.shopName,
            balance: newBalance
          }
        });
      } else if (action === 'reject') {
        reqItem.status = 'rejected';
        reqItem.rejectedAt = new Date().toISOString();
        reqItem.adminNote = note || 'Rejected by Admin (Invalid UTR/Payment)';

        writeDb(db);

        return sendJson(res, 200, {
          success: true,
          message: `Recharge request ${requestId} marked as REJECTED.`,
          request: reqItem
        });
      } else {
        return sendJson(res, 400, { error: 'Invalid action. Must be approve or reject.' });
      }
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  // -------------------------------------------------------------
  // 22. Static File Server
  // -------------------------------------------------------------
  let reqUrl = pathname;
  if (reqUrl === '/' || reqUrl === '' || reqUrl === '/home' || reqUrl === '/home.html') {
    reqUrl = '/index.html';
  }

  let filePath = path.join(__dirname, reqUrl);

  // Directory handling
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    // SPA fallback
    filePath = path.join(__dirname, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server Error: ' + err.code);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Justcard Portal & PhonePe Wallet Engine running at http://localhost:${PORT}/`);
});
