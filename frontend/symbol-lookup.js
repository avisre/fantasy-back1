// Shared symbol lookup utility for v4 using Alpha Vantage SYMBOL_SEARCH
(function(){
  const DEFAULT_ALPHA_KEY = '6VWT72JNHHLBF3MH';
  function getKey(){ try { return localStorage.getItem('alpha_key') || DEFAULT_ALPHA_KEY; } catch { return DEFAULT_ALPHA_KEY; } }
  async function searchOne(query){
    const trimmed = (query||'').trim();
    if (!trimmed) return [];
    try {
      const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(trimmed)}&apikey=${encodeURIComponent(getKey())}`;
      const resp = await fetch(url);
      const data = await resp.json();
      const list = Array.isArray(data?.bestMatches) ? data.bestMatches : [];
      return list.slice(0, 10).map(m => ({ symbol: m['1. symbol'], name: m['2. name'] }));
    } catch {
      return [];
    }
  }
  window.SymbolLookup = { searchOne };
})();

