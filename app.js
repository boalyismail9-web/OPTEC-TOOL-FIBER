'use strict';

/* ==========================
   تخزين الحالة والتهيئة
========================== */
const LS_KEY = 'router_inventory_app_v1';
const DEFAULT_STATE = {
  inventory: { capacity: 50, stock: 50 },
  cable: { capacity: 0, stock: 0 }, // بالمتر
  sips: [], // {id, number, note, createdAt}
  
  logs: [], // {id, type: 'inv'|'sip'|'sys', message, delta:0, createdAt}
  settings: { primaryColor: '#1e3a8a', darkEnabled: false, passwordEnabled: false, password: '' },
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
      cable: { ...DEFAULT_STATE.cable, ...(parsed.cable||{}) },
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

// تنسيق تاريخ/وقت ليتوافق مع حقل datetime-local
function toDatetimeLocalValue(date){
  // عالج الإزاحة بحيث نأخذ الوقت المحلي بدون المنطقة في النص
  const d = new Date(date.getTime() - date.getTimezoneOffset()*60000);
  return d.toISOString().slice(0,16); // YYYY-MM-DDTHH:mm
}

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

// تطبيق الوضع الداكن
function applyDarkMode(enabled){
  const root = document.documentElement;
  if (enabled) root.classList.add('dark');
  else root.classList.remove('dark');
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

// تبويبات فرعية داخل صفحة SIP
function initSubTabs(){
  $$('.sub-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      // فعّل الزر
      const group = btn.closest('.sub-tabs');
      group?.querySelectorAll('.sub-tab').forEach(b=> b.classList.remove('active'));
      btn.classList.add('active');
      // أظهر المحتوى الموافق
      const id = btn.dataset.subtab;
      const host = btn.closest('form')?.parentElement; // داخل نفس البطاقة
      host?.querySelectorAll('.sub-tab-content').forEach(sec=> sec.classList.remove('shown'));
      const target = host?.querySelector('#'+id);
      if (target) target.classList.add('shown');
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

  // بطاقة ميتراج الكابل
  if ($('#cableCurrent')){
    $('#cableCurrent').textContent = formatNum(state.cable.stock||0);
    $('#cableCapacity').textContent = formatNum(state.cable.capacity||0);
    const cbadge = $('#cableStatus');
    if (cbadge){
      cbadge.classList.remove('badge-low','badge-crit');
      const crem = state.cable.stock||0;
      // عتبات افتراضية: حرج <= 20م، منخفض <= 50م
      if (crem <= 20) { cbadge.classList.add('badge-crit'); cbadge.textContent = 'تحذير حرج: 20م أو أقل'; }
      else if (crem <= 50) { cbadge.classList.add('badge-low'); cbadge.textContent = 'تحذير منخفض: 50م أو أقل'; }
      else { cbadge.textContent = 'مستقر'; }
    }
  }

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

// إدارة سعة/مخزون الكابل (بالمتر)
function setCable(capacity, stock){
  capacity = Math.max(0, Number(capacity||0));
  stock = Math.min(capacity, Math.max(0, Number(stock||0)));
  state.cable.capacity = capacity;
  state.cable.stock = stock;
  logEvent('sys', `تحديث سعة الكابل إلى ${capacity}م والكمية إلى ${stock}م`);
  saveState();
  updateAllUI();
}

function adjustCable(delta, reason='تعديل كابل'){
  delta = Number(delta||0);
  if (!delta) return;
  const before = state.cable.stock || 0;
  const cap = Math.max(0, Number(state.cable.capacity||0));
  const after = Math.min(cap, Math.max(0, before + delta));
  const applied = after - before;
  if (applied === 0){ toast('لا يمكن تجاوز حدود الكابل','warn'); return; }
  state.cable.stock = after;
  logEvent('inv', `${reason}: ${applied>0?'+':''}${applied}م`, applied);
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
  // حقول الكابل
  if ($('#invCableCurrent')) $('#invCableCurrent').value = state.cable.stock || 0;
  if ($('#invCableCapacity')) $('#invCableCapacity').value = state.cable.capacity || 0;
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
function addSip(number, note, createdAtIso){
  number = String(number||'').trim();
  if(!/^[0-9]{3,15}$/.test(number)) { toast('صيغة رقم غير صحيحة', 'error'); return false; }
  // منع التكرار
  if (state.sips.some(s => s.number === number)) { toast('الرقم موجود مسبقاً', 'warn'); return false; }
  if (state.inventory.stock <= 0){ toast('المخزون نفد، لا يمكن إضافة SIP جديد', 'error'); return false; }

  const s = { id: genId(), number, note: String(note||'').trim(), createdAt: createdAtIso || nowIso() };
  state.sips.push(s);
  logEvent('sip', `إضافة SIP ${number}${s.note? ' - '+s.note:''}`);
  consumeOneForSip();
  // خصم من مطراج الكابل إن كانت القيمة رقمية في الملاحظة
  const noteDigits = toLatinDigits(s.note).match(/\d+/);
  if (noteDigits){
    const meters = Number(noteDigits[0]);
    if (meters>0){
      const before = state.cable.stock || 0;
      const after = Math.max(0, before - meters);
      const applied = after - before; // سالب
      state.cable.stock = after;
      logEvent('inv', `خصم ${meters}م من الكابل لعملية SIP`, applied);
    }
  }
  saveState();
  updateAllUI();
  toast('تمت إضافة SIP بنجاح', 'success');
  return true;
}

// تحديث SIP قائم (تعديل الرقم/الملاحظة)
function updateSip(id, newNumber, newNote){
  const s = state.sips.find(x=> x.id === id);
  if(!s){ toast('العنصر غير موجود','error'); return false; }
  const prevNumber = s.number;
  const prevNote = s.note || '';
  newNumber = String(newNumber||'').trim();
  newNote = String(newNote||'').trim();

  if(!/^[0-9]{3,15}$/.test(newNumber)) { toast('صيغة رقم غير صحيحة', 'error'); return false; }
  // منع التكرار مع استثناء العنصر نفسه
  if (newNumber !== prevNumber && state.sips.some(x => x.number === newNumber)){
    toast('الرقم موجود مسبقاً','warn');
    return false;
  }

  s.number = newNumber;
  s.note = newNote;
  saveState();
  const msgParts = [];
  if (newNumber !== prevNumber) msgParts.push(`الرقم: ${prevNumber} → ${newNumber}`);
  if (newNote !== prevNote) msgParts.push('تحديث مطراج الكابل');
  logEvent('sip', msgParts.length? `تحديث SIP (${msgParts.join(' ، ')})` : 'تحديث SIP بدون تغييرات');
  updateAllUI();
  toast('تم تحديث SIP','success');
  return true;
}

function renderSipList(){
  const ul = $('#sipList');
  ul.innerHTML = '';
  const q = ($('#searchSip').value||'').trim();
  const qNorm = toLatinDigits(q).replace(/\D+/g,'');
  const fd = $('#fromDate').value ? new Date($('#fromDate').value) : null;
  const td = $('#toDate').value ? new Date($('#toDate').value) : null;
  const noteQ = ($('#noteFilter')?.value||'').trim();

  let items = [...state.sips].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  if(qNorm) items = items.filter(s => s.number.includes(qNorm));
  if(noteQ) items = items.filter(s => (s.note||'').includes(noteQ));
  if(fd) items = items.filter(s => new Date(s.createdAt) >= fd);
  if(td) { td.setHours(23,59,59,999); items = items.filter(s => new Date(s.createdAt) <= td); }

  // إبراز المطابقة في الرقم
  function highlightNumber(num){
    const disp = toLatinDigits(num);
    if(!qNorm) return `<strong>${disp}</strong>`;
    const idx = disp.indexOf(qNorm);
    if(idx === -1) return `<strong>${disp}</strong>`;
    const before = disp.slice(0, idx);
    const match = disp.slice(idx, idx+qNorm.length);
    const after = disp.slice(idx+qNorm.length);
    return `<strong>${before}<mark class="hl">${match}</mark>${after}</strong>`;
  }

  for (const s of items.slice(0,200)){
    const li = document.createElement('li');

    // عرض عادي
    const normalWrap = document.createElement('div');
    normalWrap.innerHTML = `<div><div>${highlightNumber(s.number)}</div><div class="meta">${s.note? s.note+' · ' : ''}${fmtDateTime(s.createdAt)}</div></div>`;

    const btnsWrap = document.createElement('div');
    btnsWrap.style.display = 'flex';
    btnsWrap.style.gap = '8px';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-light';
    copyBtn.textContent = 'نسخ';
    copyBtn.addEventListener('click', async ()=>{
      try{ await navigator.clipboard.writeText(toLatinDigits(s.number)); toast('تم النسخ', 'success'); }catch{ toast('تعذر النسخ','error'); }
    });
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-primary';
    editBtn.textContent = 'تعديل';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'حذف';

    btnsWrap.appendChild(copyBtn);
    btnsWrap.appendChild(editBtn);
    btnsWrap.appendChild(delBtn);

    // وضع التحرير
    const editWrap = document.createElement('div');
    editWrap.style.display = 'none';
    editWrap.innerHTML = `
      <div class="row">
        <div class="col"><input class="sip-edit-number" inputmode="numeric" pattern="^[0-9]{3,15}$" value="${s.number}" /></div>
        <div class="col"><input class="sip-edit-note" value="${s.note||''}" /></div>
      </div>
    `;
    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'buttons mt';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-success';
    saveBtn.textContent = 'تحديث';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-light';
    cancelBtn.textContent = 'إلغاء';
    actionsWrap.appendChild(saveBtn);
    actionsWrap.appendChild(cancelBtn);
    editWrap.appendChild(actionsWrap);

    // تبديل بين الوضعين
    function enterEdit(){ normalWrap.style.display='none'; btnsWrap.style.display='none'; editWrap.style.display='block'; }
    function exitEdit(){ normalWrap.style.display=''; btnsWrap.style.display='flex'; editWrap.style.display='none'; }

    editBtn.addEventListener('click', ()=> enterEdit());
    cancelBtn.addEventListener('click', ()=> exitEdit());
    // طب-normalize أثناء الكتابة
    const inlineNum = editWrap.querySelector('.sip-edit-number');
    inlineNum.addEventListener('input', ()=>{
      const caret = inlineNum.selectionStart;
      inlineNum.value = toLatinDigits(inlineNum.value).replace(/\D+/g,'');
      try{ inlineNum.setSelectionRange(caret, caret); }catch{}
    });

    saveBtn.addEventListener('click', ()=>{
      const numInput = editWrap.querySelector('.sip-edit-number');
      const noteInput = editWrap.querySelector('.sip-edit-note');
      const normalized = toLatinDigits(numInput.value).replace(/\D+/g,'');
      const ok = updateSip(s.id, normalized, noteInput.value);
      if (ok) { renderSipList(); }
    });

    delBtn.addEventListener('click', async ()=>{
      const ok = await confirmDialog(`سيتم حذف SIP ${toLatinDigits(s.number)}. هل أنت متأكد؟`);
      if(!ok) return;
      deleteSip(s.id);
    });

    li.appendChild(normalWrap);
    li.appendChild(btnsWrap);
    li.appendChild(editWrap);
    ul.appendChild(li);
  }
}

// حذف SIP بسؤال تأكيد
function deleteSip(id){
  const idx = state.sips.findIndex(x=> x.id===id);
  if(idx === -1){ toast('العنصر غير موجود','error'); return; }
  const removed = state.sips.splice(idx,1)[0];
  logEvent('sip', `حذف SIP ${removed.number}${removed.note? ' - '+removed.note:''}`);
  // استرجاع قطعة إلى المخزون إن أمكن (بدون تجاوز السعة)
  if (state.inventory.stock < state.inventory.capacity) {
    state.inventory.stock += 1;
    logEvent('inv', 'استرجاع 1 راوتر بعد حذف SIP', +1);
  } else {
    // في حال كانت السعة ممتلئة، لا نزيد المخزون لتجنب التجاوز
  }
  // استرجاع الكابل إذا كانت الملاحظة تحوي أرقام متر
  const noteDigits = toLatinDigits(removed.note||'').match(/\d+/);
  if (noteDigits){
    const meters = Number(noteDigits[0]);
    if (meters>0){
      const before = state.cable.stock || 0;
      const cap = Math.max(0, Number(state.cable.capacity||0));
      const after = Math.min(cap, before + meters);
      const applied = after - before; // موجب
      state.cable.stock = after;
      if (applied){ logEvent('inv', `استرجاع ${applied}م كابل بعد حذف SIP`, applied); }
    }
  }
  saveState();
  updateAllUI();
  toast('تم حذف SIP','success');
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
      ['اليوم','التاريخ','الوقت','الشهر','رقم SIP','مطراج الكابل']
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
      { 'السعة القصوى (راوتر)': capacity, 'المخزون الحالي (راوتر)': stock, 'المستهلك (راوتر)': used, 'سعة الكابل (م)': state.cable.capacity||0, 'المتبقي كابل (م)': state.cable.stock||0, 'تاريخ التصدير': fmtDateTime(nowIso()) }
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
  initSubTabs();

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

  // كابل: حفظ/تصفير وتعديلات سريعة
  $('#saveCable')?.addEventListener('click', ()=>{
    const cap = Number($('#invCableCapacity').value||0);
    const cur = Number($('#invCableCurrent').value||0);
    setCable(cap, cur);
  });
  $('#resetCable')?.addEventListener('click', ()=>{
    setCable(0, 0);
  });
  $$('#inventory .btn[data-cdelta]')?.forEach(b=>{
    b.addEventListener('click', ()=> adjustCable(Number(b.dataset.cdelta||0)));
  });
  $('#applyCustomCable')?.addEventListener('click', ()=>{
    const d = Number($('#customCableDelta').value||0); if(!d) return; adjustCable(d, 'تعديل كابل مخصص'); $('#customCableDelta').value='';
  });

  // SIP
  $('#sipForm').addEventListener('submit', async (e)=>{
    e.preventDefault();
    // حول أي أرقام عربية إلى لاتينية وتخلص من أي رموز غير أرقام
    const number = toLatinDigits($('#sipNumber').value).replace(/\D+/g,'');
    const note = $('#sipNote').value;
    let createdAtIso = null;
    const useCustom = $('#sipCustomDateToggle')?.checked;
    const dtInput = $('#sipDateTime');
    if (useCustom && dtInput && dtInput.value){
      // القيمة بدون منطقة زمنية، افترضها وقت محلي
      const d = new Date(dtInput.value);
      if (!isNaN(d.getTime())) createdAtIso = d.toISOString();
    }
    const ok = await confirmDialog(`سيتم خصم 1 من المخزون لإضافة SIP ${number}. تأكيد؟`);
    if(!ok) return;
    if (addSip(number, note, createdAtIso)) { $('#sipForm').reset(); renderSipList(); }
  });
  $('#sipNumber').addEventListener('input', ()=>{
    // طبّق تحويل الأرقام إلى لاتيني مباشرة في الحقل
    const inp = $('#sipNumber');
    const caret = inp.selectionStart;
    const before = inp.value;
    inp.value = toLatinDigits(inp.value).replace(/\D+/g,'');
    // حاول الحفاظ على موضع المؤشر إن أمكن
    try{ inp.setSelectionRange(caret, caret); }catch{}
    const remaining = state.inventory.stock - 1;
    const hint = $('#sipImpact');
    hint.textContent = remaining>=0 ? `المتبقي بعد الإضافة: ${remaining}` : 'لا يوجد مخزون كافٍ';
    hint.classList.remove('text-warn','text-error');
    if (remaining < 0){ hint.classList.add('text-error'); }
    else if (remaining <= 5){ hint.classList.add('text-warn'); }
  });
  ['searchSip','fromDate','toDate','noteFilter'].forEach(id=> $('#'+id)?.addEventListener('input', renderSipList));

  // أزرار نطاق التاريخ السريعة لقائمة SIP
  const setRange = (type)=>{
    const from = $('#fromDate');
    const to = $('#toDate');
    const now = new Date();
    let start=null, end=null;
    if(type==='today'){
      start = new Date(now); start.setHours(0,0,0,0);
      end = new Date(now); end.setHours(23,59,59,999);
    } else if(type==='week'){
      start = new Date(now); start.setDate(now.getDate()-6); start.setHours(0,0,0,0);
      end = new Date(now); end.setHours(23,59,59,999);
    } else if(type==='month'){
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now); end.setHours(23,59,59,999);
    } else if(type==='clear'){
      from.value = ''; to.value = ''; renderSipList(); return;
    }
    // تعبئة حقول التاريخ بنسق YYYY-MM-DD
    const toDateInputVal = (d)=> new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
    from.value = toDateInputVal(start);
    to.value = toDateInputVal(end);
    renderSipList();
  };
  $('#rangeToday')?.addEventListener('click', ()=> setRange('today'));
  $('#rangeWeek')?.addEventListener('click', ()=> setRange('week'));
  $('#rangeMonth')?.addEventListener('click', ()=> setRange('month'));
  $('#clearRange')?.addEventListener('click', ()=> setRange('clear'));

  // عناصر التاريخ المخصص
  const toggle = $('#sipCustomDateToggle');
  const dt = $('#sipDateTime');
  const backBtn = $('#sipDateBackBtn');
  if (toggle && dt && backBtn){
    function setNow(){ dt.value = toDatetimeLocalValue(new Date()); }
    toggle.addEventListener('change', ()=>{
      const on = toggle.checked;
      dt.disabled = !on;
      backBtn.disabled = !on;
      if (on){ setNow(); }
      else { dt.value = ''; }
    });
    backBtn.addEventListener('click', ()=>{
      if (!dt.value){ dt.value = toDatetimeLocalValue(new Date()); }
      const d = new Date(dt.value);
      if (isNaN(d.getTime())){ setNow(); return; }
      d.setDate(d.getDate() - 1);
      dt.value = toDatetimeLocalValue(d);
    });
  }
  // إعدادات
  if ($('#enableDark')){
    $('#enableDark').addEventListener('change', (e)=> applyDarkMode(e.target.checked));
    state.settings.darkEnabled = !!($('#enableDark')?.checked);
  }
  $('#enablePassword').addEventListener('change', (e)=>{ $('#passwordWrap').style.display = e.target.checked? 'block':'none'; });
  $('#saveSettings').addEventListener('click', ()=>{
    // احتفظ باللون الحالي إن وجد
    const currentPrimary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#1e3a8a';
    state.settings.primaryColor = currentPrimary;
    state.settings.passwordEnabled = $('#enablePassword').checked;
    state.settings.password = $('#appPassword').value || state.settings.password;
    applyDarkMode(state.settings.darkEnabled);
    saveState();
    updateAllUI();
    toast('تم حفظ الإعدادات','success');
  });

  // قفل
  $('#lockBtn').addEventListener('click', lockApp);

  // نسخ احتياطي
  $('#exportBtn').addEventListener('click', ()=>{
    // قائمة صغيرة لاختيار JSON/CSV
    exportJSON();
  });
  $('#exportXlsxBtn').addEventListener('click', exportXLSX);
  $('#importInput').addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if(!f) return; importFile(f).finally(()=>{ e.target.value=''; });
  });

  // تقارير سريعة CSV لعمليات SIP اليوم/الأسبوع
  function exportSipsCsv(range){
    const now = new Date();
    let start, end;
    if(range==='today'){
      start = new Date(now); start.setHours(0,0,0,0);
      end = new Date(now); end.setHours(23,59,59,999);
    } else if(range==='week'){
      start = new Date(now); start.setDate(now.getDate()-6); start.setHours(0,0,0,0);
      end = new Date(now); end.setHours(23,59,59,999);
    } else {
      start = new Date(0); end = now;
    }
    const rows = [['id','number','note','createdAt']];
    const items = state.sips.filter(s=>{ const t = new Date(s.createdAt); return t>=start && t<=end; });
    for (const s of items){ rows.push([s.id, s.number, s.note||'', s.createdAt]); }
    const csv = rows.map(r=> r.map(x=> x==null? '' : String(x).includes(',')||String(x).includes('"') ? '"'+String(x).replaceAll('"','""')+'"' : String(x)).join(',')).join('\n');
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `sips-${range}-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast('تم تصدير تقرير SIP','success');
  }
  $('#exportTodaySips')?.addEventListener('click', ()=> exportSipsCsv('today'));
  $('#exportWeekSips')?.addEventListener('click', ()=> exportSipsCsv('week'));

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
  applyDarkMode(!!state.settings.darkEnabled);
  if ($('#enableDark')) $('#enableDark').checked = !!state.settings.darkEnabled;
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
