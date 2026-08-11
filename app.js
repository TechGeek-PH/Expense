'use strict';

const STORAGE_KEY='techgeekph_finance_v2';
const API_URL_KEY='techgeekph_v2_apps_script_url';
const SYNC_KEY_STORAGE='techgeekph_v2_sync_key';
const BILL_MONTH_STORAGE='techgeekph_v2_bill_month';
const EXP_MONTH_STORAGE='techgeekph_v3_expense_month';
const moneyFmt=new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',minimumFractionDigits:2});
const money=n=>moneyFmt.format(Number(n)||0);
const today=()=>new Date().toLocaleDateString('en-CA');
const currentMonth=()=>today().slice(0,7);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=p=>`${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
const num=v=>Number(v)||0;

let syncBusy=false;
let state=normalizeState(loadLocal());

function normalizeState(v){
  const s=v&&typeof v==='object'?v:{};
  return {
    version:s.version||2,
    sourceAsOf:s.sourceAsOf||'',
    billingMonth:/^\d{4}-\d{2}$/.test(String(s.billingMonth||''))?s.billingMonth:currentMonth(),
    savedAt:s.savedAt||null,
    debts:Array.isArray(s.debts)?s.debts:[],
    transactions:Array.isArray(s.transactions)?s.transactions:[],
    expenses:Array.isArray(s.expenses)?s.expenses:[],
    bills:Array.isArray(s.bills)?s.bills:[]
  };
}
function loadLocal(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')}catch{return {}}}
function cache(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch{}}
function getStored(k){try{return localStorage.getItem(k)||''}catch{return ''}}
function setStored(k,v){try{localStorage.setItem(k,v)}catch{}}
function apiConfig(){return {url:getStored(API_URL_KEY).trim(),key:getStored(SYNC_KEY_STORAGE).trim()}}
function remoteReady(){const c=apiConfig();return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(c.url)&&c.key.length>=20}

function apiCall(action,payload={}){
  const cfg=apiConfig();
  if(!remoteReady()) return Promise.reject(new Error('Google Sheets connection is not configured.'));
  return new Promise((resolve,reject)=>{
    const cb='__tgcb_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
    const script=document.createElement('script');
    const timer=setTimeout(()=>finish(new Error('Google Sheets request timed out.')),25000);
    function finish(err,data){clearTimeout(timer);try{delete window[cb]}catch{};script.remove();err?reject(err):resolve(data)}
    window[cb]=res=>{if(!res||res.ok!==true)finish(new Error((res&&res.error)||'Google Sheets request failed.'));else finish(null,res)};
    const u=new URL(cfg.url);
    u.searchParams.set('action',action);
    u.searchParams.set('key',cfg.key);
    u.searchParams.set('callback',cb);
    u.searchParams.set('payload',JSON.stringify(payload||{}));
    script.onerror=()=>finish(new Error('Unable to reach Apps Script.'));
    script.src=u.toString();
    document.head.appendChild(script);
  });
}

async function syncFromSheets(silent=false){
  if(!remoteReady()){updateConnectionUI();if(!silent)openConnection();return false}
  syncBusy=true;updateConnectionUI();
  try{
    const res=await apiCall('getAppData');
    state=normalizeState(res.data);cache();renderAll();
    if(!silent)toast('Refreshed from Google Sheets');
    return true;
  }catch(err){
    setStatus('error','Sync error');
    document.getElementById('modeNotice').className='notice warn';
    document.getElementById('modeNotice').textContent='Google Sheets sync failed: '+err.message+' Click the connection status to verify the private connection.';
    if(!silent)alert(err.message);
    return false;
  }finally{syncBusy=false;updateConnectionUI()}
}

async function mutate(action,payload,localFallback){
  if(remoteReady()){
    syncBusy=true;updateConnectionUI();
    try{const res=await apiCall(action,payload);state=normalizeState(res.data);cache();renderAll();return true}
    catch(err){alert('Save failed: '+err.message);return false}
    finally{syncBusy=false;updateConnectionUI()}
  }
  if(typeof localFallback==='function'){localFallback();state.savedAt=new Date().toISOString();cache();renderAll();toast('Saved locally only');return true}
  openConnection();return false;
}

function setStatus(cls,text){const b=document.getElementById('connectionButton');b.classList.remove('connected','syncing','error');if(cls)b.classList.add(cls);document.getElementById('saveStatus').textContent=text}
function updateConnectionUI(){
  const notice=document.getElementById('modeNotice');
  if(syncBusy){setStatus('syncing','Syncing with Google Sheets…');return}
  if(remoteReady()){
    const t=state.savedAt?new Date(state.savedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
    setStatus('connected',t?'Google Sheets • '+t:'Google Sheets connected');
    notice.className='notice good';
    notice.textContent='Auto-sync ON • Google Sheets is the source of truth. Updates made in this CFO chat will appear here after refresh.';
  }else{
    setStatus('error','Connection required');
    notice.className='notice warn';
    notice.textContent='This browser is not connected yet. Click “Connection required” once to enter the private Apps Script URL and Sync Key.';
  }
  const c=apiConfig();document.getElementById('apiUrl').value=c.url;document.getElementById('syncKey').value=c.key;
}
function openConnection(){document.getElementById('connectionDialog').showModal();updateConnectionUI()}
async function saveConnection(){
  const url=document.getElementById('apiUrl').value.trim();const key=document.getElementById('syncKey').value.trim();
  if(!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:\?.*)?$/.test(url)){alert('Use the Apps Script Web App /exec URL.');return}
  if(key.length<20){alert('Sync Key looks incomplete.');return}
  setStored(API_URL_KEY,url);setStored(SYNC_KEY_STORAGE,key);
  document.getElementById('connectionInfo').textContent='Verifying connection…';
  const ok=await syncFromSheets(true);
  document.getElementById('connectionInfo').textContent=ok?'Connected successfully. You can close this window.':'Unable to verify. Check the URL and Sync Key.';
  if(ok){toast('Google Sheets connected');setTimeout(()=>document.getElementById('connectionDialog').close(),500)}
}

function debtBalance(d){
  let b=num(d.openingBalance);
  for(const x of state.transactions){if(x.debtId!==d.id)continue;if(x.type==='Payment')b-=num(x.amount);else if(x.type==='New Borrowing / Charge')b+=num(x.amount)}
  return Math.max(0,Math.round(b*100)/100);
}
function monthExpenses(m){return state.expenses.filter(x=>String(x.date||'').slice(0,7)===m)}
function isCashAdvance(x){return String(x.category||'').toLowerCase().includes('cash advance')}
function expenseTotal(xs){return xs.reduce((a,x)=>a+num(x.amount),0)}
function businessDebts(){return state.debts.filter(d=>d.scope==='Business')}
function selectedExpenseMonth(){return document.getElementById('expenseMonth').value||currentMonth()}
function selectedBillMonth(){return document.getElementById('billMonth').value||state.billingMonth||currentMonth()}

function renderAll(){renderDebtOptions();renderDashboard();renderExpenses();renderDebts();renderBills();updateConnectionUI()}

function renderDashboard(){
  const m=currentMonth(), mx=monthExpenses(m), cashOut=expenseTotal(mx), ca=expenseTotal(mx.filter(isCashAdvance)), opex=cashOut-ca;
  const bds=businessDebts();
  const businessDebt=bds.reduce((a,d)=>a+debtBalance(d),0);
  const fixed=bds.filter(d=>d.type==='Fixed Installment').reduce((a,d)=>a+num(d.monthlyDue),0);
  const running=bds.filter(d=>d.type==='Running Credit').reduce((a,d)=>a+num(d.monthlyDue),0);
  const bm=state.billingMonth||currentMonth();const bills=state.bills.filter(b=>b.billingMonth===bm);const unpaid=bills.filter(b=>b.status!=='Paid').reduce((a,b)=>a+num(b.amount),0);
  const todayTotal=expenseTotal(state.expenses.filter(x=>x.date===today()));
  const household=state.debts.filter(d=>d.scope==='Household').reduce((a,d)=>a+debtBalance(d),0);
  const review=state.debts.filter(d=>String(d.review||'').trim()&&!/^ok$/i.test(String(d.review))).length;
  const cards=[
    ['Business Debt',money(businessDebt),'Current calculated balance','warn'],
    ['Fixed Installments / Month',money(fixed),'Business fixed loans only',''],
    ['Running Credit Due',money(running),'Current statements / revolving credit','warn'],
    ['Unpaid Bills ('+bm+')',money(unpaid),bills.filter(b=>b.status!=='Paid').length+' unpaid records','warn'],
    ['Cash Out This Month',money(cashOut),'Includes cash advances','info'],
    ['Operating Expense This Month',money(opex),'Excludes employee cash advances','good'],
    ['Cash Advance This Month',money(ca),'Cash out / employee receivable','info'],
    ['Expenses Today',money(todayTotal),'Recorded today',''],
    ['Household Debt',money(household),'Reference only; keep separate','info'],
    ['Review Items',String(review),'Debt rows that still need review','warn']
  ];
  document.getElementById('dashboardCards').innerHTML=cards.map(c=>`<div class="metric ${c[3]}"><div class="label">${esc(c[0])}</div><div class="value">${esc(c[1])}</div><div class="sub">${esc(c[2])}</div></div>`).join('');
  document.getElementById('expenseBreakdownLabel').textContent=m;
  document.getElementById('expenseBreakdown').innerHTML=summaryHtml(mx);
  renderUpcoming();
  document.getElementById('latestExpenses').innerHTML=expenseTableHtml([...state.expenses].sort(sortDateDesc).slice(0,10),false);
}

function renderUpcoming(){
  const rows=businessDebts().map(d=>({kind:'Debt',name:d.creditor,dueDay:num(d.dueDay),amount:num(d.monthlyDue),status:d.type,id:d.id}));
  const bm=state.billingMonth||currentMonth();
  state.bills.filter(b=>b.billingMonth===bm&&b.status!=='Paid').forEach(b=>rows.push({kind:'Bill',name:b.biller,dueDay:num(b.dueDay),amount:num(b.amount),status:'Unpaid',id:b.id}));
  rows.sort((a,b)=>a.dueDay-b.dueDay);
  document.getElementById('upcomingObligations').innerHTML=rows.length?`<table class="data"><thead><tr><th>Due</th><th>Type</th><th>Obligation</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${rows.slice(0,18).map(r=>`<tr><td>${r.dueDay}</td><td>${esc(r.kind)}</td><td><strong>${esc(r.name)}</strong><div class="muted">${esc(r.id)}</div></td><td>${pill(r.status)}</td><td class="num money">${money(r.amount)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No active obligations found.</div>';
}

function summaryHtml(xs){
  const total=expenseTotal(xs);const groups={};xs.forEach(x=>groups[x.category||'Uncategorized']=(groups[x.category||'Uncategorized']||0)+num(x.amount));
  const arr=Object.entries(groups).sort((a,b)=>b[1]-a[1]);
  if(!arr.length)return '<div class="empty">No expense records in this period.</div>';
  return arr.map(([k,v])=>`<div class="summary-row"><div><strong>${esc(k)}</strong><br><small>${total?((v/total)*100).toFixed(1):'0.0'}% of cash-out</small></div><div class="bar-wrap"><div class="bar" style="width:${total?Math.min(100,(v/total)*100):0}%"></div></div><b>${money(v)}</b></div>`).join('')+`<div class="summary-row"><strong>Total cash-out</strong><b>${money(total)}</b></div>`;
}

function renderExpenses(){
  const m=selectedExpenseMonth();setStored(EXP_MONTH_STORAGE,m);
  const cats=[...new Set(state.expenses.map(x=>x.category).filter(Boolean))].sort();const f=document.getElementById('expenseCategoryFilter');const old=f.value;f.innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option>${esc(c)}</option>`).join('');if(cats.includes(old))f.value=old;
  const cat=f.value;const q=document.getElementById('expenseSearch').value.trim().toLowerCase();
  let xs=state.expenses.filter(x=>!m||String(x.date||'').slice(0,7)===m);
  if(cat)xs=xs.filter(x=>x.category===cat);
  if(q)xs=xs.filter(x=>[x.description,x.notes,x.reference,x.method,x.category].join(' ').toLowerCase().includes(q));
  xs=[...xs].sort(sortDateDesc);
  const cash=expenseTotal(xs),ca=expenseTotal(xs.filter(isCashAdvance)),opex=cash-ca;
  document.getElementById('expenseSummary').innerHTML=`<div class="summary-row"><span>Cash-out</span><b>${money(cash)}</b></div><div class="summary-row"><span>Operating expense</span><b>${money(opex)}</b></div><div class="summary-row"><span>Cash advance</span><b>${money(ca)}</b></div><div class="summary-row"><span>Records</span><b>${xs.length}</b></div>`+summaryHtml(xs);
  document.getElementById('expenseCountLabel').textContent=`${xs.length} record${xs.length===1?'':'s'} • ${money(cash)}`;
  document.getElementById('expenseTable').innerHTML=expenseTableHtml(xs,true);
}

function expenseTableHtml(xs,actions){
  if(!xs.length)return '<div class="empty">No expense records found.</div>';
  return `<table class="data"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Payment</th><th>Reference / Notes</th><th class="num">Amount</th>${actions?'<th></th>':''}</tr></thead><tbody>${xs.map(x=>`<tr><td>${esc(x.date)}</td><td>${isCashAdvance(x)?'<span class="pill cashadvance">Cash Advance</span>':esc(x.category)}</td><td><strong>${esc(x.description)}</strong></td><td>${esc(x.method||'')}</td><td><div>${esc(x.reference||'')}</div><div class="muted">${esc(x.notes||'')}</div></td><td class="num money">${money(x.amount)}</td>${actions?`<td><button class="btn danger small" data-del-exp="${esc(x.id)}">Delete</button></td>`:''}</tr>`).join('')}</tbody></table>`;
}
function sortDateDesc(a,b){return String(b.date||'').localeCompare(String(a.date||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||''))}

function renderDebtOptions(){
  const opts=state.debts.map(d=>`<option value="${esc(d.id)}">${esc(d.id)} — ${esc(d.creditor)}</option>`).join('');
  document.getElementById('txDebt').innerHTML=opts;
  document.getElementById('billDebtId').innerHTML='<option value="">None</option>'+opts;
}
function renderDebts(){
  const ds=[...state.debts].sort((a,b)=>(a.scope||'').localeCompare(b.scope||'')||num(a.dueDay)-num(b.dueDay));
  document.getElementById('debtTable').innerHTML=ds.length?`<table class="data"><thead><tr><th>ID</th><th>Scope</th><th>Creditor</th><th>Type</th><th>Due</th><th class="num">Monthly / Statement</th><th class="num">Current Balance</th><th>Review</th><th></th></tr></thead><tbody>${ds.map(d=>`<tr><td>${esc(d.id)}</td><td>${pill(d.scope)}</td><td><strong>${esc(d.creditor)}</strong><div class="muted">${esc(d.note||'')}</div></td><td>${pill(d.type)}</td><td>${num(d.dueDay)}</td><td class="num money">${money(d.monthlyDue)}</td><td class="num money"><strong>${money(debtBalance(d))}</strong></td><td>${d.review?pill(d.review):''}</td><td><button class="btn secondary small" data-edit-debt="${esc(d.id)}">Edit</button></td></tr>`).join('')}</tbody></table>`:'<div class="empty">No debt records.</div>';
  const tx=[...state.transactions].sort(sortDateDesc).slice(0,10);
  document.getElementById('recentDebtTx').innerHTML=tx.length?`<table class="data"><thead><tr><th>Date</th><th>Debt</th><th>Type</th><th class="num">Amount</th><th>Ref</th></tr></thead><tbody>${tx.map(x=>`<tr><td>${esc(x.date)}</td><td>${esc(x.debtId)}</td><td>${esc(x.type)}</td><td class="num money">${money(x.amount)}</td><td>${esc(x.reference||'')}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No debt movements yet.</div>';
}

function renderBills(){
  const m=selectedBillMonth();setStored(BILL_MONTH_STORAGE,m);const xs=state.bills.filter(b=>b.billingMonth===m).sort((a,b)=>num(a.dueDay)-num(b.dueDay));
  const total=xs.reduce((a,b)=>a+num(b.amount),0),unpaid=xs.filter(b=>b.status!=='Paid'),paid=xs.filter(b=>b.status==='Paid');
  const cards=[['Total Bills',money(total),xs.length+' records',''],['Unpaid',money(expenseTotal(unpaid)),unpaid.length+' records','warn'],['Paid',money(expenseTotal(paid)),paid.length+' records','good'],['Next Due Day',String(unpaid.length?Math.min(...unpaid.map(b=>num(b.dueDay))):'—'),'Earliest unpaid due day','info']];
  document.getElementById('billCards').innerHTML=cards.map(c=>`<div class="metric ${c[3]}"><div class="label">${esc(c[0])}</div><div class="value">${esc(c[1])}</div><div class="sub">${esc(c[2])}</div></div>`).join('');
  document.getElementById('billCountLabel').textContent=`${xs.length} records • ${m}`;
  document.getElementById('billTable').innerHTML=xs.length?`<table class="data"><thead><tr><th>Due</th><th>Biller</th><th>Category</th><th>Status</th><th>Debt ID</th><th class="num">Amount</th><th></th></tr></thead><tbody>${xs.map(b=>`<tr><td>${num(b.dueDay)}</td><td><strong>${esc(b.biller)}</strong><div class="muted">${esc(b.terms||'')}</div></td><td>${esc(b.category||'')}</td><td>${pill(b.status)}</td><td>${esc(b.debtId||'')}</td><td class="num money">${money(b.amount)}</td><td><div class="actions"><button class="btn secondary small" data-toggle-bill="${esc(b.id)}" data-status="${b.status==='Paid'?'Unpaid':'Paid'}">Mark ${b.status==='Paid'?'Unpaid':'Paid'}</button><button class="btn secondary small" data-edit-bill="${esc(b.id)}">Edit</button><button class="btn danger small" data-del-bill="${esc(b.id)}">Delete</button></div></td></tr>`).join('')}</tbody></table>`:'<div class="empty">No bills saved for this month.</div>';
}
function pill(v){const s=String(v||'');let c='review';if(s==='Business')c='business';else if(s==='Household')c='household';else if(s==='Fixed Installment')c='fixed';else if(s==='Running Credit')c='running';else if(/^paid$/i.test(s))c='paid';else if(/^unpaid$/i.test(s))c='unpaid';else if(/^ok$/i.test(s))c='ok';return `<span class="pill ${c}">${esc(s)}</span>`}

async function addExpense(e){e.preventDefault();const x={id:uid('exp'),date:document.getElementById('expDate').value,category:document.getElementById('expCategory').value,description:document.getElementById('expDescription').value.trim(),amount:num(document.getElementById('expAmount').value),method:document.getElementById('expMethod').value,reference:document.getElementById('expReference').value.trim(),notes:document.getElementById('expNotes').value.trim(),createdAt:new Date().toISOString()};if(!x.date||!x.description||x.amount<=0)return;const ok=await mutate('addExpense',x,()=>state.expenses.push(x));if(ok){e.target.reset();document.getElementById('expDate').value=today();toast('Expense saved')}}
async function addDebtTx(e){e.preventDefault();const x={id:uid('tx'),date:document.getElementById('txDate').value,debtId:document.getElementById('txDebt').value,type:document.getElementById('txType').value,amount:num(document.getElementById('txAmount').value),reference:document.getElementById('txReference').value.trim(),notes:document.getElementById('txNotes').value.trim(),createdAt:new Date().toISOString()};if(!x.debtId||x.amount<=0)return;const ok=await mutate('addTransaction',x,()=>state.transactions.push(x));if(ok){e.target.reset();document.getElementById('txDate').value=today();renderDebtOptions();toast('Debt update saved')}}
async function deleteExpense(id){if(!confirm('Delete this expense record?'))return;await mutate('deleteExpense',{id},()=>state.expenses=state.expenses.filter(x=>x.id!==id));toast('Expense deleted')}

function openDebt(d=null){
  const dlg=document.getElementById('debtDialog');document.getElementById('debtId').readOnly=!!d;
  document.getElementById('debtId').value=d?.id||'';document.getElementById('debtScope').value=d?.scope||'Business';document.getElementById('debtCreditor').value=d?.creditor||'';document.getElementById('debtType').value=d?.type||'Fixed Installment';document.getElementById('debtMonthlyDue').value=d?.monthlyDue??'';document.getElementById('debtTerms').value=d?.terms??'';document.getElementById('debtDueDay').value=d?.dueDay??'';document.getElementById('debtOpeningBalance').value=d?.openingBalance??'';document.getElementById('debtReview').value=d?.review||'';document.getElementById('debtNote').value=d?.note||'';dlg.showModal();
}
async function saveDebt(){const d={id:document.getElementById('debtId').value.trim(),scope:document.getElementById('debtScope').value,creditor:document.getElementById('debtCreditor').value.trim(),type:document.getElementById('debtType').value,monthlyDue:num(document.getElementById('debtMonthlyDue').value),terms:document.getElementById('debtTerms').value?num(document.getElementById('debtTerms').value):null,dueDay:num(document.getElementById('debtDueDay').value),openingBalance:num(document.getElementById('debtOpeningBalance').value),review:document.getElementById('debtReview').value.trim(),note:document.getElementById('debtNote').value.trim()};if(!d.id||!d.creditor||d.dueDay<1)return alert('Complete the required debt fields.');const ok=await mutate('saveDebt',d,()=>{const i=state.debts.findIndex(x=>x.id===d.id);i>=0?state.debts[i]=d:state.debts.push(d)});if(ok){document.getElementById('debtDialog').close();toast('Debt saved')}}

function openBill(b=null){const m=selectedBillMonth();document.getElementById('billId').value=b?.id||'';document.getElementById('billEditMonth').value=b?.billingMonth||m;document.getElementById('billBiller').value=b?.biller||'';document.getElementById('billAmount').value=b?.amount??'';document.getElementById('billDueDay').value=b?.dueDay??'';document.getElementById('billTerms').value=b?.terms||'';document.getElementById('billStatus').value=b?.status||'Unpaid';document.getElementById('billCategory').value=b?.category||'Operating Bill';document.getElementById('billDebtId').value=b?.debtId||'';document.getElementById('billDialog').showModal()}
async function saveBill(){const b={id:document.getElementById('billId').value||uid('bill'),billingMonth:document.getElementById('billEditMonth').value,biller:document.getElementById('billBiller').value.trim(),amount:num(document.getElementById('billAmount').value),terms:document.getElementById('billTerms').value.trim(),dueDay:num(document.getElementById('billDueDay').value),status:document.getElementById('billStatus').value,category:document.getElementById('billCategory').value.trim()||'Operating Bill',debtId:document.getElementById('billDebtId').value};if(!b.biller||!b.billingMonth||b.amount<=0||b.dueDay<1)return alert('Complete the required bill fields.');const ok=await mutate('saveBill',b,()=>{const i=state.bills.findIndex(x=>x.id===b.id);i>=0?state.bills[i]=b:state.bills.push(b)});if(ok){document.getElementById('billDialog').close();toast('Bill saved')}}
async function setBillStatus(id,status){await mutate('setBillStatus',{id,status},()=>{const b=state.bills.find(x=>x.id===id);if(b)b.status=status});toast('Bill status updated')}
async function deleteBill(id){if(!confirm('Delete this bill?'))return;await mutate('deleteBill',{id},()=>state.bills=state.bills.filter(x=>x.id!==id));toast('Bill deleted')}
async function copyPrevBills(){const target=selectedBillMonth();const d=new Date(target+'-01T00:00:00');d.setMonth(d.getMonth()-1);const source=d.toLocaleDateString('en-CA').slice(0,7);if(!confirm(`Copy ${source} bills into ${target}?`))return;if(!remoteReady())return alert('Google Sheets connection is required for this action.');const ok=await mutate('copyBillsFromMonth',{sourceMonth:source,targetMonth:target});if(ok)toast('Previous month bills copied')}

function exportExpenses(){const m=selectedExpenseMonth(),cat=document.getElementById('expenseCategoryFilter').value,q=document.getElementById('expenseSearch').value.trim().toLowerCase();let xs=state.expenses.filter(x=>!m||String(x.date||'').slice(0,7)===m);if(cat)xs=xs.filter(x=>x.category===cat);if(q)xs=xs.filter(x=>[x.description,x.notes,x.reference,x.method,x.category].join(' ').toLowerCase().includes(q));const rows=[['Date','Category','Description','Amount','Payment Method','Reference','Notes'],...xs.map(x=>[x.date,x.category,x.description,x.amount,x.method,x.reference,x.notes])];const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`TechGeekPH-Expenses-${m||'all'}.csv`;a.click();URL.revokeObjectURL(a.href)}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2200)}

function goPage(id){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===id));window.scrollTo({top:0,behavior:'smooth'})}
function bind(){
  document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>goPage(b.dataset.page)));
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>goPage(b.dataset.go)));
  document.getElementById('connectionButton').addEventListener('click',openConnection);document.getElementById('saveConnectionBtn').addEventListener('click',saveConnection);document.getElementById('syncNowBtn').addEventListener('click',()=>syncFromSheets(false));
  document.getElementById('expenseForm').addEventListener('submit',addExpense);document.getElementById('debtTxForm').addEventListener('submit',addDebtTx);
  ['expenseMonth','expenseCategoryFilter'].forEach(id=>document.getElementById(id).addEventListener('change',renderExpenses));document.getElementById('expenseSearch').addEventListener('input',renderExpenses);document.getElementById('exportExpensesBtn').addEventListener('click',exportExpenses);
  document.getElementById('expenseTable').addEventListener('click',e=>{const b=e.target.closest('[data-del-exp]');if(b)deleteExpense(b.dataset.delExp)});
  document.getElementById('openDebtDialog').addEventListener('click',()=>openDebt());document.getElementById('saveDebtBtn').addEventListener('click',saveDebt);document.getElementById('debtTable').addEventListener('click',e=>{const b=e.target.closest('[data-edit-debt]');if(b)openDebt(state.debts.find(d=>d.id===b.dataset.editDebt))});
  document.getElementById('billMonth').addEventListener('change',renderBills);document.getElementById('openBillDialog').addEventListener('click',()=>openBill());document.getElementById('saveBillBtn').addEventListener('click',saveBill);document.getElementById('copyPrevBills').addEventListener('click',copyPrevBills);
  document.getElementById('billTable').addEventListener('click',e=>{const t=e.target.closest('[data-toggle-bill]');if(t)return setBillStatus(t.dataset.toggleBill,t.dataset.status);const ed=e.target.closest('[data-edit-bill]');if(ed)return openBill(state.bills.find(b=>b.id===ed.dataset.editBill));const del=e.target.closest('[data-del-bill]');if(del)return deleteBill(del.dataset.delBill)});
}

function init(){
  document.getElementById('expDate').value=today();document.getElementById('txDate').value=today();document.getElementById('expenseMonth').value=getStored(EXP_MONTH_STORAGE)||currentMonth();document.getElementById('billMonth').value=getStored(BILL_MONTH_STORAGE)||state.billingMonth||currentMonth();
  bind();renderAll();
  if(remoteReady())syncFromSheets(true);else setTimeout(openConnection,300);
  setInterval(()=>{if(remoteReady()&&!syncBusy)syncFromSheets(true)},60000);
}
document.addEventListener('DOMContentLoaded',init);
