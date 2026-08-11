let db = null, auth = null, currentUser = null, userReadings = [];

// DOM & LocalStorage Helpers
const $ = id => document.getElementById(id);
const getNum = id => parseFloat($(id)?.value || 0) || 0;
const setStorage = (k, v) => localStorage.setItem(k, typeof v === 'object' ? JSON.stringify(v) : v.toString());
const getStorage = k => localStorage.getItem(k);

// Prevent multi-touch gesture zoom
document.addEventListener('gesturestart', e => e.preventDefault());

// Application State
let providersList = JSON.parse(getStorage('utility_providers') || '[]');
let elecCycleStartDay = parseInt(getStorage('utility_elec_cycle_start_day'), 10) || 28;
let waterCycleStartDay = parseInt(getStorage('utility_water_cycle_start_day'), 10) || 28;

// Explicit Order Normalization
function normalizeProviderOrders() {
  const catMap = { 'REFUSE': 0, 'ELECTRICITY': 1, 'WATER': 2 };
  providersList.sort((a, b) => (catMap[a.type] ?? 99) - (catMap[b.type] ?? 99) || (a.order ?? 999) - (b.order ?? 999));
  
  ['REFUSE', 'ELECTRICITY', 'WATER'].forEach(type => {
    providersList.filter(p => p.type === type).forEach((p, idx) => {
      p.order = idx;
      p.isDefault = (idx === 0);
    });
  });
}

function getActiveProvider(type) {
  return providersList.find(p => p.type === type && p.isDefault) ||
         providersList.find(p => p.type === type) ||
         (type === 'WATER' ? { name: 'PUB Water', model: 'SG_TIERED', t1Tariff: 1.21, t1Wct: 0.72, t1Wbf: 1.09, t2Tariff: 1.81, t2Wct: 1.18, t2Wbf: 1.40, flatRate: 1.20, gst: 9.0 } :
          type === 'ELECTRICITY' ? { name: 'SP Group', tariff: 0.2324, gst: 9.0 } :
          { name: 'Refuse Fee', fee: 9.76, gst: 9.0 });
}

function getDefaultCycleStartDate(type = 'WATER') {
  const cycleDay = type === 'ELECTRICITY' ? elecCycleStartDay : waterCycleStartDay;
  const today = new Date();
  let year = today.getFullYear(), month = today.getMonth();
  if (today.getDate() < cycleDay) { month -= 1; if (month < 0) { month = 11; year -= 1; } }
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(cycleDay).padStart(2, '0')}`;
}

function formatDateDMY(dateMs) {
  const dt = new Date(dateMs || Date.now());
  return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
}

function getReadingCycleInfo(dateMs, cycleDay = 28) {
  const dt = new Date(dateMs || Date.now());
  let year = dt.getFullYear(), month = dt.getMonth();
  if (dt.getDate() < cycleDay) { month -= 1; if (month < 0) { month = 11; year -= 1; } }
  
  const cycleDate = new Date(year, month, 1);
  const monthName = cycleDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const startDate = new Date(year, month, cycleDay);
  let endMonth = month + 1, endYear = year;
  if (endMonth > 11) { endMonth = 0; endYear += 1; }
  const endDate = new Date(endYear, endMonth, cycleDay - 1);
  
  return { monthName, year, month, rangeStr: `${formatDateDMY(startDate.getTime())} - ${formatDateDMY(endDate.getTime())}` };
}

// Calculations
function calculateWaterEst() {
  const usage = Math.max(0, getNum('waterCurrInput') - getNum('waterPrevInput'));
  const p = getActiveProvider('WATER');
  let base = 0;

  if (p.model === 'FLAT') {
    base = usage * (p.flatRate || 1.20);
  } else {
    const t1 = (p.t1Tariff || 1.21) + (p.t1Wct || 0.72) + (p.t1Wbf || 1.09);
    const t2 = (p.t2Tariff || 1.81) + (p.t2Wct || 1.18) + (p.t2Wbf || 1.40);
    base = usage <= 40 ? usage * t1 : (40 * t1) + ((usage - 40) * t2);
  }

  const tax = base * ((p.gst || 9.0) / 100);
  const total = base + tax;

  if ($('waterUsageEst')) $('waterUsageEst').innerText = `${usage.toFixed(3)} m³`;
  if ($('waterTaxEst')) $('waterTaxEst').innerText = `S$${tax.toFixed(2)}`;
  if ($('waterTotalEst')) $('waterTotalEst').innerText = `S$${total.toFixed(2)}`;

  return { usage, tax, total };
}

function calculateElecEst() {
  const usage = Math.max(0, Math.round(getNum('elecCurrInput') - getNum('elecPrevInput')));
  const p = getActiveProvider('ELECTRICITY');
  const base = usage * (p.tariff || 0.2324);
  const total = base * (1 + ((p.gst || 9.0) / 100));

  if ($('elecUsageEst')) $('elecUsageEst').innerText = `${usage} kWh`;
  if ($('elecTotalEst')) $('elecTotalEst').innerText = `S$${total.toFixed(2)}`;

  return { usage, total };
}

// Formatters
function formatWaterInputAutoDecimal(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    let digits = el.value.replace(/\D/g, '');
    if (!digits || parseInt(digits, 10) === 0) { el.value = ''; } 
    else {
      if (digits.length > 9) digits = digits.slice(0, 9);
      el.value = (parseInt(digits, 10) / 1000).toFixed(3);
    }
    calculateWaterEst();
  });
}

function formatElecInputWholeNumber(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    let digits = el.value.replace(/\D/g, '');
    if (!digits) { el.value = ''; } 
    else {
      if (digits.length > 8) digits = digits.slice(0, 8);
      el.value = parseInt(digits, 10).toString();
    }
    calculateElecEst();
  });
}

formatWaterInputAutoDecimal($('waterPrevInput'));
formatWaterInputAutoDecimal($('waterCurrInput'));
formatElecInputWholeNumber($('elecPrevInput'));
formatElecInputWholeNumber($('elecCurrInput'));

// Autofill Previous Readings
function autofillLatestReadings() {
  let waterVal = getStorage('utility_last_water_reading') || '';
  let elecVal = getStorage('utility_last_elec_reading') || '';

  if (currentUser) {
    waterVal = getStorage(`utility_last_water_reading_${currentUser.uid}`) || waterVal;
    elecVal = getStorage(`utility_last_elec_reading_${currentUser.uid}`) || elecVal;
  }

  if (userReadings?.length) {
    const wLatest = userReadings.filter(r => r.type === 'WATER' && (r.currentReading ?? r.reading) != null).sort((a,b)=>(b.readingDate||0)-(a.readingDate||0))[0];
    if (wLatest) waterVal = wLatest.currentReading ?? wLatest.reading;

    const eLatest = userReadings.filter(r => r.type === 'ELECTRICITY' && (r.currentReading ?? r.reading) != null).sort((a,b)=>(b.readingDate||0)-(a.readingDate||0))[0];
    if (eLatest) elecVal = eLatest.currentReading ?? eLatest.reading;
  }

  if (waterVal !== '' && $('waterPrevInput')) {
    $('waterPrevInput').value = parseFloat(waterVal).toFixed(3);
    setStorage('utility_last_water_reading', waterVal);
    if (currentUser) setStorage(`utility_last_water_reading_${currentUser.uid}`, waterVal);
  }

  if (elecVal !== '' && $('elecPrevInput')) {
    $('elecPrevInput').value = Math.round(parseFloat(elecVal) || 0).toString();
    setStorage('utility_last_elec_reading', elecVal);
    if (currentUser) setStorage(`utility_last_elec_reading_${currentUser.uid}`, elecVal);
  }

  calculateWaterEst();
  calculateElecEst();
}

function updateCycleLabels() {
  const getSuffix = d => `${d}${d===1?'st':d===2?'nd':d===3?'rd':'th'}`;
  if ($('elecCycleStartDayLabel')) $('elecCycleStartDayLabel').innerText = getSuffix(elecCycleStartDay);
  if ($('waterCycleStartDayLabel')) $('waterCycleStartDayLabel').innerText = getSuffix(waterCycleStartDay);
  if ($('waterCycleStartInput') && !$('waterCycleStartInput').value) $('waterCycleStartInput').value = getDefaultCycleStartDate('WATER');
  if ($('elecCycleStartInput') && !$('elecCycleStartInput').value) $('elecCycleStartInput').value = getDefaultCycleStartDate('ELECTRICITY');
}

function updateRateLabels() {
  const wP = getActiveProvider('WATER'), eP = getActiveProvider('ELECTRICITY');
  if ($('activeWaterProviderLabel')) $('activeWaterProviderLabel').innerText = `${wP.name} (${(wP.model==='SG_TIERED'||wP.model==='TIERED')?'Tiered':'Flat'})`;
  if ($('activeElecProviderLabel')) $('activeElecProviderLabel').innerText = `${eP.name} (Flat)`;
  if ($('elecTariffLabel')) $('elecTariffLabel').innerText = `$${(eP.tariff || 0).toFixed(4)} / kWh`;
}

function renderProviderActionControls(p) {
  return `
    <div style="display:flex; gap:6px; align-items:center;">
      <button type="button" data-action="edit-provider" data-id="${p.id}" class="btn-icon-action"><span class="material-icons-round">edit</span></button>
      <button type="button" data-action="delete-provider" data-id="${p.id}" class="btn-icon-action text-danger"><span class="material-icons-round">delete</span></button>
    </div>`;
}

function saveProvidersState() {
  normalizeProviderOrders();
  setStorage('utility_providers', providersList);
  if (currentUser) setStorage(`utility_providers_${currentUser.uid}`, providersList);
  syncFirebase('providers', providersList);
  renderProviders();
  updateRateLabels();
  calculateWaterEst();
  calculateElecEst();
}

function renderProviders() {
  normalizeProviderOrders();
  ['REFUSE', 'ELECTRICITY', 'WATER'].forEach(type => {
    const listEl = $(`${type.toLowerCase()}ProvidersList`);
    if (!listEl) return;
    const items = providersList.filter(p => p.type === type);
    
    listEl.innerHTML = !items.length ? `<p style="font-size:0.75rem; color:var(--text-muted); font-style:italic;">No ${type.toLowerCase()} providers added.</p>` :
      items.map(p => `
        <div class="provider-card-ui">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
            <div>
              <strong style="font-size:0.78rem; font-weight:700; color:#0f172a;">${p.name}</strong>
              ${p.isDefault ? '<div style="margin-top:2px;"><span class="badge-default">★ Default</span></div>' : ''}
            </div>
            ${renderProviderActionControls(p)}
          </div>
          <div style="background:#f8fafc; padding:8px 10px; border-radius:10px; font-size:0.76rem;">
            ${p.type==='REFUSE' ? `<div class="card-row-item"><span>Usage Fee</span><strong>S$${(p.fee||0).toFixed(4)} / month</strong></div>` :
              p.type==='ELECTRICITY' ? `<div class="card-row-item"><span>Usage Fee</span><strong>S$${(p.tariff||0).toFixed(4)} / kWh</strong></div>` :
              `<div class="card-row-item"><span>Rate Model</span><strong>${p.model==='FLAT'?'Flat':'Standard Tiered'}</strong></div>`}
            <div class="card-row-item"><span>GST</span><strong>${(p.gst||0).toFixed(1)}%</strong></div>
          </div>
        </div>`).join('');
  });
}

// Modal State & Controls
let editingProviderId = null, selectedModalType = 'ELECTRICITY', selectedModalWaterModel = 'FLAT';

function updateModalUI() {
  ['Elec', 'Water', 'Refuse'].forEach(t => {
    const chip = $(`chip${t}`), group = $(`form${t}Group`);
    if (chip) chip.className = `type-chip${selectedModalType === t.toUpperCase() ? ` active-${t.toLowerCase()}` : ''}`;
    if (group) group.classList.toggle('hidden', selectedModalType !== t.toUpperCase());
  });

  if ($('btnWaterModelFlat')) $('btnWaterModelFlat').className = `model-btn${selectedModalWaterModel==='FLAT'?' active':''}`;
  if ($('btnWaterModelTiered')) $('btnWaterModelTiered').className = `model-btn${selectedModalWaterModel==='TIERED'?' active':''}`;
  if ($('modalWaterFlatFields')) $('modalWaterFlatFields').classList.toggle('hidden', selectedModalWaterModel !== 'FLAT');
  if ($('modalWaterTieredFields')) $('modalWaterTieredFields').classList.toggle('hidden', selectedModalWaterModel !== 'TIERED');
}

function openModalForProvider(p = null) {
  editingProviderId = p?.id || null;
  if ($('modalTitle')) $('modalTitle').innerText = p ? 'Edit Provider' : 'Configure New Provider';
  if ($('modalProviderName')) $('modalProviderName').value = p?.name || '';
  if ($('modalIsDefault')) $('modalIsDefault').checked = p ? !!p.isDefault : true;

  selectedModalType = p?.type || 'ELECTRICITY';
  if (selectedModalType === 'WATER') selectedModalWaterModel = (p?.model === 'SG_TIERED' || p?.model === 'TIERED') ? 'TIERED' : 'FLAT';
  
  updateModalUI();
  if ($('providerModal')) $('providerModal').classList.remove('hidden');
}

$('btnOpenAddProvider')?.addEventListener('click', () => openModalForProvider(null));
$('modalBtnCancel')?.addEventListener('click', () => $('providerModal')?.classList.add('hidden'));

['chipElec', 'chipWater', 'chipRefuse'].forEach((id, i) => {
  $(id)?.addEventListener('click', () => { selectedModalType = ['ELECTRICITY', 'WATER', 'REFUSE'][i]; updateModalUI(); });
});

$('btnWaterModelFlat')?.addEventListener('click', () => { selectedModalWaterModel = 'FLAT'; updateModalUI(); });
$('btnWaterModelTiered')?.addEventListener('click', () => { selectedModalWaterModel = 'TIERED'; updateModalUI(); });

$('modalBtnSave')?.addEventListener('click', () => {
  const name = $('modalProviderName')?.value.trim() || 'Provider Name';
  const isDefault = $('modalIsDefault')?.checked ?? true;

  let pObj = { id: editingProviderId || 'p_' + Date.now(), type: selectedModalType, name, isDefault };

  if (selectedModalType === 'ELECTRICITY') {
    pObj.tariff = getNum('modalElecRate') || 0.2324;
    pObj.gst = getNum('modalElecGst') || 9.0;
  } else if (selectedModalType === 'WATER') {
    pObj.model = selectedModalWaterModel;
    if (selectedModalWaterModel === 'FLAT') {
      pObj.flatRate = getNum('modalWaterFlatRate') || 1.20;
      pObj.gst = getNum('modalWaterFlatGst') || 9.0;
    } else {
      pObj.t1Tariff = getNum('modalWaterT1Tariff') || 1.210;
      pObj.t1Wct = getNum('modalWaterT1Wct') || 0.720;
      pObj.t1Wbf = getNum('modalWaterT1Wbf') || 1.090;
      pObj.t2Tariff = getNum('modalWaterT2Tariff') || 1.810;
      pObj.t2Wct = getNum('modalWaterT2Wct') || 1.180;
      pObj.t2Wbf = getNum('modalWaterT2Wbf') || 1.400;
      pObj.gst = getNum('modalWaterTieredGst') || 9.0;
    }
  } else if (selectedModalType === 'REFUSE') {
    pObj.fee = getNum('modalRefuseFee') || 9.76;
    pObj.gst = getNum('modalRefuseGst') || 9.0;
  }

  if (isDefault) providersList.forEach(p => { if (p.type === selectedModalType) p.isDefault = false; });

  if (editingProviderId) {
    const idx = providersList.findIndex(p => p.id === editingProviderId);
    if (idx !== -1) providersList[idx] = pObj;
  } else { providersList.push(pObj); }

  $('providerModal')?.classList.add('hidden');
  saveProvidersState();
});

// Steppers
const bindStepper = (id, key, delta) => $(id)?.addEventListener('click', () => {
  let v = (key==='E'?elecCycleStartDay:waterCycleStartDay) + delta;
  if (v < 1) v = 31; else if (v > 31) v = 1;
  if (key==='E') elecCycleStartDay = v; else waterCycleStartDay = v;
  setStorage(`utility_${key==='E'?'elec':'water'}_cycle_start_day`, v);
  updateCycleLabels();
  syncFirebase('cycles', { elecCycleStartDay, waterCycleStartDay });
  renderHistory();
});

bindStepper('btnElecCycleMinus', 'E', -1);
bindStepper('btnElecCyclePlus', 'E', 1);
bindStepper('btnWaterCycleMinus', 'W', -1);
bindStepper('btnWaterCyclePlus', 'W', 1);

// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const type = btn.getAttribute('data-type');
    document.querySelectorAll('.tab-section').forEach(sec => sec.classList.add('hidden'));
    $(`section${type.charAt(0) + type.slice(1).toLowerCase()}`)?.classList.remove('hidden');
    if (type === 'HISTORY') renderHistory();
  });
});

// Firebase Unified Sync Helper
async function syncFirebase(path, val) {
  if (db && currentUser && window.FirebaseSDK) {
    try {
      const { ref, set } = window.FirebaseSDK;
      await set(ref(db, `users/${currentUser.uid}/${path}`), val);
    } catch(e) { console.error(`Sync error (${path}):`, e); }
  }
}

// Reading Save Logic
async function saveReading(type) {
  const isWater = type === 'WATER';
  const est = isWater ? calculateWaterEst() : calculateElecEst();
  const prev = isWater ? getNum('waterPrevInput') : Math.round(getNum('elecPrevInput'));
  const curr = isWater ? getNum('waterCurrInput') : Math.round(getNum('elecCurrInput'));

  if (curr <= 0) return alert('Please enter a valid current reading.');

  const cycleDate = ($(isWater ? 'waterCycleStartInput' : 'elecCycleStartInput')?.value) || getDefaultCycleStartDate(type);
  const activeP = getActiveProvider(type);

  const item = {
    id: 'rd_' + Date.now(),
    type,
    providerName: activeP.name,
    previousReading: isWater ? parseFloat(prev.toFixed(3)) : prev,
    currentReading: isWater ? parseFloat(curr.toFixed(3)) : curr,
    reading: isWater ? parseFloat(curr.toFixed(3)) : curr,
    usage: isWater ? parseFloat(est.usage.toFixed(3)) : Math.round(est.usage),
    totalAmount: est.total,
    readingDate: Date.now(),
    timestamp: Date.now(),
    date: new Date().toISOString(),
    cycleStartDate: cycleDate
  };

  userReadings.push(item);
  setStorage('utility_readings_local', userReadings);
  if (currentUser) setStorage(`utility_readings_${currentUser.uid}`, userReadings);

  await syncFirebase('readings', userReadings);
  
  if (isWater) {
    if ($('waterPrevInput')) $('waterPrevInput').value = curr.toFixed(3);
    setStorage('utility_last_water_reading', curr.toFixed(3));
    if ($('waterCurrInput')) $('waterCurrInput').value = '';
  } else {
    if ($('elecPrevInput')) $('elecPrevInput').value = curr.toString();
    setStorage('utility_last_elec_reading', curr.toString());
    if ($('elecCurrInput')) $('elecCurrInput').value = '';
  }

  autofillLatestReadings();
  renderHistory();
  alert(`${isWater ? 'Water' : 'Electricity'} reading saved and synced!`);
}

$('btnSaveWater')?.addEventListener('click', () => saveReading('WATER'));
$('btnSaveElectricity')?.addEventListener('click', () => saveReading('ELECTRICITY'));

// History & Breakdown Renderers
function renderHistory() {
  if (!$('historyList')) return;
  const refuseP = getActiveProvider('REFUSE');
  const refuseFee = (refuseP.fee || 9.76) * (1 + ((refuseP.gst || 9.0) / 100));
  const currentCycleInfo = getReadingCycleInfo(Date.now(), waterCycleStartDay);
  
  const cycleGroups = {};
  userReadings.forEach(item => {
    const cycleInfo = getReadingCycleInfo(item.readingDate || item.timestamp, item.type === 'ELECTRICITY' ? elecCycleStartDay : waterCycleStartDay);
    if (!cycleGroups[cycleInfo.monthName]) {
      cycleGroups[cycleInfo.monthName] = { key: cycleInfo.monthName, rangeStr: cycleInfo.rangeStr, year: cycleInfo.year, month: cycleInfo.month, elec: [], water: [] };
    }
    cycleGroups[cycleInfo.monthName][item.type === 'ELECTRICITY' ? 'elec' : 'water'].push(item);
  });

  if (!cycleGroups[currentCycleInfo.monthName]) {
    cycleGroups[currentCycleInfo.monthName] = { key: currentCycleInfo.monthName, rangeStr: currentCycleInfo.rangeStr, year: currentCycleInfo.year, month: currentCycleInfo.month, elec: [], water: [] };
  }

  const currG = cycleGroups[currentCycleInfo.monthName];
  const currElecTotal = currG.elec.reduce((s, x) => s + (x.totalAmount || 0), 0);
  const currWaterTotal = currG.water.reduce((s, x) => s + (x.totalAmount || 0), 0);
  const currCycleGrandTotal = currElecTotal + currWaterTotal + refuseFee;

  let html = `
    <div class="current-cycle-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span style="font-weight:800; font-size:0.92rem; color:#0f172a;">Current Cycle Monitor</span>
        <span style="font-weight:700; font-size:0.78rem; color:#64748b;">${currentCycleInfo.monthName}</span>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:14px; text-align:center;">
        <div class="cycle-metric-box"><div style="color:#ef4444; font-size:0.75rem; font-weight:700;">⚡ Electricity</div><div style="font-size:0.95rem; font-weight:800; color:#ef4444;">S$${currElecTotal.toFixed(2)}</div></div>
        <div class="cycle-metric-box"><div style="color:#0284c7; font-size:0.75rem; font-weight:700;">💧 Water</div><div style="font-size:0.95rem; font-weight:800; color:#0284c7;">S$${currWaterTotal.toFixed(2)}</div></div>
        <div class="cycle-metric-box"><div style="color:#64748b; font-size:0.75rem; font-weight:700;">🗑️ Refuse</div><div style="font-size:0.95rem; font-weight:800; color:#64748b;">S$${refuseFee.toFixed(2)}</div></div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px dashed #cbd5e1; padding-top:10px;">
        <span style="font-weight:700; font-size:0.85rem; color:#0f172a;">Estimated Cycle Total</span>
        <span style="font-weight:800; font-size:1.18rem; color:#0f172a;">S$${currCycleGrandTotal.toFixed(2)}</span>
      </div>
    </div>`;

  const sortedKeys = Object.keys(cycleGroups).sort((a, b) => (cycleGroups[b].year * 12 + cycleGroups[b].month) - (cycleGroups[a].year * 12 + cycleGroups[a].month));
  
  html += sortedKeys.map(key => {
    const g = cycleGroups[key];
    const elecTotal = g.elec.reduce((s, x) => s + (x.totalAmount || 0), 0);
    const elecUsage = g.elec.reduce((s, x) => s + (x.usage || 0), 0);
    const waterTotal = g.water.reduce((s, x) => s + (x.totalAmount || 0), 0);
    const waterUsage = g.water.reduce((s, x) => s + (x.usage || 0), 0);
    
    return `
      <div class="history-period-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
          <div><strong style="font-size:0.98rem; font-weight:800; color:#0f172a;">${g.key}</strong></div>
          <div style="text-align:right;"><span style="font-size:0.68rem; color:#64748b;">Total Bill</span><strong style="font-size:1.05rem; display:block; color:#0f172a;">S$${(elecTotal + waterTotal + refuseFee).toFixed(2)}</strong></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
          <div class="history-subcard-elec"><div style="font-weight:700; font-size:0.76rem; color:#dc2626;">⚡ Electricity</div><div style="font-weight:800; font-size:0.92rem; color:#dc2626;">S$${elecTotal.toFixed(4)}</div><div style="font-size:0.72rem; font-weight:700;">${Math.round(elecUsage)} kWh</div></div>
          <div class="history-subcard-water"><div style="font-weight:700; font-size:0.76rem; color:#0284c7;">💧 Water</div><div style="font-weight:800; font-size:0.92rem; color:#0284c7;">S$${waterTotal.toFixed(4)}</div><div style="font-size:0.72rem; font-weight:700;">${waterUsage.toFixed(3)} m³</div></div>
        </div>
        <button type="button" class="btn-see-history" onclick="window.openBreakdownModal('${g.key}')">➔ See History</button>
      </div>`;
  }).join('');

  $('historyList').innerHTML = html;
  autofillLatestReadings();
}

window.openBreakdownModal = function(groupKey) {
  const items = userReadings.filter(item => getReadingCycleInfo(item.readingDate || item.timestamp, item.type === 'ELECTRICITY' ? elecCycleStartDay : waterCycleStartDay).monthName === groupKey);
  const refuseP = getActiveProvider('REFUSE');
  const refuseFee = (refuseP.fee || 9.76) * (1 + ((refuseP.gst || 9.0) / 100));

  const elecItems = items.filter(x => x.type === 'ELECTRICITY').sort((a,b)=>(b.readingDate||0)-(a.readingDate||0));
  const waterItems = items.filter(x => x.type === 'WATER').sort((a,b)=>(b.readingDate||0)-(a.readingDate||0));

  const grandTotal = items.reduce((s, x) => s + (x.totalAmount || 0), 0) + refuseFee;
  if ($('breakdownTitle')) $('breakdownTitle').innerText = groupKey.toUpperCase();

  const renderLogRows = logItems => logItems.map(item => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; font-size:0.74rem;">
      <span>${formatDateDMY(item.readingDate || item.timestamp)} (${item.type==='WATER'?parseFloat(item.previousReading||0).toFixed(3):Math.round(item.previousReading)} ➔ ${item.type==='WATER'?parseFloat(item.currentReading||0).toFixed(3):Math.round(item.currentReading)})</span>
      <div style="display:flex; align-items:center; gap:8px;">
        <strong>S$${(item.totalAmount || 0).toFixed(2)}</strong>
        <button type="button" onclick="window.deleteReadingItem('${item.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer;"><span class="material-icons-round">delete</span></button>
      </div>
    </div>`).join('');

  if ($('breakdownContent')) {
    $('breakdownContent').innerHTML = `
      <div style="background:#fff; border-radius:16px; padding:14px 16px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
        <div><span style="font-size:0.72rem; color:#64748b; font-weight:700;">Combined Grand Total</span><strong style="font-size:1.35rem; display:block;">S$${grandTotal.toFixed(2)}</strong></div>
        <span class="material-icons-round" style="color:#10b981; font-size:32px;">check_circle</span>
      </div>
      <div style="margin-bottom:14px;"><strong style="color:#ef4444;">⚡ Electricity Logs</strong><div style="background:#fff; padding:12px; border-radius:16px; margin-top:6px;">${renderLogRows(elecItems)}</div></div>
      <div style="margin-bottom:14px;"><strong style="color:#0284c7;">💧 Water Logs</strong><div style="background:#fff; padding:12px; border-radius:16px; margin-top:6px;">${renderLogRows(waterItems)}</div></div>`;
  }

  $('breakdownModal')?.classList.remove('hidden');
};

window.deleteReadingItem = async function(id) {
  if (!confirm('Delete this reading entry?')) return;
  userReadings = userReadings.filter(x => x.id !== id);
  setStorage('utility_readings_local', userReadings);
  if (currentUser) setStorage(`utility_readings_${currentUser.uid}`, userReadings);
  await syncFirebase('readings', userReadings);
  renderHistory();
  if ($('breakdownModal') && !$('breakdownModal').classList.contains('hidden')) $('breakdownModal').classList.add('hidden');
};

window.closeBreakdownModal = () => $('breakdownModal')?.classList.add('hidden');

// Delegated Click Handlers
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action'), id = btn.getAttribute('data-id');

  if (action === 'edit-provider') openModalForProvider(providersList.find(x => x.id === id));
  else if (action === 'delete-provider' && confirm('Delete this provider?')) {
    providersList = providersList.filter(x => x.id !== id);
    saveProvidersState();
  }
});

// Global Logout Handler
window.handleLogout = async function() {
  if (window.FirebaseSDK) {
    try {
      if (!auth) auth = window.FirebaseSDK.getAuth();
      if (auth) await window.FirebaseSDK.signOut(auth);
    } catch(e) { console.error('Logout error:', e); }
  }
  currentUser = null;
  $('mainHeader')?.classList.add('hidden');
  $('authLandingScreen')?.classList.remove('hidden');
  $('mainContainer')?.classList.add('hidden');

  try { userReadings = JSON.parse(getStorage('utility_readings_local') || '[]'); } catch(e) { userReadings = []; }
  try { providersList = JSON.parse(getStorage('utility_providers') || '[]'); } catch(e) {}
  
  renderHistory();
  renderProviders();
};

// Firebase Initialization
const defaultCfg = {
  apiKey: "AIzaSyD7ILTXVKJ2Cd1KYALBHhllipzXNJqmG0c",
  authDomain: "utility-reading.firebaseapp.com",
  databaseURL: "https://utility-reading-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "utility-reading",
  storageBucket: "utility-reading.firebasestorage.app",
  messagingSenderId: "361617071162",
  appId: "1:361617071162:web:9619065ad4e76407efa903"
};

function initFirebase(cfg) {
  try {
    if (!window.FirebaseSDK) return false;
    const { initializeApp, getAuth, getDatabase, onAuthStateChanged, ref, onValue } = window.FirebaseSDK;
    const app = initializeApp(cfg);
    auth = getAuth(app); db = getDatabase(app);

    onAuthStateChanged(auth, user => {
      currentUser = user;
      $('mainHeader')?.classList.toggle('hidden', !user);
      $('authLandingScreen')?.classList.toggle('hidden', !!user);
      $('mainContainer')?.classList.toggle('hidden', !user);

      if (user) {
        if ($('userAvatar')) $('userAvatar').src = user.photoURL || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="%230f172a"/><path d="M220 120 C220 120 130 240 130 310 A90 90 0 0 0 310 310 C310 240 220 120 220 120 Z" fill="%2338bdf8"/><path d="M310 110 L215 250 L270 250 L190 400 L310 230 L255 230 Z" fill="%23f59e0b"/></svg>';
        
        onValue(ref(db, `users/${user.uid}/readings`), snapshot => {
          if (snapshot.exists()) {
            const data = snapshot.val();
            userReadings = Array.isArray(data) ? data : Object.entries(data).map(([id, val]) => ({ id, ...val }));
            setStorage('utility_readings_local', userReadings);
            renderHistory();
          }
        });

        onValue(ref(db, `users/${user.uid}/providers`), snapshot => {
          if (snapshot.exists()) {
            const data = snapshot.val();
            providersList = Array.isArray(data) ? data : Object.values(data);
          } else { providersList = []; syncFirebase('providers', providersList); }
          setStorage('utility_providers', providersList);
          renderProviders(); updateRateLabels();
        });
      }
    });
    return true;
  } catch (err) { console.error('Firebase init:', err); return false; }
}

initFirebase(defaultCfg);
renderProviders();
updateRateLabels();
updateCycleLabels();
autofillLatestReadings();

$('btnMainLogin')?.addEventListener('click', async () => {
  if (!window.FirebaseSDK) return alert("Firebase SDK loading...");
  try {
    const provider = new window.FirebaseSDK.GoogleAuthProvider();
    await window.FirebaseSDK.signInWithPopup(auth, provider);
  } catch(e) { alert("Sign in note: " + (e.message || "Auth error")); }
});
