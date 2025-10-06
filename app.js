'use strict';

/* ==========================
   تخزين الحالة والتهيئة
========================== */
const LS_KEY = 'router_inventory_app_v1';
const DEFAULT_STATE = {
  inventory: { capacity: 50, stock: 50 },
  sips: [], // {id, number, note, createdAt}
  logs: [], // {id, type: 'inv'|'sip'|'sys', message, delta:0, createdAt}
  settings: { primaryColor: '#1e3a8a', passwordEnabled: false, password: '' },
  meta: { lastBackupAt: null }
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    // تطابق الشكل مع الافتراضي
    return { ...structuredClone(DEFAULT_STATE), ...parsed,
      inventory: { ...DEFAULT_STATE.inventory, ...(parsed.inventory||{}) },
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings||{}) },
      meta: { ...DEFAULT_STATE.meta, ...(parsed.meta||{}) },
      sips: Array.isArray(parsed.sips)? parsed.sips : [],
      logs: Array.isArray(parsed.logs)? parsed.logs : []
    };
  } catch(e){
    console.error('loadState failed', e);
    return structuredClone(DEFAULT_STATE);
  }
}
function saveState() { localStorage.setItem(LS_KEY, JSON.stringify(state)); }

/* ==========================
   أدوات مساعدة
========================== */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const nowIso = () => new Date().toISOString();
// Use Arabic locale with Latin digits
const DIGIT_LOCALE = 'ar-EG-u-nu-latn';
const fmtDateTime = iso => new Date(iso).toLocaleString(DIGIT_LOCALE);
const fmtDate = iso => new Date(iso).toLocaleDateString(DIGIT_LOCALE, { weekday:'short', day:'2-digit', month:'2-digit'});
const formatNum = n => Number(n||0).toLocaleString(DIGIT_LOCALE);
// Normalize any Arabic-Indic digits to Latin for display
function toLatinDigits(input){
  const map = {
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'
  };
  return String(input||'').replace(/[٠-٩۰-۹]/g, d=> map[d] || d);
}
const genId = () => Math.random().toString(36).slice(2,9)+Date.now().toString(36);

function toast(msg, type='info', timeout=3000){
  const host = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type==='success'?'success': type==='error'?'error': type==='warn'?'warn':''}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(6px)'; }, timeout-300);
  setTimeout(()=>{ host.removeChild(el); }, timeout);
}

function confirmDialog(message){
  return new Promise(resolve=>{
    const modal = $('#confirmModal');
    $('#confirmMessage').textContent = message;
    modal.classList.remove('hidden');
    const onYes = ()=>{ cleanup(); resolve(true); };
    const onNo = ()=>{ cleanup(); resolve(false); };
    $('#confirmYes').addEventListener('click', onYes, { once:true });
    $('#confirmNo').addEventListener('click', onNo, { once:true });
    function onEsc(e){ if(e.key==='Escape'){ onNo(); } }
    document.addEventListener('keydown', onEsc, { once:true });
    function cleanup(){ modal.classList.add('hidden'); document.removeEventListener('keydown', onEsc); }
  });
}

function applyPrimaryColor(color){
  document.documentElement.style.setProperty('--primary', color);
}

/* ==========================
   تبويبات
========================== */
function initTabs(){
  $$('.tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      $$('.tab').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const t = btn.dataset.tab;
      $$('.tab-content').forEach(sec=>sec.classList.remove('shown'));
      $('#'+t).classList.add('shown');
    });
  });
}

/* ==========================
   عرض لوحة التحكم
========================== */
function updateDashboard(){
  $('#currentStock').textContent = formatNum(state.inventory.stock);
  $('#maxCapacity').textContent = formatNum(state.inventory.capacity);
  $('#todayDate').textContent = new Date().toLocaleDateString(DIGIT_LOCALE);
  const todayCount = state.sips.filter(s => new Date(s.createdAt).toDateString() === new Date().toDateString()).length;
  $('#todaySipCount').textContent = formatNum(todayCount);

  // حالة المخزون
  const badge = $('#stockStatus');
  const remaining = state.inventory.stock;
  badge.classList.remove('badge-low', 'badge-crit');
  if (remaining <= 5) { badge.classList.add('badge-crit'); badge.textContent = 'تحذير حرج: 5 أو أقل'; }
  else if (remaining <= 10) { badge.classList.add('badge-low'); badge.textContent = 'تحذير منخفض: 10 أو أقل'; }
  else { badge.textContent = 'مستقر'; }

  renderRecentLogs();
  renderCharts();
}

function renderRecentLogs(){
  const ul = $('#recentLogs');
  ul.innerHTML = '';
  const last = [...state.logs].slice(-8).reverse();
  for(const log of last){
    const li = document.createElement('li');
    li.innerHTML = `<span>${log.message}</span><span class="meta">${fmtDateTime(log.createdAt)}</span>`;
    ul.appendChild(li);
  }
}

/* ==========================
   إدارة المخزون
========================== */
function setInventory(capacity, stock){
  capacity = Math.max(1, Number(capacity||0));
  stock = Math.min(capacity, Math.max(0, Number(stock||0)));
  state.inventory.capacity = capacity;
  state.inventory.stock = stock;
  logEvent('sys', `تحديث السعة إلى ${capacity} والكمية إلى ${stock}`);
  saveState();
  updateAllUI();
}
function adjustStock(delta, reason='تعديل يدوي'){
  delta = Number(delta||0);
  if (!delta) return;
  const before = state.inventory.stock;
  const after = Math.min(state.inventory.capacity, Math.max(0, before + delta));
  const applied = after - before;
  if (applied === 0){ toast('لا يمكن تجاوز الحدود', 'warn'); return; }
  state.inventory.stock = after;
  logEvent('inv', `${reason}: ${applied>0?'+':''}${applied}`, applied);
  saveState();
  updateAllUI();
}

function consumeOneForSip(){
  if (state.inventory.stock <= 0) return false;
  state.inventory.stock -= 1;
  logEvent('inv', 'خصم 1 راوتر لعملية SIP', -1);
  saveState();
  return true;
}

function populateInventoryPage(){
  $('#invCurrent').value = state.inventory.stock;
  $('#invCapacity').value = state.inventory.capacity;
  renderInvLogs();
}

function renderInvLogs(){
  const ul = $('#invLogs');
  ul.innerHTML = '';
  const items = [...state.logs].filter(l=>l.type!=='sip').slice(-30).reverse();
  for(const log of items){
    const li = document.createElement('li');
    const pill = document.createElement('span');
    pill.className = 'pill';
    if (log.delta){
      const abs = formatNum(Math.abs(log.delta));
      pill.textContent = log.delta>0?`+${abs}`:`-${abs}`;
    } else {
      pill.textContent = '—';
    }
    li.innerHTML = `<span>${log.message}</span><span class="meta">${fmtDateTime(log.createdAt)}</span>`;
    li.appendChild(pill);
    ul.appendChild(li);
  }
}

// حذف عدد من أحدث سجلات التعديلات (غير سجلات SIP)
async function deleteRecentInvLogs(count){
  count = Math.max(1, Number(count||0));
  const available = state.logs.filter(l=> l.type !== 'sip').length;
  const toRemove = Math.min(count, available);
  if (toRemove <= 0){ toast('لا توجد سجلات للحذف','warn'); return; }
  const ok = await confirmDialog(`سيتم حذف ${toRemove} من أحدث سجلات التعديلات (لا يشمل SIP). متابعة؟`);
  if(!ok) return;
  // احذف من نهاية المصفوفة حتى حذف العدد المطلوب
  let removed = 0;
  for (let i = state.logs.length - 1; i >= 0 && removed < toRemove; i--) {
    if (state.logs[i].type !== 'sip') { state.logs.splice(i,1); removed++; }
  }
  saveState();
  updateAllUI();
  toast(`تم حذف ${removed} سجل`, 'success');
}

/* ==========================
   SIP
========================== */
function addSip(number, note){
  number = String(number||'').trim();
  if(!/^[0-9]{3,15}$/.test(number)) { toast('صيغة رقم غير صحيحة', 'error'); return false; }
  // منع التكرار
  if (state.sips.some(s => s.number === number)) { toast('الرقم موجود مسبقاً', 'warn'); return false; }
  if (state.inventory.stock <= 0){ toast('المخزون نفد، لا يمكن إضافة SIP جديد', 'error'); return false; }

  const s = { id: genId(), number, note: String(note||'').trim(), createdAt: nowIso() };
  state.sips.push(s);
  logEvent('sip', `إضافة SIP ${number}${s.note? ' - '+s.note:''}`);
  consumeOneForSip();
  saveState();
  updateAllUI();
  toast('تمت إضافة SIP بنجاح', 'success');
  return true;
}

function renderSipList(){
  const ul = $('#sipList');
  ul.innerHTML = '';
  const q = ($('#searchSip').value||'').trim();
  const fd = $('#fromDate').value ? new Date($('#fromDate').value) : null;
  const td = $('#toDate').value ? new Date($('#toDate').value) : null;

  let items = [...state.sips].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  if(q) items = items.filter(s => s.number.includes(q));
  if(fd) items = items.filter(s => new Date(s.createdAt) >= fd);
  if(td) { td.setHours(23,59,59,999); items = items.filter(s => new Date(s.createdAt) <= td); }

  for (const s of items.slice(0,200)){
    const li = document.createElement('li');
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-light';
    copyBtn.textContent = 'نسخ';
    copyBtn.addEventListener('click', async ()=>{
      try{ await navigator.clipboard.writeText(toLatinDigits(s.number)); toast('تم النسخ', 'success'); }catch{ toast('تعذر النسخ','error'); }
    });
    li.innerHTML = `<div><div><strong>${toLatinDigits(s.number)}</strong></div><div class="meta">${s.note? s.note+' · ' : ''}${fmtDateTime(s.createdAt)}</div></div>`;
    li.appendChild(copyBtn);
    ul.appendChild(li);
  }
}

/* ==========================
   السجلات والتقارير
========================== */
function logEvent(type, message, delta=0){
  state.logs.push({ id: genId(), type, message, delta, createdAt: nowIso() });
}

function renderAllLogs(){
  const ul = $('#allLogs');
  ul.innerHTML = '';
  const q = ($('#searchLog').value||'').trim();
  const fd = $('#logFrom').value ? new Date($('#logFrom').value) : null;
  const td = $('#logTo').value ? new Date($('#logTo').value) : null;
  let items = [...state.logs].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  if(q) items = items.filter(l => l.message.includes(q));
  if(fd) items = items.filter(l => new Date(l.createdAt) >= fd);
  if(td) { td.setHours(23,59,59,999); items = items.filter(l => new Date(l.createdAt) <= td); }

  for(const log of items.slice(0,400)){
    const li = document.createElement('li');
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.textContent = log.type.toUpperCase();
    li.innerHTML = `<span>${log.message}</span><span class="meta">${fmtDateTime(log.createdAt)}</span>`;
    li.appendChild(pill);
    ul.appendChild(li);
  }
}

/* ==========================
   جدول استهلاك الأسبوع (SIP)
========================== */
function renderWeeklyTable(){
  const tableBody = document.querySelector('#weeklyTable tbody');
  if(!tableBody) return;
  tableBody.innerHTML = '';
  const now = new Date();
  const start = new Date(now); start.setDate(now.getDate()-6); start.setHours(0,0,0,0);
  const end = new Date(now); end.setHours(23,59,59,999);

  const rows = state.sips
    .filter(s=>{ const t = new Date(s.createdAt); return t>=start && t<=end; })
    .sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));

  if(rows.length===0){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align:center;color:#64748b">لا توجد عمليات خلال الأسبوع</td>`;
    tableBody.appendChild(tr);
    return;
  }

  for(const s of rows){
    const t = new Date(s.createdAt);
    const dayName = t.toLocaleDateString(DIGIT_LOCALE,{ weekday:'long' });
    const dateStr = t.toLocaleDateString(DIGIT_LOCALE,{ day:'2-digit', month:'2-digit', year:'numeric' });
    const timeStr = t.toLocaleTimeString(DIGIT_LOCALE,{ hour:'2-digit', minute:'2-digit', second:'2-digit' });
    const monthStr = t.toLocaleDateString(DIGIT_LOCALE,{ month:'long' });
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${dayName}</td>
      <td>${dateStr}</td>
      <td>${timeStr}</td>
      <td>${monthStr}</td>
      <td><strong>${toLatinDigits(s.number)}</strong></td>
      <td>${s.note? s.note : '—'}</td>
    `;
    tableBody.appendChild(tr);
  }
}

/* ==========================
   الرسوم البيانية
========================== */
let pieChart, barChart;
function renderCharts(){
  // Pie: المتبقي مقابل المستهلك
  const pieCtx = $('#stockPie');
  const used = Math.max(0, state.inventory.capacity - state.inventory.stock);
  const remaining = state.inventory.stock;
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(pieCtx, {
    type: 'doughnut',
    data: { labels:['المتبقي','المستهلك'], datasets:[{ data:[remaining, used], backgroundColor:['#10b981','#3b82f6'] }] },
    options: { plugins:{ legend:{ position:'bottom' } }, cutout:'65%'}
  });

  // Bar: استهلاك الاسبوع
  const barCtx = $('#weeklyChart');
  const days = [...Array(7)].map((_,i)=>{
    const d = new Date(); d.setDate(d.getDate() - (6-i)); d.setHours(0,0,0,0); return d;
  });
  const counts = days.map(d => weeklyCountForDay(d));
  if (barChart) barChart.destroy();
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: { labels: days.map(d=> d.toLocaleDateString(DIGIT_LOCALE,{weekday:'short'})), datasets:[{ label:'SIP', data: counts, backgroundColor:'#3b82f6' }] },
    options: { scales:{ y:{ beginAtZero:true, ticks:{ stepSize:1 } } } }
  });
}
function weeklyCountForDay(day){
  const start = new Date(day); start.setHours(0,0,0,0);
  const end = new Date(day); end.setHours(23,59,59,999);
  return state.sips.filter(s=>{ const t = new Date(s.createdAt); return t>=start && t<=end; }).length;
}

/* ==========================
   نسخ احتياطي وتصدير/استيراد
========================== */
function exportJSON(){
  const blob = new Blob([JSON.stringify(state,null,2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `router-inventory-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  state.meta.lastBackupAt = nowIso(); saveState(); toast('تم تصدير نسخة احتياطية','success');
}

function toCSV(){
  const lines = [];
  lines.push('type,id,number,note,delta,message,createdAt');
  for(const s of state.sips){ lines.push(['sip', s.id, s.number, quoteCsv(s.note), '', '', s.createdAt].join(',')); }
  for(const l of state.logs){ lines.push([l.type, l.id, '', '', l.delta, quoteCsv(l.message), l.createdAt].join(',')); }
  return lines.join('\n');
}
function quoteCsv(v){ if(v==null) return ''; const s = String(v).replaceAll('"','""'); return '"'+s+'"'; }

function exportCSV(){
  const blob = new Blob([toCSV()], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `router-inventory-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast('تم تصدير CSV','success');
}

function exportXLSX(){
  try{
    const wb = XLSX.utils.book_new();

    // Weekly SIP table (first sheet): last 7 days rows matching UI table
    const now = new Date();
    const start = new Date(now); start.setDate(now.getDate()-6); start.setHours(0,0,0,0);
    const end = new Date(now); end.setHours(23,59,59,999);
    const weeklyRows = [
      ['اليوم','التاريخ','الوقت','الشهر','رقم SIP','ملاحظات']
    ];
    const weeklyItems = state.sips
      .filter(s=>{ const t=new Date(s.createdAt); return t>=start && t<=end; })
      .sort((a,b)=> new Date(a.createdAt) - new Date(b.createdAt));
    if (weeklyItems.length){
      for (const s of weeklyItems){
        const t = new Date(s.createdAt);
        const dayName = t.toLocaleDateString(DIGIT_LOCALE,{ weekday:'long' });
        const dateStr = t.toLocaleDateString(DIGIT_LOCALE,{ day:'2-digit', month:'2-digit', year:'numeric' });
        const timeStr = t.toLocaleTimeString(DIGIT_LOCALE,{ hour:'2-digit', minute:'2-digit', second:'2-digit' });
        const monthStr = t.toLocaleDateString(DIGIT_LOCALE,{ month:'long' });
        weeklyRows.push([dayName, dateStr, timeStr, monthStr, s.number, s.note||'']);
      }
    } else {
      weeklyRows.push(['—','—','—','—','—','لا توجد عمليات خلال الأسبوع']);
    }
    const weeklySheet = XLSX.utils.aoa_to_sheet(weeklyRows);
    XLSX.utils.book_append_sheet(wb, weeklySheet, 'جدول الأسبوع');

    // Summary sheet
    const capacity = state.inventory.capacity;
    const stock = state.inventory.stock;
    const used = Math.max(0, capacity - stock);
    const totalSips = state.sips.length;
    const today = new Date();
    const startOfToday = new Date(today); startOfToday.setHours(0,0,0,0);
    const endOfToday = new Date(today); endOfToday.setHours(23,59,59,999);
    const todaySips = state.sips.filter(s=>{ const t=new Date(s.createdAt); return t>=startOfToday && t<=endOfToday; }).length;

    const startOfWeek = new Date(today); startOfWeek.setDate(today.getDate()-6); startOfWeek.setHours(0,0,0,0);
    const weekSips = state.sips.filter(s=> new Date(s.createdAt) >= startOfWeek).length;

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthSips = state.sips.filter(s=> new Date(s.createdAt) >= startOfMonth).length;

    const summaryRows = [
      ['تاريخ التصدير', fmtDateTime(nowIso())],
      ['السعة القصوى', capacity],
      ['المخزون الحالي', stock],
      ['المستهلك (السعة - المخزون)', used],
      ['إجمالي عمليات SIP', totalSips],
      ['عمليات اليوم', todaySips],
      ['عمليات هذا الأسبوع', weekSips],
      ['عمليات هذا الشهر', monthSips],
      [],
      ['تفصيل الأسبوع (آخر 7 أيام)'],
      ['اليوم', 'عدد عمليات SIP']
    ];
    for(let i=6;i>=0;i--){
      const d = new Date(today); d.setDate(today.getDate()-i); d.setHours(0,0,0,0);
      const count = weeklyCountForDay(d);
      summaryRows.push([d.toLocaleDateString(DIGIT_LOCALE,{weekday:'short', day:'2-digit', month:'2-digit'}), count]);
    }
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'الملخص');

    // Inventory sheet
    const invData = [
      { 'السعة القصوى': capacity, 'المخزون الحالي': stock, 'المستهلك': used, 'تاريخ التصدير': fmtDateTime(nowIso()) }
    ];
    const invSheet = XLSX.utils.json_to_sheet(invData);
    XLSX.utils.book_append_sheet(wb, invSheet, 'المخزون');

    // SIPs sheet (ensure headers even when empty)
    const sipHeaders = ['المعرف','رقم SIP','مطراج الكابل','التاريخ والوقت'];
    const sipData = state.sips.map(s=>({
      'المعرف': s.id,
      'رقم SIP': s.number,
      'مطراج الكابل': s.note||'',
      'التاريخ والوقت': fmtDateTime(s.createdAt)
    }));
    let sipSheet;
    if (sipData.length){
      sipSheet = XLSX.utils.json_to_sheet(sipData, { header: sipHeaders });
    } else {
      sipSheet = XLSX.utils.aoa_to_sheet([sipHeaders]);
    }
    XLSX.utils.book_append_sheet(wb, sipSheet, 'SIPs');

    // Logs sheet (ensure headers even when empty)
    const logHeaders = ['المعرف','النوع','الرسالة','التغير','التاريخ والوقت'];
    const logData = state.logs.map(l=>({
      'المعرف': l.id,
      'النوع': l.type,
      'الرسالة': l.message,
      'التغير': l.delta,
      'التاريخ والوقت': fmtDateTime(l.createdAt)
    }));
    let logSheet;
    if (logData.length){
      logSheet = XLSX.utils.json_to_sheet(logData, { header: logHeaders });
    } else {
      logSheet = XLSX.utils.aoa_to_sheet([logHeaders]);
    }
    XLSX.utils.book_append_sheet(wb, logSheet, 'Logs');

    const fileName = `router-inventory-${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast('تم التصدير إلى Excel','success');
  }catch(e){ console.error(e); toast('فشل التصدير إلى Excel','error'); }
}

async function importFile(file){
  const text = await file.text();
  try{
    if (file.type.includes('json') || text.trim().startsWith('{')){
      const obj = JSON.parse(text);
      if(!obj || !obj.inventory) throw new Error('صيغة غير صحيحة');
      const ok = await confirmDialog('سيتم استبدال البيانات الحالية، هل تريد المتابعة؟');
      if (!ok) return;
      state = { ...structuredClone(DEFAULT_STATE), ...obj };
      saveState();
      updateAllUI();
      toast('تم الاستيراد بنجاح','success');
    } else {
      toast('يدعم الاستيراد JSON فقط حالياً','warn');
    }
  }catch(e){ console.error(e); toast('فشل الاستيراد','error'); }
}

/* ==========================
   الأمان والقفل
========================== */
function lockApp(){ if(!state.settings.passwordEnabled || !state.settings.password){ toast('لم يتم تفعيل كلمة المرور','warn'); return; } $('#lockScreen').classList.remove('hidden'); }
function unlockApp(){ const v = $('#unlockPassword').value; if(v===state.settings.password){ $('#lockScreen').classList.add('hidden'); $('#unlockPassword').value=''; toast('تم الفتح','success'); } else { toast('كلمة مرور غير صحيحة','error'); } }

/* ==========================
   تهيئة الأحداث والواجهة
========================== */
function bindEvents(){
  // تبويبات
  initTabs();

  // أزرار سريعة في لوحة التحكم
  $('#add5').addEventListener('click', ()=>adjustStock(5,'إضافة سريعة'));
  $('#add10').addEventListener('click', ()=>adjustStock(10,'إضافة سريعة'));
  $('#sub5').addEventListener('click', ()=>adjustStock(-5,'خصم سريع'));
  $('#sub10').addEventListener('click', ()=>adjustStock(-10,'خصم سريع'));

  // إدارة المخزون
  $('#saveInv').addEventListener('click', ()=>{
    const cap = Number($('#invCapacity').value);
    const cur = Number($('#invCurrent').value);
    setInventory(cap, cur);
  });
  $('#resetInv').addEventListener('click', async()=>{
    const ok = await confirmDialog('سيتم إعادة تعيين التطبيق بالكامل وحذف جميع السجلات والبيانات. هل تريد المتابعة؟');
    if(!ok) return;
    try {
      localStorage.removeItem(LS_KEY);
    } catch(e) { /* ignore */ }
    // أعد تحميل الصفحة لبدء حالة جديدة تماماً
    location.reload();
  });
  $$('#inventory .btn[data-delta]').forEach(b=>{
    b.addEventListener('click', ()=> adjustStock(Number(b.dataset.delta)));
  });
  $('#applyCustom').addEventListener('click', ()=>{
    const d = Number($('#customDelta').value||0); if(!d) return; adjustStock(d, 'تعديل مخصص'); $('#customDelta').value='';
  });
  $('#deleteInvLogs').addEventListener('click', ()=>{
    const c = Number($('#invDeleteCount').value||0);
    if(!c){ toast('الرجاء إدخال عدد صحيح', 'warn'); return; }
    deleteRecentInvLogs(c);
  });

  // SIP
  $('#sipForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    const number = $('#sipNumber').value;
    const note = $('#sipNote').value;
    const ok = await confirmDialog(`سيتم خصم 1 من المخزون لإضافة SIP ${number}. تأكيد؟`);
    if(!ok) return;
    if (addSip(number, note)) { $('#sipForm').reset(); renderSipList(); }
  });
  $('#sipNumber').addEventListener('input', ()=>{
    const remaining = state.inventory.stock - 1;
    $('#sipImpact').textContent = remaining>=0 ? `المتبقي بعد الإضافة: ${remaining}` : 'لا يوجد مخزون كافٍ';
  });
  ['searchSip','fromDate','toDate'].forEach(id=> $('#'+id).addEventListener('input', renderSipList));

  // السجلات
  ['searchLog','logFrom','logTo'].forEach(id=> $('#'+id).addEventListener('input', renderAllLogs));

  // إعدادات
  $('#primaryColor').addEventListener('input', (e)=> applyPrimaryColor(e.target.value));
  $('#enablePassword').addEventListener('change', (e)=>{ $('#passwordWrap').style.display = e.target.checked? 'block':'none'; });
  $('#saveSettings').addEventListener('click', ()=>{
    state.settings.primaryColor = $('#primaryColor').value;
    state.settings.passwordEnabled = $('#enablePassword').checked;
    state.settings.password = $('#appPassword').value || state.settings.password;
    saveState();
    toast('تم حفظ الإعدادات','success');
  });

  // قفل
  $('#lockBtn').addEventListener('click', lockApp);
  $('#unlockBtn').addEventListener('click', unlockApp);

  // نسخ احتياطي
  $('#exportBtn').addEventListener('click', ()=>{
    // قائمة صغيرة لاختيار JSON/CSV
    exportJSON();
  });
  $('#exportXlsxBtn').addEventListener('click', exportXLSX);
  $('#importInput').addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if(!f) return; importFile(f).finally(()=>{ e.target.value=''; });
  });

  // اختصارات لوحة المفاتيح
  document.addEventListener('keydown', (e)=>{
    if(e.key.toLowerCase() === 'l'){ lockApp(); }
    if(e.key === '/' && document.activeElement.tagName !== 'INPUT'){ e.preventDefault(); $('.tab[data-tab="sip"]').click(); $('#searchSip').focus(); }
    if(e.key === '+' && e.shiftKey){ adjustStock(1,'اختصار'); }
    if(e.key === '-' ){ adjustStock(-1,'اختصار'); }
  });
}

function updateSettingsUI(){
  applyPrimaryColor(state.settings.primaryColor || '#1e3a8a');
  $('#primaryColor').value = state.settings.primaryColor || '#1e3a8a';
  $('#enablePassword').checked = !!state.settings.passwordEnabled;
  $('#passwordWrap').style.display = state.settings.passwordEnabled? 'block':'none';
  if(state.settings.passwordEnabled && !state.settings.password){ toast('يرجى تعيين كلمة مرور','warn'); }
}

function weeklyBackupReminder(){
  const last = state.meta.lastBackupAt ? new Date(state.meta.lastBackupAt) : null;
  const now = new Date();
  if(!last || (now - last) > 7*24*60*60*1000){ toast('مر أكثر من أسبوع بدون نسخة احتياطية','warn', 5000); }
}

function updateAllUI(){
  updateDashboard();
  populateInventoryPage();
  renderSipList();
  renderAllLogs();
  renderWeeklyTable();
}

function init(){
  bindEvents();
  updateSettingsUI();
  updateAllUI();
  weeklyBackupReminder();
}

document.addEventListener('DOMContentLoaded', init);
