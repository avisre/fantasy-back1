const API_URL = '/api';
let STRIPE_PUBLISHABLE_KEY = 'pk_test_replace_with_real_key';

async function initiateStripeCheckout(email) {
  if (typeof Stripe !== 'function') {
    throw new Error('Stripe.js not loaded');
  }
  const resp = await fetch(`${API_URL}/stripe/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.message || 'Unable to start checkout');
  }
  const payload = await resp.json();
  if (!payload.sessionId) {
    throw new Error('Missing Stripe session ID from backend');
  }
  const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
  const { error } = await stripe.redirectToCheckout({ sessionId: payload.sessionId });
  if (error) throw error;
}
// (auth gating removed – original behavior)
const PAGE_NAME = (() => {
  const raw = location.pathname.split('/').filter(Boolean).pop();
  return raw ? raw.toLowerCase() : 'index.html';
})();
const RESTRICTED_PAGES = new Set(['dashboard.html', 'fundamentals.html', 'news.html']);

const getToken = () => localStorage.getItem('token');

if (RESTRICTED_PAGES.has(PAGE_NAME) && !getToken()) {
  const next = PAGE_NAME + (location.search || '');
  window.location.replace(`login.html?next=${encodeURIComponent(next)}`);
}

function configureNavAuthState() {
  const authed = Boolean(getToken());
  document.querySelectorAll('a[data-guarded]').forEach(link => {
    const original = link.dataset.originalHref || link.getAttribute('href');
    link.dataset.originalHref = original;
    if (!authed) {
      const next = original.replace(/^\/+/, '');
      link.setAttribute('href', `login.html?next=${encodeURIComponent(next)}`);
    } else {
      link.setAttribute('href', link.dataset.originalHref);
    }
  });

  document.querySelectorAll('[data-show-when]').forEach(el => {
    const mode = el.dataset.showWhen;
    if (mode === 'authed') {
      el.style.display = authed ? '' : 'none';
    } else if (mode === 'guest') {
      el.style.display = authed ? 'none' : '';
    }
  });
}

document.addEventListener('DOMContentLoaded', configureNavAuthState);
window.addEventListener('storage', (evt) => {
  if (evt.key === 'token') configureNavAuthState();
});
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('toggle-headings');
  if (btn) {
    btn.addEventListener('click', () => {
      const nextState = !document.body.classList.contains('show-menu');
      document.body.classList.toggle('show-menu', nextState);
      document.body.classList.toggle('show-headings', nextState);
      btn.setAttribute('aria-expanded', nextState ? 'true' : 'false');
    });
  }
  // Light, friendly blink on cartoon stickers (replacing question marks)
  try {
    document.querySelectorAll('.sticker.face').forEach((el, idx) => {
      const delay = 500 + (idx * 300) + Math.random() * 1500;
      setTimeout(() => el.classList.add('blink'), delay);
    });
  } catch (_) {}
});

const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const ARROW_UP = '^';
const ARROW_DOWN = 'v';
const ARROW_FLAT = '-';
const getSharedTooltip = (() => {
  let tooltipEl = null;
  return () => {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.className = 'chart-tooltip';
      tooltipEl.setAttribute('role', 'status');
      tooltipEl.classList.remove('show');
      (document.body || document.documentElement).appendChild(tooltipEl);
    }
    return tooltipEl;
  };
})();
const SYMBOL_TONES = {
  AAPL: { label: 'Tech', tone: 'tech' },
  MSFT: { label: 'Tech', tone: 'tech' },
  TSLA: { label: 'Auto', tone: 'auto' },
  RIVN: { label: 'Auto', tone: 'auto' },
  PFE: { label: 'Health', tone: 'health' },
  AMZN: { label: 'Commerce', tone: 'commerce' },
  GOOGL: { label: 'Tech', tone: 'tech' },
  NVDA: { label: 'Tech', tone: 'tech' },
};
const SECTOR_TONES = [
  { match: ['technology','information technology'], label:'Tech', tone:'tech' },
  { match: ['healthcare','health care','health'], label:'Health', tone:'health' },
  { match: ['consumer cyclical','consumer defensive','consumer discretionary'], label:'Consumer', tone:'commerce' },
  { match: ['financial services','financial','finance'], label:'Finance', tone:'finance' },
  { match: ['industrials','industrial'], label:'Industrials', tone:'industrial' },
  { match: ['communication services','communications'], label:'Comm', tone:'communications' },
  { match: ['energy'], label:'Energy', tone:'energy' },
  { match: ['real estate'], label:'Real Estate', tone:'realestate' },
  { match: ['utilities','utility'], label:'Utility', tone:'utility' },
  { match: ['basic materials','materials'], label:'Materials', tone:'materials' },
  { match: ['automotive','auto manufacturers'], label:'Auto', tone:'auto' }
];

function getSectorMeta(symbol, sector) {
  if (sector) {
    const normalized = sector.toString().toLowerCase();
    const match = SECTOR_TONES.find(entry => entry.match.some(label => normalized.indexOf(label) !== -1));
    if (match) return { label: match.label, tone: match.tone };
  }
  return SYMBOL_TONES[symbol] || { label: sector || 'Equity', tone: 'neutral' };
}

function formatCurrencyValue(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  return currencyFormatter.format(numeric);
}

function formatCurrencySigned(value) {
  const numeric = Number.isFinite(value) ? value : 0;
  const abs = currencyFormatter.format(Math.abs(numeric));
  return `${numeric >= 0 ? '+' : '-'}${abs}`;
}

function applyTrendClass(el, value) {
  if (!el) return;
  el.classList.remove('gain', 'loss', 'neutral');
  if (value > 0) el.classList.add('gain');
  else if (value < 0) el.classList.add('loss');
  else el.classList.add('neutral');
}

// Stock suggestion dataset (shared across dashboard & fundamentals)
const STOCK_SUGGESTIONS = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'GOOGL', name: 'Alphabet Inc. Class A' },
  { symbol: 'GOOG', name: 'Alphabet Inc. Class C' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.' },
  { symbol: 'META', name: 'Meta Platforms Inc.' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation' },
  { symbol: 'AMD', name: 'Advanced Micro Devices Inc.' },
  { symbol: 'INTC', name: 'Intel Corporation' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor Manufacturing' },
  { symbol: 'NFLX', name: 'Netflix Inc.' },
  { symbol: 'DIS', name: 'Walt Disney Co.' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.' },
  { symbol: 'BAC', name: 'Bank of America Corp.' },
  { symbol: 'V', name: 'Visa Inc.' },
  { symbol: 'MA', name: 'Mastercard Inc.' },
  { symbol: 'WMT', name: 'Walmart Inc.' },
  { symbol: 'COST', name: 'Costco Wholesale Corp.' },
  { symbol: 'KO', name: 'Coca-Cola Co.' },
  { symbol: 'PEP', name: 'PepsiCo Inc.' },
  { symbol: 'NKE', name: 'Nike Inc.' },
  { symbol: 'CRM', name: 'Salesforce Inc.' },
  { symbol: 'ORCL', name: 'Oracle Corporation' },
  { symbol: 'SAP', name: 'SAP SE' },
  { symbol: 'PYPL', name: 'PayPal Holdings Inc.' },
  { symbol: 'SQ', name: 'Block Inc.' },
  { symbol: 'UBER', name: 'Uber Technologies Inc.' },
  { symbol: 'LYFT', name: 'Lyft Inc.' },
  { symbol: 'BABA', name: 'Alibaba Group Holding Ltd.' },
  { symbol: 'T', name: 'AT&T Inc.' },
  { symbol: 'VZ', name: 'Verizon Communications' },
  { symbol: 'XOM', name: 'Exxon Mobil Corporation' },
  { symbol: 'CVX', name: 'Chevron Corporation' },
  { symbol: 'ABNB', name: 'Airbnb Inc.' },
  { symbol: 'SHOP', name: 'Shopify Inc.' },
  { symbol: 'ADBE', name: 'Adobe Inc.' },
  { symbol: 'MRNA', name: 'Moderna Inc.' },
  { symbol: 'PFE', name: 'Pfizer Inc.' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
  { symbol: 'MCD', name: "McDonald's Corporation" },
  { symbol: 'SBUX', name: 'Starbucks Corporation' }
];

function densifySeries(series, target = 12) {
  if (!Array.isArray(series) || series.length < 2) return series.slice();
  if (series.length >= target) return series.slice();
  const result = [];
  const gaps = series.length - 1;
  const extraNeeded = target - series.length;
  const perGap = Math.max(1, Math.ceil(extraNeeded / gaps));
  for (let i = 0; i < series.length - 1; i++) {
    const start = series[i];
    const end = series[i + 1];
    result.push(start);
    for (let step = 1; step <= perGap; step++) {
      const t = step / (perGap + 1);
      result.push({
        date: new Date(start.date.getTime() + t * (end.date.getTime() - start.date.getTime())),
        value: start.value + t * (end.value - start.value)
      });
    }
  }
  result.push(series[series.length - 1]);
  return result;
}

function filterStockSuggestions(query, maxResults = 8) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return STOCK_SUGGESTIONS.filter(item =>
    item.symbol.toLowerCase().includes(normalized) ||
    item.name.toLowerCase().includes(normalized)
  ).slice(0, maxResults);
}

function attachSymbolAutocomplete({ input, results, onSelect, maxResults = 8 }) {
  if (!input || !results) return;
  let suggestions = [];

  function hideList() {
    results.style.display = 'none';
    results.innerHTML = '';
    suggestions = [];
  }

  function renderList(list) {
    if (!list.length) {
      hideList();
      return;
    }
    suggestions = list;
    const frag = document.createDocumentFragment();
    list.forEach((item, index) => {
      const li = document.createElement('li');
      li.dataset.index = String(index);
      li.textContent = `${item.name} (${item.symbol})`;
      frag.appendChild(li);
    });
    results.innerHTML = '';
    results.appendChild(frag);
    results.style.display = 'block';
  }

  input.addEventListener('input', async () => {
    const q = (input.value || '').trim();
    if (q.length < 2) { hideList(); onSelect?.(null); return; }
    let list = [];
    if (window.SymbolLookup && typeof window.SymbolLookup.searchOne === 'function') {
      try { list = await window.SymbolLookup.searchOne(q); } catch {}
    }
    if (!Array.isArray(list) || !list.length) {
      list = filterStockSuggestions(q, maxResults);
    }
    if (!list.length) { hideList(); onSelect?.(null); return; }
    renderList(list);
    onSelect?.(null);
  });

  results.addEventListener('mousedown', (event) => {
    const li = event.target.closest('li');
    if (!li) return;
    event.preventDefault();
    const item = suggestions[Number(li.dataset.index)];
    hideList();
    if (item) onSelect?.(item);
  });

  document.addEventListener('click', (event) => {
    if (event.target === input || results.contains(event.target)) return;
    hideList();
  });
}

window.attachSymbolAutocomplete = attachSymbolAutocomplete;

let portfolioValueOverTime = []; // To track the portfolio value over time
let stockAllocationOverTime = []; // To track stock allocation over time
let stockSymbols = []; // To keep track of stock symbols

//////////////////////////////////
// LOGIN FUNCTIONALITY
//////////////////////////////////
if (document.getElementById('login-form')) {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault(); // Prevent default form submission
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message'); // Error message div

    // Clear previous error messages
    if (errorMessage) {
      errorMessage.textContent = '';
      errorMessage.style.display = 'none';
    }
    

    try {
      const response = await fetch(`${API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (response.ok) {
        // If login is successful, save token to localStorage and redirect to dashboard
        localStorage.setItem('token', data.token);
        window.location.href = (new URLSearchParams(location.search).get('next') || 'dashboard.html'); // Redirect to the dashboard page
      } else {
        // Display error message if login failed
        if (errorMessage) {
          errorMessage.textContent = data.message || 'Login failed, please try again.';
          errorMessage.style.display = 'block';
        }
      }
    } catch (error) {
      console.error('Error logging in:', error);
      if (errorMessage) {
        errorMessage.textContent = 'Something went wrong. Please try again later.';
        errorMessage.style.display = 'block';
      }
    }
    
  });
}
const checkoutAction = document.getElementById('checkout-button');
if (checkoutAction) {
  checkoutAction.addEventListener('click', async () => {
    const emailInput = document.getElementById('email');
    const email = emailInput ? emailInput.value.trim() : '';
    if (!email) {
      alert('Please enter an email address before starting checkout.');
      emailInput?.focus();
      return;
    }
    try {
      await initiateStripeCheckout(email);
    } catch (err) {
      console.error('Stripe checkout failed:', err);
      alert(err.message || 'Unable to start checkout.');
    }
  });
}

async function loadStripeConfig() {
  try {
    const response = await fetch('/stripe/config');
    if (!response.ok) return;
    const data = await response.json();
    if (data.publishableKey) {
      STRIPE_PUBLISHABLE_KEY = data.publishableKey;
    }
  } catch (err) {
    console.warn('Unable to load Stripe configuration:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadStripeConfig();
});

//////////////////////////////////
// PORTFOLIO FUNCTIONALITY (Dashboard)
//////////////////////////////////

// Ensure user is logged in by checking the token
if (window.location.pathname.endsWith('dashboard.html')) {
  // Loader controls
  const showLoader = () => { const el=document.getElementById('loading-overlay'); if(el) el.removeAttribute('hidden'); };
  const hideLoader = () => { const el=document.getElementById('loading-overlay'); if(el) el.setAttribute('hidden',''); };
  let selectedCompany = null; // { symbol, name }
  let symbolNames = {};
  try { symbolNames = JSON.parse(localStorage.getItem('symbolNames')||'{}'); } catch {}
  async function ensureAuth() {
    if (getToken()) return true;
    window.location.replace('login.html?next=dashboard.html');
    return false;
  }

  // Theme toggle (light/dark)
  const themeToggleBtn = document.getElementById('theme-toggle');
  const applyTheme = (theme) => {
    if (theme === 'dark') {
      document.body.classList.add('dark');
      if (themeToggleBtn) themeToggleBtn.textContent = '☀️';
    } else {
      document.body.classList.remove('dark');
      if (themeToggleBtn) themeToggleBtn.textContent = '🌙';
    }
  };
  const storedTheme = localStorage.getItem('theme') || 'light';
  applyTheme(storedTheme);
  // Ensure readable label text
  if (themeToggleBtn) themeToggleBtn.textContent = document.body.classList.contains('dark') ? 'Light' : 'Dark';
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const next = document.body.classList.contains('dark') ? 'light' : 'dark';
      localStorage.setItem('theme', next);
      applyTheme(next);
      if (themeToggleBtn) themeToggleBtn.textContent = document.body.classList.contains('dark') ? 'Light' : 'Dark';
    });
  }

  // Alpha Vantage helpers (use default key if none stored)
  const DEFAULT_ALPHA_KEY = '6VWT72JNHHLBF3MH';
  const getAlphaKey = () => localStorage.getItem('alpha_key') || DEFAULT_ALPHA_KEY;
  async function fetchDailySeries(symbol, output='compact'){
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&outputsize=${output}&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(getAlphaKey())}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const series = data['Time Series (Daily)'] || {};
    // ascending array of {date, close}
    return Object.keys(series).sort().map(d=>({ date: new Date(d+'T00:00:00'), close: parseFloat(series[d]['4. close']) }));
  }
  let symbolSeries = {}; // { [symbol]: Array<{date, close}> }
function buildAggregateSeries(portfolio, earliestStart){
    // Union of dates
    const dateSet = new Set();
    Object.values(symbolSeries).forEach(arr => (arr||[]).forEach(pt => dateSet.add(+pt.date)) );
    if(dateSet.size===0) return [];
    let dates = Array.from(dateSet).sort((a,b)=>a-b).map(ts=> new Date(ts));
    // Filter to user portfolio start (earliest purchaseDate)
    if (earliestStart) { dates = dates.filter(d => d >= earliestStart); }
  // Maps for forward fill with per-holding purchase start dates
  const maps = portfolio.map(s=>({ shares:s.shares, start: (s.purchaseDate? new Date(s.purchaseDate) : earliestStart) || earliestStart, map: new Map((symbolSeries[s.symbol]||[]).map(pt=> [+pt.date, pt.close])) }));
    const lastPrice = maps.map(()=> null);
    const out = [];
    dates.forEach(d=>{
      let total=0;
      maps.forEach((m,idx)=>{
        const key=+d; const price = m.map.has(key)? m.map.get(key) : lastPrice[idx];
        if(m.map.has(key)) lastPrice[idx] = m.map.get(key);
      if(price!=null && (!m.start || d >= m.start)) total += price * m.shares;
      });
      out.push({ date:d, value: total });
    });
    return out;
  }
async function hydratePerfFromAlpha(portfolio){
  const syms = Array.from(new Set(portfolio.map(s=> s.symbol)));
  const outputs = await Promise.all(syms.map(sym => fetchDailySeries(sym, 'compact').catch(()=>[])));
  symbolSeries = {}; syms.forEach((sym,i)=> symbolSeries[sym] = outputs[i] || []);
  const earliest = portfolio.reduce((acc,s)=>{ const d = s.purchaseDate? new Date(s.purchaseDate) : null; return (!acc|| (d && d<acc))? d : acc; }, null);
  portfolioStartDate = earliest || null;
  perfSeriesAll = buildAggregateSeries(portfolio, portfolioStartDate);
}

  // Fetch and display portfolio data when the dashboard is loaded
  async function fetchPortfolio() {
    showLoader();
    try {
      const response = await fetch(`${API_URL}/portfolio`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      const portfolio = await response.json();

      // Optional demo seeding only when ?demo=1 is present
      const demo = new URLSearchParams(location.search||'').get('demo');
      if (demo === '1' && Array.isArray(portfolio) && portfolio.length === 0 && !localStorage.getItem('seeded')) {
        await addStockDirect('AAPL', 10);
        await addStockDirect('MSFT', 5);
        localStorage.setItem('seeded', 'yes');
        return fetchPortfolio();
      }
      updatePortfolio(portfolio);
      drawStackedAreaChart();
      try{ await hydratePerfFromAlpha(portfolio); }catch(e){ console.warn('Alpha series hydration failed, using demo', e); }
      drawInteractiveLineChart();
      try { await updateBenchmarkSinceStart(); } catch {}
    } catch (error) {
      console.error('Error fetching portfolio:', error);
      // Fallback demo so UI remains interactive even if backend is unavailable
      try {
        regeneratePerfSeries(1000);
        drawInteractiveLineChart();
      } catch {}
    } finally { hideLoader(); }
  }

  // Helper to add a stock via API
  async function addStockDirect(symbol, shares) {
    try {
      const response = await fetch(`${API_URL}/portfolio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ symbol, shares, purchaseDate: new Date().toISOString() }),
      });
      if (!response.ok) {
        console.warn('Seeding add stock failed for', symbol);
      }
    } catch (e) {
      console.error('Error adding stock (seed):', e);
    }
  }

  function updatePortfolio(portfolio) {
    const stocksListElement = document.getElementById('stocks-list');
    const totalValueElement = document.getElementById('total-value');
    const totalDeltaElement = document.getElementById('total-delta');
    const dayChangeValueElement = document.getElementById('day-change-value');
    const dayChangeDeltaElement = document.getElementById('day-change-delta');
    const holdingsCountElement = document.getElementById('holdings-count');
    const holdingsNoteElement = document.getElementById('holdings-note');
    const ytdValueElement = document.getElementById('percentage-change');
    const ytdNoteElement = document.getElementById('ytd-note');

    if (stocksListElement) stocksListElement.innerHTML = '';

    let totalValue = 0;
    let totalPurchaseValue = 0;
    const allocationsMap = {};
    const sectorLookup = {};

    stockAllocationOverTime = [];
    stockSymbols = [];
    const rows = [];

    portfolio.forEach((stock) => {
      if (stock.name && stock.symbol) {
        symbolNames[stock.symbol] = stock.name;
      }
      const symbol = (stock.symbol || '').toUpperCase();
      const shares = Number(stock.shares) || 0;
      const purchasePrice = Number(stock.purchasePrice) || 0;
      const currentPrice = Number(stock.currentPrice) || 0;
      const stockValue = currentPrice * shares;
      const purchaseValue = purchasePrice * shares;
      const sector = (stock.sector || '').trim();

      totalValue += stockValue;
      totalPurchaseValue += purchaseValue;
      allocationsMap[symbol] = (allocationsMap[symbol] || 0) + stockValue;
      if (sector) sectorLookup[symbol] = sector;

      if (!stockSymbols.includes(symbol)) stockSymbols.push(symbol);

      const stockData = [];
      for (let day = 1; day <= 10; day++) {
        stockData.push({
          day,
          value: stockValue * (1 + (Math.random() - 0.5) / 10),
        });
      }
      stockAllocationOverTime.push({ symbol, data: stockData });

      const deltaValue = stockValue - purchaseValue;
      const percentRaw = purchasePrice ? ((currentPrice - purchasePrice) / purchasePrice) * 100 : 0;
      const percentDisplay = `${percentRaw >= 0 ? '+' : '-'}${Math.abs(percentRaw).toFixed(2)}%`;
      const plClass = percentRaw > 0 ? 'gain' : percentRaw < 0 ? 'loss' : 'neutral';

      const meta = getSectorMeta(symbol, sector);
      const companyName = stock.name || symbolNames[symbol] || symbol;
      symbolNames[symbol] = companyName;

      rows.push(`
        <tr data-symbol="${symbol}">
          <td>
            <div class="holding-name">${companyName}</div>
          </td>
          <td>
            <div class="symbol-cell">
              <span class="symbol-code">${symbol}</span>
              <span class="symbol-pill" data-tone="${meta.tone}">
                <span class="pill-dot" aria-hidden="true"></span>${meta.label}
              </span>
            </div>
          </td>
          <td class="num">${numberFormatter.format(shares)}</td>
          <td class="num">${formatCurrencyValue(purchasePrice)}</td>
          <td class="num">${formatCurrencyValue(currentPrice)}</td>
          <td class="pl-cell">
            <div class="pl-value ${plClass}">${formatCurrencySigned(deltaValue)}</div>
            <div class="pl-sub ${plClass}">${percentDisplay}</div>
            <button class="table-action" type="button" onclick="deleteStock('${stock._id}')">Remove</button>
          </td>
        </tr>
      `);
    });

    if (stocksListElement) stocksListElement.innerHTML = rows.join('');

    portfolioValueOverTime = [];
    for (let day = 1; day <= 10; day++) {
      let dayValue = 0;
      stockAllocationOverTime.forEach(stock => {
        const stockDayData = stock.data.find(d => d.day === day);
        dayValue += stockDayData ? stockDayData.value : 0;
      });
      portfolioValueOverTime.push({ day, value: dayValue });
    }

    const totalGainLoss = totalValue - totalPurchaseValue;
    const percentageChange = totalPurchaseValue ? (totalGainLoss / totalPurchaseValue) * 100 : 0;

    if (totalValueElement) totalValueElement.textContent = formatCurrencyValue(totalValue);
    if (totalDeltaElement) {
      const deltaArrow = percentageChange > 0 ? ARROW_UP : percentageChange < 0 ? ARROW_DOWN : ARROW_FLAT;
      totalDeltaElement.textContent = `${deltaArrow} ${Math.abs(percentageChange).toFixed(2)}%`;
      applyTrendClass(totalDeltaElement, percentageChange);
    }

    if (holdingsCountElement) holdingsCountElement.textContent = portfolio.length;

    let dayChange = 0;
    if (portfolioValueOverTime.length >= 2) {
      const last = portfolioValueOverTime[portfolioValueOverTime.length - 1].value;
      const prev = portfolioValueOverTime[portfolioValueOverTime.length - 2].value;
      dayChange = last - prev;
    }

    if (dayChangeValueElement) {
      dayChangeValueElement.textContent = formatCurrencySigned(dayChange);
      applyTrendClass(dayChangeValueElement, dayChange);
    }
    if (dayChangeDeltaElement) {
      const totalArrow = totalGainLoss > 0 ? ARROW_UP : totalGainLoss < 0 ? ARROW_DOWN : ARROW_FLAT;
      dayChangeDeltaElement.textContent = `${totalArrow} ${formatCurrencyValue(Math.abs(totalGainLoss))}`;
      applyTrendClass(dayChangeDeltaElement, totalGainLoss);
    }

    if (holdingsNoteElement) {
      let holdingsTrend = 0;
      let holdingsMessage = 'Add positions';
      if (portfolio.length) {
        const stabilityThreshold = Math.max(totalValue * 0.0015, 5);
        if (Math.abs(dayChange) <= stabilityThreshold) {
          holdingsMessage = 'Stable';
          holdingsTrend = 0;
        } else if (dayChange > 0) {
          holdingsMessage = 'Trending up';
          holdingsTrend = 1;
        } else {
          holdingsMessage = 'Needs attention';
          holdingsTrend = -1;
        }
      }
      holdingsNoteElement.textContent = holdingsMessage;
      applyTrendClass(holdingsNoteElement, holdingsTrend);
    }

    if (ytdValueElement) {
      ytdValueElement.textContent = `${percentageChange >= 0 ? '+' : '-'}${Math.abs(percentageChange).toFixed(2)}%`;
      applyTrendClass(ytdValueElement, percentageChange);
    }
    if (ytdNoteElement) {
      ytdNoteElement.textContent = percentageChange >= 0 ? 'Beating S&P' : 'Trailing benchmark';
      applyTrendClass(ytdNoteElement, percentageChange);
    }

    try { localStorage.setItem('symbolNames', JSON.stringify(symbolNames)); } catch {}

    const listEl = document.getElementById('stocks-list');
    if (listEl && !listEl.dataset.clickable) {
      listEl.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const row = e.target.closest('tr[data-symbol]');
        if (!row) return;
        const sym = row.dataset.symbol;
        if (sym) window.location.href = `fundamentals.html?symbol=${encodeURIComponent(sym)}`;
      });
      listEl.dataset.clickable = 'true';
    }

    const allocations = Object.keys(allocationsMap).map(symbol => ({
      symbol,
      value: allocationsMap[symbol],
      name: symbolNames[symbol] || symbol,
      sector: sectorLookup[symbol] || ''
    }));
    drawAllocationDonutChart(allocations);
  }

  // Add stock to the portfolio
  document.getElementById('add-stock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = document.getElementById('stock-symbol').value.trim();
    const shares = document.getElementById('shares').value.trim();

    // derive symbol/name from selection or typed input "Name (SYM)" or just symbol
    let symbol, name;
    if (selectedCompany) {
      symbol = String(selectedCompany.symbol||'').toUpperCase();
      name = selectedCompany.name||symbol;
    } else {
      const m = raw.match(/^(.*)\(([^)]+)\)\s*$/);
      if (m) { name = m[1].trim(); symbol = m[2].trim().toUpperCase(); }
      else { symbol = raw.toUpperCase(); name = symbol; }
    }

    if (symbol && shares) {
      const stock = { symbol, name, shares: parseFloat(shares), purchaseDate: new Date().toISOString() };
      try {
        showLoader();
        const response = await fetch(`${API_URL}/portfolio`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify(stock),
        });

        if (response.ok) {
          // remember human-friendly name for display (local cache)
          if (name && symbol) {
            symbolNames[symbol] = name;
            localStorage.setItem('symbolNames', JSON.stringify(symbolNames));
          }
          selectedCompany = null;
          companySearchInput.value = '';
          document.getElementById('shares').value = '';
          fetchPortfolio(); // Refresh portfolio after adding stock
        } else {
          alert('Error adding stock');
        }
      } catch (error) {
        console.error('Error adding stock:', error);
      } finally { hideLoader(); }
    }
  });

  // Delete stock from the portfolio
  window.deleteStock = async function deleteStock(stockId) {
    try {
      showLoader();
      const response = await fetch(`${API_URL}/portfolio/${stockId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });

      if (!response.ok) {
        throw new Error('Error deleting stock');
      }

      fetchPortfolio(); // Refresh portfolio after deletion
    } catch (error) {
      console.error('Error deleting stock:', error);
    } finally { hideLoader(); }
  };

  // D3.js Stacked Area Chart for Portfolio Growth Over Time
  function drawStackedAreaChart() {
    // Prepare data
    const stackData = [];
    const days = [...Array(10).keys()].map(i => i + 1); // Days 1 to 10
    days.forEach(day => {
      const dayData = { day: day };
      stockAllocationOverTime.forEach(stock => {
        const stockDayData = stock.data.find(d => d.day === day);
        dayData[stock.symbol] = stockDayData ? stockDayData.value : 0;
      });
      stackData.push(dayData);
    });

    // Set up dimensions and margins
    const margin = { top: 20, right: 30, bottom: 50, left: 60 },
      width = 600 - margin.left - margin.right,
      height = 400 - margin.top - margin.bottom;

    // Remove any existing SVG
    d3.select('#portfolio-area-chart').selectAll('*').remove();

    // Create SVG container
    const svg = d3
      .select('#portfolio-area-chart')
      .append('svg')
      .attr('viewBox', `0 0 ${width + margin.left + margin.right} ${height + margin.top + margin.bottom}`)
      .style('max-width', '100%')
      .style('height', 'auto')
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Set up X and Y scales
    const xScale = d3.scaleLinear()
      .domain([1, 10])
      .range([0, width]);

    const yScale = d3.scaleLinear()
      .domain([0, d3.max(stackData, d => {
        let total = 0;
        stockSymbols.forEach(symbol => total += d[symbol]);
        return total;
      })])
      .range([height, 0]);

    // Set up color scale
    const color = d3.scaleOrdinal()
      .domain(stockSymbols)
      .range(d3.schemeTableau10);

    // Stack the data
    const stack = d3.stack()
      .keys(stockSymbols);

    const stackedData = stack(stackData);

    // Create the area generator
    const area = d3.area()
      .x(d => xScale(d.data.day))
      .y0(d => yScale(d[0]))
      .y1(d => yScale(d[1]))
      .curve(d3.curveMonotoneX);

    // Add the stacked areas
    svg.selectAll('.area')
      .data(stackedData)
      .enter()
      .append('path')
      .attr('class', 'area')
      .attr('d', area)
      .style('fill', d => color(d.key))
      .style('opacity', 0.8);

    // Add X Axis
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale).ticks(10))
      .append('text')
      .attr('y', 35)
      .attr('x', width / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'black')
      .text('Time');

    // Add Y Axis
    svg.append('g')
      .call(d3.axisLeft(yScale))
      .append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -50)
      .attr('x', -height / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'black')
      .text('Portfolio Value ($)');

    // Add legend
    const legend = svg.selectAll('.legend')
      .data(stockSymbols)
      .enter()
      .append('g')
      .attr('class', 'legend')
      .attr('transform', (d, i) => `translate(0,${i * 20})`);

    legend.append('rect')
      .attr('x', width - 18)
      .attr('width', 18)
      .attr('height', 18)
      .style('fill', color);

    legend.append('text')
      .attr('x', width - 24)
      .attr('y', 9)
      .attr('dy', '.35em')
      .style('text-anchor', 'end')
      .text(d => d);
  }

  

  // D3.js Interactive Line Chart for Portfolio Value Over Time
  let valueMode = 'value'; // 'value' | 'percent'
  function toPercentSeries(series) {
    if (!series || !series.length) return [];
    const basePoint = series.find(d => d.value > 0) || series[0];
    const base = basePoint && basePoint.value ? basePoint.value : 1;
    return series.map(d => ({ ...d, value: base ? ((d.value - base)/base*100) : 0 }));
  }

  // Performance line chart with date-based scale and ranges
let selectedPerfRange = '1M';
let perfSeriesAll = [];
let portfolioStartDate = null; // earliest purchase date across holdings
const RANGE_FALLBACK_LENGTH = {
  '5D': 7,
  '1M': 30,
  '6M': 180,
  '1Y': 365,
  '5Y': 365 * 5,
  'ALL': 365 * 5
};
function regeneratePerfSeries(baseValue){
    const days = 365*5; const today = new Date(); const start = new Date(today); start.setDate(start.getDate()-days+1);
    let v = Math.max(100, baseValue || 1000); const out = [];
    for(let i=0;i<days;i++){ const drift=(Math.random()-0.5)*0.02; v=Math.max(1, v*(1+drift)); const d=new Date(start); d.setDate(start.getDate()+i); out.push({date:d,value:v}); }
    perfSeriesAll = out;
}
function filterPerfSeries(range){ if(!perfSeriesAll.length) return []; const all=perfSeriesAll; const end=all[all.length-1].date; const start=new Date(end); switch(range){ case '5D': start.setDate(start.getDate()-5); break; case '1M': start.setMonth(start.getMonth()-1); break; case '6M': start.setMonth(start.getMonth()-6); break; case '1Y': start.setFullYear(start.getFullYear()-1); break; case '5Y': start.setFullYear(start.getFullYear()-5); break; case 'ALL': return all.slice(); default: start.setMonth(start.getMonth()-1);} return all.filter(p=>p.date>=start && p.date<=end); }
function getSeriesForRange(range){
  if (!perfSeriesAll.length) return [];
  let sliced = filterPerfSeries(range);
  if (sliced.length >= 2) return sliced;
  const fallbackWindow = RANGE_FALLBACK_LENGTH[range] || 60;
  const take = Math.min(Math.max(fallbackWindow, 2), perfSeriesAll.length);
  sliced = perfSeriesAll.slice(perfSeriesAll.length - take);
  if (sliced.length >= 2) return sliced;
  return perfSeriesAll.slice();
}
  function drawInteractiveLineChart(){
    const lastTotal = (function(){
      try {
        const raw = document.getElementById('total-value').textContent.replace(/[^0-9.\-]/g,'');
        return parseFloat(raw) || 1000;
      } catch { return 1000; }
    })();
    if(!perfSeriesAll.length){ regeneratePerfSeries(lastTotal); }
    let raw = getSeriesForRange(selectedPerfRange);
    if(!raw || raw.length < 2){ regeneratePerfSeries(lastTotal); raw = getSeriesForRange(selectedPerfRange); }
    const data = (valueMode === 'percent') ? toPercentSeries(raw) : raw.map(d => ({ ...d }));

    const container = d3.select('#portfolio-line-chart');
    const node = container.node(); if(!node) return;
    container.selectAll('*').remove();
    const bbox = node.getBoundingClientRect(); const W=Math.max(320,Math.floor(bbox.width)), H=Math.max(240,Math.floor(bbox.height));
    const margin={top:20,right:30,bottom:40,left:56}; const width=Math.max(0,W-margin.left-margin.right), height=Math.max(0,H-margin.top-margin.bottom);
    const svgRoot = container.append('svg').attr('viewBox',`0 0 ${W} ${H}`).style('width','100%').style('height','100%');
    const svg = svgRoot.append('g').attr('transform',`translate(${margin.left},${margin.top})`);
    if(!data.length){ svg.append('text').text('No data').attr('x',10).attr('y',20).style('fill','#94a3b8'); return; }
    const values = data.map(d=>d.value).filter(v=>Number.isFinite(v));
    if(!values.length){ svg.append('text').text('No data').attr('x',10).attr('y',20).style('fill','#94a3b8'); return; }
    const x=d3.scaleTime().domain(d3.extent(data,d=>d.date)).range([0,width]);
    let [minVal, maxVal] = d3.extent(values);
    if(!Number.isFinite(minVal) || !Number.isFinite(maxVal)){ svg.append('text').text('No data').attr('x',10).attr('y',20).style('fill','#94a3b8'); return; }
    if(minVal === maxVal){ const adjust = Math.max(1, Math.abs(minVal)*0.02 || 1); minVal -= adjust; maxVal += adjust; }
    if(valueMode === 'percent'){
      const span = Math.max(1e-9, maxVal - minVal);
      const pad = span * 0.15 || 4;
      minVal -= pad;
      maxVal += pad;
      if(minVal > 0) minVal = 0;
      if(maxVal < 0) maxVal = 0;
    } else {
      const span = Math.max(1e-9, maxVal - minVal);
      const pad = span * 0.08 || Math.max(5, Math.abs(maxVal) * 0.05);
      minVal = Math.max(0, minVal - pad);
      maxVal = maxVal + pad;
    }
    const y=d3.scaleLinear().domain([minVal, maxVal]).range([height,0]).nice();
    const yTicks = Math.min(8, Math.max(3, values.length));
    const grid = d3.axisLeft(y).ticks(yTicks).tickSize(-width).tickFormat('');
    const gridGroup = svg.append('g').attr('class','chart-grid').call(grid);
    gridGroup.selectAll('.tick line').attr('stroke','#1e293b').attr('stroke-dasharray','3,6');
    gridGroup.select('.domain').remove();

    const areaId = `perfArea${Math.random().toString(36).slice(2,8)}`;
    const defs = svgRoot.append('defs');
    const gradient = defs.append('linearGradient').attr('id',areaId).attr('x1','0').attr('y1','0').attr('x2','0').attr('y2','1');
    gradient.append('stop').attr('offset','0%').attr('stop-color','#6366f1').attr('stop-opacity', valueMode==='percent'?0.25:0.4);
    gradient.append('stop').attr('offset','100%').attr('stop-color','#6366f1').attr('stop-opacity',0);

    const area=d3.area().x(d=>x(d.date)).y0(()=> y(0)).y1(d=>y(d.value)).curve(d3.curveMonotoneX);
    svg.append('path').datum(data).attr('fill',`url(#${areaId})`).attr('d',area);
    const line=d3.line().x(d=>x(d.date)).y(d=>y(d.value)).curve(d3.curveMonotoneX);
    const path=svg.append('path').datum(data).attr('fill','none').attr('stroke','#6366f1').attr('stroke-width',2.4).attr('d',line);
    try{
      const L=path.node().getTotalLength();
      path.attr('stroke-dasharray',`${L},${L}`).attr('stroke-dashoffset',L).transition().duration(700).attr('stroke-dashoffset',0);
    }catch(e){}

    const formatAxisCurrency = (v) => {
      const abs = Math.abs(v);
      if(abs >= 1e12) return `$${(v/1e12).toFixed(2)}T`;
      if(abs >= 1e9) return `$${(v/1e9).toFixed(2)}B`;
      if(abs >= 1e6) return `$${(v/1e6).toFixed(1)}M`;
      if(abs >= 1e3) return `$${(v/1e3).toFixed(1)}K`;
      return currencyFormatter.format(v);
    };

    const buildXAxis = (range, xScale, pxWidth) => {
      const axis = d3.axisBottom(xScale);
      const domain = xScale.domain();
      const start = domain[0], end = domain[1];
      const approx = Math.max(2, Math.floor(pxWidth / 90));
      switch(range){
        case '5D': {
          return axis.ticks(d3.timeDay.every(1)).tickFormat(d3.timeFormat('%a'));
        }
        case '1M': {
          return axis.ticks(d3.timeWeek.every(1)).tickFormat(d3.timeFormat('%b %d'));
        }
        case '6M':
        case '1Y': {
          const months = Math.max(1, d3.timeMonth.count(start, end));
          const step = Math.max(1, Math.round(months / approx));
          return axis.ticks(d3.timeMonth.every(step)).tickFormat(d3.timeFormat('%b'));
        }
        case '5Y':
        case 'ALL': {
          const years = Math.max(1, d3.timeYear.count(start, end));
          const step = Math.max(1, Math.round(years / approx));
          return axis.ticks(d3.timeYear.every(step)).tickFormat(d3.timeFormat('%Y'));
        }
        default: {
          return axis.ticks(approx).tickFormat(d3.timeFormat('%b %d'));
        }
      }
    };
    const xAxisGroup = svg.append('g').attr('transform',`translate(0,${height})`).call(buildXAxis(selectedPerfRange,x,width));
    xAxisGroup.selectAll('.tick text').attr('fill','#94a3b8');
    xAxisGroup.selectAll('.tick line').attr('stroke','#1e293b');
    xAxisGroup.select('.domain').attr('stroke','#1e293b');

    const yFmt=(valueMode==='percent')
      ? (d=> `${d3.format('.1f')(d)}%`)
      : (d=> formatAxisCurrency(d));
    const yAxisGroup = svg.append('g').call(d3.axisLeft(y).ticks(yTicks).tickFormat(yFmt));
    yAxisGroup.selectAll('.tick line').attr('stroke','transparent');
    yAxisGroup.selectAll('.tick text').attr('fill','#94a3b8');
    yAxisGroup.select('.domain').attr('stroke','#1e293b');

    const crosshair = svg.append('g').attr('class','chart-crosshair').style('pointer-events','none').attr('opacity',0);
    crosshair.append('line').attr('class','vline').attr('stroke','#475569').attr('stroke-width',1).attr('y1',0).attr('y2',height);
    const dot=crosshair.append('circle').attr('r',4.5).attr('fill','#6366f1').attr('stroke','#0f172a').attr('stroke-width',1.5);

    const labelGroup = svgRoot.append('g').attr('class','chart-tooltip-box').style('pointer-events','none').attr('opacity',0);
    const labelRect = labelGroup.append('rect').attr('rx',6).attr('ry',6).attr('fill','#0f172a').attr('opacity',0.88);
    const labelText = labelGroup.append('text').attr('fill','#f8fafc').attr('font-size','12px').attr('dy','1em').attr('dx','0.6em');

    const bisect=d3.bisector(d=>d.date).left;
    const formatTooltipValue = (val) => {
      if(valueMode==='percent'){
        const signed = val >= 0 ? '+' : '';
        return `${signed}${val.toFixed(2)}%`;
      }
      return formatAxisCurrency(val);
    };
    svg.append('rect')
      .attr('class','hover-capture')
      .attr('width',width)
      .attr('height',height)
      .attr('fill','transparent')
      .on('mousemove',(event)=>{
        const [mx]=d3.pointer(event);
        const x0=x.invert(mx);
        const idx=Math.max(0,Math.min(data.length-1,bisect(data,x0)));
        const d0=data[idx];
        if(!d0){
          crosshair.attr('opacity',0);
          labelGroup.attr('opacity',0);
          return;
        }
        const vx=x(d0.date);
        const vy=y(d0.value);
        crosshair.attr('opacity',1);
        crosshair.select('line.vline').attr('x1',vx).attr('x2',vx);
        dot.attr('cx',vx).attr('cy',vy);
        const label=`${d3.timeFormat('%b %d, %Y')(d0.date)}  ${formatTooltipValue(d0.value)}`;
        labelText.text(label);
        const bb=labelText.node().getBBox();
        labelRect.attr('width',bb.width+12).attr('height',bb.height+8);
        const labelX=Math.min(W-bb.width-24, margin.left + vx + 16);
        const labelY=Math.max(16, margin.top + vy - 36);
        labelGroup.attr('opacity',1).attr('transform',`translate(${labelX},${labelY})`);
      })
      .on('mouseleave',()=>{
        crosshair.attr('opacity',0);
        labelGroup.attr('opacity',0);
      });
  }

  const ALLOCATION_COLORS = ['#4f46e5','#22d3ee','#22c55e','#f59e0b','#ef4444','#a855f7','#0ea5a4','#38bdf8','#f97316','#fb7185'];

  function drawAllocationDonutChart(data){
    const container=d3.select('#allocation-donut-chart'); if (container.empty()) return; container.selectAll('*').remove();
    const tooltip = getSharedTooltip();
    if (tooltip) {
      if (typeof tooltip.replaceChildren === 'function') tooltip.replaceChildren();
      else tooltip.innerHTML = '';
      tooltip.style.display = 'none';
    }
    if (!data.length) {
      const legendEl = document.getElementById('allocation-legend');
      if (legendEl) legendEl.innerHTML = '';
      container.append('div').attr('class','chart-empty').text('Add holdings to see allocation');
      return;
    }
    const bbox = container.node().getBoundingClientRect();
    const w=Math.max(0,Math.floor(bbox.width)), h=Math.max(0,Math.floor(bbox.height));
    const radius = Math.min(w,h) * 0.38;
    const inner = radius * 0.62;
    const svgRoot=container.append('svg').attr('viewBox',`0 0 ${w} ${h}`).style('width','100%').style('height','100%');
    const svg=svgRoot.append('g').attr('transform',`translate(${w/2},${h/2})`);
    const labels=data.map(d=>d.symbol);
    const color=d3.scaleOrdinal().domain(labels).range(ALLOCATION_COLORS);
    const pie=d3.pie().padAngle(0.02).sort(null).value(d=>d.value);
    const arc=d3.arc().innerRadius(inner).outerRadius(radius).cornerRadius(10);
    const total = data.reduce((sum,item)=>sum + (item.value || 0), 0);
    const safeTotal = total || 1;

    const center = svg.append('g').attr('class','donut-center').attr('text-anchor','middle');
    const centerHeader = center.append('text').attr('class','donut-label-top').attr('y', -8);
    const centerValue = center.append('text').attr('class','donut-label-main').attr('y', 16);
    const centerSub = center.append('text').attr('class','donut-label-sub').attr('y', 34);
    const resetCenter = () => {
      centerHeader.text('Total');
      centerValue.text(currencyFormatter.format(total || 0));
      centerSub.text(total ? '100%' : '0%');
    };
    const updateCenter = (slice) => {
      const datum = slice.data;
      centerHeader.text(datum.symbol);
      centerValue.text(currencyFormatter.format(datum.value || 0));
      const pct = safeTotal ? ((datum.value || 0) / safeTotal) * 100 : 0;
      centerSub.text(`${pct.toFixed(1)}%`);
    };
    resetCenter();

    const moveTooltip = (event) => {
      if (!tooltip) return;
      const offset = 18;
      tooltip.style.left = `${event.pageX + offset}px`;
      tooltip.style.top = `${event.pageY + offset}px`;
    };
    const showTooltip = (event, slice) => {
      if (!tooltip) return;
      const datum = slice.data;
      const pct = safeTotal ? ((datum.value || 0) / safeTotal) * 100 : 0;
      if (typeof tooltip.replaceChildren === 'function') tooltip.replaceChildren();
      else tooltip.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'tooltip-title';
      title.textContent = datum.name || datum.symbol;
      const body = document.createElement('div');
      body.className = 'tooltip-sub';
      body.textContent = `${datum.symbol} • ${currencyFormatter.format(datum.value || 0)} • ${pct.toFixed(1)}%`;
      tooltip.appendChild(title);
      tooltip.appendChild(body);
      tooltip.style.display = 'block';
      moveTooltip(event);
    };
    const hideTooltip = () => {
      if (!tooltip) return;
      tooltip.style.display = 'none';
      if (typeof tooltip.replaceChildren === 'function') tooltip.replaceChildren();
      else tooltip.innerHTML = '';
    };

    const slices=svg.selectAll('path').data(pie(data)).enter().append('path')
      .attr('fill',d=>color(d.data.symbol))
      .attr('stroke','#0f172a')
      .attr('stroke-width',1.5)
      .attr('d',arc)
      .attr('tabindex',0)
      .on('mouseenter',function(event,d){
        d3.select(this).raise().transition().duration(160).attr('stroke-width',2.2);
        updateCenter(d);
        showTooltip(event,d);
      })
      .on('mousemove',(event)=> moveTooltip(event))
      .on('mouseleave',function(){
        d3.select(this).transition().duration(160).attr('stroke-width',1.5);
        hideTooltip();
        resetCenter();
      })
      .on('focus',function(event,d){
        d3.select(this).attr('stroke-width',2.2);
        updateCenter(d);
        hideTooltip();
      })
      .on('blur',function(){
        d3.select(this).attr('stroke-width',1.5);
        resetCenter();
      });
    slices.append('title')
      .text(d=>{
        const pct = ((d.data.value || 0) / safeTotal) * 100;
        return `${d.data.symbol} ${pct.toFixed(1)}%`;
      });
    renderAllocationLegend(data, color);
  }

  function renderAllocationLegend(data, color){
    const legend = document.getElementById('allocation-legend');
    if (!legend) return;
    legend.innerHTML = '';
    const total = data.reduce((sum,item)=>sum + (item.value || 0), 0);
    const sorted = data.slice().sort((a,b) => b.value - a.value);
    sorted.forEach(item => {
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.className = 'legend-left';
      const swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.background = color(item.symbol);
      left.appendChild(swatch);
      const label = document.createElement('span');
      label.className = 'legend-chip';
      label.textContent = `${item.symbol}`; // legend shows only symbol
      left.appendChild(label);
      li.appendChild(left);
      legend.appendChild(li);
    });
  }
  const companySearchInput = document.getElementById('stock-symbol');
  const searchResults = document.getElementById('search-results');
  if (companySearchInput && searchResults) {
    attachSymbolAutocomplete({
      input: companySearchInput,
      results: searchResults,
      onSelect(item) {
        if (!item) {
          selectedCompany = null;
          return;
        }
        selectedCompany = { symbol: item.symbol.toUpperCase(), name: item.name };
        companySearchInput.value = `${item.name} (${item.symbol})`;
      }
    });
  }
  
  // Donut controls wiring
   // Logout functionality
   document.getElementById('logout-btn').addEventListener('click', () => {
    localStorage.removeItem('token'); // Remove token from localStorage
    window.location.href = 'index.html'; // Redirect to login page
  });


  // Value vs % toggle
  const valueModeControls = document.getElementById('value-mode-controls');
  if (valueModeControls) {
    valueModeControls.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      valueModeControls.querySelectorAll('button').forEach(b => b.classList.remove('btn-primary'));
      btn.classList.add('btn-primary');
      valueMode = btn.dataset.mode;
      drawInteractiveLineChart();
    }));
  }

  // Performance range buttons wiring
  const perfRangeControls = document.getElementById('perf-range-controls');
  if (perfRangeControls) {
    perfRangeControls.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      perfRangeControls.querySelectorAll('button').forEach(b => b.classList.remove('btn-primary'));
      btn.classList.add('btn-primary');
      selectedPerfRange = btn.dataset.range;
      drawInteractiveLineChart();
    }));
  }

  (async () => { if (await ensureAuth()) { await fetchPortfolio(); } })();
  // Shares stepper controls
  const sharesInput = document.getElementById('shares');
  const stepUp = document.querySelector('.input-stepper .up');
  const stepDown = document.querySelector('.input-stepper .down');
  function adjustShares(delta){
    if(!sharesInput) return; const curr = parseFloat(sharesInput.value||'0') || 0; const next = Math.max(0, curr + delta);
    sharesInput.value = String(next);
  }
  if (stepUp) stepUp.addEventListener('click', ()=> adjustShares(1));
  if (stepDown) stepDown.addEventListener('click', ()=> adjustShares(-1));
}

// --- Benchmark (S&P) comparison helpers (since portfolio start) ---
function computeReturnFromSeries(series, startDate){
  try{
    if(!Array.isArray(series) || series.length < 2) return 0;
    const start = startDate || (series[0].date || series[0].Date);
    const filtered = start ? series.filter(p => (p.date||p.Date) >= start) : series;
    const arr = filtered.length ? filtered : series;
    const first = arr[0]; const last = arr[arr.length-1];
    const a = (typeof first.value === 'number') ? first.value : Number(first.close||0);
    const b = (typeof last.value === 'number') ? last.value : Number(last.close||0);
    if (!a || !b) return 0;
    return (b/a - 1) * 100;
  } catch { return 0; }
}
async function updateBenchmarkSinceStart(){
  try{
    const ytdValueElement = document.getElementById('percentage-change');
    const ytdNoteElement = document.getElementById('ytd-note');
    const portRet = computeReturnFromSeries(perfSeriesAll, portfolioStartDate);
    const spySeries = await fetchDailySeries('SPY','compact');
    const spyRet = computeReturnFromSeries(spySeries, portfolioStartDate);
    if (ytdValueElement) {
      ytdValueElement.textContent = `${portRet>=0?'+':''}${portRet.toFixed(2)}% vs S&P ${spyRet>=0?'+':''}${spyRet.toFixed(2)}%`;
      applyTrendClass(ytdValueElement, portRet);
      try{ const labelEl = ytdValueElement.closest('.chip')?.querySelector('.kpi-label'); if (labelEl) labelEl.textContent = 'Since Start'; }catch{}
    }
    if (ytdNoteElement) { ytdNoteElement.textContent = (portRet >= spyRet) ? 'Beating S&P' : 'Trailing S&P'; applyTrendClass(ytdNoteElement, (portRet - spyRet)); }
  } catch(e){ /* leave prior label */ }
}


























