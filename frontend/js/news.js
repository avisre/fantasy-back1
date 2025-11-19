if (!localStorage.getItem('token')) {
  const next = 'news.html' + (location.search || '');
  window.location.replace(`login.html?next=${encodeURIComponent(next)}`);
}
const DEFAULT_ALPHA_KEY = '6VWT72JNHHLBF3MH';
      const ALPHA_TOPICS = [
        'all','top_stories','world_news','financial_markets','economy_monetary','economy_fiscal','economy_macro',
        'technology','blockchain','earnings','ipo','mergers_and_acquisitions','energy_transportation','finance',
        'life_sciences','manufacturing','real_estate','retail_wholesale'
      ];
      const $ = (id) => document.getElementById(id);
      (function ensureKey(){ if(!localStorage.getItem('alpha_key')) localStorage.setItem('alpha_key', DEFAULT_ALPHA_KEY); })();
      const getKey = () => localStorage.getItem('alpha_key') || DEFAULT_ALPHA_KEY;
      const getQP = (k)=> new URLSearchParams(location.search).get(k);

      const Loader = { show(){ const el=$('loading-overlay'); if(el) el.removeAttribute('hidden'); }, hide(){ const el=$('loading-overlay'); if(el) el.setAttribute('hidden',''); } };
      const AlphaNewsApi = {
        async fetch({ tickers, topics, limit=50 }){
          const params = new URLSearchParams({ function:'NEWS_SENTIMENT', apikey:getKey(), sort:'LATEST', limit:String(limit) });
          if (tickers) params.set('tickers', tickers);
          if (topics && topics!=='all') params.set('topics', topics);
          const url = `https://www.alphavantage.co/query?${params.toString()}`;
          const resp = await fetch(url);
          const data = await resp.json();
          return (data.feed || []).map(item => ({
            title: item.title, url: item.url, time: item.time_published, authors: item.authors || [],
            summary: item.summary || '', source: item.source || '',
            overall_sentiment_label: item.overall_sentiment_label,
            overall_sentiment_score: item.overall_sentiment_score,
            tickers: item.ticker_sentiment?.map(t=>t.ticker) || []
          }));
        }
      };
      const SymbolLookup = {
        maybeSymbol(raw){
          const s=(raw||'').trim().toUpperCase();
          if(!s) return null;
          if(/^[A-Z][A-Z0-9\.-]{0,6}$/.test(s)) return s;
          return null;
        },
        async searchOne(query){
          try{
            const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${encodeURIComponent(getKey())}`;
            const resp = await fetch(url); const data = await resp.json();
            const m = (data.bestMatches||[])[0];
            if(!m) return query;
            return m['1. symbol'] || query;
          }catch{ return query; }
        },
        async resolveMany(raw){
          if(!raw) return [];
          const parts = raw.split(',').map(p=>p.trim()).filter(Boolean);
          const out=[];
          for(const part of parts){
            const maybe=this.maybeSymbol(part);
            out.push(maybe || await this.searchOne(part));
          }
          return out;
        }
      };
      const NewsRenderer = {
        renderList(items){
          const grid=$('news-grid'); grid.innerHTML='';
          if(!items.length){ grid.innerHTML='<div class="card">No news found.</div>'; return; }
          for(const n of items){
            const resolvedTickers = Array.isArray(n.tickers) ? n.tickers : [];
            const tickersMarkup = resolvedTickers
              .map(ticker => `<a class="badge" href="fundamentals.html?symbol=${encodeURIComponent(ticker)}" data-guarded>${ticker}</a>`)
              .join(' ');
            const card=document.createElement('article'); card.className='card'; card.style.padding='12px';
            card.innerHTML = `
              <div class="title" style="font-weight:700;margin-bottom:6px"><a href="${n.url}" target="_blank" rel="noopener">${n.title}</a></div>
              <div class="meta"><span>${n.source||''}</span><span>${(n.time||'').slice(0,8)}</span><span>${n.overall_sentiment_label||''}</span></div>
              <p>${n.summary}</p>
              <div class="meta" aria-label="Tickers">${tickersMarkup}</div>
            `;
            grid.appendChild(card);
          }
        },
        renderTopics(){
          const row = $('topics-row'); row.innerHTML='';
          ALPHA_TOPICS.forEach(t=>{
            const b=document.createElement('button'); b.type='button'; b.className='chip'+(t==='all'?' active':''); b.dataset.topic=t; b.textContent = t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); row.appendChild(b);
          });
        }
      };
      const NewsController = (function(){
        let currentTopic='all';
        const input = $('tickers');
        const results = document.getElementById('news-search-results');
        async function alphaSearch(q){
          try{
            const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(q)}&apikey=${encodeURIComponent(getKey())}`;
            const resp = await fetch(url); const data = await resp.json();
            return (data.bestMatches||[]).slice(0,8).map(m=>({ symbol:m['1. symbol'], name:m['2. name'] }));
          }catch{ return []; }
        }
        function showResults(list){
          results.innerHTML='';
          list.forEach(item=>{
            const li=document.createElement('li');
            li.textContent = `${item.name} (${item.symbol})`;
            li.addEventListener('mousedown', (ev)=>{ ev.preventDefault(); select(item.symbol); });
            results.appendChild(li);
          });
          results.style.display = list.length? 'block':'none';
        }
        function select(symbol){
          const raw = input.value.trim();
          const parts = raw.split(',');
          parts[parts.length-1] = symbol;
          input.value = parts.map(p=>p.trim()).filter(Boolean).join(', ');
          results.style.display='none';
        }
        function bindSearch(){
          input.addEventListener('input', async (e)=>{
            const raw=e.target.value; const last=raw.split(',').pop().trim();
            if(last.length<2){ results.style.display='none'; return; }
            const items = await alphaSearch(last);
            showResults(items);
          });
          document.addEventListener('click',(e)=>{ if(!results.contains(e.target) && e.target!==input){ results.style.display='none'; } });
        }
        async function load(){
          const raw = $('tickers').value.trim();
          Loader.show();
          try {
            const resolved = await SymbolLookup.resolveMany(raw);
            const tickers = resolved.length? resolved.join(',') : undefined;
            const items = await AlphaNewsApi.fetch({ tickers, topics: currentTopic, limit: 50 });
            NewsRenderer.renderList(items);
          } finally { Loader.hide(); }
        }
        function bind(){
          $('load').addEventListener('click',()=> load().catch(()=>{ Loader.hide(); NewsRenderer.renderList([]); }));
          document.addEventListener('click',(e)=>{
            const el = e.target.closest('.chip[data-topic]'); if(!el) return;
            document.querySelectorAll('.chip[data-topic]').forEach(b=>b.classList.remove('active'));
            el.classList.add('active'); currentTopic = el.dataset.topic; load().catch(()=>{ Loader.hide(); NewsRenderer.renderList([]); });
          });
          bindSearch();
        }
        return { load, bind };
      })();

      document.addEventListener('DOMContentLoaded', ()=>{
        NewsRenderer.renderTopics();
        NewsController.bind();
        const qpTickers=getQP('tickers'); if(qpTickers){ $('tickers').value = qpTickers; }
        NewsController.load().catch(()=>{ Loader.hide(); NewsRenderer.renderList([]); });
      });
