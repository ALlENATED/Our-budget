/*
 * app.js — the entire application logic.
 *
 * Firebase is initialized in index.html. Everything here uses the
 * window.FB object that index.html exposes.
 *
 * Structure:
 *   1.  Firebase connection and constants
 *   2.  Global state
 *   3.  Auth flow (email + password)
 *   4.  Firestore references
 *   5.  Bootstrap (startApp)
 *   6.  Real-time listeners (attachListeners)
 *   7.  Shared helpers (formatting, DOM, toast, sheets)
 *   8.  Tab bar
 *   9.  Screen registry
 *   10. Screen renderers
 *   11. Editor sheets
 *   12. Pickers
 *   13. Boot
 */

// ============================================================
// 1. FIREBASE
// ============================================================
const FB = window.FB;
const BUDGET_ID = 'shared';

// ============================================================
// 2. GLOBAL STATE
// ============================================================
const App = {
  user: null,
  settings: null,
  categories: [],
  expenses: [],
  toPay: [],
  buy: [],
  history: [],
  screen: 'home',
  historyYear: null,
  toastTimer: null,
  listeners: [],
};

const DEFAULT_SETTINGS = {
  appName: 'Our Budget',
  currency: 'SEK',
  totalBudget: 12000,
  periodStartDay: 25,
  toPayResetDay: 'last',
  timezone: 'Europe/Stockholm',
  theme: 'system',
  heroTone: 'forest',
};

const TABS = [
  { id: 'home',       label: 'Home',       icon: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>' },
  { id: 'categories', label: 'Categories', icon: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>' },
  { id: 'buy',        label: 'Buy',        icon: '<path d="M5 7h14l-1.4 11.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8L5 7z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>' },
  { id: 'topay',      label: 'To Pay',     icon: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>' },
  { id: 'history',    label: 'History',    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>' },
  { id: 'settings',   label: 'Settings',   icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>' },
];

const SCREENS = TABS.map(t => t.id);
const ScreenRenderers = {};

// ============================================================
// 3. AUTH FLOW — GOOGLE SIGN-IN
// ============================================================
FB.onAuthStateChanged(FB.auth, async (user) => {
  if (user) {
    App.user = user;
    document.getElementById('login-screen').hidden = true;
    await startApp();
  } else {
    App.user = null;
    document.getElementById('login-screen').hidden = false;
    document.getElementById('loading').classList.add('hidden');
  }
});

document.getElementById('google-signin').addEventListener('click', async () => {
  const provider = new FB.GoogleAuthProvider();
  try {
    await FB.signInWithPopup(FB.auth, provider);
  } catch (err) {
    if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
      toast('Popup blocked. Please allow popups for this site.');
    } else if (err.code === 'auth/unauthorized-domain') {
      toast('This domain is not authorized. Check Firebase settings.');
    } else {
      toast('Could not sign in: ' + err.message);
    }
  }
});

function getLoginFields() {
  return {
    email: document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-password').value,
    errorEl: document.getElementById('login-error'),
  };
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

document.getElementById('login-btn').addEventListener('click', async () => {
  const { email, password, errorEl } = getLoginFields();
  errorEl.style.display = 'none';
  if (!email || !password) { showLoginError('Please enter email and password.'); return; }
  try {
    await FB.signInWithEmailAndPassword(FB.auth, email, password);
  } catch (err) {
    if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
      showLoginError('Wrong email or password.');
    } else if (err.code === 'auth/too-many-requests') {
      showLoginError('Too many attempts. Try again in a few minutes.');
    } else {
      showLoginError(err.message);
    }
  }
});

document.getElementById('signup-btn').addEventListener('click', async () => {
  const { email, password, errorEl } = getLoginFields();
  errorEl.style.display = 'none';
  if (!email || !password) { showLoginError('Enter email and password.'); return; }
  if (password.length < 6) { showLoginError('Password must be at least 6 characters.'); return; }
  try {
    await FB.createUserWithEmailAndPassword(FB.auth, email, password);
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      showLoginError('An account with this email already exists. Tap "Sign in".');
    } else if (err.code === 'auth/invalid-email') {
      showLoginError('That email address is not valid.');
    } else if (err.code === 'auth/weak-password') {
      showLoginError('Password must be at least 6 characters.');
    } else {
      showLoginError(err.message);
    }
  }
});

// ============================================================
// 4. FIRESTORE REFERENCES
// ============================================================
function budgetDoc()    { return FB.doc(FB.db, 'budgets', BUDGET_ID); }
function categoriesCol(){ return FB.collection(FB.db, 'budgets', BUDGET_ID, 'categories'); }
function expensesCol()  { return FB.collection(FB.db, 'budgets', BUDGET_ID, 'expenses'); }
function toPayCol()     { return FB.collection(FB.db, 'budgets', BUDGET_ID, 'toPay'); }
function buyCol()       { return FB.collection(FB.db, 'budgets', BUDGET_ID, 'buy'); }
function historyCol()   { return FB.collection(FB.db, 'budgets', BUDGET_ID, 'history'); }

// ============================================================
// 5. BOOTSTRAP
// ------------------------------------------------------------
// Called once after the user signs in.
//
// CRITICAL: we wait for the auth token to be present BEFORE
// attaching any Firestore listeners. Without this wait, the
// snapshot listeners fire as unauthenticated requests and get
// rejected with permission-denied.
// ============================================================
async function startApp() {
  // Step 1: ensure the shared budget document exists.
  const snap = await FB.getDoc(budgetDoc());
  if (!snap.exists()) {
    await FB.setDoc(budgetDoc(), DEFAULT_SETTINGS);
  }

  // Step 2: seed starter categories on first ever boot.
  const catsSnap = await FB.getDocs(categoriesCol()).catch(() => null);
  if (catsSnap && catsSnap.size === 0) {
    const now = new Date().toISOString();
    const seed = [
      { name: 'Groceries',     icon: '🛒', limit: 5000, colorKey: 'green',  parentId: '', pinOrder: 0, createdAt: now },
      { name: 'Transport',     icon: '🚌', limit: 1500, colorKey: 'blue',   parentId: '', pinOrder: 0, createdAt: now },
      { name: 'Dining out',    icon: '🍽️', limit: 1000, colorKey: 'red',    parentId: '', pinOrder: 0, createdAt: now },
      { name: 'Utilities',     icon: '💡', limit: 2000, colorKey: 'amber',  parentId: '', pinOrder: 0, createdAt: now },
      { name: 'Entertainment', icon: '🎬', limit: 1500, colorKey: 'purple', parentId: '', pinOrder: 0, createdAt: now },
      { name: 'Health',        icon: '💊', limit: 1000, colorKey: 'teal',   parentId: '', pinOrder: 0, createdAt: now },
    ];
    for (const cat of seed) {
      await FB.addDoc(categoriesCol(), cat);
    }
  }

  // Step 3: wait for the auth token to be ready, THEN attach listeners.
  if (FB.auth.currentUser) {
    try {
      await FB.auth.currentUser.getIdToken();
    } catch (err) {
      console.error('Auth token fetch failed:', err);
    }
  }

  // Step 4: attach real-time listeners.
  attachListeners();

  // Step 5: render.
  mountScreens();
  renderTabbar();
  goScreen('home');

  // Step 6: hide loading overlay.
  document.getElementById('loading').classList.add('hidden');
}

// ============================================================
// 6. REAL-TIME LISTENERS
// ------------------------------------------------------------
// Every listener stores its unsubscribe function in App.listeners
// so we could detach them if the user signs out.
// ============================================================
function attachListeners() {
  App.listeners.push(FB.onSnapshot(budgetDoc(), (snap) => {
    if (snap.exists()) {
      App.settings = snap.data();
      applyThemeAndTone();
      if (App.screen === 'home' || App.screen === 'settings') renderScreen(App.screen);
    }
  }));

  App.listeners.push(FB.onSnapshot(
    FB.query(categoriesCol(), FB.orderBy('createdAt')),
    (snap) => {
      App.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (App.screen === 'categories' || App.screen === 'home' || App.screen === 'settings') renderScreen(App.screen);
    }
  ));

  App.listeners.push(FB.onSnapshot(
    FB.query(expensesCol(), FB.orderBy('dateAdded', 'desc')),
    (snap) => {
      App.expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (App.screen === 'home' || App.screen === 'categories') renderScreen(App.screen);
    }
  ));

  App.listeners.push(FB.onSnapshot(
    FB.query(toPayCol(), FB.orderBy('createdAt')),
    (snap) => {
      App.toPay = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (App.screen === 'topay') renderScreen(App.screen);
    }
  ));

  App.listeners.push(FB.onSnapshot(
    FB.query(buyCol(), FB.orderBy('createdAt')),
    (snap) => {
      App.buy = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (App.screen === 'buy') renderScreen(App.screen);
    }
  ));

  App.listeners.push(FB.onSnapshot(
    FB.query(historyCol(), FB.orderBy('periodKey', 'desc')),
    (snap) => {
      App.history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (App.screen === 'history') renderScreen(App.screen);
    }
  ));
}

// ============================================================
// 7. SHARED HELPERS
// ============================================================
function fmtAmount(n, withCurrency) {
  const num = Number(n) || 0;
  const s = String(Math.round(num));
  if (withCurrency && App.settings) s += ' ' + App.settings.currency;
  return s;
}

function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.getDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
}

function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 86400000);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function h(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(k => {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'style') el.style.cssText = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      }
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k]);
    });
  }
  if (children) {
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }
  return el;
}

function svgIcon(paths) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
}

function toast(message, action, onAction) {
  const el = document.getElementById('toast');
  el.innerHTML = '';
  el.appendChild(document.createTextNode(message));
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action;
    btn.onclick = () => { if (onAction) onAction(); hideToast(); };
    el.appendChild(btn);
  }
  el.classList.add('show');
  clearTimeout(App.toastTimer);
  App.toastTimer = setTimeout(hideToast, 3500);
}
function hideToast() {
  document.getElementById('toast').classList.remove('show');
}

function openSheet(builder) {
  const root = document.getElementById('sheet-root');
  root.innerHTML = '';
  const overlay = h('div', { class: 'overlay show', onclick: closeSheet });
  const sheet = h('div', { class: 'sheet' });
  const grab = h('div', { class: 'grab' });
  const body = h('div', { class: 'sheet-body' });
  sheet.appendChild(grab);
  sheet.appendChild(body);
  root.appendChild(overlay);
  root.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('show'));
  builder(body, sheet);
}

function closeSheet() {
  const root = document.getElementById('sheet-root');
  const sheet = root.querySelector('.sheet');
  const overlay = root.querySelector('.overlay');
  if (sheet) sheet.classList.remove('show');
  if (overlay) overlay.classList.remove('show');
  setTimeout(() => { root.innerHTML = ''; }, 250);
}

function applyThemeAndTone() {
  if (!App.settings) return;
  document.body.setAttribute('data-tone', App.settings.heroTone || 'forest');
  let theme = App.settings.theme || 'system';
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.body.setAttribute('data-theme', theme);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (App.settings && App.settings.theme === 'system') applyThemeAndTone();
});

// ============================================================
// 8. TAB BAR
// ============================================================
function renderTabbar() {
  const nav = document.getElementById('tabbar');
  nav.innerHTML = '';
  TABS.forEach(t => {
    const btn = h('button', {
      class: 'tab' + (App.screen === t.id ? ' active' : ''),
      onclick: () => goScreen(t.id),
    });
    btn.innerHTML = svgIcon(t.icon) + '<span>' + t.label + '</span>';
    nav.appendChild(btn);
  });
}

// ============================================================
// 9. SCREEN REGISTRY
// ============================================================
function mountScreens() {
  const root = document.getElementById('screens');
  root.innerHTML = '';
  SCREENS.forEach(id => {
    root.appendChild(h('div', { id: 'screen-' + id, class: 'screen' }));
  });
}

function renderScreen(id) {
  const fn = ScreenRenderers[id];
  const el = document.getElementById('screen-' + id);
  if (!fn || !el) return;
  el.innerHTML = '';
  el.appendChild(fn());
}

function goScreen(id) {
  if (!SCREENS.includes(id)) return;
  App.screen = id;
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.toggle('active', s.id === 'screen-' + id);
  });
  renderTabbar();
  renderScreen(id);
}

// ============================================================
// 10. SCREEN — HOME
// ============================================================
ScreenRenderers.home = function () {
  const s = App.settings || DEFAULT_SETTINGS;
  const period = computeCurrentPeriod(s.periodStartDay);
  const expenses = App.expenses.filter(e => e.periodKey === period.key);
  const categories = App.categories;
  const byId = {};
  categories.forEach(c => { byId[c.id] = c; });

  const spentByCat = {};
  expenses.forEach(e => {
    if (e.categoryId) spentByCat[e.categoryId] = (spentByCat[e.categoryId] || 0) + Number(e.amount || 0);
    if (e.subcategoryId) spentByCat[e.subcategoryId] = (spentByCat[e.subcategoryId] || 0) + Number(e.amount || 0);
  });

  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalBudget = Number(s.totalBudget) || 0;
  const remaining = totalBudget - totalSpent;
  const pctUsed = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const pctLeft = 100 - pctUsed;

  const wrap = document.createElement('div');

  const greeting = (() => {
    const hr = new Date().getHours();
    return hr < 12 ? 'Good morning,' : hr < 18 ? 'Good afternoon,' : 'Good evening,';
  })();
  const head = document.createElement('div');
  head.className = 'apphead';
  head.innerHTML =
    '<div><div class="greeting">' + greeting + '</div>' +
    '<div class="appname">' + esc(s.appName || 'Our Budget') + '</div></div>' +
    '<div class="avatar">' + (s.appName || 'OB').slice(0, 2).toUpperCase() + '</div>';
  wrap.appendChild(head);

  const pill = document.createElement('div');
  pill.className = 'period-pill';
  pill.innerHTML = '<span class="dot"></span><span>' + esc(period.label) + '</span><span class="chev">›</span>';
  wrap.appendChild(pill);

  const hero = document.createElement('div');
  hero.className = 'hero';
  hero.innerHTML =
    '<div class="hero-inner">' +
      '<div class="hero-top">' +
        '<span class="hero-lbl">Remaining</span>' +
        '<span class="hero-badge">' + pctLeft + '% left</span>' +
      '</div>' +
      '<div class="hero-amt">' + fmtAmount(remaining) +
        '<span class="cur">' + esc(s.currency) + '</span></div>' +
      '<div class="hero-bar"><div style="width:' + Math.min(100, pctUsed) + '%"></div></div>' +
      '<div class="hero-stats">' +
        '<div><div class="k">Budget</div><div class="v">' + fmtAmount(totalBudget) + '</div></div>' +
        '<div><div class="k">Spent</div><div class="v">' + fmtAmount(totalSpent) + '</div></div>' +
        '<div><div class="k">Days</div><div class="v">' + period.daysLeft + '</div></div>' +
      '</div>' +
    '</div>';
  wrap.appendChild(hero);

  const pinned = categories
    .filter(c => Number(c.pinOrder) > 0)
    .sort((a, b) => Number(a.pinOrder) - Number(b.pinOrder))
    .slice(0, 3);

  if (pinned.length) {
    const pinWrap = document.createElement('div');
    pinWrap.className = 'pinned-wrap';
    pinWrap.innerHTML = '<div class="pinned-head"><h3>Pinned</h3><a data-manage>Manage</a></div>';
    const grid = document.createElement('div');
    grid.className = 'pinned-grid';
    pinned.forEach(c => {
      const spent = spentByCat[c.id] || 0;
      const limit = Number(c.limit) || 0;
      const over = limit > 0 && spent > limit;
      const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
      const el = document.createElement('div');
      el.className = 'pin c-' + (c.colorKey || 'blue') + (over ? ' over' : '');
      el.innerHTML =
        '<div class="top"><div class="ico">' + esc(c.icon || '🏷️') + '</div>' +
        '<div class="n">' + esc(c.name) + '</div></div>' +
        '<div class="bar"><div style="width:' + pct + '%"></div></div>' +
        '<div class="v"><b>' + fmtAmount(spent) + '</b> / ' + fmtAmount(limit) + '</div>';
      el.onclick = () => goScreen('categories');
      grid.appendChild(el);
    });
    pinWrap.appendChild(grid);
    wrap.appendChild(pinWrap);
  }

  const qa = document.createElement('div');
  qa.className = 'quickadd';
  qa.innerHTML = '<div class="plus">＋</div><input placeholder="Add an expense…" id="qa-input"><button class="go" id="qa-add">Add</button>';
  wrap.appendChild(qa);

  const sechead = document.createElement('div');
  sechead.className = 'sechead';
  sechead.innerHTML = '<h2>Recent</h2><span class="meta">' + fmtAmount(totalSpent) + ' this period</span>';
  wrap.appendChild(sechead);

  if (!expenses.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<div class="emoji">🛒</div><div>No expenses yet this period.<br><b>Add one above to get started.</b></div>';
    wrap.appendChild(empty);
  } else {
    const feed = document.createElement('div');
    feed.className = 'feed';
    const byDay = {};
    expenses.forEach(e => {
      const d = e.dateAdded ? String(e.dateAdded).slice(0, 10) : 'unknown';
      (byDay[d] = byDay[d] || []).push(e);
    });
    const dayKeys = Object.keys(byDay).sort().reverse();
    dayKeys.forEach(dk => {
      const dayTotal = byDay[dk].reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const dayEl = document.createElement('div');
      dayEl.className = 'day';
      dayEl.innerHTML = '<span>' + labelForDay(dk) + '</span><span class="tot">' + fmtAmount(dayTotal) + '</span>';
      feed.appendChild(dayEl);
      byDay[dk].forEach(e => {
        const cat = byId[e.subcategoryId] || byId[e.categoryId] || { name: '—', icon: '🏷️', colorKey: 'blue' };
        const exp = document.createElement('div');
        exp.className = 'exp';
        exp.innerHTML =
          '<div class="exp-icon c-' + (cat.colorKey || 'blue') + '">' + esc(cat.icon || '🏷️') + '</div>' +
          '<div class="exp-body"><div class="exp-name">' + esc(e.name) + '</div>' +
          '<div class="exp-cat">' + esc(cat.name) + '</div></div>' +
          '<div class="exp-amt">' + fmtAmount(e.amount) + '</div>';
        exp.onclick = () => openExpenseEditor(e);
        feed.appendChild(exp);
      });
    });
    wrap.appendChild(feed);
  }

  setTimeout(() => {
    const input = document.getElementById('qa-input');
    const btn = document.getElementById('qa-add');
    if (btn && input) {
      const add = () => {
        const v = input.value.trim();
        if (!v) return;
        input.value = '';
        openExpenseEditor(null, v);
      };
      btn.onclick = add;
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') add(); });
    }
    const mng = wrap.querySelector('[data-manage]');
    if (mng) mng.onclick = () => goScreen('categories');
  }, 0);

  return wrap;
};

// ============================================================
// 11. SCREEN — CATEGORIES
// ============================================================
ScreenRenderers.categories = function () {
  const s = App.settings || DEFAULT_SETTINGS;
  const period = computeCurrentPeriod(s.periodStartDay);
  const expenses = App.expenses.filter(e => e.periodKey === period.key);
  const categories = App.categories;
  const parents = categories.filter(c => !c.parentId);
  const childrenByParent = {};
  categories.forEach(c => {
    if (c.parentId) (childrenByParent[c.parentId] = childrenByParent[c.parentId] || []).push(c);
  });

  const spentByCat = {};
  expenses.forEach(e => {
    if (e.categoryId) spentByCat[e.categoryId] = (spentByCat[e.categoryId] || 0) + Number(e.amount || 0);
    if (e.subcategoryId) spentByCat[e.subcategoryId] = (spentByCat[e.subcategoryId] || 0) + Number(e.amount || 0);
  });

  const totalSpent = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalBudget = Number(s.totalBudget) || 0;
  const pctUsed = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const remaining = totalBudget - totalSpent;

  const wrap = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'apphead';
  head.innerHTML =
    '<div><div class="greeting">Budget breakdown,</div>' +
    '<div class="appname">Categories</div></div>' +
    '<div class="avatar">' + (s.appName || 'OB').slice(0, 2).toUpperCase() + '</div>';
  wrap.appendChild(head);

  const overall = document.createElement('div');
  overall.className = 'overall';
  overall.innerHTML =
    '<div class="overall-top">' +
      '<div>' +
        '<div class="lbl">Total spent</div>' +
        '<div class="big">' +
          '<span class="num">' + fmtAmount(totalSpent) + '</span>' +
          '<span class="cur">' + esc(s.currency) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="pct">of ' + fmtAmount(totalBudget) + ' · ' + pctUsed + '%</div>' +
    '</div>' +
    '<div class="overall-bar"><div style="width:' + Math.min(100, pctUsed) + '%"></div></div>' +
    '<div class="overall-foot">' +
      '<span>Remaining ' + fmtAmount(remaining) + '</span>' +
      '<span>' + parents.length + ' categor' + (parents.length === 1 ? 'y' : 'ies') + '</span>' +
    '</div>';
  wrap.appendChild(overall);

  const sh = document.createElement('div');
  sh.className = 'sechead';
  sh.innerHTML = '<h2>All categories</h2><a id="cat-new">＋ New</a>';
  wrap.appendChild(sh);

  if (!parents.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<div class="emoji">📁</div><div>No categories yet.<br><b>Add one to start tracking.</b></div>';
    wrap.appendChild(empty);
  } else {
    parents.forEach(cat => {
      const spent = spentByCat[cat.id] || 0;
      const limit = Number(cat.limit) || 0;
      const over = limit > 0 && spent > limit;
      const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      const pctClamped = Math.min(100, pct);
      const left = limit - spent;

      const card = document.createElement('div');
      card.className = 'cat c-' + (cat.colorKey || 'blue') + (over ? ' over' : '');

      const subs = childrenByParent[cat.id] || [];
      let subsHtml = '';
      if (subs.length) {
        subsHtml = '<div class="subs">' +
          subs.map(sc => {
            const scSpent = spentByCat[sc.id] || 0;
            const scLimit = Number(sc.limit) || 0;
            return '<div class="sub"><span class="n">' + esc(sc.name) + '</span>' +
              '<span class="v">' + fmtAmount(scSpent) + ' <small>/ ' + fmtAmount(scLimit) + '</small></span></div>';
          }).join('') +
        '</div>';
      }

      card.innerHTML =
        '<div class="cat-icon">' + esc(cat.icon || '🏷️') + '</div>' +
        '<div class="cat-body">' +
          '<div class="cat-top">' +
            '<span class="cat-name">' + esc(cat.name) + '</span>' +
            '<span class="cat-amt"><b>' + fmtAmount(spent) + '</b> / ' + fmtAmount(limit) + '</span>' +
          '</div>' +
          '<div class="cat-bar"><div style="width:' + pctClamped + '%"></div></div>' +
          '<div class="cat-foot">' +
            '<span class="cat-left">' + (over ? '−' + fmtAmount(-left) + ' over' : fmtAmount(left) + ' left') + '</span>' +
            '<span class="cat-pct">' + pct + '%</span>' +
          '</div>' +
          subsHtml +
        '</div>';

      card.onclick = () => openCategoryEditor(cat);
      wrap.appendChild(card);
    });
  }

  setTimeout(() => {
    const btn = document.getElementById('cat-new');
    if (btn) btn.onclick = () => openCategoryEditor(null);
  }, 0);

  return wrap;
};

// ============================================================
// 12. SCREEN — BUY
// ============================================================
ScreenRenderers.buy = function () {
  const s = App.settings || DEFAULT_SETTINGS;
  const items = App.buy.slice().sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  const wrap = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'apphead';
  head.innerHTML =
    '<div><div class="greeting">Shopping list,</div>' +
    '<div class="appname">Buy</div></div>' +
    '<div class="avatar">' + (s.appName || 'OB').slice(0, 2).toUpperCase() + '</div>';
  wrap.appendChild(head);

  const qa = document.createElement('div');
  qa.className = 'quickadd';
  qa.innerHTML = '<div class="plus">＋</div><input placeholder="Add item…" id="buy-input"><button class="go" id="buy-add">Add</button>';
  wrap.appendChild(qa);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.marginTop = '16px';
    empty.innerHTML = '<div class="emoji">🛍️</div><div>Nothing on the list.<br><b>Add something above.</b></div>';
    wrap.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'buy-list';
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'gitem' + (item.checked ? ' paid' : '');
      row.innerHTML =
        '<div class="gcheck' + (item.checked ? ' on' : '') + '">' + (item.checked ? '✓' : '') + '</div>' +
        '<div class="gname">' + esc(item.name) + '</div>';
      const chk = row.querySelector('.gcheck');
      chk.onclick = (ev) => { ev.stopPropagation(); toggleBuy(item); };

      let t = null;
      const start = () => { t = setTimeout(() => buyItemMenu(item), 600); };
      const stop = () => { if (t) { clearTimeout(t); t = null; } };
      row.addEventListener('touchstart', start);
      row.addEventListener('touchend', stop);
      row.addEventListener('touchcancel', stop);
      row.addEventListener('mousedown', start);
      row.addEventListener('mouseup', stop);
      row.addEventListener('mouseleave', stop);

      list.appendChild(row);
    });
    wrap.appendChild(list);

    const clearRow = document.createElement('div');
    clearRow.className = 'clear-row';
    clearRow.innerHTML =
      '<button class="clear-btn" id="buy-clear-checked">Clear checked</button>' +
      '<button class="clear-btn primary" id="buy-clear-all">Clear all</button>';
    wrap.appendChild(clearRow);
  }

  setTimeout(() => {
    const inp = document.getElementById('buy-input');
    const addBtn = document.getElementById('buy-add');
    if (addBtn && inp) {
      const add = async () => {
        const v = inp.value.trim();
        if (!v) return;
        inp.value = '';
        await FB.addDoc(buyCol(), {
          name: v, checked: false,
          createdAt: new Date().toISOString(), checkedAt: null,
        });
      };
      addBtn.onclick = add;
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') add(); });
    }
    const clearChecked = document.getElementById('buy-clear-checked');
    if (clearChecked) clearChecked.onclick = async () => {
      const checked = App.buy.filter(x => x.checked);
      for (const x of checked) await FB.deleteDoc(FB.doc(buyCol(), x.id));
    };
    const clearAll = document.getElementById('buy-clear-all');
    if (clearAll) clearAll.onclick = async () => {
      if (!confirm('Clear the entire list?')) return;
      for (const x of App.buy.slice()) await FB.deleteDoc(FB.doc(buyCol(), x.id));
    };
  }, 0);

  return wrap;
};

function toggleBuy(item) {
  FB.updateDoc(FB.doc(buyCol(), item.id), {
    checked: !item.checked,
    checkedAt: !item.checked ? new Date().toISOString() : null,
  });
}

function buyItemMenu(item) {
  openSheet((body) => {
    body.appendChild(h('h3', null, item.name));
    const editBtn = h('button', { class: 'primary' }, 'Rename');
    editBtn.onclick = async () => {
      const v = prompt('New name:', item.name);
      if (v === null) return;
      const trimmed = v.trim();
      if (!trimmed) return;
      closeSheet();
      await FB.updateDoc(FB.doc(buyCol(), item.id), { name: trimmed });
    };
    body.appendChild(editBtn);
    const del = h('button', { class: 'danger' }, 'Delete');
    del.onclick = async () => {
      closeSheet();
      await FB.deleteDoc(FB.doc(buyCol(), item.id));
    };
    body.appendChild(del);
  });
}

// ============================================================
// 13. SCREEN — TO PAY
// ============================================================
ScreenRenderers.topay = function () {
  const items = App.toPay.slice();

  function sortKey(x) {
    if (x.paid) return 3;
    if (x.dueDate) { const d = daysUntil(x.dueDate); return d != null ? 1 : 2; }
    return 2;
  }
  items.sort((a, b) => {
    const ka = sortKey(a), kb = sortKey(b);
    if (ka !== kb) return ka - kb;
    if (ka === 1) return daysUntil(a.dueDate) - daysUntil(b.dueDate);
    if (ka === 3) return new Date(b.paidDate || 0) - new Date(a.paidDate || 0);
    return 0;
  });

  const unpaidCount = items.filter(x => !x.paid).length;
  const unpaidTotal = items
    .filter(x => !x.paid && x.amount != null)
    .reduce((sum, x) => sum + Number(x.amount || 0), 0);

  const wrap = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'apphead';
  head.innerHTML =
    '<div><div class="greeting">Persistent list,</div>' +
    '<div class="appname">To Pay</div></div>' +
    '<div class="avatar">' + (App.settings?.appName || 'OB').slice(0, 2).toUpperCase() + '</div>';
  wrap.appendChild(head);

  const sum = document.createElement('div');
  sum.className = 'summary';
  sum.innerHTML =
    '<div class="summary-cells">' +
      '<div><div class="k">Unpaid</div><div class="v red">' + unpaidCount + '</div></div>' +
      '<div><div class="k">Total</div><div class="v">' + fmtAmount(unpaidTotal) + '</div></div>' +
    '</div>';
  wrap.appendChild(sum);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.marginTop = '16px';
    empty.innerHTML = '<div class="emoji">✅</div><div>Nothing to pay.<br><b>Add one below.</b></div>';
    wrap.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'pay-list';
    items.forEach(item => {
      const d = item.dueDate ? daysUntil(item.dueDate) : null;
      let metaTxt = '', metaCls = 'pmeta';
      if (item.paid) { metaTxt = 'Paid ' + fmtDateShort(item.paidDate); metaCls = 'pmeta done'; }
      else if (d === null) { metaTxt = 'No due date'; }
      else if (d < 0) { metaTxt = 'Overdue by ' + (-d) + ' day' + (d === -1 ? '' : 's'); metaCls = 'pmeta due'; }
      else if (d === 0) { metaTxt = 'Due today'; metaCls = 'pmeta due'; }
      else if (d === 1) { metaTxt = 'Due tomorrow'; metaCls = 'pmeta due'; }
      else { metaTxt = 'Due ' + fmtDateShort(item.dueDate) + ' · ' + d + ' days'; metaCls = 'pmeta due'; }

      const amountHtml = item.amount == null
        ? '<div class="pamt" style="color:var(--text3);font-size:13px">—</div>'
        : '<div class="pamt">' + fmtAmount(item.amount) + '</div>';
      const pill = (d === 1 && !item.paid) ? '<div class="pill-day">1 day</div>' : '';
      const subTag = item.isSubscription ? '<span class="pill-sub">SUB</span>' : '';

      const row = document.createElement('div');
      row.className = 'prow' + (item.paid ? ' paid' : '');
      row.innerHTML =
        '<div class="pcheck' + (item.paid ? ' on' : '') + '">' + (item.paid ? '✓' : '') + '</div>' +
        '<div class="pbody">' +
          '<div class="pname">' + esc(item.name) + ' ' + subTag + '</div>' +
          '<div class="' + metaCls + '">' + esc(metaTxt) + '</div>' +
        '</div>' + pill + amountHtml;

      const chk = row.querySelector('.pcheck');
      chk.onclick = (ev) => { ev.stopPropagation(); togglePaid(item); };
      row.onclick = () => openToPayEditor(item);
      list.appendChild(row);
    });
    wrap.appendChild(list);
  }

  const qa = document.createElement('div');
  qa.className = 'quickadd';
  qa.style.marginTop = '16px';
  qa.innerHTML = '<div class="plus">＋</div><input placeholder="Add a payment…" id="tp-input"><button class="go" id="tp-add">Add</button>';
  wrap.appendChild(qa);

  setTimeout(() => {
    const inp = document.getElementById('tp-input');
    const btn = document.getElementById('tp-add');
    if (btn && inp) {
      const add = () => {
        const v = inp.value.trim();
        if (!v) return;
        inp.value = '';
        openToPayEditor(null, v);
      };
      btn.onclick = add;
      inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') add(); });
    }
  }, 0);

  return wrap;
};

function togglePaid(item) {
  FB.updateDoc(FB.doc(toPayCol(), item.id), {
    paid: !item.paid,
    paidDate: !item.paid ? new Date().toISOString() : null,
  });
}

function openToPayEditor(item, prefillName) {
  const isNew = !item;
  if (!item) {
    item = {
      name: prefillName || '', amount: null, dueDate: null,
      paid: false, paidDate: null, isSubscription: false,
      remindWith: 'off', emailTo: '', reminderRules: [],
    };
  }

  openSheet((body) => {
    body.appendChild(h('h3', null, isNew ? 'New item' : 'Edit item'));

    const nameF = h('div', { class: 'field' });
    nameF.innerHTML = '<label>Name</label><input id="tp-name" value="' + esc(item.name) + '">';
    body.appendChild(nameF);

    const amtF = h('div', { class: 'field' });
    amtF.innerHTML = '<label>Amount</label><input id="tp-amt" inputmode="numeric" value="' +
      (item.amount != null ? item.amount : '') + '" placeholder="Optional">';
    body.appendChild(amtF);

    const dueF = h('div', { class: 'field' });
    dueF.innerHTML = '<label>Due date</label><input id="tp-due" type="date" value="' + (item.dueDate || '') + '">';
    body.appendChild(dueF);

    const subF = document.createElement('div');
    subF.className = 'field';
    subF.style.cursor = 'pointer';
    let subState = !!item.isSubscription;
    subF.innerHTML =
      '<div style="display:flex;flex-direction:column;gap:2px;flex:1">' +
        '<label style="color:var(--text);font-weight:600">Recurring subscription</label>' +
        '<span id="tp-sub-hint" style="font-size:11px;color:var(--text2);font-weight:500">' +
          (subState ? 'Rolls forward each month' : 'Deletes after this month') +
        '</span>' +
      '</div>' +
      '<div id="tp-sub-toggle" style="width:44px;height:26px;border-radius:13px;' +
        'background:' + (subState ? '#34c759' : 'var(--track)') + ';' +
        'position:relative;transition:background .2s;flex-shrink:0">' +
        '<div style="position:absolute;top:2px;' + (subState ? 'right:2px' : 'left:2px') + ';' +
          'width:22px;height:22px;border-radius:11px;background:#fff;' +
          'box-shadow:0 1px 2px rgba(0,0,0,.2);transition:left .2s,right .2s"></div>' +
      '</div>';
    subF.onclick = () => {
      subState = !subState;
      const t = document.getElementById('tp-sub-toggle');
      t.style.background = subState ? '#34c759' : 'var(--track)';
      t.firstElementChild.style.left = subState ? 'auto' : '2px';
      t.firstElementChild.style.right = subState ? '2px' : 'auto';
      document.getElementById('tp-sub-hint').textContent =
        subState ? 'Rolls forward each month' : 'Deletes after this month';
    };
    body.appendChild(subF);

    const saveBtn = h('button', { class: 'primary' }, isNew ? 'Add' : 'Save');
    saveBtn.onclick = async () => {
      const name = document.getElementById('tp-name').value.trim();
      if (!name) { toast('Name required'); return; }
      const amtVal = document.getElementById('tp-amt').value.trim();
      const amount = amtVal === '' ? null : Number(amtVal);
      if (amount !== null && (isNaN(amount) || amount < 0)) { toast('Invalid amount'); return; }
      const due = document.getElementById('tp-due').value || '';
      if (subState && !due) { toast('Subscriptions need a due date'); return; }

      const data = {
        name, amount, dueDate: due, isSubscription: subState,
        remindWith: 'off', emailTo: '', reminderRules: [],
      };
      closeSheet();
      if (isNew) {
        await FB.addDoc(toPayCol(), {
          ...data, paid: false, paidDate: null,
          createdAt: new Date().toISOString(),
        });
      } else {
        await FB.updateDoc(FB.doc(toPayCol(), item.id), data);
      }
    };
    body.appendChild(saveBtn);

    if (!isNew) {
      const del = h('button', { class: 'danger' }, 'Delete');
      del.onclick = async () => {
        if (!confirm('Delete "' + item.name + '"?')) return;
        closeSheet();
        await FB.deleteDoc(FB.doc(toPayCol(), item.id));
      };
      body.appendChild(del);
    }
  });
}

// ============================================================
// 14. SCREEN — HISTORY
// ============================================================
ScreenRenderers.history = function () {
  const s = App.settings || DEFAULT_SETTINGS;
  const period = computeCurrentPeriod(s.periodStartDay);
  if (!App.historyYear) App.historyYear = String(period.year);
  const currentYear = App.historyYear;

  const years = Array.from(new Set(App.history.map(h => String(h.periodKey).slice(0, 4)))).sort();
  if (!years.includes(currentYear)) years.push(currentYear);
  years.sort();

  const rows = App.history
    .filter(h => String(h.periodKey).slice(0, 4) === currentYear)
    .sort((a, b) => b.periodKey.localeCompare(a.periodKey));

  const wrap = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'apphead';
  head.innerHTML =
    '<div><div class="greeting">Past periods,</div>' +
    '<div class="appname">History</div></div>' +
    '<div class="avatar">' + (s.appName || 'OB').slice(0, 2).toUpperCase() + '</div>';
  wrap.appendChild(head);

  const prevEnabled = years.includes(String(Number(currentYear) - 1));
  const nextEnabled = years.includes(String(Number(currentYear) + 1));

  const yearDiv = document.createElement('div');
  yearDiv.className = 'year';
  yearDiv.innerHTML =
    '<div class="arr ' + (prevEnabled ? '' : 'disabled') + '" id="hist-prev">‹</div>' +
    '<div class="y">' + currentYear + '</div>' +
    '<div class="arr ' + (nextEnabled ? '' : 'disabled') + '" id="hist-next">›</div>';
  wrap.appendChild(yearDiv);

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = '<div class="emoji">📅</div><div>No periods yet in ' + currentYear + '.<br><b>Check back after a few months.</b></div>';
    wrap.appendChild(empty);
  } else {
    rows.forEach(r => {
      const over = Number(r.totalSpent) > Number(r.budgetSnapshot);
      const pct = Number(r.budgetSnapshot) > 0
        ? Math.min(100, Math.round((Number(r.totalSpent) / Number(r.budgetSnapshot)) * 100))
        : 0;

      const card = document.createElement('div');
      card.className = 'hcard';
      card.innerHTML =
        '<div class="row1">' +
          '<span class="period">' + esc(r.periodLabel) + '</span>' +
          '<span class="pill ' + (over ? 'red' : 'green') + '">' + (over ? 'Over' : 'Within') + '</span>' +
        '</div>' +
        '<div class="row2">' +
          '<div class="cell"><div class="k">Budget</div><div class="v">' + fmtAmount(r.budgetSnapshot) + '</div></div>' +
          '<div class="cell"><div class="k">Spent</div><div class="v' + (over ? ' over' : '') + '">' + fmtAmount(r.totalSpent) + '</div></div>' +
        '</div>' +
        '<div class="bar"><div class="' + (over ? 'over' : 'ok') + '" style="width:' + pct + '%"></div></div>';
      wrap.appendChild(card);
    });
  }

  setTimeout(() => {
    const prev = document.getElementById('hist-prev');
    const next = document.getElementById('hist-next');
    if (prev && !prev.classList.contains('disabled')) {
      prev.onclick = () => { App.historyYear = String(Number(App.historyYear) - 1); renderScreen('history'); };
    }
    if (next && !next.classList.contains('disabled')) {
      next.onclick = () => { App.historyYear = String(Number(App.historyYear) + 1); renderScreen('history'); };
    }
  }, 0);

  return wrap;
};

// ============================================================
// 15. SCREEN — SETTINGS
// ============================================================
ScreenRenderers.settings = function () {
  const s = App.settings || DEFAULT_SETTINGS;
  const parents = App.categories.filter(c => !c.parentId);

  const wrap = document.createElement('div');

  const head = document.createElement('div');
  head.className = 'apphead';
  head.innerHTML =
    '<div><div class="greeting">Tune things,</div>' +
    '<div class="appname">Settings</div></div>' +
    '<div class="avatar">' + (s.appName || 'OB').slice(0, 2).toUpperCase() + '</div>';
  wrap.appendChild(head);

  wrap.appendChild(sectionTitle('General'));
  const g = group();
  g.appendChild(rowInput('App name', 'set-appname', s.appName || ''));
  g.appendChild(rowInput('Currency', 'set-currency', s.currency || 'SEK'));
  g.appendChild(rowInput('Total budget', 'set-budget', s.totalBudget || 0));
  wrap.appendChild(g);

  wrap.appendChild(sectionTitle('Reset'));
  const reset = group();
  reset.appendChild(rowInput('Period start day', 'set-startday', s.periodStartDay || 25));
  wrap.appendChild(reset);
  wrap.appendChild(hint('Period start day determines when your budget period begins.'));

  wrap.appendChild(sectionTitle('Appearance'));
  const appear = group();

  const themeRow = document.createElement('div');
  themeRow.className = 'row';
  themeRow.innerHTML = '<span class="lbl">Theme</span>';
  const seg = document.createElement('div');
  seg.className = 'segmented';
  ['light', 'dark', 'system'].forEach(opt => {
    const b = document.createElement('button');
    b.textContent = opt[0].toUpperCase() + opt.slice(1);
    if (s.theme === opt) b.className = 'active';
    b.onclick = () => changeTheme(opt);
    seg.appendChild(b);
  });
  themeRow.appendChild(seg);
  appear.appendChild(themeRow);

  const toneRow = document.createElement('div');
  toneRow.className = 'row';
  toneRow.innerHTML =
    '<span class="lbl">Hero tone</span>' +
    '<div class="tone-preview" style="background:linear-gradient(160deg,var(--hero-a),var(--hero-b))"></div>';
  toneRow.onclick = () => openTonePicker(s.heroTone || 'forest');
  appear.appendChild(toneRow);
  wrap.appendChild(appear);

  wrap.appendChild(sectionTitle('Categories', parents.length + ' of unlimited'));
  const cats = group();
  parents.forEach(c => {
    const r = document.createElement('div');
    r.className = 'row';
    r.innerHTML = '<span class="lbl">' + esc(c.name) + '</span>' +
      '<span class="val">' + fmtAmount(c.limit) + ' ›</span>';
    r.onclick = () => openCategoryEditor(c);
    cats.appendChild(r);
  });
  const addCat = document.createElement('div');
  addCat.className = 'addcat';
  addCat.innerHTML = '＋ New category';
  addCat.onclick = () => openCategoryEditor(null);
  cats.appendChild(addCat);
  wrap.appendChild(cats);

  wrap.appendChild(sectionTitle('Account'));
  const acct = group();
  acct.appendChild(rowVal('Signed in as', App.user?.email || '—', null));
  const signOutBtn = document.createElement('div');
  signOutBtn.className = 'row';
  signOutBtn.innerHTML = '<span class="lbl" style="color:var(--red);font-weight:600">Sign out</span>';
  signOutBtn.onclick = () => {
    if (confirm('Sign out of Our Budget?')) FB.signOut(FB.auth);
  };
  acct.appendChild(signOutBtn);
  wrap.appendChild(acct);

  setTimeout(() => {
    bindInput('set-appname', v => saveSetting('appName', v));
    bindInput('set-currency', v => saveSetting('currency', v));
    bindInput('set-budget', v => saveSetting('totalBudget', Number(v) || 0));
    bindInput('set-startday', v => {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= 1 && n <= 31) saveSetting('periodStartDay', n);
    });
  }, 0);

  return wrap;
};

function sectionTitle(text, count) {
  const el = document.createElement('div');
  el.className = 'secttl';
  el.innerHTML = esc(text) + (count ? ' <span class="count">' + esc(count) + '</span>' : '');
  return el;
}
function group() { const g = document.createElement('div'); g.className = 'group'; return g; }
function hint(text) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = text; return h; }
function rowInput(label, id, value) {
  const r = document.createElement('div');
  r.className = 'row';
  r.innerHTML = '<span class="lbl">' + esc(label) + '</span>' +
    '<input class="field" id="' + id + '" value="' + esc(value) + '">';
  return r;
}
function rowVal(label, value, onClick) {
  const r = document.createElement('div');
  r.className = 'row';
  r.innerHTML = '<span class="lbl">' + esc(label) + '</span>' +
    '<span class="val">' + esc(value || '') + '</span>';
  if (onClick) r.onclick = onClick;
  return r;
}
function bindInput(id, onCommit) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('blur', () => onCommit(el.value));
  el.addEventListener('keydown', ev => { if (ev.key === 'Enter') el.blur(); });
}
function saveSetting(key, value) {
  FB.updateDoc(budgetDoc(), { [key]: value });
}
function changeTheme(theme) {
  saveSetting('theme', theme);
  if (theme === 'system') {
    document.body.setAttribute('data-theme',
      window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } else {
    document.body.setAttribute('data-theme', theme);
  }
  renderScreen('settings');
}

// ============================================================
// 16. CATEGORY EDITOR
// ============================================================
function openCategoryEditor(cat) {
  const isNew = !cat;
  const editing = cat
    ? Object.assign({}, cat)
    : { name: '', icon: '🏷️', limit: 0, colorKey: 'blue', parentId: '', pinOrder: 0 };

  openSheet((body) => {
    body.appendChild(h('h3', null, isNew ? 'New category' : 'Edit category'));

    const nameF = h('div', { class: 'field' });
    nameF.innerHTML = '<label>Name</label><input id="ce-name" value="' + esc(editing.name) + '">';
    body.appendChild(nameF);

    const limF = h('div', { class: 'field' });
    limF.innerHTML = '<label>Limit</label><input id="ce-limit" inputmode="numeric" value="' + (editing.limit || 0) + '">';
    body.appendChild(limF);

    const iconF = h('div', { class: 'field' });
    iconF.innerHTML = '<label>Icon</label><input id="ce-icon" value="' + esc(editing.icon || '🏷️') + '" maxlength="4" style="width:60px;text-align:right;">';
    body.appendChild(iconF);

    const colorF = h('div', { class: 'field c-' + editing.colorKey });
    colorF.style.cursor = 'pointer';
    colorF.innerHTML =
      '<label>Color</label>' +
      '<div style="display:flex;align-items:center;gap:10px">' +
        '<div id="ce-swatch" style="width:22px;height:22px;border-radius:11px;background:var(--cat);' +
          'box-shadow:inset 0 0 0 2px rgba(255,255,255,.7),0 1px 3px rgba(0,0,0,.12)"></div>' +
        '<span style="color:var(--text3)">›</span>' +
      '</div>';
    colorF.onclick = () => {
      openColorPicker(editing.colorKey, (newKey) => {
        editing.colorKey = newKey;
        colorF.className = 'field c-' + newKey;
        const sw = document.getElementById('ce-swatch');
        if (sw) sw.style.background = 'var(--cat)';
      });
    };
    body.appendChild(colorF);

    const saveBtn = h('button', { class: 'primary' }, isNew ? 'Create' : 'Save');
    saveBtn.onclick = async () => {
      const name = document.getElementById('ce-name').value.trim();
      if (!name) { toast('Name required'); return; }
      const limit = Number(document.getElementById('ce-limit').value) || 0;
      const icon = document.getElementById('ce-icon').value.trim() || '🏷️';
      closeSheet();
      const data = { name, limit, icon, colorKey: editing.colorKey, parentId: editing.parentId || '', pinOrder: editing.pinOrder || 0 };
      if (isNew) {
        await FB.addDoc(categoriesCol(), { ...data, createdAt: new Date().toISOString() });
      } else {
        await FB.updateDoc(FB.doc(categoriesCol(), cat.id), data);
      }
    };
    body.appendChild(saveBtn);

    if (!isNew) {
      const del = h('button', { class: 'danger' }, 'Delete');
      del.onclick = async () => {
        if (!confirm('Delete "' + cat.name + '"? Historical expenses keep their name.')) return;
        closeSheet();
        await FB.deleteDoc(FB.doc(categoriesCol(), cat.id));
      };
      body.appendChild(del);
    }
  });
}

// ============================================================
// 17. EXPENSE EDITOR
// ============================================================
function openExpenseEditor(expense, prefillName) {
  const isNew = !expense;
  const working = expense
    ? Object.assign({}, expense)
    : { name: prefillName || '', amount: 0, categoryId: '', subcategoryId: '' };

  openSheet(body => {
    body.appendChild(h('h3', null, isNew ? 'Add expense' : 'Edit expense'));

    const nameF = h('div', { class: 'field' });
    nameF.innerHTML = '<label>Name</label><input id="exp-name" value="' + esc(working.name) + '">';
    body.appendChild(nameF);

    const amtF = h('div', { class: 'field' });
    amtF.innerHTML = '<label>Amount</label><input id="exp-amt" inputmode="numeric" value="' +
      (working.amount || '') + '" placeholder="0">';
    body.appendChild(amtF);

    body.appendChild(h('div', {
      style: 'font-size:11px;color:var(--text2);font-weight:700;' +
        'text-transform:uppercase;letter-spacing:.5px;margin:14px 4px 8px;'
    }, 'Category'));

    const parents = App.categories.filter(c => !c.parentId);
    let chosenCat = working.categoryId || (parents[0] ? parents[0].id : null);

    parents.forEach(c => {
      const row = document.createElement('div');
      row.className = 'field';
      row.style.cursor = 'pointer';
      row.innerHTML =
        '<div style="display:flex;align-items:center;gap:10px;flex:1">' +
          '<div class="cat-icon c-' + (c.colorKey || 'blue') + '" ' +
            'style="width:30px;height:30px;border-radius:10px;font-size:14px;' +
              'display:flex;align-items:center;justify-content:center">' +
            esc(c.icon || '🏷️') +
          '</div>' +
          '<span style="font-weight:600">' + esc(c.name) + '</span>' +
        '</div>' +
        '<span class="cat-check" style="color:var(--blue);font-weight:800;opacity:' +
          (chosenCat === c.id ? '1' : '0') + '">✓</span>';
      row.onclick = () => {
        chosenCat = c.id;
        body.querySelectorAll('.cat-check').forEach(el => el.style.opacity = '0');
        row.querySelector('.cat-check').style.opacity = '1';
      };
      body.appendChild(row);
    });

    const saveBtn = h('button', { class: 'primary' }, isNew ? 'Add expense' : 'Save');
    saveBtn.onclick = async () => {
      const name = document.getElementById('exp-name').value.trim();
      const amount = Number(document.getElementById('exp-amt').value);
      if (!name) { toast('Name required'); return; }
      if (!amount || amount <= 0) { toast('Amount must be > 0'); return; }
      if (!chosenCat) { toast('Pick a category'); return; }
      closeSheet();

      if (isNew) {
        const periodKey = computeCurrentPeriod(App.settings.periodStartDay).key;
        const now = new Date().toISOString();
        await FB.addDoc(expensesCol(), {
          name, amount, categoryId: chosenCat, subcategoryId: '',
          dateAdded: now, periodKey,
        });
        await ensureHistoryRowForCurrentPeriod();
      } else {
        await FB.updateDoc(FB.doc(expensesCol(), expense.id), { name, amount, categoryId: chosenCat });
        await recomputeHistoryTotal(expense.periodKey);
      }
    };
    body.appendChild(saveBtn);

    if (!isNew) {
      const del = h('button', { class: 'danger' }, 'Delete');
      del.onclick = async () => {
        if (!confirm('Delete "' + expense.name + '"?')) return;
        closeSheet();
        await FB.deleteDoc(FB.doc(expensesCol(), expense.id));
        await recomputeHistoryTotal(expense.periodKey);
      };
      body.appendChild(del);
    }
  });
}

// ============================================================
// 18. HISTORY MAINTENANCE
// ============================================================
async function ensureHistoryRowForCurrentPeriod() {
  const period = computeCurrentPeriod(App.settings.periodStartDay);
  const docRef = FB.doc(historyCol(), period.key);
  const snap = await FB.getDoc(docRef);
  if (!snap.exists()) {
    await FB.setDoc(docRef, {
      periodKey: period.key,
      periodLabel: period.label,
      budgetSnapshot: Number(App.settings.totalBudget) || 0,
      totalSpent: 0,
    });
  }
  await recomputeHistoryTotal(period.key);
}

async function recomputeHistoryTotal(periodKey) {
  if (!periodKey) return;
  const total = App.expenses
    .filter(e => e.periodKey === periodKey)
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const docRef = FB.doc(historyCol(), periodKey);
  const snap = await FB.getDoc(docRef);
  if (snap.exists()) {
    await FB.updateDoc(docRef, { totalSpent: total });
  }
}

// ============================================================
// 19. COLOR PICKER (50 colors)
// ============================================================
const PALETTE = [
  'blue','sky','azure','teal','mint','cyan','ocean','indigo','violet','lavender',
  'green','emerald','forest','pine','lime','jade','sage','seafoam','pistachio','olive',
  'amber','orange','tangerine','coral','gold','mustard','apricot','peach','saffron','honey',
  'red','crimson','ruby','rose','raspberry','pink','magenta','fuchsia','salmon','blush',
  'brown','cocoa','coffee','slate','steel','gray','stone','sand','clay','graphite',
];

function openColorPicker(currentKey, onPick) {
  openSheet(body => {
    body.appendChild(h('h3', null, 'Pick a color'));
    const grid = document.createElement('div');
    grid.className = 'palette-grid';
    PALETTE.forEach(key => {
      const chip = document.createElement('div');
      chip.className = 'color-chip c-' + key + (currentKey === key ? ' on' : '');
      chip.onclick = () => { onPick(key); closeSheet(); };
      grid.appendChild(chip);
    });
    body.appendChild(grid);
  });
}

// ============================================================
// 20. TONE PICKER (15 tones)
// ============================================================
const TONES = [
  { key: 'forest',   name: 'Forest',   a: '#1b4332', b: '#40916c' },
  { key: 'ocean',    name: 'Ocean',    a: '#0a84ff', b: '#5b4bff' },
  { key: 'midnight', name: 'Midnight', a: '#1a1a2e', b: '#3b2f6b' },
  { key: 'twilight', name: 'Twilight', a: '#3a1c71', b: '#d76d77' },
  { key: 'emerald',  name: 'Emerald',  a: '#0f766e', b: '#14b8a6' },
  { key: 'sunset',   name: 'Sunset',   a: '#ff512f', b: '#f09819' },
  { key: 'coral',    name: 'Coral',    a: '#ff6b6b', b: '#ee5a24' },
  { key: 'rose',     name: 'Rose',     a: '#c9184a', b: '#ff8fab' },
  { key: 'grape',    name: 'Grape',    a: '#5f0f40', b: '#9a031e' },
  { key: 'graphite', name: 'Graphite', a: '#2b2d42', b: '#4a4e69' },
  { key: 'sand',     name: 'Sand',     a: '#a47148', b: '#d4a373' },
  { key: 'slate',    name: 'Slate',    a: '#33415c', b: '#5c6b8a' },
  { key: 'berry',    name: 'Berry',    a: '#6a0572', b: '#ab83a1' },
  { key: 'mint',     name: 'Mint',     a: '#009688', b: '#7fdbca' },
  { key: 'blush',    name: 'Blush',    a: '#e07a5f', b: '#f2cc8f' },
];

function openTonePicker(currentKey) {
  openSheet(body => {
    body.appendChild(h('h3', null, 'Hero tone'));
    const grid = document.createElement('div');
    grid.className = 'tone-grid';
    TONES.forEach(t => {
      const tile = document.createElement('div');
      tile.className = 'tone-tile' + (currentKey === t.key ? ' on' : '');
      tile.style.background = 'linear-gradient(160deg,' + t.a + ' 0%,' + t.b + ' 100%)';
      tile.textContent = t.name;
      tile.onclick = () => {
        saveSetting('heroTone', t.key);
        closeSheet();
        renderScreen('settings');
      };
      grid.appendChild(tile);
    });
    body.appendChild(grid);
  });
}

// ============================================================
// 21. PERIOD HELPERS
// ============================================================
function computeCurrentPeriod(startDay) {
  startDay = startDay || 25;
  const now = new Date();
  const todayDay = now.getDate();
  const todayMonth = now.getMonth();
  const todayYear = now.getFullYear();

  let startYear, startMonth;
  if (todayDay >= startDay) {
    startYear = todayYear;
    startMonth = todayMonth;
  } else {
    const prev = new Date(todayYear, todayMonth - 1, 1);
    startYear = prev.getFullYear();
    startMonth = prev.getMonth();
  }

  const startDate = clampDay(startYear, startMonth, startDay);
  const endDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, startDate.getDate() - 1);
  const key = pad2(startDate.getFullYear()) + '-' + pad2(startDate.getMonth() + 1);
  const label = formatPeriodLabel(startDate, endDate);

  const msPerDay = 86400000;
  const daysTotal = Math.round((endDate - startDate) / msPerDay) + 1;
  const todayMidnight = new Date(todayYear, todayMonth, todayDay);
  const daysLeft = Math.max(0, Math.round((endDate - todayMidnight) / msPerDay));

  return {
    key, year: startDate.getFullYear(),
    start: startDate.toISOString(), end: endDate.toISOString(),
    label, daysTotal, daysLeft,
  };
}

function clampDay(year, month0, day) {
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  return new Date(year, month0, Math.min(day, lastDay));
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function formatPeriodLabel(start, end) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const sameYear = start.getFullYear() === end.getFullYear();
  const s = start.getDate() + ' ' + months[start.getMonth()] + (sameYear ? '' : ' ' + start.getFullYear());
  const e = end.getDate() + ' ' + months[end.getMonth()] + ' ' + end.getFullYear();
  return s + ' – ' + e;
}
function labelForDay(iso) {
  if (iso === 'unknown') return 'Unknown date';
  const d = new Date(iso + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Today · ' + d.getDate() + ' ' + monthShort(d);
  if (diff === 1) return 'Yesterday · ' + d.getDate() + ' ' + monthShort(d);
  return d.getDate() + ' ' + monthShort(d);
}
function monthShort(d) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
}