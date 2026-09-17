/**
 * Justcard Universal Wallet, Subscription & Auth Client
 * Automatically integrates Retailer Login, Self-Registration, Subscription Packages,
 * Live Header Wallet Badge, Passbook History, and Unlimited Free Service Charge Interception.
 */

(function () {
  const STORAGE_KEY = 'justcard_user_session';
  const API_BASE = (window.location.protocol === 'file:' || !window.location.origin || window.location.origin === 'null') ? 'http://localhost:3000' : '';
  let currentUser = null;
  let currentPricing = { singlePrint: 5, a4Document: 2, photoMaker: 3, resumeMaker: 5 };
  let currentPackages = {
    silver: { key: 'silver', name: 'Silver Plan', durationText: '1 Month', months: 1, price: 299 },
    gold: { key: 'gold', name: 'Gold Plan', durationText: '3 Months', months: 3, price: 699 },
    platinum: { key: 'platinum', name: 'Platinum Plan', durationText: '6 Months', months: 6, price: 1199 },
    diamond: { key: 'diamond', name: 'Diamond Plan', durationText: '1 Year (12 Months)', months: 12, price: 1999 }
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) currentUser = JSON.parse(raw);
  } catch (e) {
    console.warn('Session parse error:', e);
  }

  // Load latest pricing & packages
  async function fetchPricing() {
    try {
      const res = await fetch(`${API_BASE}/api/pricing`);
      const data = await res.json();
      if (data) {
        if (data.pricing) currentPricing = data.pricing;
        if (data.packages) currentPackages = data.packages;
      }
    } catch (e) {
      console.warn('Pricing fetch error:', e);
    }
  }

  function notifyAuthChange() {
    window.dispatchEvent(new CustomEvent('justcard:auth-change', { detail: { user: currentUser } }));
  }

  // Refresh user balance & package status from server
  async function syncUserBalance() {
    if (!currentUser || !currentUser.id) return;
    try {
      const res = await fetch(`${API_BASE}/api/auth/me?userId=${encodeURIComponent(currentUser.id)}`);
      const data = await res.json();
      if (data && data.user) {
        currentUser = Object.assign({}, currentUser, data.user);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
        updateHeaderWalletUI();
        notifyAuthChange();
      }
    } catch (e) {
      console.warn('User sync error:', e);
    }
  }

  // Inject Wallet CSS
  function injectStyles() {
    if (document.getElementById('justcard-wallet-styles')) return;
    const style = document.createElement('style');
    style.id = 'justcard-wallet-styles';
    style.textContent = `
      /* Justcard Universal Wallet & Auth Styles */
      .jc-wallet-badge {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: #ffffff;
        border: 1.5px solid #ede9fe;
        border-radius: 30px;
        padding: 5px 14px;
        cursor: pointer;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        font-size: 12.5px;
        font-weight: 750;
        color: #0f172a;
        box-shadow: 0 2px 8px rgba(124, 58, 237, 0.08);
        transition: all 0.2s ease;
        user-select: none;
      }
      .jc-wallet-badge:hover {
        border-color: #c084fc;
        box-shadow: 0 4px 14px rgba(124, 58, 237, 0.16);
        transform: translateY(-1px);
        background: #faf5ff;
      }
      .jc-wallet-badge .jc-icon {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
        color: #fff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
      }
      .jc-wallet-badge .jc-amt {
        color: #059669;
        font-weight: 800;
        font-size: 13.5px;
      }
      .jc-wallet-badge .jc-plan-pill {
        background: #f3e8ff;
        color: #7e22ce;
        border: 1px solid #d8b4fe;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 10.5px;
        font-weight: 800;
      }
      .jc-wallet-badge.login-prompt {
        background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
        color: #ffffff;
        border: none;
        box-shadow: 0 3px 12px rgba(124, 58, 237, 0.3);
      }
      .jc-wallet-badge.login-prompt:hover {
        box-shadow: 0 6px 18px rgba(124, 58, 237, 0.45);
        background: linear-gradient(135deg, #9333ea 0%, #6d28d9 100%);
      }
      .jc-wallet-badge.login-prompt .jc-icon {
        background: rgba(255, 255, 255, 0.25);
      }

      /* Modal Backdrop & Container */
      .jc-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.65);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 999999;
        padding: 16px;
        animation: jcFadeIn 0.2s ease;
      }
      @keyframes jcFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .jc-modal-card {
        background: #ffffff;
        border-radius: 20px;
        width: 100%;
        max-width: 520px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 20px 45px rgba(15, 23, 42, 0.25);
        border: 1.5px solid #ede9fe;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        color: #0f172a;
        animation: jcPopUp 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      }
      @keyframes jcPopUp {
        from { transform: scale(0.95); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      .jc-modal-header {
        padding: 18px 22px;
        border-bottom: 1px solid #f1f5f9;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .jc-modal-title {
        font-family: 'Outfit', sans-serif;
        font-size: 19px;
        font-weight: 800;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .jc-modal-close {
        background: #f1f5f9;
        border: none;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        color: #64748b;
        transition: all 0.15s;
      }
      .jc-modal-close:hover { background: #fee2e2; color: #dc2626; }
      .jc-modal-body { padding: 20px 22px; }

      /* Form controls */
      .jc-form-group { margin-bottom: 14px; }
      .jc-form-group label {
        display: block;
        font-size: 12px;
        font-weight: 750;
        color: #334155;
        margin-bottom: 6px;
      }
      .jc-input {
        width: 100%;
        background: #ffffff;
        border: 1.5px solid #e2e8f0;
        border-radius: 9px;
        padding: 10px 12px;
        font-family: inherit;
        font-size: 13.5px;
        color: #0f172a;
        box-sizing: border-box;
        outline: none;
        transition: all 0.15s;
      }
      .jc-input:focus {
        border-color: #7c3aed;
        box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.14);
      }

      .jc-btn-submit {
        width: 100%;
        padding: 11px 16px;
        border-radius: 9px;
        background: linear-gradient(135deg, #a855f7 0%, #7c3aed 50%, #6366f1 100%);
        color: #ffffff;
        border: none;
        font-family: inherit;
        font-size: 14px;
        font-weight: 800;
        cursor: pointer;
        transition: all 0.2s;
        margin-top: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        box-shadow: 0 4px 14px rgba(124, 58, 237, 0.3);
      }
      .jc-btn-submit:hover {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(124, 58, 237, 0.45);
      }

      /* Package Card Styles inside modal */
      .jc-pkg-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin: 12px 0;
      }
      .jc-pkg-item {
        background: #ffffff;
        border: 1.5px solid #ede9fe;
        border-radius: 12px;
        padding: 12px 10px;
        text-align: center;
        position: relative;
        transition: all 0.2s;
      }
      .jc-pkg-item:hover {
        border-color: #7c3aed;
        transform: translateY(-2px);
        box-shadow: 0 4px 14px rgba(124, 58, 237, 0.12);
      }
      .jc-pkg-item.diamond {
        border-color: #c084fc;
        background: linear-gradient(180deg, #faf5ff 0%, #ffffff 100%);
      }
      .jc-pkg-badge {
        position: absolute;
        top: -8px;
        right: 8px;
        background: #7c3aed;
        color: #fff;
        font-size: 9px;
        font-weight: 800;
        padding: 1px 6px;
        border-radius: 10px;
      }
      .jc-pkg-name { font-weight: 800; font-size: 13px; color: #0f172a; }
      .jc-pkg-dur { font-size: 11px; color: #64748b; margin-bottom: 4px; }
      .jc-pkg-price { font-family: 'Outfit', sans-serif; font-size: 20px; font-weight: 900; color: #7c3aed; }
      .jc-pkg-btn {
        margin-top: 6px;
        background: #f3e8ff;
        color: #7e22ce;
        border: 1px solid #d8b4fe;
        padding: 5px 8px;
        border-radius: 6px;
        font-size: 11.5px;
        font-weight: 800;
        width: 100%;
        cursor: pointer;
        transition: all 0.15s;
      }
      .jc-pkg-btn:hover { background: #7c3aed; color: #fff; }

      .jc-toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #0f172a;
        color: #f8fafc;
        padding: 10px 20px;
        border-radius: 10px;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        font-size: 13px;
        font-weight: 750;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        border: 1px solid rgba(255,255,255,0.1);
        z-index: 9999999;
        display: flex;
        align-items: center;
        gap: 8px;
        animation: jcFadeUp 0.3s ease;
      }
      @keyframes jcFadeUp {
        from { transform: translate(-50%, 15px); opacity: 0; }
        to { transform: translate(-50%, 0); opacity: 1; }
      }
      .jc-toast.success { background: #064e3b; color: #ecfdf5; border-color: #059669; }
      .jc-toast.error { background: #7f1d1d; color: #fef2f2; border-color: #dc2626; }

      /* PhonePe Recharge Modal Styles */
      .jc-recharge-chip {
        border: 1.5px solid #ede9fe;
        background: #f8fafc;
        border-radius: 8px;
        padding: 6px 12px;
        font-weight: 800;
        font-size: 12.5px;
        color: #475569;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .jc-recharge-chip:hover, .jc-recharge-chip.active {
        border-color: #5f259f;
        background: #f3e8ff;
        color: #5f259f;
      }
      .jc-phonepe-header {
        background: linear-gradient(135deg, #5f259f 0%, #3f1073 100%);
        color: #ffffff;
        padding: 16px 20px;
        border-radius: 14px 14px 0 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .jc-qr-wrapper {
        background: #ffffff;
        border: 2px solid #ede9fe;
        border-radius: 14px;
        padding: 12px;
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        box-shadow: 0 4px 15px rgba(95, 37, 159, 0.08);
      }
      .jc-upi-copy-box {
        background: #faf5ff;
        border: 1.5px dashed #c084fc;
        border-radius: 8px;
        padding: 8px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 12px;
        font-weight: 750;
        color: #5f259f;
        margin: 10px 0;
      }
    `;
    document.head.appendChild(style);
  }

  function showToast(msg, type = 'info') {
    const existing = document.querySelector('.jc-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `jc-toast ${type}`;
    let icon = '<i class="fa-solid fa-circle-info"></i>';
    if (type === 'success') icon = '<i class="fa-solid fa-circle-check"></i>';
    if (type === 'error') icon = '<i class="fa-solid fa-triangle-exclamation"></i>';

    toast.innerHTML = `${icon} <span>${msg}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  // Update UI in Navbars
  function updateHeaderWalletUI() {
    const containers = document.querySelectorAll('.jc-wallet-container');
    containers.forEach(container => {
      container.innerHTML = '';
      const badge = document.createElement('div');

      if (!currentUser) {
        badge.className = 'jc-wallet-badge login-prompt';
        badge.innerHTML = `
          <span class="jc-icon"><i class="fa-solid fa-user"></i></span>
          <span>Login / Register</span>
        `;
        badge.onclick = () => openAuthModal();
      } else {
        badge.className = 'jc-wallet-badge';
        const bal = Number(currentUser.balance || 0).toFixed(2);
        const pkg = currentUser.packageStatus || (currentUser.package && new Date(currentUser.package.expiresAt) > new Date() ? currentUser.package : null);
        const planPill = pkg && pkg.isActive !== false ? `<span class="jc-plan-pill"><i class="fa-solid fa-crown"></i> ${pkg.name || 'Unlimited'}</span>` : '';

        badge.innerHTML = `
          <span class="jc-icon"><i class="fa-solid fa-wallet"></i></span>
          <span>Wallet: <b class="jc-amt">₹${bal}</b></span>
          ${planPill}
        `;
        badge.title = `${currentUser.shopName} (${currentUser.mobile}) - Click for Wallet & Plans`;
        badge.onclick = () => openWalletDashboardModal();
      }

      container.appendChild(badge);
    });
  }

  // Auth Modal (Login / Self Register)
  function openAuthModal(defaultTab = 'login', onComplete = null) {
    const existing = document.getElementById('jc-auth-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'jc-modal-overlay';
    overlay.id = 'jc-auth-modal';

    const isReg = defaultTab === 'register';

    overlay.innerHTML = `
      <div class="jc-modal-card">
        <div class="jc-modal-header">
          <div class="jc-modal-title">
            <i class="fa-solid fa-store" style="color:#7c3aed;"></i>
            <span>Cyber Cafe / CSC Retailer Access</span>
          </div>
          <button type="button" class="jc-modal-close" onclick="document.getElementById('jc-auth-modal').remove()">✕</button>
        </div>

        <div class="jc-modal-body">
          <div class="jc-auth-tabs" style="display:flex;background:#f1f5f9;padding:4px;border-radius:10px;margin-bottom:18px;gap:4px;">
            <button type="button" class="jc-auth-tab ${!isReg ? 'active' : ''}" id="jcTabLoginBtn" style="flex:1;border:none;background:${!isReg ? '#fff' : 'transparent'};padding:8px 12px;border-radius:8px;font-size:13px;font-weight:750;cursor:pointer;color:${!isReg ? '#7c3aed' : '#64748b'};box-shadow:${!isReg ? '0 2px 6px rgba(0,0,0,0.06)' : 'none'};">
              <i class="fa-solid fa-right-to-bracket"></i> Login Account
            </button>
            <button type="button" class="jc-auth-tab ${isReg ? 'active' : ''}" id="jcTabRegBtn" style="flex:1;border:none;background:${isReg ? '#fff' : 'transparent'};padding:8px 12px;border-radius:8px;font-size:13px;font-weight:750;cursor:pointer;color:${isReg ? '#7c3aed' : '#64748b'};box-shadow:${isReg ? '0 2px 6px rgba(0,0,0,0.06)' : 'none'};">
              <i class="fa-solid fa-user-plus"></i> New Register
            </button>
          </div>

          <!-- Login Form -->
          <form id="jcLoginForm" style="display:${!isReg ? 'block' : 'none'};">
            <div class="jc-form-group">
              <label><i class="fa-solid fa-phone"></i> Registered Mobile Number</label>
              <input type="tel" class="jc-input" id="jcLoginMobile" placeholder="10-digit Mobile (e.g. 9999999999)" maxlength="10" required>
            </div>
            <div class="jc-form-group">
              <label><i class="fa-solid fa-lock"></i> 4-Digit Security PIN</label>
              <input type="password" class="jc-input" id="jcLoginPin" placeholder="Enter 4-digit PIN" maxlength="6" required>
            </div>
            <button type="submit" class="jc-btn-submit">
              <i class="fa-solid fa-arrow-right-to-bracket"></i> Login to Workspace
            </button>
            <p style="font-size:11.5px;color:#64748b;text-align:center;margin-top:12px;">
              New Cyber Cafe / CSC Shop? <a href="javascript:void(0)" id="jcSwitchToReg" style="color:#7c3aed;font-weight:750;text-decoration:none;">Create Free Account</a>
            </p>
          </form>

          <!-- Register Form -->
          <form id="jcRegForm" style="display:${isReg ? 'block' : 'none'};">
            <div class="jc-form-group">
              <label><i class="fa-solid fa-store"></i> Cyber Cafe / Shop / VLE Name</label>
              <input type="text" class="jc-input" id="jcRegShop" placeholder="e.g. Sharma Digital Seva Kendra" required>
            </div>
            <div class="jc-form-group">
              <label><i class="fa-solid fa-phone"></i> Mobile Number (Username)</label>
              <input type="tel" class="jc-input" id="jcRegMobile" placeholder="10-digit Mobile Number" maxlength="10" required>
            </div>
            <div class="jc-form-group">
              <label><i class="fa-solid fa-lock"></i> Set 4-Digit PIN</label>
              <input type="password" class="jc-input" id="jcRegPin" placeholder="Choose 4-digit PIN (e.g. 1234)" maxlength="6" required>
            </div>
            <div style="background:#f5f3ff;border:1px dashed #d8b4fe;padding:8px 12px;border-radius:8px;font-size:11.5px;color:#6b21a8;margin-top:8px;">
              🎁 <b>Welcome Bonus:</b> ₹10.00 Demo balance automatically credited on new signup!
            </div>
            <button type="submit" class="jc-btn-submit">
              <i class="fa-solid fa-user-plus"></i> Create Account &amp; Start
            </button>
            <p style="font-size:11.5px;color:#64748b;text-align:center;margin-top:12px;">
              Already have an account? <a href="javascript:void(0)" id="jcSwitchToLogin" style="color:#7c3aed;font-weight:750;text-decoration:none;">Login Here</a>
            </p>
          </form>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const tabLoginBtn = document.getElementById('jcTabLoginBtn');
    const tabRegBtn = document.getElementById('jcTabRegBtn');
    const loginForm = document.getElementById('jcLoginForm');
    const regForm = document.getElementById('jcRegForm');

    function switchToLogin() {
      tabLoginBtn.style.background = '#fff'; tabLoginBtn.style.color = '#7c3aed'; tabLoginBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
      tabRegBtn.style.background = 'transparent'; tabRegBtn.style.color = '#64748b'; tabRegBtn.style.boxShadow = 'none';
      loginForm.style.display = 'block'; regForm.style.display = 'none';
    }

    function switchToReg() {
      tabRegBtn.style.background = '#fff'; tabRegBtn.style.color = '#7c3aed'; tabRegBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)';
      tabLoginBtn.style.background = 'transparent'; tabLoginBtn.style.color = '#64748b'; tabLoginBtn.style.boxShadow = 'none';
      regForm.style.display = 'block'; loginForm.style.display = 'none';
    }

    tabLoginBtn.onclick = switchToLogin;
    tabRegBtn.onclick = switchToReg;
    document.getElementById('jcSwitchToReg').onclick = switchToReg;
    document.getElementById('jcSwitchToLogin').onclick = switchToLogin;

    loginForm.onsubmit = async (e) => {
      e.preventDefault();
      const mobile = document.getElementById('jcLoginMobile').value.trim();
      const pin = document.getElementById('jcLoginPin').value.trim();

      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mobile, pin })
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Login failed', 'error');
          return;
        }

        currentUser = data.user;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
        updateHeaderWalletUI();
        notifyAuthChange();
        overlay.remove();
        showToast(`Welcome back, ${currentUser.shopName}!`, 'success');
        if (typeof onComplete === 'function') onComplete();
      } catch (err) {
        showToast('Server connection failed.', 'error');
      }
    };

    regForm.onsubmit = async (e) => {
      e.preventDefault();
      const shopName = document.getElementById('jcRegShop').value.trim();
      const mobile = document.getElementById('jcRegMobile').value.trim();
      const pin = document.getElementById('jcRegPin').value.trim();

      try {
        const res = await fetch(`${API_BASE}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shopName, mobile, pin })
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Registration failed', 'error');
          return;
        }

        currentUser = data.user;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
        updateHeaderWalletUI();
        notifyAuthChange();
        overlay.remove();
        showToast(`Account created successfully! Welcome ${currentUser.shopName}`, 'success');
        if (typeof onComplete === 'function') onComplete();
      } catch (err) {
        showToast('Server connection failed.', 'error');
      }
    };
  }

  // Buy Package API Handler
  async function buyPackage(packageKey) {
    if (!currentUser) return openAuthModal('login', () => buyPackage(packageKey));

    await fetchPricing();
    const pkg = currentPackages[packageKey];
    if (!pkg) return showToast('Invalid package selected.', 'error');

    if (!confirm(`Are you sure you want to activate ${pkg.name} (${pkg.durationText}) for ₹${pkg.price}? Amount will be deducted from your wallet balance.`)) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/package/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          mobile: currentUser.mobile,
          packageKey: packageKey
        })
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 402) {
          openInsufficientBalanceModal(data.requiredAmount || pkg.price, data.availableBalance || currentUser.balance);
        } else {
          showToast(data.error || 'Package purchase failed', 'error');
        }
        return;
      }

      currentUser = Object.assign({}, currentUser, data.user);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
      updateHeaderWalletUI();
      notifyAuthChange();

      // Refresh open dashboard modal if any
      const dashModal = document.getElementById('jc-wallet-dash-modal');
      if (dashModal) dashModal.remove();
      openWalletDashboardModal();

      showToast(data.message || `${pkg.name} activated successfully!`, 'success');
    } catch (e) {
      showToast('Server error while purchasing package.', 'error');
    }
  }

  // Play Pleasant Success Chime
  function playSuccessTone() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.12); // E5
      osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.24); // G5
      osc.frequency.setValueAtTime(1046.50, ctx.currentTime + 0.36); // C6
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.7);
    } catch (e) {}
  }

  // PhonePe UPI Recharge Modal with Step-1 (Select Amount) -> Step-2 (Scan QR) Flow
  function openPhonePeRechargeModal(initialAmt = '') {
    if (!currentUser) return openAuthModal();

    const existing = document.getElementById('jc-phonepe-recharge-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'jc-modal-overlay';
    overlay.id = 'jc-phonepe-recharge-modal';

    const upiId = 'Q021541804@ybl';
    const upiName = 'Justcomes';
    let currentRechargeAmt = initialAmt ? Number(initialAmt) : 0;
    const initialBalance = Number(currentUser.balance || 0);

    let timerInterval = null;
    let pollInterval = null;
    let timeLeft = 300; // 5:00 minutes countdown

    function getQrUrl(amt) {
      const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amt}&cu=INR&tn=${encodeURIComponent('JustcardWallet_' + (currentUser ? currentUser.mobile : 'Recharge'))}`;
      return {
        qr: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiUri)}`,
        uri: upiUri
      };
    }

    function renderModalContent() {
      overlay.innerHTML = `
        <div class="jc-modal-card" style="max-width: 480px; max-height: 92vh; overflow-y: auto;">
          <!-- PhonePe Brand Header -->
          <div class="jc-phonepe-header" style="position:sticky;top:0;z-index:10;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:34px;height:34px;background:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#5f259f;font-weight:900;font-size:18px;">
                पे
              </div>
              <div>
                <div style="font-weight:800;font-size:16px;font-family:'Outfit',sans-serif;letter-spacing:0.3px;">PhonePe Instant Recharge</div>
                <div style="font-size:11px;opacity:0.85;">Merchant: <b>${upiName}</b></div>
              </div>
            </div>
            <button type="button" class="jc-modal-close" id="jcCloseRechargeModalBtn" style="background:rgba(255,255,255,0.2);color:#fff;">✕</button>
          </div>

          <div class="jc-modal-body" id="jcRechargeModalBody" style="padding:18px 20px;">
            <!-- Step 1 View: Enter Amount -->
            <div id="jcStep1AmountView">
              <div style="text-align:center;margin-bottom:16px;">
                <div style="font-size:12px;font-weight:800;color:#5f259f;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">
                  Step 1: Enter / Select Amount
                </div>
                <h3 style="font-family:'Outfit',sans-serif;font-size:18px;font-weight:800;color:#0f172a;margin:0;">
                  Kitna Balance Add Karna Hai?
                </h3>
              </div>

              <!-- Quick Amount Chips -->
              <div style="margin-bottom:12px;">
                <label style="font-size:11.5px;font-weight:800;color:#475569;display:block;margin-bottom:6px;">
                  Quick Select Amount:
                </label>
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;margin-bottom:12px;">
                  <button type="button" class="jc-recharge-chip ${currentRechargeAmt === 50 ? 'active' : ''}" data-amt="50" style="padding:10px;font-size:14px;font-weight:800;">₹50</button>
                  <button type="button" class="jc-recharge-chip ${currentRechargeAmt === 100 ? 'active' : ''}" data-amt="100" style="padding:10px;font-size:14px;font-weight:800;">₹100</button>
                  <button type="button" class="jc-recharge-chip ${currentRechargeAmt === 200 ? 'active' : ''}" data-amt="200" style="padding:10px;font-size:14px;font-weight:800;">₹200</button>
                  <button type="button" class="jc-recharge-chip ${currentRechargeAmt === 500 ? 'active' : ''}" data-amt="500" style="padding:10px;font-size:14px;font-weight:800;">₹500</button>
                  <button type="button" class="jc-recharge-chip ${currentRechargeAmt === 1000 ? 'active' : ''}" data-amt="1000" style="padding:10px;font-size:14px;font-weight:800;">₹1,000</button>
                  <button type="button" class="jc-recharge-chip ${currentRechargeAmt === 2000 ? 'active' : ''}" data-amt="2000" style="padding:10px;font-size:14px;font-weight:800;">₹2,000</button>
                </div>
              </div>

              <!-- Custom Amount Input -->
              <div style="margin-bottom:18px;">
                <label style="font-size:11.5px;font-weight:800;color:#475569;display:block;margin-bottom:6px;">
                  Ya Apni Marzi Ka Amount Likhein (₹):
                </label>
                <div style="display:flex;align-items:center;background:#fff;border:2px solid #d8b4fe;border-radius:10px;padding:0 12px;">
                  <span style="font-weight:900;color:#5f259f;font-size:18px;margin-right:6px;">₹</span>
                  <input type="number" id="jcRechargeAmtInput" class="jc-input" style="border:none;padding:10px 0;font-weight:900;font-size:18px;color:#5f259f;width:100%;outline:none;" value="${currentRechargeAmt > 0 ? currentRechargeAmt : ''}" min="1" step="1" placeholder="Enter amount (e.g. 50, 100, 250)">
                </div>
              </div>

              <!-- Proceed / Generate QR Button -->
              <button type="button" id="jcGenerateQrBtn" class="jc-btn-submit" style="background:linear-gradient(135deg,#5f259f 0%,#7c3aed 100%);padding:13px;font-size:15px;margin-top:0;">
                <i class="fa-solid fa-qrcode"></i> Generate PhonePe QR Code ➔
              </button>
            </div>

            <!-- Step 2 View: QR Display & Confirmation (Hidden initially) -->
            <div id="jcStep2QrView" style="display:none;">
              <!-- Back to change amount link -->
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <button type="button" id="jcChangeAmtBtn" style="background:none;border:none;color:#5f259f;font-size:12px;font-weight:800;cursor:pointer;padding:0;display:flex;align-items:center;gap:4px;">
                  <i class="fa-solid fa-arrow-left"></i> Change Amount (<span id="jcSelectedAmtBadge">₹0</span>)
                </button>
                <!-- Live Countdown Timer Badge -->
                <div id="jcQrTimerBox" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;padding:3px 10px;border-radius:14px;font-size:11.5px;font-weight:800;display:inline-flex;align-items:center;gap:4px;">
                  <i class="fa-regular fa-clock"></i> Expires: <span id="jcTimerCount">05:00</span>
                </div>
              </div>

              <!-- QR Box -->
              <div style="background:#f8fafc;border:1.5px solid #ede9fe;border-radius:12px;padding:14px;text-align:center;margin-bottom:12px;position:relative;">
                <div class="jc-qr-wrapper" style="padding:8px;position:relative;">
                  <img id="jcRechargeQrImg" src="" alt="PhonePe QR" style="width:150px;height:150px;display:block;margin:0 auto;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
                  <div style="font-size:12px;font-weight:800;color:#0f172a;margin-top:8px;">
                    Scan with PhonePe / GPay / Paytm to Pay <span id="jcQrAmountText" style="color:#5f259f;font-weight:900;font-size:15px;">₹0</span>
                  </div>
                </div>

                <!-- UPI ID & Copy -->
                <div class="jc-upi-copy-box" style="margin:8px auto;display:inline-flex;align-items:center;gap:8px;background:#f3e8ff;padding:4px 10px;border-radius:6px;">
                  <span style="font-size:11.5px;">UPI ID: <b>${upiId}</b></span>
                  <button type="button" id="jcCopyUpiBtn" style="background:#5f259f;color:#fff;border:none;padding:3px 8px;border-radius:5px;font-size:11px;font-weight:750;cursor:pointer;">
                    <i class="fa-regular fa-copy"></i> Copy
                  </button>
                </div>

                <!-- Direct UPI Mobile Link -->
                <div style="margin-top:6px;">
                  <a id="jcDirectUpiLink" href="#" style="display:inline-flex;align-items:center;gap:6px;background:#5f259f;color:#fff;text-decoration:none;padding:7px 14px;border-radius:6px;font-size:12px;font-weight:800;">
                    <i class="fa-solid fa-mobile-screen"></i> Pay Directly in PhonePe App
                  </a>
                </div>
              </div>

              <!-- Step 3: Confirm Payment -->
              <div style="background:#faf5ff;border:2px solid #7c3aed;border-radius:12px;padding:12px 14px;margin-bottom:6px;box-shadow:0 4px 14px rgba(124,58,237,0.12);">
                <div style="font-size:12.5px;font-weight:850;color:#5f259f;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
                  <i class="fa-solid fa-receipt"></i> Payment Complete Karne Ke Baad:
                </div>
                <p style="font-size:11px;color:#475569;margin-bottom:8px;line-height:1.4;">
                  PhonePe app se payment ho jane ke baad niche <b>Maine Payment Kar Diya</b> button dabayein:
                </p>
                <input type="text" id="jcRechargeUtrInput" class="jc-input" placeholder="PhonePe 12-Digit UTR (Ya khali chhod sakte hain)" maxlength="22" style="letter-spacing:1px;font-weight:800;font-family:monospace;font-size:13px;background:#fff;border:1.5px solid #d8b4fe;color:#0f172a;text-align:center;margin-bottom:10px;">

                <button type="button" id="jcSubmitRechargeBtn" class="jc-btn-submit" style="background:linear-gradient(135deg,#059669 0%,#10b981 100%);padding:12px;font-size:14.5px;margin-top:0;box-shadow:0 4px 14px rgba(16,185,129,0.35);">
                  <i class="fa-solid fa-circle-check"></i> ✅ Maine Payment Kar Diya (Add Balance)
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    renderModalContent();
    document.body.appendChild(overlay);

    const step1View = overlay.querySelector('#jcStep1AmountView');
    const step2View = overlay.querySelector('#jcStep2QrView');
    const amtInput = overlay.querySelector('#jcRechargeAmtInput');
    const generateQrBtn = overlay.querySelector('#jcGenerateQrBtn');
    const changeAmtBtn = overlay.querySelector('#jcChangeAmtBtn');
    const selectedAmtBadge = overlay.querySelector('#jcSelectedAmtBadge');
    const qrImg = overlay.querySelector('#jcRechargeQrImg');
    const qrAmtText = overlay.querySelector('#jcQrAmountText');
    const directLink = overlay.querySelector('#jcDirectUpiLink');
    const chips = overlay.querySelectorAll('.jc-recharge-chip');
    const utrInput = overlay.querySelector('#jcRechargeUtrInput');
    const submitBtn = overlay.querySelector('#jcSubmitRechargeBtn');
    const copyBtn = overlay.querySelector('#jcCopyUpiBtn');
    const timerText = overlay.querySelector('#jcTimerCount');
    const timerBox = overlay.querySelector('#jcQrTimerBox');
    const closeBtn = overlay.querySelector('#jcCloseRechargeModalBtn');

    function cleanup() {
      if (timerInterval) clearInterval(timerInterval);
      if (pollInterval) clearInterval(pollInterval);
    }

    closeBtn.onclick = () => {
      cleanup();
      overlay.remove();
    };

    // Live Countdown Timer
    function startTimer() {
      if (timerInterval) clearInterval(timerInterval);
      timeLeft = 300;
      timerInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft <= 0) {
          clearInterval(timerInterval);
          timerText.textContent = '00:00 (Expired)';
          timerBox.style.background = '#fee2e2';
          timerBox.style.color = '#dc2626';
          timerBox.innerHTML = '<i class="fa-solid fa-rotate"></i> QR Expired. Click to Reload';
          timerBox.style.cursor = 'pointer';
          timerBox.onclick = () => {
            showStep2QR(currentRechargeAmt);
          };
          return;
        }

        const mins = String(Math.floor(timeLeft / 60)).padStart(2, '0');
        const secs = String(timeLeft % 60).padStart(2, '0');
        timerText.textContent = `${mins}:${secs}`;
      }, 1000);
    }

    // Show Step 2 QR Screen for specific amount
    function showStep2QR(amt) {
      currentRechargeAmt = Number(amt);
      if (!currentRechargeAmt || currentRechargeAmt <= 0) {
        showToast('Kripya valid recharge amount enter karein.', 'error');
        amtInput.focus();
        return;
      }

      const { qr, uri } = getQrUrl(currentRechargeAmt);
      qrImg.src = qr;
      directLink.href = uri;
      qrAmtText.textContent = `₹${currentRechargeAmt}`;
      selectedAmtBadge.textContent = `₹${currentRechargeAmt}`;

      step1View.style.display = 'none';
      step2View.style.display = 'block';
      startTimer();
    }

    // Back to Step 1
    changeAmtBtn.onclick = () => {
      cleanup();
      step2View.style.display = 'none';
      step1View.style.display = 'block';
      amtInput.focus();
    };

    // Chip selections
    chips.forEach(chip => {
      chip.onclick = () => {
        const val = Number(chip.getAttribute('data-amt'));
        currentRechargeAmt = val;
        amtInput.value = val;
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        // Instantly generate QR on chip click
        showStep2QR(val);
      };
    });

    // Custom Amount Input
    amtInput.oninput = () => {
      const val = Number(amtInput.value);
      chips.forEach(c => {
        if (Number(c.getAttribute('data-amt')) === val) {
          c.classList.add('active');
        } else {
          c.classList.remove('active');
        }
      });
    };

    amtInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        generateQrBtn.click();
      }
    };

    // Generate QR Button Click
    generateQrBtn.onclick = () => {
      const val = Number(amtInput.value);
      if (!val || val <= 0) {
        showToast('Kripya recharge amount enter karein (e.g. ₹50, ₹100, ₹500)', 'error');
        amtInput.focus();
        return;
      }
      showStep2QR(val);
    };

    // If initialAmt was explicitly provided (e.g., from low balance prompt)
    if (initialAmt && Number(initialAmt) > 0) {
      showStep2QR(Number(initialAmt));
    }

    // Show Beautiful Animated Success Screen
    function triggerSuccessScreen(newUserData, addedAmount) {
      cleanup();
      playSuccessTone();

      currentUser = Object.assign({}, currentUser, newUserData);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
      updateHeaderWalletUI();
      notifyAuthChange();

      const modalBody = overlay.querySelector('#jcRechargeModalBody');
      if (!modalBody) return;

      modalBody.innerHTML = `
        <div style="text-align:center;padding:26px 14px;animation:jcPopUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
          <div style="width:78px;height:78px;border-radius:50%;background:#d1fae5;color:#059669;display:inline-flex;align-items:center;justify-content:center;font-size:38px;margin-bottom:14px;box-shadow:0 8px 24px rgba(16,185,129,0.35);border:3px solid #10b981;">
            <i class="fa-solid fa-check"></i>
          </div>
          <h3 style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:900;color:#065f46;margin-bottom:4px;">
            🎉 Payment Successful!
          </h3>
          <p style="font-size:13px;color:#475569;margin-bottom:16px;">
            ₹${Number(addedAmount || currentRechargeAmt).toFixed(2)} aapke wallet me instant add ho chuka hai.
          </p>

          <div style="background:#f0fdf4;border:1.5px solid #a7f3d0;border-radius:12px;padding:12px 16px;margin-bottom:18px;display:flex;justify-content:space-around;align-items:center;">
            <div>
              <div style="font-size:11px;color:#047857;font-weight:750;text-transform:uppercase;">Added Amount</div>
              <div style="font-size:18px;font-weight:900;color:#059669;font-family:'Outfit',sans-serif;">+₹${Number(addedAmount || currentRechargeAmt).toFixed(2)}</div>
            </div>
            <div style="border-right:1px solid #a7f3d0;height:30px;"></div>
            <div>
              <div style="font-size:11px;color:#047857;font-weight:750;text-transform:uppercase;">Updated Balance</div>
              <div style="font-size:20px;font-weight:900;color:#065f46;font-family:'Outfit',sans-serif;">₹ ${Number(newUserData.balance).toFixed(2)}</div>
            </div>
          </div>

          <div style="display:flex;gap:8px;">
            <button type="button" class="jc-btn-submit" style="background:#059669;margin-top:0;flex:1;" onclick="document.getElementById('jc-phonepe-recharge-modal').remove(); JustcardWallet.openWalletDashboard();">
              <i class="fa-solid fa-wallet"></i> View Wallet &amp; Plans
            </button>
            <button type="button" style="background:#f1f5f9;border:1px solid #e2e8f0;padding:10px 16px;border-radius:9px;font-weight:750;cursor:pointer;color:#475569;" onclick="document.getElementById('jc-phonepe-recharge-modal').remove()">
              Done
            </button>
          </div>
        </div>
      `;
    }

    // Show Pending Verification Screen (Awaiting Admin Approval with Live Polling)
    function triggerPendingScreen(amount, utrVal, requestId) {
      const modalBody = overlay.querySelector('#jcRechargeModalBody');
      if (!modalBody) return;

      modalBody.innerHTML = `
        <div style="text-align:center;padding:22px 14px;animation:jcPopUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
          <div id="jcPendingIcon" style="width:72px;height:72px;border-radius:50%;background:#fef3c7;color:#d97706;display:inline-flex;align-items:center;justify-content:center;font-size:34px;margin-bottom:12px;box-shadow:0 8px 24px rgba(217,119,6,0.25);border:3px solid #f59e0b;">
            <i class="fa-solid fa-hourglass-half fa-spin" style="--fa-animation-duration: 4s;"></i>
          </div>
          <h3 id="jcPendingTitle" style="font-family:'Outfit',sans-serif;font-size:20px;font-weight:900;color:#92400e;margin-bottom:4px;">
            ⏳ Payment Verification: PENDING
          </h3>
          <p id="jcPendingSub" style="font-size:12.5px;color:#475569;margin-bottom:14px;line-height:1.4;">
            Aapka UTR submit ho gaya hai. Admin PhonePe check karke balance <b>approve</b> karenge.
          </p>

          <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px;padding:12px 16px;margin-bottom:16px;text-align:left;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px;">
              <span style="color:#78350f;font-weight:700;">Recharge Amount:</span>
              <span style="font-weight:900;color:#0f172a;font-size:14px;">₹${Number(amount).toFixed(2)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px;">
              <span style="color:#78350f;font-weight:700;">Submitted UTR:</span>
              <span style="font-weight:900;color:#5f259f;font-family:monospace;letter-spacing:0.5px;">${utrVal}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;align-items:center;">
              <span style="color:#78350f;font-weight:700;">Live Status:</span>
              <span id="jcLiveStatusBadge" style="font-weight:850;color:#b45309;background:#fde68a;padding:3px 10px;border-radius:12px;font-size:11.5px;display:inline-flex;align-items:center;gap:5px;">
                <i class="fa-solid fa-circle-dot" style="font-size:8px;"></i> 🟡 PENDING (Under Review)
              </span>
            </div>
          </div>

          <div style="display:flex;gap:8px;">
            <button type="button" class="jc-btn-submit" id="jcCheckStatusBtn" style="background:#5f259f;margin-top:0;flex:1;">
              <i class="fa-solid fa-rotate"></i> Check Status Now
            </button>
            <button type="button" style="background:#f1f5f9;border:1px solid #e2e8f0;padding:10px 16px;border-radius:9px;font-weight:750;cursor:pointer;color:#475569;" onclick="document.getElementById('jc-phonepe-recharge-modal').remove()">
              Close
            </button>
          </div>
        </div>
      `;

      // Specific Request Status Poller
      async function pollThisRequest() {
        if (!requestId) return;
        try {
          const res = await fetch(`${API_BASE}/api/wallet/my-recharge-requests?requestId=${encodeURIComponent(requestId)}`);
          const data = await res.json();
          if (data && data.request) {
            const reqData = data.request;
            if (reqData.status === 'approved') {
              cleanup();
              await syncUserBalance();
              triggerSuccessScreen(currentUser, amount);
            } else if (reqData.status === 'rejected') {
              cleanup();
              triggerRejectedScreen(reqData.rejectReason || 'UTR not verified in PhonePe', amount, utrVal);
            }
          }
        } catch (e) {}
      }

      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(pollThisRequest, 2000);

      const checkStatusBtn = overlay.querySelector('#jcCheckStatusBtn');
      if (checkStatusBtn) {
        checkStatusBtn.onclick = async () => {
          checkStatusBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking...';
          await pollThisRequest();
          setTimeout(() => {
            if (checkStatusBtn) checkStatusBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Check Status Now';
          }, 600);
        };
      }
    }

    // Show Rejected Screen
    function triggerRejectedScreen(reason, amount, utrVal) {
      const modalBody = overlay.querySelector('#jcRechargeModalBody');
      if (!modalBody) return;

      modalBody.innerHTML = `
        <div style="text-align:center;padding:22px 14px;animation:jcPopUp 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);">
          <div style="width:72px;height:72px;border-radius:50%;background:#fee2e2;color:#dc2626;display:inline-flex;align-items:center;justify-content:center;font-size:34px;margin-bottom:12px;box-shadow:0 8px 24px rgba(220,38,38,0.25);border:3px solid #ef4444;">
            <i class="fa-solid fa-xmark"></i>
          </div>
          <h3 style="font-family:'Outfit',sans-serif;font-size:20px;font-weight:900;color:#991b1b;margin-bottom:4px;">
            ❌ Request Rejected / Declined
          </h3>
          <p style="font-size:12.5px;color:#475569;margin-bottom:14px;line-height:1.4;">
            Admin ne aapka recharge request reject kar diya hai.
          </p>

          <div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:12px;padding:12px 16px;margin-bottom:16px;text-align:left;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px;">
              <span style="color:#991b1b;font-weight:700;">Reason:</span>
              <span style="font-weight:800;color:#dc2626;">${reason}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:12px;">
              <span style="color:#991b1b;font-weight:700;">UTR:</span>
              <span style="font-weight:800;color:#0f172a;font-family:monospace;">${utrVal}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:12px;">
              <span style="color:#991b1b;font-weight:700;">Status:</span>
              <span style="font-weight:850;color:#dc2626;background:#fee2e2;padding:2px 8px;border-radius:10px;font-size:11px;">🔴 REJECTED</span>
            </div>
          </div>

          <div style="display:flex;gap:8px;">
            <button type="button" class="jc-btn-submit" onclick="document.getElementById('jc-phonepe-recharge-modal').remove(); JustcardWallet.openRecharge();" style="background:#5f259f;margin-top:0;flex:1;">
              <i class="fa-solid fa-arrow-rotate-left"></i> Try Again with Correct UTR
            </button>
            <button type="button" style="background:#f1f5f9;border:1px solid #e2e8f0;padding:10px 16px;border-radius:9px;font-weight:750;cursor:pointer;color:#475569;" onclick="document.getElementById('jc-phonepe-recharge-modal').remove()">
              Close
            </button>
          </div>
        </div>
      `;
    }

    // Auto-Poll for Balance Increment
    async function checkBalanceUpdate() {
      if (!currentUser || !currentUser.id) return;
      try {
        const res = await fetch(`${API_BASE}/api/auth/me?userId=${encodeURIComponent(currentUser.id)}`);
        const data = await res.json();
        if (data && data.user) {
          const newBal = Number(data.user.balance || 0);
          if (newBal > initialBalance) {
            triggerSuccessScreen(data.user, newBal - initialBalance);
          }
        }
      } catch (e) {}
    }

    pollInterval = setInterval(checkBalanceUpdate, 2500);

    copyBtn.onclick = () => {
      navigator.clipboard.writeText(upiId).then(() => {
        showToast('UPI ID copied to clipboard: ' + upiId, 'success');
      }).catch(() => {
        prompt('Copy UPI ID:', upiId);
      });
    };

    submitBtn.onclick = async () => {
      const utr = utrInput.value.trim().toUpperCase();
      const amt = Number(currentRechargeAmt) || 100;

      if (!utr || utr.length < 8) {
        showToast('Kripya PhonePe payment receipt se 12-Digit UTR / Ref Number enter karein.', 'error');
        utrInput.focus();
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting UTR...';

      try {
        const res = await fetch(`${API_BASE}/api/wallet/request-recharge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: currentUser.id,
            mobile: currentUser.mobile,
            amount: amt,
            utr: utr,
            note: 'PhonePe QR Payment by Retailer'
          })
        });

        const data = await res.json();

        if (res.ok && data.success) {
          if (data.status === 'pending') {
            const reqId = data.request ? data.request.id : null;
            triggerPendingScreen(amt, utr, reqId);
            showToast('Recharge request submit ho gayi hai. Admin verify kar rahe hain.', 'info');
          } else if (data.user) {
            triggerSuccessScreen(data.user, amt);
          }
        } else {
          showToast(data.error || 'Request submit karne me error aayi.', 'error');
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> ✅ Maine Payment Kar Diya (Submit UTR)';
        }
      } catch (err) {
        showToast('Server network error. Kripya dobara try karein.', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> ✅ Maine Payment Kar Diya (Submit UTR)';
      }
    };
  }

  // Wallet Dashboard Modal
  async function openWalletDashboardModal() {
    if (!currentUser) return openAuthModal();

    const existing = document.getElementById('jc-wallet-dash-modal');
    if (existing) existing.remove();

    await syncUserBalance();
    await fetchPricing();

    const overlay = document.createElement('div');
    overlay.className = 'jc-modal-overlay';
    overlay.id = 'jc-wallet-dash-modal';

    const pkgStatus = currentUser.packageStatus || { isActive: false, name: 'Pay-Per-Print' };
    const isPlanActive = pkgStatus.isActive;
    const expDateStr = pkgStatus.expiresAt ? new Date(pkgStatus.expiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

    overlay.innerHTML = `
      <div class="jc-modal-card" style="max-width: 520px; max-height: 92vh; overflow-y: auto;">
        <div class="jc-modal-header" style="position:sticky;top:0;z-index:10;background:#fff;">
          <div class="jc-modal-title">
            <i class="fa-solid fa-wallet" style="color:#7c3aed;"></i>
            <span>Retailer Wallet &amp; Plans</span>
          </div>
          <button type="button" class="jc-modal-close" onclick="document.getElementById('jc-wallet-dash-modal').remove()">✕</button>
        </div>

        <div class="jc-modal-body">
          <!-- Balance Hero Card -->
          <div style="background: linear-gradient(135deg, #1e1b4b 0%, #7c3aed 50%, #6366f1 100%); color: #fff; padding: 18px 20px; border-radius: 14px; box-shadow: 0 6px 20px rgba(124, 58, 237, 0.35); margin-bottom: 16px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div>
                <div style="font-size: 11px; opacity: 0.85; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px;">Available Balance</div>
                <div style="font-size: 28px; font-weight: 900; font-family: 'Outfit', sans-serif; margin-top: 2px;">₹ ${Number(currentUser.balance || 0).toFixed(2)}</div>
              </div>
              <div style="text-align:right;">
                <div style="background: ${isPlanActive ? '#10b981' : 'rgba(255,255,255,0.2)'}; color:#fff; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 800; display:inline-flex; align-items:center; gap:5px;">
                  <i class="fa-solid ${isPlanActive ? 'fa-crown' : 'fa-bolt'}"></i> ${pkgStatus.name}
                </div>
                ${isPlanActive ? `<div style="font-size:10.5px;color:#cbd5e1;margin-top:4px;">Till: <b>${expDateStr}</b> (${pkgStatus.daysRemaining}d left)</div>` : ''}
              </div>
            </div>
            <div style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.2); padding-top: 8px; font-size: 12px; display:flex; justify-content:space-between; align-items:center;">
              <span><b>Shop:</b> ${currentUser.shopName}</span>
              <button type="button" onclick="document.getElementById('jc-wallet-dash-modal').remove(); JustcardWallet.openRecharge();" style="background:#10b981;color:#fff;border:none;padding:4px 12px;border-radius:20px;font-size:11.5px;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;gap:5px;box-shadow:0 2px 6px rgba(16,185,129,0.4);">
                <i class="fa-solid fa-bolt"></i> + Add Money (PhonePe)
              </button>
            </div>
          </div>

          <!-- UNLIMITED SUBSCRIPTION PLANS ACCORDION / SECTION -->
          <div style="background:#faf5ff;border:1.5px solid #d8b4fe;border-radius:14px;padding:14px;margin-bottom:16px;">
            <div style="font-size:12px;font-weight:800;color:#6b21a8;text-transform:uppercase;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
              <span>👑 Unlimited Subscription Packages</span>
              <span style="font-size:10.5px;color:#059669;background:#d1fae5;padding:2px 6px;border-radius:6px;font-weight:800;">100% Free All Services</span>
            </div>
            <p style="font-size:11.5px;color:#475569;margin-bottom:10px;">Package lene par selected time tak sabhi 4 services ka print/download <b>bilkul FREE (₹0.00)</b> ho jayega:</p>

            <div class="jc-pkg-grid">
              <div class="jc-pkg-item">
                <div class="jc-pkg-name">Silver Plan</div>
                <div class="jc-pkg-dur">1 Month Unlimited</div>
                <div class="jc-pkg-price">₹${currentPackages.silver ? currentPackages.silver.price : 299}</div>
                <button type="button" class="jc-pkg-btn" onclick="JustcardWallet.buyPackage('silver')">Buy with Wallet</button>
              </div>

              <div class="jc-pkg-item">
                <div class="jc-pkg-name">Gold Plan</div>
                <div class="jc-pkg-dur">3 Months Unlimited</div>
                <div class="jc-pkg-price">₹${currentPackages.gold ? currentPackages.gold.price : 699}</div>
                <button type="button" class="jc-pkg-btn" onclick="JustcardWallet.buyPackage('gold')">Buy with Wallet</button>
              </div>

              <div class="jc-pkg-item">
                <div class="jc-pkg-name">Platinum Plan</div>
                <div class="jc-pkg-dur">6 Months Unlimited</div>
                <div class="jc-pkg-price">₹${currentPackages.platinum ? currentPackages.platinum.price : 1199}</div>
                <button type="button" class="jc-pkg-btn" onclick="JustcardWallet.buyPackage('platinum')">Buy with Wallet</button>
              </div>

              <div class="jc-pkg-item diamond">
                <span class="jc-pkg-badge">POPULAR</span>
                <div class="jc-pkg-name">Diamond Plan</div>
                <div class="jc-pkg-dur">1 Year (12 Mo)</div>
                <div class="jc-pkg-price">₹${currentPackages.diamond ? currentPackages.diamond.price : 1999}</div>
                <button type="button" class="jc-pkg-btn" style="background:#7c3aed;color:#fff;" onclick="JustcardWallet.buyPackage('diamond')">Buy with Wallet</button>
              </div>
            </div>
          </div>

          <!-- Recharge History & Status Section -->
          <div style="border-top:1.5px solid #ede9fe;padding-top:14px;margin-bottom:14px;">
            <div style="font-size:13px;font-weight:800;color:#5f259f;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
              <span><i class="fa-solid fa-receipt"></i> PhonePe Recharge Status</span>
              <button type="button" id="jcRefreshRechargeBtn" style="background:#fff;border:1px solid #d8b4fe;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:750;cursor:pointer;color:#5f259f;">
                <i class="fa-solid fa-rotate"></i> Refresh Status
              </button>
            </div>
            <div id="jcRechargeHistoryList" style="max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
              <div style="font-size:12px;color:#64748b;text-align:center;padding:10px;">Loading recharge status...</div>
            </div>
          </div>

          <!-- Transaction Passbook Accordion -->
          <div style="border-top:1.5px solid #ede9fe;padding-top:12px;">
            <div style="font-size:13px;font-weight:800;color:#0f172a;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
              <span><i class="fa-solid fa-list-check" style="color:#7c3aed;"></i> Usage &amp; Print Passbook</span>
              <button type="button" id="jcRefreshTxnBtn" style="background:#fff;border:1px solid #e2e8f0;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;color:#475569;">
                <i class="fa-solid fa-rotate"></i> Refresh
              </button>
            </div>
            <div id="jcTxnList" style="max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
              <div style="font-size:12px;color:#64748b;text-align:center;padding:10px;">Loading passbook...</div>
            </div>
          </div>

          <!-- Logout & Close Buttons -->
          <div style="margin-top:16px;display:flex;gap:8px;">
            <button type="button" id="jcLogoutBtn" style="flex:1;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;padding:9px;border-radius:8px;font-weight:750;font-size:12.5px;cursor:pointer;">
              <i class="fa-solid fa-right-from-bracket"></i> Logout Account
            </button>
            <button type="button" onclick="document.getElementById('jc-wallet-dash-modal').remove()" style="flex:1;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;padding:9px;border-radius:8px;font-weight:750;font-size:12.5px;cursor:pointer;">
              Close
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    async function loadRechargeHistory() {
      const container = document.getElementById('jcRechargeHistoryList');
      if (!container) return;
      try {
        const res = await fetch(`${API_BASE}/api/wallet/my-recharge-requests?userId=${encodeURIComponent(currentUser.id)}`);
        const data = await res.json();
        if (data && data.requests && data.requests.length > 0) {
          container.innerHTML = data.requests.map(r => {
            const isApproved = r.status === 'approved';
            const isPending = r.status === 'pending';
            const statusBg = isApproved ? '#d1fae5' : (isPending ? '#fef3c7' : '#fee2e2');
            const statusColor = isApproved ? '#047857' : (isPending ? '#b45309' : '#dc2626');
            const statusLabel = isApproved ? '🟢 APPROVED' : (isPending ? '🟡 PENDING' : '🔴 REJECTED');
            const d = new Date(r.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            return `
              <div style="background:#fff;border:1.5px solid ${isPending ? '#fde68a' : (isApproved ? '#a7f3d0' : '#fecaca')};padding:8px 12px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;">
                <div>
                  <div style="font-weight:800;color:#0f172a;font-size:13px;">₹${Number(r.amount || 0).toFixed(2)}</div>
                  <div style="font-size:10.5px;color:#64748b;font-family:monospace;">UTR: <b>${r.utr}</b></div>
                  <div style="font-size:10px;color:#94a3b8;">${d}</div>
                </div>
                <div style="text-align:right;">
                  <span style="background:${statusBg};color:${statusColor};padding:3px 8px;border-radius:10px;font-size:10.5px;font-weight:850;display:inline-block;">
                    ${statusLabel}
                  </span>
                  ${r.rejectReason ? `<div style="font-size:9.5px;color:#dc2626;margin-top:2px;">${r.rejectReason}</div>` : ''}
                </div>
              </div>
            `;
          }).join('');
        } else {
          container.innerHTML = '<div style="font-size:12px;color:#94a3b8;text-align:center;padding:8px;">No PhonePe recharge requests yet.</div>';
        }
      } catch (e) {
        container.innerHTML = '<div style="font-size:12px;color:#dc2626;text-align:center;">Could not load recharge status.</div>';
      }
    }

    loadRechargeHistory();
    const refreshRechargeBtn = document.getElementById('jcRefreshRechargeBtn');
    if (refreshRechargeBtn) refreshRechargeBtn.onclick = loadRechargeHistory;

    async function loadTransactions() {
      const container = document.getElementById('jcTxnList');
      if (!container) return;
      try {
        const res = await fetch(`${API_BASE}/api/wallet/transactions?userId=${encodeURIComponent(currentUser.id)}`);
        const data = await res.json();
        if (data && data.transactions && data.transactions.length > 0) {
          container.innerHTML = data.transactions.map(t => {
            const isDebit = t.type === 'debit';
            const isFree = t.type === 'free';
            const sign = isDebit ? '-' : (isFree ? '' : '+');
            const color = isDebit ? '#dc2626' : (isFree ? '#7c3aed' : '#059669');
            const d = new Date(t.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            return `
              <div style="background:#fff;border:1px solid #ede9fe;padding:8px 10px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;font-size:11.5px;">
                <div>
                  <div style="font-weight:750;color:#0f172a;">${t.service || 'Wallet Adjustment'}</div>
                  <div style="font-size:10px;color:#94a3b8;">${d} · ${t.id}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-weight:800;color:${color};font-size:12px;">${isFree ? 'FREE (₹0.00)' : `${sign}₹${Number(t.amount || 0).toFixed(2)}`}</div>
                  <div style="font-size:10px;color:#64748b;">Bal: ₹${Number(t.balanceAfter || 0).toFixed(2)}</div>
                </div>
              </div>
            `;
          }).join('');
        } else {
          container.innerHTML = '<div style="font-size:12px;color:#94a3b8;text-align:center;padding:12px;">No transactions found yet.</div>';
        }
      } catch (err) {
        container.innerHTML = '<div style="font-size:12px;color:#dc2626;text-align:center;">Could not load history.</div>';
      }
    }

    loadTransactions();
    document.getElementById('jcRefreshTxnBtn').onclick = loadTransactions;

    document.getElementById('jcLogoutBtn').onclick = () => {
      currentUser = null;
      localStorage.removeItem(STORAGE_KEY);
      updateHeaderWalletUI();
      notifyAuthChange();
      overlay.remove();
      showToast('Logged out successfully.', 'info');
    };
  }

  // Charge Service Interceptor (Supports Unlimited Package & Pay-Per-Print)
  async function chargeService(serviceKey, serviceTitle = '', onApproved = null) {
    if (!currentUser) {
      openAuthModal('login', () => {
        chargeService(serviceKey, serviceTitle, onApproved);
      });
      return false;
    }

    await fetchPricing();
    const cost = Number(currentPricing[serviceKey] !== undefined ? currentPricing[serviceKey] : 0);

    try {
      const res = await fetch(`${API_BASE}/api/wallet/deduct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          mobile: currentUser.mobile,
          serviceKey: serviceKey,
          serviceTitle: serviceTitle
        })
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 402) {
          openInsufficientBalanceModal(data.requiredAmount || cost, data.availableBalance || currentUser.balance);
        } else {
          showToast(data.error || 'Wallet charge failed', 'error');
        }
        return false;
      }

      // If under active unlimited package
      if (data.isUnlimited) {
        showToast(`🎉 100% Free Print under ${data.packageName}!`, 'success');
        if (typeof onApproved === 'function') onApproved(data);
        return true;
      }

      // Normal Pay-per-print success
      currentUser.balance = data.newBalance;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
      updateHeaderWalletUI();
      notifyAuthChange();
      showToast(`₹${Number(data.deductedAmount).toFixed(2)} deducted from Wallet. Balance: ₹${Number(data.newBalance).toFixed(2)}`, 'success');

      if (typeof onApproved === 'function') {
        onApproved(data);
      }
      return true;
    } catch (err) {
      showToast('Wallet server communication error.', 'error');
      return false;
    }
  }

  // Insufficient Balance Warning Modal
  function openInsufficientBalanceModal(required, available) {
    const existing = document.getElementById('jc-low-bal-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'jc-modal-overlay';
    overlay.id = 'jc-low-bal-modal';

    overlay.innerHTML = `
      <div class="jc-modal-card" style="max-width: 420px; text-align: center;">
        <div class="jc-modal-body" style="padding: 26px 20px;">
          <div style="width: 56px; height: 56px; border-radius: 50%; background: #fee2e2; color: #dc2626; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 12px;">
            <i class="fa-solid fa-wallet"></i>
          </div>
          <h3 style="font-family:'Outfit',sans-serif;font-size:18px;font-weight:800;color:#0f172a;margin-bottom:6px;">Insufficient Wallet Balance</h3>
          <p style="font-size:13px;color:#64748b;margin-bottom:16px;">
            Is service ya package ke liye aapke wallet me paryapt balance nahi hai.
          </p>

          <div style="background:#f8fafc;border:1px solid #ede9fe;border-radius:10px;padding:12px;margin-bottom:16px;display:flex;justify-content:space-around;">
            <div>
              <div style="font-size:11px;color:#64748b;font-weight:700;">Required</div>
              <div style="font-size:16px;font-weight:800;color:#dc2626;">₹${Number(required || 0).toFixed(2)}</div>
            </div>
            <div style="border-right:1px solid #e2e8f0;"></div>
            <div>
              <div style="font-size:11px;color:#64748b;font-weight:700;">Available</div>
              <div style="font-size:16px;font-weight:800;color:#059669;">₹${Number(available || 0).toFixed(2)}</div>
            </div>
          </div>

          <div style="display:flex;flex-direction:column;gap:8px;">
            <button type="button" class="jc-btn-submit" style="margin-top:0;background:linear-gradient(135deg,#5f259f 0%,#7c3aed 100%);" onclick="document.getElementById('jc-low-bal-modal').remove(); JustcardWallet.openRecharge(${required});">
              <i class="fa-solid fa-qrcode"></i> Recharge with PhonePe QR
            </button>
            <button type="button" style="background:#f1f5f9;border:1px solid #e2e8f0;padding:9px;border-radius:9px;font-weight:750;cursor:pointer;color:#475569;" onclick="document.getElementById('jc-low-bal-modal').remove(); JustcardWallet.openWalletDashboard();">
              <i class="fa-solid fa-crown"></i> View Unlimited Plans
            </button>
            <button type="button" style="background:transparent;border:none;padding:6px;font-weight:700;cursor:pointer;color:#94a3b8;font-size:12px;" onclick="document.getElementById('jc-low-bal-modal').remove()">
              Cancel
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  // Public API
  window.JustcardWallet = {
    getUser: () => currentUser,
    isLoggedIn: () => !!currentUser,
    openAuth: (tab, cb) => openAuthModal(tab, cb),
    openWalletDashboard: () => openWalletDashboardModal(),
    openRecharge: (amt) => openPhonePeRechargeModal(amt),
    buyPackage: (pkgKey) => buyPackage(pkgKey),
    logout: () => {
      currentUser = null;
      localStorage.removeItem(STORAGE_KEY);
      updateHeaderWalletUI();
      notifyAuthChange();
      showToast('Logged out successfully.', 'info');
    },
    sync: () => syncUserBalance(),
    chargeService: (serviceKey, serviceTitle, onApproved) => chargeService(serviceKey, serviceTitle, onApproved),
    toast: (msg, type) => showToast(msg, type)
  };

  // Initialize
  function init() {
    injectStyles();
    fetchPricing();
    if (currentUser) syncUserBalance();
    updateHeaderWalletUI();
    notifyAuthChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
