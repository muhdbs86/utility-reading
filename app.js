let db = null;
let auth = null;
let currentUser = null;
let userReadings = [];

// Prevent double-tap and gesture zoom on mobile devices (iOS Safari & Chrome)
let lastTouchEnd = 0;
document.addEventListener('touchend', (event) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) {
    // Only prevent zoom if the touch target is not a form input or textarea
    if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) {
      event.preventDefault();
    }
  }
  lastTouchEnd = now;
}, { passive: false });

document.addEventListener('gesturestart', (e) => {
  e.preventDefault();
});

// Providers List State
let providersList = JSON.parse(localStorage.getItem('utility_providers')) || [];

let elecCycleStartDay = parseInt(localStorage.getItem('utility_elec_cycle_start_day'), 10) || 28;
let waterCycleStartDay = parseInt(localStorage.getItem('utility_water_cycle_start_day'), 10) || 28;

function getActiveProvider(type) {
  const match = providersList.find(p => p.type === type && p.isDefault);
  if (match) return match;
  const fallback = providersList.find(p => p.type === type);
  if (fallback) return fallback;
  if (type === 'WATER') {
    return { name: 'No Provider Set', model: 'SG_TIERED', t1Tariff: 0, t1Wct: 0, t1Wbf: 0, t2Tariff: 0, t2Wct: 0, t2Wbf: 0, flatRate: 0, gst: 0 };
  }
  if (type === 'ELECTRICITY') {
    return { name: 'No Provider Set', tariff: 0, gst: 0 };
  }
  return { name: 'No Provider Set', fee: 0, gst: 0 };
}

// Helper: Default start of cycle date calculation
function getDefaultCycleStartDate(type = 'WATER') {
  const cycleDay = type === 'ELECTRICITY' ? elecCycleStartDay : waterCycleStartDay;
  const today = new Date();
  let year = today.getFullYear();
  let month = today.getMonth();
  if (today.getDate() < cycleDay) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  const yyyy = year;
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(cycleDay).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function updateCycleLabels() {
  const elecDayStr = `${elecCycleStartDay}${elecCycleStartDay === 1 ? 'st' : elecCycleStartDay === 2 ? 'nd' : elecCycleStartDay === 3 ? 'rd' : 'th'}`;
  const waterDayStr = `${waterCycleStartDay}${waterCycleStartDay === 1 ? 'st' : waterCycleStartDay === 2 ? 'nd' : waterCycleStartDay === 3 ? 'rd' : 'th'}`;
  
  const elecLabel = document.getElementById('elecCycleStartDayLabel');
  const waterLabel = document.getElementById('waterCycleStartDayLabel');
  if (elecLabel) elecLabel.innerText = elecDayStr;
  if (waterLabel) waterLabel.innerText = waterDayStr;
  
  const waterInput = document.getElementById('waterCycleStartInput');
  const elecInput = document.getElementById('elecCycleStartInput');
  if (waterInput && !waterInput.value) waterInput.value = getDefaultCycleStartDate('WATER');
  if (elecInput && !elecInput.value) elecInput.value = getDefaultCycleStartDate('ELECTRICITY');
}

function updateRateLabels() {
  const waterP = getActiveProvider('WATER');
  const elecP = getActiveProvider('ELECTRICITY');
  const waterLbl = document.getElementById('activeWaterProviderLabel');
  const elecLbl = document.getElementById('activeElecProviderLabel');
  const elecTariffLbl = document.getElementById('elecTariffLabel');

  if (waterLbl) waterLbl.innerText = `${waterP.name} (${(waterP.model === 'SG_TIERED' || waterP.model === 'TIERED') ? 'Tiered' : 'Flat'})`;
  if (elecLbl) elecLbl.innerText = `${elecP.name} (Flat)`;
  if (elecTariffLbl) elecTariffLbl.innerText = `$${(elecP.tariff || 0).toFixed(4)} / kWh`;
}

function renderProviderActionControls(p, idx, totalItems) {
  const isFirst = idx === 0;
  const isLast = idx === totalItems - 1;
  return `
    <div style="display:flex; gap:6px; align-items:center;">
      <button type="button" class="btn-reorder" onclick="window.moveProviderUp('${p.id}')" title="Move Up" ${isFirst ? 'disabled' : ''}>
        <span class="material-icons-round" style="font-size:20px;">arrow_upward</span>
      </button>
      <button type="button" class="btn-reorder" onclick="window.moveProviderDown('${p.id}')" title="Move Down" ${isLast ? 'disabled' : ''}>
        <span class="material-icons-round" style="font-size:20px;">arrow_downward</span>
      </button>
      <div style="width:1px; height:20px; background:#e2e8f0; margin:0 2px;"></div>
      <button type="button" onclick="window.editProvider('${p.id}')" class="btn-icon-action" title="Edit">
        <span class="material-icons-round" style="font-size:20px;">edit</span>
      </button>
      <button type="button" onclick="window.deleteProvider('${p.id}')" class="btn-icon-action text-danger" title="Delete">
        <span class="material-icons-round" style="font-size:20px;">delete</span>
      </button>
    </div>
  `;
}

function saveProvidersState() {
  localStorage.setItem('utility_providers', JSON.stringify(providersList));
  if (currentUser) {
    localStorage.setItem(`utility_providers_${currentUser.uid}`, JSON.stringify(providersList));
  }
  syncProvidersToFirebase();
  renderProviders();
  updateRateLabels();
  calculateWaterEst();
  calculateElecEst();
}

// Fixed Provider Reordering Logic (Category-isolated replacement)
window.moveProviderUp = function(id) {
  const item = providersList.find(x => x.id === id);
  if (!item) return;
  const targetType = item.type;
  const sameType = providersList.filter(p => p.type === targetType);
  const idx = sameType.findIndex(x => x.id === id);
  
  if (idx > 0) {
    const temp = sameType[idx];
    sameType[idx] = sameType[idx - 1];
    sameType[idx - 1] = temp;

    let stIdx = 0;
    providersList = providersList.map(p => {
      if (p.type === targetType) {
        return sameType[stIdx++];
      }
      return p;
    });

    saveProvidersState();
  }
};

window.moveProviderDown = function(id) {
  const item = providersList.find(x => x.id === id);
  if (!item) return;
  const targetType = item.type;
  const sameType = providersList.filter(p => p.type === targetType);
  const idx = sameType.findIndex(x => x.id === id);
  
  if (idx !== -1 && idx < sameType.length - 1) {
    const temp = sameType[idx];
    sameType[idx] = sameType[idx + 1];
    sameType[idx + 1] = temp;

    let stIdx = 0;
    providersList = providersList.map(p => {
      if (p.type === targetType) {
        return sameType[stIdx++];
      }
      return p;
    });

    saveProvidersState();
  }
};

function renderProviders() {
  const refuseList = document.getElementById('refuseProvidersList');
  const elecList = document.getElementById('elecProvidersList');
  const waterList = document.getElementById('waterProvidersList');

  if (!refuseList || !elecList || !waterList) return;

  const refuseItems = providersList.filter(p => p.type === 'REFUSE');
  const elecItems = providersList.filter(p => p.type === 'ELECTRICITY');
  const waterItems = providersList.filter(p => p.type === 'WATER');

  refuseList.innerHTML = refuseItems.length === 0 
    ? `<p style="font-size:0.75rem; color:var(--text-muted); font-style:italic; padding:4px 0;">No refuse providers added.</p>`
    : refuseItems.map((p, idx) => `
    <div class="provider-card-ui">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
        <div style="display:flex; flex-direction:column; gap:2px;">
          <strong style="font-size:0.78rem; font-weight:700; color:#0f172a; line-height:1.2;">${p.name}</strong>
          ${p.isDefault ? '<div style="margin-top:2px;"><span class="badge-default">★ Default</span></div>' : ''}
        </div>
        ${renderProviderActionControls(p, idx, refuseItems.length)}
      </div>
      <div style="background:#f8fafc; padding:8px 10px; border-radius:10px; font-size:0.76rem;">
        <div class="card-row-item"><span>Usage Fee</span><strong>S$${(p.fee || 0).toFixed(4)} / month</strong></div>
        <div class="card-row-item"><span>GST</span><strong>${(p.gst || 0).toFixed(1)}%</strong></div>
      </div>
    </div>
  `).join('');

  elecList.innerHTML = elecItems.length === 0 
    ? `<p style="font-size:0.75rem; color:var(--text-muted); font-style:italic; padding:4px 0;">No electricity providers added.</p>`
    : elecItems.map((p, idx) => `
    <div class="provider-card-ui">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
        <div style="display:flex; flex-direction:column; gap:2px;">
          <strong style="font-size:0.78rem; font-weight:700; color:#0f172a; line-height:1.2;">${p.name}</strong>
          ${p.isDefault ? '<div style="margin-top:2px;"><span class="badge-default">★ Default</span></div>' : ''}
        </div>
        ${renderProviderActionControls(p, idx, elecItems.length)}
      </div>
      <div style="background:#f8fafc; padding:8px 10px; border-radius:10px; font-size:0.76rem;">
        <div class="card-row-item"><span>Usage Fee</span><strong>S$${(p.tariff || 0).toFixed(4)} / kWh</strong></div>
        <div class="card-row-item"><span>GST</span><strong>${(p.gst || 0).toFixed(1)}%</strong></div>
      </div>
    </div>
  `).join('');

  waterList.innerHTML = waterItems.length === 0 
    ? `<p style="font-size:0.75rem; color:var(--text-muted); font-style:italic; padding:4px 0;">No water providers added.</p>`
    : waterItems.map((p, idx) => {
    if (p.model === 'FLAT') {
      return `
        <div class="provider-card-ui">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
            <div style="display:flex; flex-direction:column; gap:2px;">
              <strong style="font-size:0.78rem; font-weight:700; color:#0f172a; line-height:1.2;">${p.name}</strong>
              ${p.isDefault ? '<div style="margin-top:2px;"><span class="badge-default">★ Default</span></div>' : ''}
            </div>
            ${renderProviderActionControls(p, idx, waterItems.length)}
          </div>
          <div style="background:#f8fafc; padding:8px 10px; border-radius:10px; font-size:0.76rem;">
            <div class="card-row-item"><span>Rate Model</span><strong>Flat Rate</strong></div>
            <div class="card-row-item"><span>Usage Fee</span><strong>S$${(p.flatRate || 0).toFixed(4)} / m³</strong></div>
            <div class="card-row-item"><span>GST</span><strong>${(p.gst || 0).toFixed(1)}%</strong></div>
          </div>
        </div>
      `;
    }
    const t1Total = (p.t1Tariff || 0) + (p.t1Wct || 0) + (p.t1Wbf || 0);
    const t2Total = (p.t2Tariff || 0) + (p.t2Wct || 0) + (p.t2Wbf || 0);
    return `
      <div class="provider-card-ui">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <div style="display:flex; flex-direction:column; gap:2px;">
            <strong style="font-size:0.78rem; font-weight:700; color:#0f172a; line-height:1.2;">${p.name}</strong>
            ${p.isDefault ? '<div style="margin-top:2px;"><span class="badge-default">★ Default</span></div>' : ''}
          </div>
          ${renderProviderActionControls(p, idx, waterItems.length)}
        </div>
        <div style="background:#f8fafc; padding:8px 10px; border-radius:10px; font-size:0.76rem;">
          <div class="card-row-item"><span>Rate Model</span><strong>Standard Tiered</strong></div>
          <div style="margin-top:4px;">
            <div class="card-row-item">
              <span>• Tier 1 (Up to 40 m³)</span>
              <strong>S$${t1Total.toFixed(4)} / m³</strong>
            </div>
            <div class="card-row-item" style="padding-left:12px; color:#64748b;">
              <span>└ Waterborne Tax (WBF)</span><span>S$${(p.t1Wbf || 0).toFixed(4)} / m³</span>
            </div>
            <div class="card-row-item" style="padding-left:12px; color:#64748b;">
              <span>└ Water Conservation Tax (WCT)</span><span>S$${(p.t1Wct || 0).toFixed(4)} / m³</span>
            </div>
          </div>
          <div style="margin-top:4px;">
            <div class="card-row-item">
              <span>• Tier 2 (Above 40 m³)</span>
              <strong>S$${t2Total.toFixed(4)} / m³</strong>
            </div>
            <div class="card-row-item" style="padding-left:12px; color:#64748b;">
              <span>└ Waterborne Tax (WBF)</span><span>S$${(p.t2Wbf || 0).toFixed(4)} / m³</span>
            </div>
            <div class="card-row-item" style="padding-left:12px; color:#64748b;">
              <span>└ Water Conservation Tax (WCT)</span><span>S$${(p.t2Wct || 0).toFixed(4)} / m³</span>
            </div>
          </div>
          <div class="card-row-item" style="margin-top:4px;"><span>GST</span><strong>${(p.gst || 0).toFixed(1)}%</strong></div>
        </div>
      </div>
    `;
  }).join('');
}

// Modal state
let editingProviderId = null;
let selectedModalType = 'ELECTRICITY';
let selectedModalWaterModel = 'FLAT';

function updateModalTypeUI() {
  const chipElec = document.getElementById('chipElec');
  const chipWater = document.getElementById('chipWater');
  const chipRefuse = document.getElementById('chipRefuse');

  if (chipElec) chipElec.className = 'type-chip' + (selectedModalType === 'ELECTRICITY' ? ' active-elec' : '');
  if (chipWater) chipWater.className = 'type-chip' + (selectedModalType === 'WATER' ? ' active-water' : '');
  if (chipRefuse) chipRefuse.className = 'type-chip' + (selectedModalType === 'REFUSE' ? ' active-refuse' : '');

  const fElec = document.getElementById('formElecGroup');
  const fWater = document.getElementById('formWaterGroup');
  const fRefuse = document.getElementById('formRefuseGroup');
  if (fElec) fElec.classList.toggle('hidden', selectedModalType !== 'ELECTRICITY');
  if (fWater) fWater.classList.toggle('hidden', selectedModalType !== 'WATER');
  if (fRefuse) fRefuse.classList.toggle('hidden', selectedModalType !== 'REFUSE');
}

function updateModalWaterModelUI() {
  const btnFlat = document.getElementById('btnWaterModelFlat');
  const btnTiered = document.getElementById('btnWaterModelTiered');
  if (btnFlat) btnFlat.className = 'model-btn' + (selectedModalWaterModel === 'FLAT' ? ' active' : '');
  if (btnTiered) btnTiered.className = 'model-btn' + (selectedModalWaterModel === 'TIERED' ? ' active' : '');

  const mWaterFlat = document.getElementById('modalWaterFlatFields');
  const mWaterTiered = document.getElementById('modalWaterTieredFields');
  if (mWaterFlat) mWaterFlat.classList.toggle('hidden', selectedModalWaterModel !== 'FLAT');
  if (mWaterTiered) mWaterTiered.classList.toggle('hidden', selectedModalWaterModel !== 'TIERED');
}

function updateTierCalculatedTotals() {
  const t1T = parseFloat(document.getElementById('modalWaterT1Tariff').value) || 0;
  const t1Wct = parseFloat(document.getElementById('modalWaterT1Wct').value) || 0;
  const t1Wbf = parseFloat(document.getElementById('modalWaterT1Wbf').value) || 0;
  const t1Total = t1T + t1Wct + t1Wbf;

  const t2T = parseFloat(document.getElementById('modalWaterT2Tariff').value) || 0;
  const t2Wct = parseFloat(document.getElementById('modalWaterT2Wct').value) || 0;
  const t2Wbf = parseFloat(document.getElementById('modalWaterT2Wbf').value) || 0;
  const t2Total = t2T + t2Wct + t2Wbf;

  const t1Lbl = document.getElementById('modalT1CalculatedLabel');
  const t2Lbl = document.getElementById('modalT2CalculatedLabel');
  if (t1Lbl) t1Lbl.innerText = `S$${t1Total.toFixed(4)} / m³`;
  if (t2Lbl) t2Lbl.innerText = `S$${t2Total.toFixed(4)} / m³`;
}

function openModalForProvider(p = null) {
  editingProviderId = p ? p.id : null;
  const modalTitle = document.getElementById('modalTitle');
  if (modalTitle) modalTitle.innerText = p ? 'Edit Provider' : 'Configure New Provider';
  const modalName = document.getElementById('modalProviderName');
  if (modalName) modalName.value = p ? p.name : '';
  const modalDefault = document.getElementById('modalIsDefault');
  if (modalDefault) modalDefault.checked = p ? !!p.isDefault : true;

  selectedModalType = p ? p.type : 'ELECTRICITY';
  updateModalTypeUI();

  if (selectedModalType === 'ELECTRICITY') {
    const eRate = document.getElementById('modalElecRate');
    const eGst = document.getElementById('modalElecGst');
    if (eRate) eRate.value = p ? p.tariff : 0.2324;
    if (eGst) eGst.value = p ? p.gst : 9.0;
  } else if (selectedModalType === 'WATER') {
    selectedModalWaterModel = (p && (p.model === 'SG_TIERED' || p.model === 'TIERED')) ? 'TIERED' : 'FLAT';
    updateModalWaterModelUI();
    if (selectedModalWaterModel === 'FLAT') {
      const wRate = document.getElementById('modalWaterFlatRate');
      const wGst = document.getElementById('modalWaterFlatGst');
      if (wRate) wRate.value = p ? (p.flatRate || 1.20) : 1.20;
      if (wGst) wGst.value = p ? (p.gst || 9.0) : 9.0;
    } else {
      const t1T = document.getElementById('modalWaterT1Tariff');
      const t1Wct = document.getElementById('modalWaterT1Wct');
      const t1Wbf = document.getElementById('modalWaterT1Wbf');
      const t2T = document.getElementById('modalWaterT2Tariff');
      const t2Wct = document.getElementById('modalWaterT2Wct');
      const t2Wbf = document.getElementById('modalWaterT2Wbf');
      const wTierGst = document.getElementById('modalWaterTieredGst');

      if (t1T) t1T.value = p ? (p.t1Tariff || 1.210) : 1.210;
      if (t1Wct) t1Wct.value = p ? (p.t1Wct || 0.720) : 0.720;
      if (t1Wbf) t1Wbf.value = p ? (p.t1Wbf || 1.090) : 1.090;
      if (t2T) t2T.value = p ? (p.t2Tariff || 1.810) : 1.810;
      if (t2Wct) t2Wct.value = p ? (p.t2Wct || 1.180) : 1.180;
      if (t2Wbf) t2Wbf.value = p ? (p.t2Wbf || 1.400) : 1.400;
      if (wTierGst) wTierGst.value = p ? (p.gst || 9.0) : 9.0;
      updateTierCalculatedTotals();
    }
  } else if (selectedModalType === 'REFUSE') {
    const rFee = document.getElementById('modalRefuseFee');
    const rGst = document.getElementById('modalRefuseGst');
    if (rFee) rFee.value = p ? p.fee : 9.76;
    if (rGst) rGst.value = p ? p.gst : 9.0;
  }

  const pModal = document.getElementById('providerModal');
  if (pModal) pModal.classList.remove('hidden');
}

window.editProvider = function(id) {
  const p = providersList.find(x => x.id === id);
  if (p) openModalForProvider(p);
};

window.deleteProvider = function(id) {
  if (confirm('Are you sure you want to delete this provider?')) {
    providersList = providersList.filter(x => x.id !== id);
    saveProvidersState();
  }
};

// Auto-format meter reading with amount-style backwards decimal entry
function formatMeterInput(val, decimals = 4) {
  if (!val) return '';
  const rawDigits = val.replace(/\D/g, '');
  if (!rawDigits) return '';
  
  const num = parseInt(rawDigits, 10);
  const factor = Math.pow(10, decimals);
  const intPart = Math.floor(num / factor).toString();
  const decPart = (num % factor).toString().padStart(decimals, '0');
  return `${intPart}.${decPart}`;
}

// Attach Water & Electricity input listeners
const waterCurrEl = document.getElementById('waterCurrInput');
const waterPrevEl = document.getElementById('waterPrevInput');
const elecCurrEl = document.getElementById('elecCurrInput');
const elecPrevEl = document.getElementById('elecPrevInput');

[
  { el: waterCurrEl, calc: calculateWaterEst },
  { el: waterPrevEl, calc: calculateWaterEst }
].forEach(({ el, calc }) => {
  if (!el) return;
  el.addEventListener('input', (e) => {
    const formatted = formatMeterInput(e.target.value, 4);
    el.value = formatted;
    if (el.setSelectionRange) {
      el.setSelectionRange(formatted.length, formatted.length);
    }
    calc();
  });
});

[
  { el: elecCurrEl, calc: calculateElecEst },
  { el: elecPrevEl, calc: calculateElecEst }
].forEach(({ el, calc }) => {
  if (!el) return;
  el.addEventListener('input', (e) => {
    let val = e.target.value.replace(/[^0-9.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) {
      val = parts[0] + '.' + parts.slice(1).join('');
    }
    el.value = val;
    calc();
  });
});

// Water Estimate Calculator
function calculateWaterEst() {
  const prev = parseFloat(waterPrevEl ? waterPrevEl.value : 0) || 0;
  const curr = parseFloat(waterCurrEl ? waterCurrEl.value : 0) || 0;
  const usage = Math.max(0, curr - prev);
  
  const usageLbl = document.getElementById('waterUsageEst');
  if (usageLbl) usageLbl.innerText = `${usage.toFixed(1)} m³`;

  const cfg = getActiveProvider('WATER');
  let total = 0;
  let tax = 0;

  if (cfg.model === 'SG_TIERED' || cfg.model === 'TIERED') {
    const t1 = Math.min(usage, 40);
    const t2 = Math.max(0, usage - 40);
    const baseT1 = (cfg.t1Tariff || 1.21) + (cfg.t1Wct || 0.72) + (cfg.t1Wbf || 1.09);
    const baseT2 = (cfg.t2Tariff || 1.81) + (cfg.t2Wct || 1.18) + (cfg.t2Wbf || 1.40);
    const totalBase = (t1 * baseT1) + (t2 * baseT2);
    total = totalBase * (1 + ((cfg.gst || 9.0) / 100));
    tax = total - (t1 * (cfg.t1Tariff || 1.21) + t2 * (cfg.t2Tariff || 1.81));
  } else {
    const base = usage * (cfg.flatRate || cfg.flat || 1.20);
    total = base * (1 + ((cfg.gst || 9.0) / 100));
    tax = total - base;
  }

  const taxLbl = document.getElementById('waterTaxEst');
  const totalLbl = document.getElementById('waterTotalEst');
  if (taxLbl) taxLbl.innerText = `$${tax.toFixed(2)}`;
  if (totalLbl) totalLbl.innerText = `$${total.toFixed(2)}`;
  return { usage, total };
}

function calculateElecEst() {
  const prev = parseFloat(elecPrevEl ? elecPrevEl.value : 0) || 0;
  const curr = parseFloat(elecCurrEl ? elecCurrEl.value : 0) || 0;
  const usage = Math.max(0, curr - prev);
  const cfg = getActiveProvider('ELECTRICITY');

  const baseCost = usage * (cfg.tariff || 0.2324);
  const total = baseCost * (1 + ((cfg.gst || 9.0) / 100));

  const usageLbl = document.getElementById('elecUsageEst');
  const totalLbl = document.getElementById('elecTotalEst');
  if (usageLbl) usageLbl.innerText = `${usage.toFixed(1)} kWh`;
  if (totalLbl) totalLbl.innerText = `$${total.toFixed(2)}`;
  return { usage, total };
}

// Modal Listeners
const btnOpenAdd = document.getElementById('btnOpenAddProvider');
if (btnOpenAdd) btnOpenAdd.addEventListener('click', () => openModalForProvider(null));

const modalCancel = document.getElementById('modalBtnCancel');
if (modalCancel) modalCancel.addEventListener('click', () => {
  const pModal = document.getElementById('providerModal');
  if (pModal) pModal.classList.add('hidden');
});

const chipE = document.getElementById('chipElec');
if (chipE) chipE.addEventListener('click', () => { selectedModalType = 'ELECTRICITY'; updateModalTypeUI(); });
const chipW = document.getElementById('chipWater');
if (chipW) chipW.addEventListener('click', () => { selectedModalType = 'WATER'; updateModalTypeUI(); });
const chipR = document.getElementById('chipRefuse');
if (chipR) chipR.addEventListener('click', () => { selectedModalType = 'REFUSE'; updateModalTypeUI(); });

const btnWFlat = document.getElementById('btnWaterModelFlat');
if (btnWFlat) btnWFlat.addEventListener('click', () => { selectedModalWaterModel = 'FLAT'; updateModalWaterModelUI(); });
const btnWTiered = document.getElementById('btnWaterModelTiered');
if (btnWTiered) btnWTiered.addEventListener('click', () => {
  selectedModalWaterModel = 'TIERED';
  updateModalWaterModelUI();
  updateTierCalculatedTotals();
});

['modalWaterT1Tariff', 'modalWaterT1Wct', 'modalWaterT1Wbf', 'modalWaterT2Tariff', 'modalWaterT2Wct', 'modalWaterT2Wbf'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateTierCalculatedTotals);
});

const modalSave = document.getElementById('modalBtnSave');
if (modalSave) modalSave.addEventListener('click', () => {
  const nameEl = document.getElementById('modalProviderName');
  const name = (nameEl ? nameEl.value.trim() : '') || 'Provider Name';
  const defEl = document.getElementById('modalIsDefault');
  const isDefault = defEl ? defEl.checked : true;

  let providerObj = {
    id: editingProviderId || 'p_' + Date.now(),
    type: selectedModalType,
    name: name,
    isDefault: isDefault
  };

  if (selectedModalType === 'ELECTRICITY') {
    const eRate = document.getElementById('modalElecRate');
    const eGst = document.getElementById('modalElecGst');
    providerObj.tariff = parseFloat(eRate ? eRate.value : 0.2324) || 0.2324;
    providerObj.gst = parseFloat(eGst ? eGst.value : 9.0) || 9.0;
  } else if (selectedModalType === 'WATER') {
    providerObj.model = selectedModalWaterModel;
    if (selectedModalWaterModel === 'FLAT') {
      const wRate = document.getElementById('modalWaterFlatRate');
      const wGst = document.getElementById('modalWaterFlatGst');
      providerObj.flatRate = parseFloat(wRate ? wRate.value : 1.20) || 1.20;
      providerObj.gst = parseFloat(wGst ? wGst.value : 9.0) || 9.0;
    } else {
      const t1T = document.getElementById('modalWaterT1Tariff');
      const t1Wct = document.getElementById('modalWaterT1Wct');
      const t1Wbf = document.getElementById('modalWaterT1Wbf');
      const t2T = document.getElementById('modalWaterT2Tariff');
      const t2Wct = document.getElementById('modalWaterT2Wct');
      const t2Wbf = document.getElementById('modalWaterT2Wbf');
      const wTierGst = document.getElementById('modalWaterTieredGst');

      providerObj.t1Tariff = parseFloat(t1T ? t1T.value : 1.210) || 1.210;
      providerObj.t1Wct = parseFloat(t1Wct ? t1Wct.value : 0.720) || 0.720;
      providerObj.t1Wbf = parseFloat(t1Wbf ? t1Wbf.value : 1.090) || 1.090;
      providerObj.t2Tariff = parseFloat(t2T ? t2T.value : 1.810) || 1.810;
      providerObj.t2Wct = parseFloat(t2Wct ? t2Wct.value : 1.180) || 1.180;
      providerObj.t2Wbf = parseFloat(t2Wbf ? t2Wbf.value : 1.400) || 1.400;
      providerObj.gst = parseFloat(wTierGst ? wTierGst.value : 9.0) || 9.0;
    }
  } else if (selectedModalType === 'REFUSE') {
    const rFee = document.getElementById('modalRefuseFee');
    const rGst = document.getElementById('modalRefuseGst');
    providerObj.fee = parseFloat(rFee ? rFee.value : 9.76) || 9.76;
    providerObj.gst = parseFloat(rGst ? rGst.value : 9.0) || 9.0;
  }

  if (isDefault) {
    providersList.forEach(p => {
      if (p.type === selectedModalType) p.isDefault = false;
    });
  }

  if (editingProviderId) {
    const idx = providersList.findIndex(p => p.id === editingProviderId);
    if (idx !== -1) providersList[idx] = providerObj;
  } else {
    providersList.push(providerObj);
  }

  const pModal = document.getElementById('providerModal');
  if (pModal) pModal.classList.add('hidden');
  saveProvidersState();
});

// Cycle Day Steppers
const btnElecMinus = document.getElementById('btnElecCycleMinus');
if (btnElecMinus) btnElecMinus.addEventListener('click', () => {
  elecCycleStartDay = elecCycleStartDay <= 1 ? 31 : elecCycleStartDay - 1;
  localStorage.setItem('utility_elec_cycle_start_day', elecCycleStartDay.toString());
  updateCycleLabels();
  syncCycleToFirebase();
});

const btnElecPlus = document.getElementById('btnElecCyclePlus');
if (btnElecPlus) btnElecPlus.addEventListener('click', () => {
  elecCycleStartDay = elecCycleStartDay >= 31 ? 1 : elecCycleStartDay + 1;
  localStorage.setItem('utility_elec_cycle_start_day', elecCycleStartDay.toString());
  updateCycleLabels();
  syncCycleToFirebase();
});

const btnWaterMinus = document.getElementById('btnWaterCycleMinus');
if (btnWaterMinus) btnWaterMinus.addEventListener('click', () => {
  waterCycleStartDay = waterCycleStartDay <= 1 ? 31 : waterCycleStartDay - 1;
  localStorage.setItem('utility_water_cycle_start_day', waterCycleStartDay.toString());
  updateCycleLabels();
  syncCycleToFirebase();
});

const btnWaterPlus = document.getElementById('btnWaterCyclePlus');
if (btnWaterPlus) btnWaterPlus.addEventListener('click', () => {
  waterCycleStartDay = waterCycleStartDay >= 31 ? 1 : waterCycleStartDay + 1;
  localStorage.setItem('utility_water_cycle_start_day', waterCycleStartDay.toString());
  updateCycleLabels();
  syncCycleToFirebase();
});

// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const type = btn.getAttribute('data-type');
    document.querySelectorAll('.tab-section').forEach(sec => sec.classList.add('hidden'));
    if (type === 'WATER') document.getElementById('sectionWater').classList.remove('hidden');
    if (type === 'ELECTRICITY') document.getElementById('sectionElectricity').classList.remove('hidden');
    if (type === 'RATES') document.getElementById('sectionRates').classList.remove('hidden');
    if (type === 'HISTORY') {
      document.getElementById('sectionHistory').classList.remove('hidden');
      renderHistory();
    }
  });
});

// Sync helpers
async function syncReadingsToFirebase() {
  if (db && currentUser) {
    try {
      const { ref, set } = window.FirebaseSDK;
      await set(ref(db, `users/${currentUser.uid}/readings`), userReadings);
    } catch(e) { console.error('Failed auto-syncing readings:', e); }
  }
}

async function syncProvidersToFirebase() {
  if (db && currentUser) {
    try {
      const { ref, set } = window.FirebaseSDK;
      await set(ref(db, `users/${currentUser.uid}/providers`), providersList);
    } catch(e) { console.error('Failed auto-syncing providers:', e); }
  }
}

async function syncCycleToFirebase() {
  if (db && currentUser) {
    try {
      const { ref, set } = window.FirebaseSDK;
      await set(ref(db, `users/${currentUser.uid}/cycles`), {
        elecCycleStartDay,
        waterCycleStartDay
      });
    } catch(e) { console.error('Failed auto-syncing cycle:', e); }
  }
}

// Save Reading & Sync
const btnSaveW = document.getElementById('btnSaveWater');
if (btnSaveW) btnSaveW.addEventListener('click', async () => {
  const est = calculateWaterEst();
  const prev = parseFloat(waterPrevEl ? waterPrevEl.value : 0) || 0;
  const curr = parseFloat(waterCurrEl ? waterCurrEl.value : 0) || 0;
  if (curr <= 0) { alert('Please enter a valid current reading.'); return; }

  const waterCycleInp = document.getElementById('waterCycleStartInput');
  const cycleDate = (waterCycleInp ? waterCycleInp.value : '') || getDefaultCycleStartDate('WATER');
  const activeWaterP = getActiveProvider('WATER');

  const item = {
    id: 'rd_' + Date.now(),
    type: 'WATER',
    providerName: activeWaterP.name,
    previousReading: prev,
    currentReading: curr,
    reading: curr,
    usage: est.usage,
    totalAmount: est.total,
    readingDate: Date.now(),
    timestamp: Date.now(),
    date: new Date().toISOString(),
    cycleStartDate: cycleDate
  };

  await saveAndSyncReading(item);
  if (waterPrevEl) waterPrevEl.value = curr.toFixed(4);
  if (waterCurrEl) waterCurrEl.value = '';
  alert('Water reading saved and synced!');
});

const btnSaveE = document.getElementById('btnSaveElectricity');
if (btnSaveE) btnSaveE.addEventListener('click', async () => {
  const est = calculateElecEst();
  const prev = parseFloat(elecPrevEl ? elecPrevEl.value : 0) || 0;
  const curr = parseFloat(elecCurrEl ? elecCurrEl.value : 0) || 0;
  if (curr <= 0) { alert('Please enter a valid current reading.'); return; }

  const elecCycleInp = document.getElementById('elecCycleStartInput');
  const cycleDate = (elecCycleInp ? elecCycleInp.value : '') || getDefaultCycleStartDate('ELECTRICITY');
  const activeElecP = getActiveProvider('ELECTRICITY');

  const item = {
    id: 'rd_' + Date.now(),
    type: 'ELECTRICITY',
    providerName: activeElecP.name,
    previousReading: prev,
    currentReading: curr,
    reading: curr,
    usage: est.usage,
    totalAmount: est.total,
    readingDate: Date.now(),
    timestamp: Date.now(),
    date: new Date().toISOString(),
    cycleStartDate: cycleDate
  };

  await saveAndSyncReading(item);
  if (elecPrevEl) elecPrevEl.value = curr.toString();
  if (elecCurrEl) elecCurrEl.value = '';
  alert('Electricity reading saved and synced!');
});

async function saveAndSyncReading(item) {
  userReadings.push(item);
  localStorage.setItem('utility_readings_local', JSON.stringify(userReadings));
  if (currentUser) {
    localStorage.setItem(`utility_readings_${currentUser.uid}`, JSON.stringify(userReadings));
  }

  await syncReadingsToFirebase();
}

function renderHistory() {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;
  if (userReadings.length === 0) {
    historyList.innerHTML = `<p style="text-align:center; color:var(--text-muted); padding:16px; font-size:0.78rem;">No saved readings found.</p>`;
    return;
  }

  const sortedReadings = [...userReadings].sort((a, b) => (b.readingDate || b.timestamp || 0) - (a.readingDate || a.timestamp || 0));

  historyList.innerHTML = sortedReadings.map((item) => {
    const originalIndex = userReadings.indexOf(item);
    const readingVal = item.currentReading || item.reading || 0;
    const prevVal = item.previousReading || 0;
    const dateStr = new Date(item.readingDate || item.timestamp || Date.now()).toLocaleDateString('en-SG', { year: 'numeric', month: 'short', day: 'numeric' });
    const cycleStr = item.cycleStartDate ? ` (Cycle: ${item.cycleStartDate})` : '';
    
    return `
      <div class="history-item" style="padding:12px; margin-bottom:8px; background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; display:flex; justify-content:space-between; align-items:center;">
        <div class="history-info">
          <div style="font-weight:700; font-size:0.82rem; color:var(--text-main); display:flex; align-items:center; gap:6px;">
            ${item.type === 'WATER' ? '<span style="color:#38bdf8;">💧 Water</span>' : '<span style="color:#f59e0b;">⚡ Electricity</span>'} 
            <span style="font-weight:600; color:#e2e8f0;">- ${(item.usage || 0).toFixed(1)} ${item.type === 'WATER' ? 'm³' : 'kWh'}</span>
          </div>
          <div style="color:var(--text-muted); font-size:0.72rem; margin-top:2px;">
            ${dateStr}${cycleStr} • ${prevVal} ➔ ${readingVal}
          </div>
          <div style="color:#64748b; font-size:0.7rem; margin-top:1px;">
            Provider: ${item.providerName || 'Default'}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-weight:800; font-size:0.88rem; color:#10b981;">S$${(item.totalAmount || item.calculatedBill || 0).toFixed(2)}</span>
          <button class="btn-delete" onclick="window.deleteItem(${originalIndex})" title="Delete Reading">
            <span class="material-icons-round" style="font-size:18px;">delete</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

window.deleteItem = async (index) => {
  if (!confirm('Delete this reading?')) return;
  userReadings.splice(index, 1);
  localStorage.setItem('utility_readings_local', JSON.stringify(userReadings));
  if (currentUser) {
    localStorage.setItem(`utility_readings_${currentUser.uid}`, JSON.stringify(userReadings));
  }
  syncReadingsToFirebase();
  renderHistory();
};

// Default Firebase Config
const defaultFirebaseConfig = {
  apiKey: "AIzaSyD7ILTXVKJ2Cd1KYALBHhllipzXNJqmG0c",
  authDomain: "utility-reading.firebaseapp.com",
  databaseURL: "https://utility-reading-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "utility-reading",
  storageBucket: "utility-reading.firebasestorage.app",
  messagingSenderId: "361617071162",
  appId: "1:361617071162:web:9619065ad4e76407efa903"
};

// Firebase Init & Auth
let activeConfig = defaultFirebaseConfig;
try {
  const savedConfig = localStorage.getItem('firebase_web_config');
  if (savedConfig) {
    const parsed = JSON.parse(savedConfig);
    if (parsed && parsed.apiKey) {
      activeConfig = parsed;
    }
  }
} catch (e) {
  localStorage.removeItem('firebase_web_config');
}

const configTextarea = document.getElementById('firebaseConfigText');
if (configTextarea) {
  configTextarea.value = JSON.stringify(activeConfig, null, 2);
}

let readingsUnsub = null;
let providersUnsub = null;
let cycleUnsub = null;

initFirebase(activeConfig);

const savedSyncUrl = localStorage.getItem('utility_sync_url') || defaultFirebaseConfig.databaseURL;
const syncUrlEl = document.getElementById('syncDbUrl');
if (syncUrlEl) {
  syncUrlEl.value = savedSyncUrl;
}

const localSaved = localStorage.getItem('utility_readings_local');
if (localSaved) {
  try { userReadings = JSON.parse(localSaved); } catch(e) {}
}

renderProviders();
updateRateLabels();
updateCycleLabels();

function initFirebase(cfg) {
  try {
    if (!window.FirebaseSDK) return false;
    const { initializeApp, getAuth, getDatabase, onAuthStateChanged, getRedirectResult, ref, onValue } = window.FirebaseSDK;
    const app = initializeApp(cfg);
    auth = getAuth(app);
    db = getDatabase(app);

    if (getRedirectResult) {
      getRedirectResult(auth).catch(err => console.warn('Redirect auth result:', err));
    }

    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      const mainHeader = document.getElementById('mainHeader');
      const authLanding = document.getElementById('authLandingScreen');
      const mainContainer = document.getElementById('mainContainer');

      if (user) {
        if (mainHeader) mainHeader.classList.remove('hidden');
        if (authLanding) authLanding.classList.add('hidden');
        if (mainContainer) mainContainer.classList.remove('hidden');

        const userAvatar = document.getElementById('userAvatar');
        if (userAvatar) userAvatar.src = user.photoURL || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="100" fill="%230f172a"/><path d="M220 120 C220 120 130 240 130 310 A90 90 0 0 0 310 310 C310 240 220 120 220 120 Z" fill="%2338bdf8"/><path d="M310 110 L215 250 L270 250 L190 400 L310 230 L255 230 Z" fill="%23f59e0b"/></svg>';
        
        const syncStatusBanner = document.getElementById('syncStatusBanner');
        if (syncStatusBanner) {
          syncStatusBanner.innerHTML = `<span style="color:#10b981; font-weight:700; display:flex; align-items:center; gap:6px;"><span class="material-icons-round" style="font-size:16px;">cloud_done</span> Real-Time Auto Sync Active (${user.email || user.displayName || 'Google Account'})</span>`;
        }

        // Real-time listener for User Readings (isolated per user UID)
        const userReadingsRef = ref(db, `users/${user.uid}/readings`);
        if (readingsUnsub) readingsUnsub();
        readingsUnsub = onValue(userReadingsRef, (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.val();
            if (Array.isArray(data)) {
              userReadings = data;
            } else {
              userReadings = Object.entries(data).map(([id, val]) => ({ id, ...val }));
            }
            localStorage.setItem(`utility_readings_${user.uid}`, JSON.stringify(userReadings));
            localStorage.setItem('utility_readings_local', JSON.stringify(userReadings));
            renderHistory();
          }
        });

        // Real-time listener for User Providers & Rates (isolated per user UID)
        const userProvidersRef = ref(db, `users/${user.uid}/providers`);
        if (providersUnsub) providersUnsub();
        providersUnsub = onValue(userProvidersRef, (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.val();
            providersList = Array.isArray(data) ? data : Object.values(data);
          } else {
            providersList = [];
            syncProvidersToFirebase();
          }
          localStorage.setItem(`utility_providers_${user.uid}`, JSON.stringify(providersList));
          localStorage.setItem('utility_providers', JSON.stringify(providersList));
          renderProviders();
          updateRateLabels();
          calculateWaterEst();
          calculateElecEst();
        });

        // Real-time listener for User Cycle Start Days (isolated per user UID)
        const userCycleRef = ref(db, `users/${user.uid}/cycles`);
        if (cycleUnsub) cycleUnsub();
        cycleUnsub = onValue(userCycleRef, (snapshot) => {
          if (snapshot.exists()) {
            const cyclesData = snapshot.val();
            if (cyclesData) {
              if (cyclesData.elecCycleStartDay) elecCycleStartDay = cyclesData.elecCycleStartDay;
              if (cyclesData.waterCycleStartDay) waterCycleStartDay = cyclesData.waterCycleStartDay;
              localStorage.setItem('utility_elec_cycle_start_day', elecCycleStartDay.toString());
              localStorage.setItem('utility_water_cycle_start_day', waterCycleStartDay.toString());
              updateCycleLabels();
            }
          } else {
            syncCycleToFirebase();
          }
        });

      } else {
        if (mainHeader) mainHeader.classList.add('hidden');
        if (authLanding) authLanding.classList.remove('hidden');
        if (mainContainer) mainContainer.classList.add('hidden');

        // Reset view to local data
        const localSaved = localStorage.getItem('utility_readings_local');
        try { userReadings = localSaved ? JSON.parse(localSaved) : []; } catch(e) {}
        renderHistory();

        const localProv = localStorage.getItem('utility_providers');
        try { if (localProv) providersList = JSON.parse(localProv); } catch(e) {}
        renderProviders();
        updateRateLabels();
      }
    });
    return true;
  } catch (err) {
    console.error('Firebase init error:', err);
    return false;
  }
}

const performGoogleLogin = async () => {
  if (!window.FirebaseSDK) {
    alert("Firebase SDK loading, please try again in a moment.");
    return;
  }
  if (!auth) {
    const success = initFirebase(activeConfig);
    if (!success || !auth) {
      if (configTextarea) configTextarea.value = JSON.stringify(activeConfig, null, 2);
      const cfgModal = document.getElementById('configModal');
      if (cfgModal) cfgModal.classList.remove('hidden');
      return;
    }
  }
  try {
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = window.FirebaseSDK;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (popupErr) {
      console.warn("Popup blocked or failed, attempting redirect login:", popupErr);
      if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/popup-closed-by-user' || popupErr.code === 'auth/cancelled-popup-request' || popupErr.message?.includes('popup')) {
        await signInWithRedirect(auth, provider);
      } else {
        throw popupErr;
      }
    }
  } catch (e) {
    console.error("Login attempt failed:", e);
    if (e.message && e.message.includes('auth/invalid-api-key')) {
      if (configTextarea) configTextarea.value = JSON.stringify(activeConfig, null, 2);
      const cfgModal = document.getElementById('configModal');
      if (cfgModal) cfgModal.classList.remove('hidden');
    } else {
      alert('Sign in note: ' + (e.message || 'Authentication error. Please try again.'));
    }
  }
};

const btnMainLogin = document.getElementById('btnMainLogin');
if (btnMainLogin) {
  btnMainLogin.addEventListener('click', performGoogleLogin);
}

const btnLogout = document.getElementById('btnLogout');
if (btnLogout) {
  btnLogout.addEventListener('click', async () => {
    if (auth) {
      try {
        const { signOut } = window.FirebaseSDK;
        await signOut(auth);
      } catch(e) {}
    }
    const mainHeader = document.getElementById('mainHeader');
    const authLanding = document.getElementById('authLandingScreen');
    const mainContainer = document.getElementById('mainContainer');
    if (mainHeader) mainHeader.classList.add('hidden');
    if (authLanding) authLanding.classList.remove('hidden');
    if (mainContainer) mainContainer.classList.add('hidden');
  });
}

const btnCloseCfg = document.getElementById('btnCloseConfigModal');
if (btnCloseCfg) {
  btnCloseCfg.addEventListener('click', () => {
    const cfgModal = document.getElementById('configModal');
    if (cfgModal) cfgModal.classList.add('hidden');
  });
}

const btnSaveCfg = document.getElementById('btnSaveFirebaseConfig');
if (btnSaveCfg) {
  btnSaveCfg.addEventListener('click', () => {
    const text = document.getElementById('firebaseConfigText').value.trim();
    try {
      const config = JSON.parse(text);
      if (!config.apiKey || !config.projectId) {
        alert('Invalid Firebase configuration format. Must contain at least apiKey and projectId.');
        return;
      }
      localStorage.setItem('firebase_web_config', JSON.stringify(config));
      activeConfig = config;
      const cfgModal = document.getElementById('configModal');
      if (cfgModal) cfgModal.classList.add('hidden');
      initFirebase(config);
      alert('Firebase web configuration saved successfully!');
    } catch (e) {
      alert('Invalid JSON configuration syntax.');
    }
  });
}
