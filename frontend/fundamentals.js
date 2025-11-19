/* Fundamentals page controller (UTF-8 clean) */
(function(){
  const $ = (id) => document.getElementById(id);
  const showLoader = () => { const el=$('loading-overlay'); if(el) el.removeAttribute('hidden'); };
  const hideLoader = () => { const el=$('loading-overlay'); if(el) el.setAttribute('hidden',''); };
  const getQP = (k)=> new URLSearchParams(location.search).get(k);

  const DEFAULT_ALPHA_KEY = '6VWT72JNHHLBF3MH';
  const API_URL = (location.origin && location.origin.startsWith('http') ? location.origin : 'http://localhost:5051') + '/api';
  if(!localStorage.getItem('alpha_key')) try{ localStorage.setItem('alpha_key', DEFAULT_ALPHA_KEY); }catch{}
  const getKey = () => localStorage.getItem('alpha_key') || DEFAULT_ALPHA_KEY;

  // State
  let priceRange = '1Y';
  let priceMode = 'price';
  let lastQuote = null;
  let basis = 'annual'; // or 'quarterly'
  let unit = 'auto'; // auto | million | billion
  let activeTab = 'income';
  let lastSymbolKey = null;
  const fundamentalsCache = new Map();

  // Data fetchers (Alpha Vantage)
  async function fetchOverview(sym){
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(getKey())}`;
    const resp = await fetch(url); return await resp.json();
  }
  async function fetchIncome(sym){
    const url = `https://www.alphavantage.co/query?function=INCOME_STATEMENT&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(getKey())}`;
    const resp = await fetch(url); return await resp.json();
  }
  async function fetchCashFlow(sym){
    const url = `https://www.alphavantage.co/query?function=CASH_FLOW&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(getKey())}`;
    const resp = await fetch(url); return await resp.json();
  }
  async function fetchBalance(sym){
    const url = `https://www.alphavantage.co/query?function=BALANCE_SHEET&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(getKey())}`;
    const resp = await fetch(url); return await resp.json();
  }
  async function fetchQuote(sym){
    const url=`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(getKey())}`;
    const resp = await fetch(url); const data = await resp.json();
    const q=data['Global Quote']||{}; return { symbol:q['01. symbol']||sym, price:+(q['05. price']||0), change:+(q['09. change']||0), changePercent:q['10. change percent']||'0%' };
  }
  async function fetchDailyAdjusted(sym){
    const url=`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY_ADJUSTED&symbol=${encodeURIComponent(sym)}&outputsize=full&apikey=${encodeURIComponent(getKey())}`;
    const resp=await fetch(url); const data=await resp.json(); const series=data['Time Series (Daily)']||{};
    return Object.keys(series).map(d=>{
      const entry=series[d];
      return { date:new Date(d+'T00:00:00'), close:+entry['4. close'], volume:+entry['6. volume'] };
    }).sort((a,b)=>a.date-b.date);
  }
  async function fetchMonthlyAdjusted(sym){
    const url=`https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY_ADJUSTED&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(getKey())}`;
    const resp=await fetch(url); const data=await resp.json(); const s=data['Monthly Adjusted Time Series']||{};
    return Object.keys(s).sort().map(d=>({ date:new Date(d+'T00:00:00'), close:+s[d]['5. adjusted close'], volume:+s[d]['6. volume'] }));
  }

  function parseNumber(v){ if(v==null||v==='') return null; const n=Number(v); return Number.isFinite(n)?n:null; }
  function determineScale(values){
    const data = values.filter(v=> Number.isFinite(v));
    const max = data.length ? Math.max(...data.map(v=>Math.abs(v))) : 0;
    if(unit==='billion') return { divisor:1e9, label:'Billions' };
    if(unit==='million') return { divisor:1e6, label:'Millions' };
    if(max>=1e10) return { divisor:1e9, label:'Billions' };
    return { divisor:1e6, label:'Millions' };
  }
  function formatPeriodLabel(period){
    if(!period) return '';
    const value = String(period);
    const year = value.slice(0,4);
    if (basis === 'annual') return year;
    const month = parseInt(value.slice(5,7), 10);
    if (!Number.isFinite(month)) return year;
    const quarter = Math.floor((month - 1) / 3) + 1;
    return `Q${quarter} ${year}`;
  }
  function formatCurrency(value,scale){ if(!Number.isFinite(value)) return '-'; const scaled=value/(scale.divisor||1); const t=Math.abs(scaled).toLocaleString(undefined,{ maximumFractionDigits:2 }); return scaled<0? `($${t})` : `$${t}`; }

  function renderQuote(q, overview){
    const el = $('quote');
    if (!el) return;
    if (!q){
      el.innerHTML = '<div>No data</div>';
      return;
    }
    const price = Number.isFinite(q.price) ? q.price : null;
    const priceText = price != null ? `$${price.toFixed(2)}` : '-';
    const change = Number.isFinite(q.change) ? q.change : null;
    const changePercent = typeof q.changePercent === 'string' ? q.changePercent : null;
    const changeLabel = change != null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}${changePercent ? ` (${changePercent})` : ''}` : '';
    const changeClass = change > 0 ? 'gain' : change < 0 ? 'loss' : 'flat';

    const parseOverviewNumber = (value) => {
      const parsed = parseNumber(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const pe = parseOverviewNumber(overview?.PERatio);
    const eps = parseOverviewNumber(overview?.EPS);
    const marketCap = parseOverviewNumber(overview?.MarketCapitalization);
    const formatCompactDollars = (value) => {
      if (!Number.isFinite(value)) return '-';
      const abs = Math.abs(value);
      if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
      if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
      if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    };
    const metrics = [
      {
        label: 'Price',
        value: `${price != null ? `<span class="quote-price-badge ${changeClass}" title="${changeLabel ? `Change: ${changeLabel}` : 'Current price'}">${priceText}</span>` : '<span class="quote-price-badge">-</span>'}${changeLabel ? `<span class="quote-change ${changeClass}">${changeLabel}</span>` : ''}`
      },
      { label: 'P/E', value: Number.isFinite(pe) ? pe.toFixed(2) : '&mdash;' },
      { label: 'Market Cap', value: formatCompactDollars(marketCap) },
      { label: 'EPS', value: Number.isFinite(eps) ? eps.toFixed(2) : '&mdash;' }
    ];
    el.setAttribute('data-symbol', q.symbol || '');
    el.innerHTML = metrics.map(item => `
      <div class="quote-metric">
        <div class="metric-label">${item.label}</div>
        <div class="metric-value">${item.value}</div>
      </div>
    `).join('');
  }

// Price/PE chart
  async function drawPriceChart(sym){
    const container=d3.select('#price-chart'); if(container.empty()) return; container.selectAll('*').remove();
    const series = priceRange==='MAX' ? await fetchMonthlyAdjusted(sym) : await fetchDailyAdjusted(sym);
    if(!series.length){ container.append('div').attr('class','chart-empty').text('No data'); return; }
    let data = series.slice();
    const end = data[data.length-1].date; const start=new Date(end);
    switch(priceRange){
      case '1M': start.setMonth(start.getMonth()-1); break;
      case '6M': start.setMonth(start.getMonth()-6); break;
      case '1Y': start.setFullYear(start.getFullYear()-1); break;
      case '3Y': start.setFullYear(start.getFullYear()-3); break;
      case '5Y': start.setFullYear(start.getFullYear()-5); break;
      case '10Y': start.setFullYear(start.getFullYear()-10); break;
      default: start.setMonth(start.getMonth()-1);
    }
    data = data.filter(p=>p.date>=start && p.date<=end);
    if(!data.length){ container.append('div').attr('class','chart-empty').text('No data'); return; }
    if(priceMode==='pe'){
      const ov = await fetchOverview(sym); const eps = parseNumber(ov?.EPS)||0; const safeEPS = Math.abs(eps)>1e-9? eps : 1;
      data = data.map(d=>({ date:d.date, value:d.close/safeEPS }));
    } else {
      data = data.map(d=>({ date:d.date, value:d.close }));
    }
    const node=container.node(); const bbox=node.getBoundingClientRect();
    const W=Math.max(320,Math.floor(bbox.width)); const H=Math.max(260,Math.floor(bbox.height));
    const margin={top:24,right:44,bottom:50,left:64}; const width=Math.max(0,W-margin.left-margin.right), height=Math.max(0,H-margin.top-margin.bottom);
    const svgRoot=container.append('svg').attr('viewBox',`0 0 ${W} ${H}`).style('width','100%').style('height','100%');
    svgRoot.append('rect').attr('x',0).attr('y',0).attr('width',W).attr('height',H).attr('fill','#0b1220');
    const svg=svgRoot.append('g').attr('transform',`translate(${margin.left},${margin.top})`);
    const values=data.map(d=>d.value).filter(v=>Number.isFinite(v));
    if(!values.length){ svg.append('text').attr('fill','#94a3b8').attr('x',10).attr('y',16).text('No data'); return; }
    let [minVal,maxVal]=d3.extent(values);
    if(!Number.isFinite(minVal) || !Number.isFinite(maxVal)){ svg.append('text').attr('fill','#94a3b8').attr('x',10).attr('y',16).text('No data'); return; }
    if(minVal===maxVal){
      const adjust=Math.max(1,Math.abs(minVal)*0.02||1);
      minVal-=adjust; maxVal+=adjust;
    }
    const span=Math.max(1e-9,maxVal-minVal);
    const pad=span*0.1 || Math.max(1,Math.abs(maxVal)*0.05);
    minVal = minVal - pad;
    maxVal = maxVal + pad;
    if(priceMode!=='pe'){ minVal = Math.max(0, minVal); }
    const x=d3.scaleTime().domain(d3.extent(data,d=>d.date)).range([0,width]);
    const y=d3.scaleLinear().domain([minVal,maxVal]).range([height,0]).nice();
    const strokeColor = priceMode==='pe' ? '#a78bfa' : '#38bdf8';
    const areaOpacity = priceMode==='pe' ? 0.28 : 0.34;
    const gradientId=`priceArea${Math.random().toString(36).slice(2,8)}`;
    const defs=svgRoot.append('defs');
    const gradient=defs.append('linearGradient').attr('id',gradientId).attr('x1','0').attr('y1','0').attr('x2','0').attr('y2','1');
    gradient.append('stop').attr('offset','0%').attr('stop-color',strokeColor).attr('stop-opacity',areaOpacity);
    gradient.append('stop').attr('offset','100%').attr('stop-color',strokeColor).attr('stop-opacity',0);
    const yTicks=Math.min(8,Math.max(3,values.length));
    const grid=d3.axisLeft(y).ticks(yTicks).tickSize(-width).tickFormat('');
    const gridGroup=svg.append('g').attr('class','chart-grid').call(grid);
    gridGroup.selectAll('.tick line').attr('stroke','#1e293b').attr('stroke-dasharray','3,6');
    gridGroup.select('.domain').remove();
    const area=d3.area().x(d=>x(d.date)).y0(()=>height).y1(d=>y(d.value)).curve(d3.curveMonotoneX);
    svg.append('path').datum(data).attr('fill',`url(#${gradientId})`).attr('d',area);
    const line=d3.line().x(d=>x(d.date)).y(d=>y(d.value)).curve(d3.curveMonotoneX);
    const path=svg.append('path').datum(data).attr('fill','none').attr('stroke',strokeColor).attr('stroke-width',2.4).attr('d',line);
    try{
      const L=path.node().getTotalLength();
      path.attr('stroke-dasharray',`${L},${L}`).attr('stroke-dashoffset',L).transition().duration(700).attr('stroke-dashoffset',0);
    }catch(e){}
    const priceFormatter=new Intl.NumberFormat('en-US',{ style:'currency', currency:'USD', maximumFractionDigits:2 });
    const lastPoint=data[data.length-1];
    if(lastPoint){
      const lastY=y(lastPoint.value);
      svg.append('line').attr('x1',0).attr('x2',width).attr('y1',lastY).attr('y2',lastY).attr('stroke',strokeColor).attr('stroke-dasharray','4,4').attr('stroke-opacity',0.35);
      const labelGroup=svg.append('g');
      const labelValue=priceMode==='pe' ? `${lastPoint.value.toFixed(2)}x` : priceFormatter.format(lastPoint.value);
      const labelText=labelGroup.append('text').attr('fill','#0f172a').attr('font-size','11px').attr('font-weight',700).attr('dy','0.35em').text(labelValue);
      const textBox=labelText.node().getBBox();
      const labelWidth=textBox.width+12;
      const labelHeight=textBox.height+8;
      labelText.attr('x',6).attr('y',labelHeight/2);
      labelGroup.insert('rect','text').attr('fill',strokeColor).attr('rx',4).attr('ry',4).attr('width',labelWidth).attr('height',labelHeight);
      labelGroup.attr('transform',`translate(${width - labelWidth},${lastY - labelHeight/2})`);
    }
    const buildXAxis=(range,xScale,px)=>{
      const axis=d3.axisBottom(xScale);
      const domain=xScale.domain();
      const start=domain[0], end=domain[1];
      const approx=Math.max(2,Math.floor(px/100));
      switch(range){
        case '1M': return axis.ticks(d3.timeWeek.every(1)).tickFormat(d3.timeFormat('%b %d'));
        case '6M': return axis.ticks(d3.timeMonth.every(1)).tickFormat(d3.timeFormat('%b'));
        case '1Y': return axis.ticks(d3.timeMonth.every(2)).tickFormat(d3.timeFormat('%b'));
        case '3Y': return axis.ticks(d3.timeMonth.every(6)).tickFormat(d3.timeFormat('%b %Y'));
        case '5Y':
        case '10Y':
        case 'MAX': {
          const years=Math.max(1,d3.timeYear.count(start,end));
          const step=Math.max(1,Math.round(years/approx));
          return axis.ticks(d3.timeYear.every(step)).tickFormat(d3.timeFormat('%Y'));
        }
        default: return axis.ticks(approx).tickFormat(d3.timeFormat('%Y'));
      }
    };
    const xAxisGroup=svg.append('g').attr('transform',`translate(0,${height})`).call(buildXAxis(priceRange,x,width));
    xAxisGroup.selectAll('.tick text').attr('fill','#94a3b8');
    xAxisGroup.selectAll('.tick line').attr('stroke','#1e293b');
    xAxisGroup.select('.domain').attr('stroke','#1e293b');
    const compactCurrency=new Intl.NumberFormat('en-US',{ style:'currency', currency:'USD', maximumFractionDigits:2, notation:'compact' });
    const yAxisGroup=svg.append('g').call(d3.axisLeft(y).ticks(yTicks).tickFormat(val=>{
      if(priceMode==='pe') return d3.format('.2f')(val);
      return compactCurrency.format(val);
    }));
    yAxisGroup.selectAll('.tick line').attr('stroke','transparent');
    yAxisGroup.selectAll('.tick text').attr('fill','#94a3b8');
    yAxisGroup.select('.domain').attr('stroke','#1e293b');
    const crosshair=svg.append('g').attr('class','chart-crosshair').style('pointer-events','none').attr('opacity',0);
    crosshair.append('line').attr('class','vline').attr('stroke','#475569').attr('stroke-width',1).attr('y1',0).attr('y2',height);
    const dot=crosshair.append('circle').attr('r',4.5).attr('fill',strokeColor).attr('stroke','#0f172a').attr('stroke-width',1.5);
    const labelBox=svgRoot.append('g').attr('class','chart-tooltip-box').style('pointer-events','none').attr('opacity',0);
    const labelRect=labelBox.append('rect').attr('rx',6).attr('ry',6).attr('fill','#0f172a').attr('opacity',0.95).attr('stroke',strokeColor).attr('stroke-width',1);
    const labelText=labelBox.append('text').attr('fill','#f8fafc').attr('font-size','12px').attr('dy','1em').attr('dx','0.6em');
    const bisect=d3.bisector(d=>d.date).left;
    const formatTooltipValue=val=> priceMode==='pe' ? `${val.toFixed(2)}x` : priceFormatter.format(val);
    svg.append('rect')
      .attr('width',width)
      .attr('height',height)
      .attr('fill','transparent')
      .on('mousemove',(event)=>{
        const [mx]=d3.pointer(event);
        const x0=x.invert(mx);
        const idx=Math.max(0,Math.min(data.length-1,bisect(data,x0)));
        const point=data[idx];
        if(!point){
          crosshair.attr('opacity',0);
          labelBox.attr('opacity',0);
          return;
        }
        const px=x(point.date);
        const py=y(point.value);
        crosshair.attr('opacity',1);
        crosshair.select('line.vline').attr('x1',px).attr('x2',px);
        dot.attr('cx',px).attr('cy',py);
        const label=`${d3.timeFormat('%b %d, %Y')(point.date)}  ${formatTooltipValue(point.value)}`;
        labelText.text(label);
        const bb=labelText.node().getBBox();
        labelRect.attr('width',bb.width+12).attr('height',bb.height+8);
        const labelX=Math.min(W - bb.width - 24, margin.left + px + 16);
        const labelY=Math.max(16, margin.top + py - 36);
        labelBox.attr('opacity',1).attr('transform',`translate(${labelX},${labelY})`);
      })
      .on('mouseleave',()=>{
        crosshair.attr('opacity',0);
        labelBox.attr('opacity',0);
      });
  }

  // Charts (bars)
  function drawBarChart(selector, series, scale, color, unitLabel){
    const container=d3.select(selector); if(!container.node()) return; container.selectAll('*').remove();
    const tooltip = typeof getSharedTooltip === 'function' ? getSharedTooltip() : null;
    const resetTooltip = () => {
      if (!tooltip) return;
      if (typeof tooltip.replaceChildren === 'function') tooltip.replaceChildren();
      else tooltip.innerHTML = '';
      tooltip.classList.remove('show');
    };
    resetTooltip();
    if(!series.length){ container.append('div').attr('class','chart-empty').text('No data'); return; }
    const bounds=container.node().getBoundingClientRect();
    const W=Math.max(320,Math.floor(bounds.width)); const H=Math.max(220,Math.floor(bounds.height));
    const margin={top:20,right:24,bottom:48,left:64}; const width=W-margin.left-margin.right; const height=H-margin.top-margin.bottom;
    const svgRoot=container.append('svg').attr('viewBox',`0 0 ${W} ${H}`).style('width','100%').style('height','100%');
    svgRoot.append('rect').attr('x',0).attr('y',0).attr('width',W).attr('height',H).attr('fill','#0b1220');
    const svg=svgRoot.append('g').attr('transform',`translate(${margin.left},${margin.top})`);
    const scaled=series.map(d=>({ period:d.period, raw:Number.isFinite(d.value)? d.value:null, value:Number.isFinite(d.value)? d.value/(scale.divisor||1):null }));
    const values=scaled.map(d=>d.value).filter(v=>v!=null); const yMin=values.length? Math.min(0,d3.min(values)):0; const yMax=values.length? Math.max(0,d3.max(values)):1;
    const x=d3.scaleBand().domain(scaled.map(d=>d.period)).range([0,width]).padding(0.28);
    const y=d3.scaleLinear().domain([yMin,yMax]).nice().range([height,0]);
    const yTicks=Math.min(6, Math.max(3, values.length || 3));
    const grid=d3.axisLeft(y).ticks(yTicks).tickSize(-width).tickFormat('');
    const gridGroup=svg.append('g').attr('class','chart-grid').call(grid);
    gridGroup.selectAll('.tick line').attr('stroke','#1e293b').attr('stroke-dasharray','3,6');
    gridGroup.select('.domain').remove();
    const defs=svgRoot.append('defs'); const gradId=`grad-${Math.random().toString(36).slice(2,8)}`; const grad=defs.append('linearGradient').attr('id',gradId).attr('x1','0').attr('y1','0').attr('x2','0').attr('y2','1');
    grad.append('stop').attr('offset','0%').attr('stop-color',color).attr('stop-opacity',0.9);
    grad.append('stop').attr('offset','100%').attr('stop-color',color).attr('stop-opacity',0.55);
    const bars=svg.selectAll('.bar').data(scaled).enter().append('rect').attr('class','bar')
      .attr('x',d=>x(d.period))
      .attr('width',x.bandwidth())
      .attr('y',y(0))
      .attr('height',0)
      .attr('rx',0).attr('ry',0)
      .attr('fill',d=> d.value!=null && d.value<0 ? '#ef4444' : `url(#${gradId})`)
      .attr('stroke','transparent');
    bars.transition().duration(650).delay((d,i)=>i*35)
      .attr('y',d=>d.value>=0? y(d.value):y(0))
      .attr('height',d=>Math.abs(y(d.value)-y(0)));
    const xAxisGroup=svg.append('g').attr('transform',`translate(0,${height})`).call(d3.axisBottom(x).tickSizeOuter(0));
    xAxisGroup.selectAll('.tick text').attr('fill','#94a3b8').text(d=>formatPeriodLabel(d));
    xAxisGroup.selectAll('.tick line').attr('stroke','#1e293b');
    xAxisGroup.select('.domain').attr('stroke','#1e293b');
    const yAxis=svg.append('g').call(d3.axisLeft(y).ticks(yTicks).tickFormat(d=>{
      const v=Number(d);
      if(!isFinite(v)) return '';
      return d3.format('~s')(v).replace('G','B');
    }));
    yAxis.selectAll('.tick text').attr('fill','#94a3b8');
    yAxis.selectAll('.tick line').attr('stroke','transparent');
    yAxis.select('.domain').attr('stroke','#1e293b');
    svg.append('line').attr('x1',0).attr('x2',width).attr('y1',y(0)).attr('y2',y(0)).attr('stroke','#334155').attr('stroke-width', yMin<0? 1.2:0.8).attr('stroke-dasharray','2,4');
    const unitLabelText = unitLabel || (scale.label ? `USD (${scale.label})` : 'USD');
    svgRoot.append('text')
      .attr('x',14)
      .attr('y',margin.top + height/2)
      .attr('transform',`rotate(-90,14,${margin.top + height/2})`)
      .attr('text-anchor','middle')
      .attr('fill','#64748b')
      .attr('font-size','12px')
      .text(unitLabelText);
    const tooltipUnit = unitLabelText;
    const treatAsCurrency = /^USD/i.test(tooltipUnit);
    const plainNumberFormatter = new Intl.NumberFormat(undefined,{ maximumFractionDigits:2 });
    const formatTooltipValue = (raw)=>{
      if(!Number.isFinite(raw)) return 'No data';
      if(treatAsCurrency) return formatCurrency(raw, scale);
      const scaled = raw/(scale.divisor||1);
      return plainNumberFormatter.format(scaled);
    };
    const positionTooltip=(event)=>{
      if(!tooltip) return;
      const offset=18;
      tooltip.style.left = `${event.clientX + offset}px`;
      tooltip.style.top = `${event.clientY + offset}px`;
    };
    const showTooltip=(event,datum)=>{
      if(!tooltip) return;
      const valueText = formatTooltipValue(datum.raw);
      if (typeof tooltip.replaceChildren === 'function') tooltip.replaceChildren();
      else tooltip.innerHTML='';
      const title=document.createElement('div');
      title.className='tooltip-title';
      title.textContent=formatPeriodLabel(datum.period);
      const body=document.createElement('div');
      body.className='tooltip-sub';
      body.textContent = Number.isFinite(datum.raw) ? `${valueText} ${tooltipUnit}`.trim() : valueText;
      tooltip.appendChild(title);
      tooltip.appendChild(body);
      tooltip.classList.add('show');
      positionTooltip(event);
    };
    const hideTooltip=()=>{
      if(!tooltip) return;
      resetTooltip();
    };
    bars.on('mouseenter',function(event,d){
        d3.select(this).attr('stroke','#cbd5f5').attr('stroke-width',1.2);
        showTooltip(event,d);
      })
      .on('mousemove',positionTooltip)
      .on('mouseleave',function(){
        d3.select(this).attr('stroke','transparent');
        hideTooltip();
      });
  }

  /* Legacy stacked bar implementation retained for reference
  function drawStackedBarsLegacy(selector, series, keys){
    const container=d3.select(selector); if(!container.node()) return; container.selectAll('*').remove();
    if(!series.length){ container.append('div').attr('class','chart-empty').text('No data'); return; }
    const bounds=container.node().getBoundingClientRect();
    const W=Math.max(320,Math.floor(bounds.width)); const H=Math.max(240,Math.floor(bounds.height));
    // Put legend at the bottom to avoid cramping the plot area
    const margin={top:20,right:16,bottom:76,left:56};
    const width=W-margin.left-margin.right; const height=H-margin.top-margin.bottom;
    const svg=container.append('svg').attr('viewBox',`0 0 ${W} ${H}`).style('width','100%').style('height','100%');
    const g=svg.append('g').attr('transform',`translate(${margin.left},${margin.top})`);
    const x=d3.scaleBand().domain(series.map(d=>d.period)).range([0,width]).padding(0.2);
    // Determine scale (Millions/Billions) based on absolute values
    const allValues=[]; series.forEach(row=> keys.forEach(k=>{ if(Number.isFinite(row[k])) allValues.push(Math.abs(row[k])); }));
    const scale = determineScale(allValues);
    const divisor = scale.divisor||1;
    const y=d3.scaleLinear().domain([0, d3.max(series, d=> keys.reduce((acc,k)=>acc+(Math.max(0,(d[k]||0)/divisor)),0))]).nice().range([height,0]);
    const color=d3.scaleOrdinal().domain(keys).range(['#2563eb','#f97316','#22c55e']);
    const stack = d3.stack().keys(keys).order(d3.stackOrderNone).offset(d3.stackOffsetNone);
    const stacked=stack(series.map(d=>({ period:d.period, ...keys.reduce((o,k)=>{o[k]=Math.max(0,(d[k]||0)/divisor); return o;},{}) })));
    g.append('g').attr('transform',`translate(0,${height})`).call(d3.axisBottom(x));
    const isBillions=(scale.label||'').toLowerCase().startsWith('billion');
    g.append('g').call(d3.axisLeft(y).ticks(6).tickFormat(d=> isFinite(d)? d3.format('~s')(d).replace('G','B') : ''));
    const group=g.selectAll('g.layer').data(stacked).enter().append('g').attr('fill',d=>color(d.key)).attr('data-key',d=>d.key);
    group.selectAll('rect').data(d=>d).enter().append('rect').attr('x',d=>x(d.data.period)).attr('width',x.bandwidth()).attr('y',y(0)).attr('height',0)
      .transition().duration(600).attr('y',d=>y(d[1])).attr('height',d=>y(d[0])-y(d[1]));
    // Titles for hover on segments
    group.selectAll('rect').append('title').text(function(d){
      const key=d3.select(this.parentNode).attr('data-key');
      const raw=(d[1]-d[0])*(divisor||1);
      const val=(raw/(divisor||1)).toLocaleString(undefined,{ maximumFractionDigits:2 });
      const lbl = `USD (${isBillions? 'Billions' : 'Millions'})`;
      return `${d.data.period} — ${key}: ${val} ${lbl}`;
    });
    // Y-axis unit label (rotated)
    svg.append('text')
      .attr('transform', `translate(14, ${margin.top + height/2}) rotate(-90)`) 
      .attr('text-anchor','middle')
      .attr('fill','#94a3b8')
      .attr('font-size','12px')
      .text(`USD (${isBillions? 'Billions' : 'Millions'})`);
    // Legend (describe each segment)
    const prettyLabel=(k)=>{
      if(k==='free') return 'Free Cash Flow';
      if(k==='operating') return 'Operating';
      if(k==='investing') return 'Investing';
      if(k==='assets') return 'Assets';
      if(k==='netDebt') return 'Net Debt';
      if(k==='cash') return 'Cash on Hand';
      return k.charAt(0).toUpperCase()+k.slice(1);
    };
    // Bottom legend (horizontal)
    const legend=svg.append('g').attr('transform',`translate(${margin.left},${H - 28})`);
    const items=legend.selectAll('g.item').data(keys).enter().append('g').attr('class','item').attr('transform',(d,i)=>`translate(${i*120},0)`);
    items.append('rect').attr('width',10).attr('height',10).attr('rx',2).attr('ry',2).attr('fill',d=>color(d));
    items.append('text').attr('x',14).attr('y',9).attr('fill','#64748b').attr('font-size','12px').text(d=>prettyLabel(d));
  }
  */

  function drawStackedBars(selector, series, keys){
    const container=d3.select(selector); if(!container.node()) return; container.selectAll('*').remove();
    const tooltip = typeof getSharedTooltip === 'function' ? getSharedTooltip() : null;
    const resetTooltip = () => {
      if (!tooltip) return;
      if (typeof tooltip.replaceChildren === 'function') tooltip.replaceChildren();
      else tooltip.innerHTML = '';
      tooltip.classList.remove('show');
    };
    resetTooltip();
    if(!series.length){ container.append('div').attr('class','chart-empty').text('No data'); return; }
    const bounds=container.node().getBoundingClientRect();
    const W=Math.max(320,Math.floor(bounds.width)); const H=Math.max(240,Math.floor(bounds.height));
    const margin={top:20,right:24,bottom:84,left:64};
    const width=W-margin.left-margin.right; const height=H-margin.top-margin.bottom;
    const svgRoot=container.append('svg').attr('viewBox',`0 0 ${W} ${H}`).style('width','100%').style('height','100%');
    svgRoot.append('rect').attr('x',0).attr('y',0).attr('width',W).attr('height',H).attr('fill','#0b1220');
    const svg=svgRoot.append('g').attr('transform',`translate(${margin.left},${margin.top})`);
    const x=d3.scaleBand().domain(series.map(d=>d.period)).range([0,width]).padding(0.22);
    const allValues=[];
    series.forEach(row=> keys.forEach(k=>{
      const raw=parseNumber(row[k]);
      if(raw!=null) allValues.push(Math.abs(raw));
    }));
    const scale = determineScale(allValues);
    const divisor = scale.divisor||1;
    const y=d3.scaleLinear().domain([0, d3.max(series,d=> keys.reduce((acc,k)=>{
      const value=parseNumber(d[k]);
      return acc + Math.max(0,(value||0)/divisor);
    },0))]).nice().range([height,0]);
    const yTicks=Math.min(6, Math.max(3, series.length || 3));
    const grid=d3.axisLeft(y).ticks(yTicks).tickSize(-width).tickFormat('');
    const gridGroup=svg.append('g').attr('class','chart-grid').call(grid);
    gridGroup.selectAll('.tick line').attr('stroke','#1e293b').attr('stroke-dasharray','3,6');
    gridGroup.select('.domain').remove();
    const color=d3.scaleOrdinal().domain(keys).range(['#2563eb','#f97316','#22c55e']);
    const stack=d3.stack().keys(keys).order(d3.stackOrderNone).offset(d3.stackOffsetNone);
    const stacked=stack(series.map(d=>({
      period:d.period,
      ...keys.reduce((o,k)=>{
        const value=parseNumber(d[k])||0;
        o[k]=Math.max(0,value/divisor);
        return o;
      },{})
    })));
    const xAxisGroup=svg.append('g').attr('transform',`translate(0,${height})`).call(d3.axisBottom(x));
    xAxisGroup.selectAll('.tick text').attr('fill','#94a3b8').text(d=>formatPeriodLabel(d));
    xAxisGroup.selectAll('.tick line').attr('stroke','#1e293b');
    xAxisGroup.select('.domain').attr('stroke','#1e293b');
    const yAxis=svg.append('g').call(d3.axisLeft(y).ticks(yTicks).tickFormat(d=> isFinite(d)? d3.format('~s')(d).replace('G','B') : ''));
    yAxis.selectAll('.tick text').attr('fill','#94a3b8');
    yAxis.selectAll('.tick line').attr('stroke','transparent');
    yAxis.select('.domain').attr('stroke','#1e293b');
    const groups=svg.selectAll('g.layer').data(stacked).enter().append('g').attr('fill',d=>color(d.key)).attr('data-key',d=>d.key);
    const segments=groups.selectAll('rect').data(d=>d).enter().append('rect')
      .attr('x',d=>x(d.data.period))
      .attr('width',x.bandwidth())
      .attr('y',y(0))
      .attr('height',0)
      .attr('rx',0).attr('ry',0)
      .attr('stroke','transparent');
    segments.transition().duration(650).delay((d,i)=>i*30)
      .attr('y',d=>y(d[1]))
      .attr('height',d=>Math.max(0,y(d[0])-y(d[1])));
    const unitLabelText = `USD (${scale.label || 'Millions'})`;
    svgRoot.append('text')
      .attr('x',14)
      .attr('y',margin.top + height/2)
      .attr('transform',`rotate(-90,14,${margin.top + height/2})`)
      .attr('text-anchor','middle')
      .attr('fill','#64748b')
      .attr('font-size','12px')
      .text(unitLabelText);
    const tooltipUnit = unitLabelText;
    const moveTooltip=(event)=>{
      if(!tooltip) return;
      const offset=18;
      tooltip.style.left = `${event.clientX + offset}px`;
      tooltip.style.top = `${event.clientY + offset}px`;
    };
    const toTitleCase=(str)=>{
      if(!str) return '';
      return str.replace(/_/g,' ').replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase()).trim();
    };
    const prettyLabel=(k)=>{
      if(k==='free') return 'Free Cash Flow';
      if(k==='operating') return 'Operating';
      if(k==='investing') return 'Investing';
      if(k==='assets') return 'Assets';
      if(k==='netDebt') return 'Net Debt';
      if(k==='cash') return 'Cash on Hand';
      return toTitleCase(k);
    };
    const showTooltip=(event,d)=>{
      if(!tooltip) return;
      const key=d3.select(event.currentTarget.parentNode).attr('data-key');
      const source=series.find(item=>item.period===d.data.period) || {};
      const rawValue=parseNumber(source[key]);
      if (typeof tooltip.replaceChildren === 'function') tooltip.replaceChildren();
      else tooltip.innerHTML='';
      const title=document.createElement('div');
      title.className='tooltip-title';
      title.textContent=`${formatPeriodLabel(d.data.period)} - ${prettyLabel(key)}`;
      const body=document.createElement('div');
      body.className='tooltip-sub';
      body.textContent = rawValue!=null ? `${formatCurrency(rawValue, scale)} ${tooltipUnit}`.trim() : 'No data';
      tooltip.appendChild(title);
      tooltip.appendChild(body);
      tooltip.classList.add('show');
      moveTooltip(event);
    };
    const hideTooltip=()=>{
      if(!tooltip) return;
      resetTooltip();
    };
    segments.on('mouseenter',function(event,d){
        d3.select(this).attr('stroke','#cbd5f5').attr('stroke-width',1);
        showTooltip(event,d);
      })
      .on('mousemove',moveTooltip)
      .on('mouseleave',function(){
        d3.select(this).attr('stroke','transparent');
        hideTooltip();
      });
    const legend=svgRoot.append('g').attr('transform',`translate(${margin.left},${margin.top + height + 32})`);
    keys.forEach((key,index)=>{
      const entry=legend.append('g').attr('transform',`translate(${index*140},0)`);
      entry.append('rect').attr('width',12).attr('height',12).attr('rx',3).attr('fill',color(key));
      entry.append('text').attr('x',18).attr('y',10).attr('fill','#94a3b8').attr('font-size','12px').text(prettyLabel(key));
    });
  }

  async function loadFundamentals(sym){
    const key = sym.toUpperCase();
    if(!fundamentalsCache.has(key)){
      const [overview,income,cash,balance] = await Promise.all([
        fetchOverview(sym), fetchIncome(sym), fetchCashFlow(sym), fetchBalance(sym)
      ]);
      fundamentalsCache.set(key,{ overview, income, cash, balance });
    }
    return fundamentalsCache.get(key);
  }

  function recentReports(dataset,count=8){
    const src = basis === 'quarterly' ? (dataset?.quarterlyReports || []) : (dataset?.annualReports || []);
    return src.filter(r=>r && r.fiscalDateEnding).slice().sort((a,b)=> new Date(a.fiscalDateEnding) - new Date(b.fiscalDateEnding)).slice(-count);
  }

  function renderOverview(overview){
    const target = $('ratios'); if(!target) return; target.innerHTML='';
    const items = [
      { label:'Market Cap', key:'MarketCapitalization', format:'currency' },
      { label:'P/E', key:'PERatio' },
      { label:'EPS', key:'EPS' },
      { label:'Profit Margin', key:'ProfitMargin', format:'percent' },
      { label:'ROE', key:'ReturnOnEquityTTM', format:'percent' },
      { label:'ROA', key:'ReturnOnAssetsTTM', format:'percent' },
      { label:'Debt/Equity', key:'DEBTtoEquity' },
      { label:'Dividend Yield', key:'DividendYield', format:'percent' }
    ];
    if(!overview || Object.keys(overview).length===0){ const chip=document.createElement('div'); chip.className='chip'; chip.textContent='Fundamentals unavailable'; target.appendChild(chip); return; }
    items.forEach(item=>{
      const chip=document.createElement('div'); chip.className='chip';
      const raw = parseNumber(overview[item.key]);
      let display='-';
      if(item.format==='currency' && Number.isFinite(raw)) display = `$${(raw/1e9).toFixed(2)}B`;
      else if(item.format==='percent' && Number.isFinite(raw)) display = (raw*100).toFixed(2)+'%';
      else if(Number.isFinite(raw)) display = raw.toFixed(2);
      chip.innerHTML = `${item.label} <span class="sub">${display}</span>`;
      target.appendChild(chip);
    });
  }

  function renderCharts(data){
    const income=recentReports(data.income,8);
    const cash=recentReports(data.cash,8);
    const balance=recentReports(data.balance,8);
    const revenueSeries=income.map(r=>({ period:(r.fiscalDateEnding||'').slice(0,10), value:parseNumber(r.totalRevenue) }));
    const netSeries=income.map(r=>({ period:(r.fiscalDateEnding||'').slice(0,10), value:parseNumber(r.netIncome) }));
    const cashFlowSeries=cash.map(r=>({ period:(r.fiscalDateEnding||'').slice(0,10), operating:parseNumber(r.operatingCashflow), investing:parseNumber(r.cashflowFromInvestment), free:(parseNumber(r.operatingCashflow)||0)+(parseNumber(r.capitalExpenditures)||0) }));
    const balanceSeriesRaw=balance.map(r=>{
      const period=(r.fiscalDateEnding||'').slice(0,10);
      const assets=parseNumber(r.totalAssets);
      const cash = (parseNumber(r.cashAndCashEquivalentsAtCarryingValue)
                    ?? parseNumber(r.cashAndShortTermInvestments)
                    ?? parseNumber(r.cashAndCashEquivalents)) || null;
      const debt = (parseNumber(r.shortLongTermDebtTotal)
                    ?? ((parseNumber(r.longTermDebt)||0) + (parseNumber(r.shortTermDebt)||0)))
                    ?? null;
      const netDebt = (debt!=null) ? (debt - (cash||0)) : null;
      const liabilities=parseNumber(r.totalLiabilities);
      const shares=parseNumber(r.commonStockSharesOutstanding);
      return { period, assets, liabilities, cash, netDebt, shares };
    });
    const balanceAL = balanceSeriesRaw.map(({period,assets,liabilities})=>({period,assets,liabilities}));
    const cashNet = balanceSeriesRaw.map(({period,cash,netDebt})=>({period,cash,netDebt}));
    const sharesSeries = balanceSeriesRaw.map(({period,shares})=>({ period, value: shares!=null? shares: null }));
    const revScale=determineScale(revenueSeries.map(d=>d.value||0));
    const netScale=determineScale(netSeries.map(d=>d.value||0));
    drawBarChart('#rev-chart', revenueSeries, revScale, '#2563eb');
    drawBarChart('#ni-chart', netSeries, netScale, '#7c3aed');
    drawStackedBars('#ocf-chart', cashFlowSeries, ['operating','investing','free']);
    drawStackedBars('#balance-chart', balanceAL, ['assets','liabilities']);
    drawStackedBars('#cashnet-chart', cashNet, ['cash','netDebt']);
    drawBarChart('#shares-chart', sharesSeries, {divisor:1e6,label:'Millions'}, '#0ea5a4', 'Shares (M)');
  }

  function renderTableHeader(periods, caption){ const thead=$('tbl-head'); if(!thead) return; thead.innerHTML=''; thead.innerHTML = `<tr class="fin-caption"><th class="fin-name">${caption}</th>${periods.map(()=>'<th></th>').join('')}</tr><tr><th></th>${periods.map(p=>`<th>${p}</th>`).join('')}</tr>`; }
  function renderTableBody(rows){ const tbody=$('tbl-body'); if(!tbody) return; tbody.innerHTML=''; rows.forEach(row=>{ const tr=document.createElement('tr'); if(row.bold) tr.classList.add('fin-bold'); if(row.lvl) tr.classList.add(`fin-lvl-${row.lvl}`); const name=document.createElement('td'); name.className='fin-name'; name.textContent=row.label; tr.appendChild(name); row.values.forEach(val=>{ const td=document.createElement('td'); td.textContent=val; tr.appendChild(td); }); tbody.appendChild(tr); }); }
  function renderRatiosTable(overview){ const head=$('tbl-head'); const body=$('tbl-body'); if(!head || !body) return; head.innerHTML='<tr><th class="fin-name">Metric</th><th>Value</th></tr>'; body.innerHTML=''; const def=[{label:'Market Cap',key:'MarketCapitalization',format:'currency'},{label:'P/E',key:'PERatio'},{label:'EPS',key:'EPS'},{label:'Profit Margin',key:'ProfitMargin',format:'percent'},{label:'ROE',key:'ReturnOnEquityTTM',format:'percent'},{label:'ROA',key:'ReturnOnAssetsTTM',format:'percent'},{label:'Debt/Equity',key:'DEBTtoEquity'},{label:'Dividend Yield',key:'DividendYield',format:'percent'}]; def.forEach(item=>{ const value=parseNumber(overview?.[item.key]); const tr=document.createElement('tr'); const formatted = (item.format==='currency')? (`$${Number(value||0).toLocaleString()}`) : (item.format==='percent'? ((value*100).toFixed(2)+'%') : (Number.isFinite(value)? value.toFixed(2):'-')); tr.innerHTML=`<td class="fin-name">${item.label}</td><td>${formatted}</td>`; body.appendChild(tr); }); }
function renderStatementTable(data){
  if(activeTab==='ratios'){ renderRatiosTable(data.overview||{}); return; }
  // Select dataset per tab, MarketWatch-like groupings
  let dataset;
  let fields;
  if(activeTab==='income'){
    dataset = basis==='annual' ? (data.income?.annualReports||[]) : (data.income?.quarterlyReports||[]);
    fields = [
      {label:'Revenue', key:'totalRevenue'},
      {label:'Gross Profit', key:'grossProfit'},
      {label:'Operating Income', key:'operatingIncome'},
      {label:'Net Income', key:'netIncome'}
    ];
  } else if(activeTab==='balance'){
    dataset = basis==='annual' ? (data.balance?.annualReports||[]) : (data.balance?.quarterlyReports||[]);
    fields = [
      {label:'Total Assets', key:'totalAssets'},
      {label:'Total Liabilities', key:'totalLiabilities'},
      {label:'Cash on Hand', compute:(r)=> (parseNumber(r.cashAndCashEquivalentsAtCarryingValue) ?? parseNumber(r.cashAndShortTermInvestments) ?? parseNumber(r.cashAndCashEquivalents)) },
      {label:'Net Debt', compute:(r)=>{ const cash=(parseNumber(r.cashAndCashEquivalentsAtCarryingValue) ?? parseNumber(r.cashAndShortTermInvestments) ?? parseNumber(r.cashAndCashEquivalents))||0; const debt=(parseNumber(r.shortLongTermDebtTotal) ?? ((parseNumber(r.longTermDebt)||0)+(parseNumber(r.shortTermDebt)||0)))||0; return debt - cash; }},
      {label:'Shareholder Equity', key:'totalShareholderEquity'}
    ];
  } else { // cash
    dataset = basis==='annual' ? (data.cash?.annualReports||[]) : (data.cash?.quarterlyReports||[]);
    fields = [
      {label:'Operating Cash Flow', key:'operatingCashflow'},
      {label:'Investing Cash Flow', key:'cashflowFromInvestment'},
      {label:'Free Cash Flow', compute:(r)=>{ const ocf=parseNumber(r.operatingCashflow)||0; const capex=parseNumber(r.capitalExpenditures)||0; return ocf+capex; }}
    ];
  }
  const desiredCount = (basis==='annual') ? 5 : 12; // last 5 years (annual) or last 3 years of quarters
  const sorted = (dataset||[]).filter(r=>r && r.fiscalDateEnding).slice().sort((a,b)=> new Date(a.fiscalDateEnding) - new Date(b.fiscalDateEnding));
  const reports = sorted.slice(-desiredCount);
  if(!reports.length){ renderTableHeader([], 'No data available'); $('tbl-body').innerHTML=''; return; }
  const periods=reports.map(r=> formatPeriodLabel((r.fiscalDateEnding||'').slice(0,10)));
  const baseNums=[]; reports.forEach(r=>fields.forEach(f=>{ const v=(f.compute? f.compute(r):parseNumber(r[f.key])); if(Number.isFinite(v)) baseNums.push(Math.abs(v)); }));
  const scale = baseNums.length? determineScale(baseNums) : { divisor:1, label:'Value' };
  const spanLabel = basis==='annual' ? 'Last 5 Years' : 'Last 20 Quarters';
  renderTableHeader(periods, `${basis==='annual'?'Annual':'Quarterly'} Data &middot; ${spanLabel} | ${scale.label} of US $`);
  const rows = fields.map(f=>({
    label:f.label,
    values: reports.map(r=>{
      const val = f.compute? f.compute(r): parseNumber(r[f.key]);
      return formatCurrency(val, scale);
    })
  }));
  renderTableBody(rows);
}

  async function renderFundamentals(sym){
    const data=await loadFundamentals(sym); lastSymbolKey=sym.toUpperCase();
    const jump=$("fundamentals-link"); if(jump){ const existing=document.getElementById("news-link"); if(existing) existing.remove(); const link=document.createElement("a"); link.id="news-link"; link.className="btn"; link.style.marginLeft="8px"; link.href=`news.html?tickers=${encodeURIComponent(sym)}`; link.textContent = 'View News ?'; jump.insertAdjacentElement("afterend", link); }
    renderOverview(data.overview);
    if (typeof renderQuote === 'function' && lastQuote) { try { renderQuote(lastQuote, data.overview); } catch {} }
    renderCharts(data);
    renderStatementTable(data);
    syncToggles();
  }

  function currentSymbol(){ return (getQP('symbol') || ($('symbol-input')?.value||'').trim() || '').toUpperCase() || null; }
  async function refreshFundamentals(sym){ if(!sym) return; showLoader(); try{ await renderFundamentals(sym); } finally{ hideLoader(); } }
  async function updateBasis(value){ if(basis===value) return; basis=value; const sym=currentSymbol(); await refreshFundamentals(sym); }
  async function updateUnit(value){ if(unit===value) return; unit=value; if(lastSymbolKey && fundamentalsCache.has(lastSymbolKey)){ const data=fundamentalsCache.get(lastSymbolKey); renderCharts(data); renderStatementTable(data); syncToggles(); } else { const sym=currentSymbol(); await refreshFundamentals(sym); } }
  function updateTab(value){ if(activeTab===value) return; activeTab=value; syncToggles(); if(lastSymbolKey && fundamentalsCache.has(lastSymbolKey)) renderStatementTable(fundamentalsCache.get(lastSymbolKey)); }
  function syncToggles(){ document.querySelectorAll('#basis-controls .range').forEach(btn=> btn.classList.toggle('btn-primary', btn.dataset.basis===basis)); document.querySelectorAll('#unit-controls .range').forEach(btn=> btn.classList.toggle('btn-primary', btn.dataset.unit===unit)); document.querySelectorAll('.fin-tabs .tab').forEach(tab=> tab.classList.toggle('active', tab.dataset.tab===activeTab)); }

  document.addEventListener('DOMContentLoaded', async ()=>{
    const go=$('go-btn'); if(go){ go.addEventListener('click', async ()=>{ const v=currentSymbol(); if(v){ showLoader(); try{ lastQuote = await fetchQuote(v); await drawPriceChart(v); await renderFundamentals(v); } finally{ hideLoader(); } } }); }
    const input=$('symbol-input');
    const list=document.getElementById('symbol-results');
    if(input){
      input.addEventListener('keydown', (e)=>{
        if(e.key==='Enter'){
          e.preventDefault();
          go?.click();
        }
      });
    }
    if(input && list && window.attachSymbolAutocomplete){
      window.attachSymbolAutocomplete({
        input,
        results: list,
        onSelect(item){
          if (!item) return;
          input.value = item.symbol;
          go?.click();
        }
      });
    }
    const sym=getQP('symbol'); if(sym){ showLoader(); try{ lastQuote = await fetchQuote(sym); await drawPriceChart(sym); await renderFundamentals(sym);} finally{ hideLoader(); } }
    const rangeCtr=document.getElementById('price-range-controls'); if(rangeCtr){ rangeCtr.querySelectorAll('button').forEach(btn=> btn.addEventListener('click', async ()=>{ rangeCtr.querySelectorAll('button').forEach(b=>b.classList.remove('btn-primary')); btn.classList.add('btn-primary'); priceRange=btn.dataset.range; const symbol=currentSymbol(); if(symbol){ showLoader(); try{ await drawPriceChart(symbol);} finally{ hideLoader(); } } })); }
    const modeCtr=document.getElementById('price-mode-controls'); if(modeCtr){ modeCtr.querySelectorAll('button').forEach(btn=> btn.addEventListener('click', async ()=>{ modeCtr.querySelectorAll('button').forEach(b=>b.classList.remove('btn-primary')); btn.classList.add('btn-primary'); priceMode=btn.dataset.mode; const symbol=currentSymbol(); if(symbol){ showLoader(); try{ await drawPriceChart(symbol);} finally{ hideLoader(); } } })); }
    const basisCtr=document.getElementById('basis-controls'); if(basisCtr){ basisCtr.querySelectorAll('button').forEach(btn=> btn.addEventListener('click', ()=> updateBasis(btn.dataset.basis))); }
    const unitCtr=document.getElementById('unit-controls'); if(unitCtr){ unitCtr.querySelectorAll('button').forEach(btn=> btn.addEventListener('click', ()=> updateUnit(btn.dataset.unit))); }
    document.querySelectorAll('.fin-tabs .tab').forEach(tab=>{ tab.addEventListener('click', ()=>{ document.querySelectorAll('.fin-tabs .tab').forEach(t=>t.classList.remove('active')); tab.classList.add('active'); updateTab(tab.dataset.tab); }); });
    syncToggles();
  });
})();






