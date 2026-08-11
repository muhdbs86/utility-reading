let db = null;
let auth = null;
let currentUser = null;
let userReadings = [];

// Prevent multi-touch gesture zoom while preserving full button responsiveness
document.addEventListener('gesturestart', (e) => {
  e.preventDefault();
});

// Providers List State
let providersList = JSON.parse(localStorage.getItem('utility_providers')) || [];

let elecCycleStartDay = parseInt(localStorage.getItem('utility_elec_cycle_start_day'), 10) || 28;
let waterCycleStartDay = parseInt(localStorage.getItem('utility_water_cycle_start_day'), 10) || 28;

// Explicit Order Normalization (Top item in each category automatically becomes default)
function normalizeProviderOrders() {
  const categoryOrder = { 'REFUSE': 0, 'ELECTRICITY': 1, 'WATER': 2 };

  // Physically sort providersList in memory by category and item order
  providersList.sort((a, b) => {
    const catA = categoryOrder[a.type] !== undefined ? categoryOrder[a.type] : 99;
    const catB = categoryOrder[b.type] !== undefined ? categoryOrder[b.type] : 99;
    if (catA !== catB) return catA - catB;
    return (a.order !== undefined ? a.order : 999) - (b.order !== undefined ? b.order : 999);
  });

  ['REFUSE', 'ELECTRICITY', 'WATER'].forEach(type => {
    const items = providersList.filter(p => p.type === type);
    items.forEach((p, idx) => {
      p.order = idx;
      p.isDefault = (idx === 0);
    });
  });
}

window.moveProviderUp = function(id) {
  normalizeProviderOrders();
  const item = providersList.find(x => x.id === id);
  if (!item) return;
  
  const targetType = item.type;
  const sameType = providersList.filter(p => p.type === targetType).sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = sameType.findIndex(x => x.id === id);
  
  if (idx > 0) {
    const prevItem = sameType[idx - 1];
    const tempOrder = item.order;
    item.order = prevItem.order;
    prevItem.order = tempOrder;

    normalizeProviderOrders();
    saveProvidersState();
  }
};

window.moveProviderDown = function(id) {
  normalizeProviderOrders();
  const item = providersList.find(x => x.id === id);
  if (!item) return;
  
  const targetType = item.type;
  const sameType = providersList.filter(p => p.type === targetType).sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = sameType.findIndex(x => x.id === id);
  
  if (idx !== -1 && idx < sameType.length - 1) {
    const nextItem = sameType[idx + 1];
    const tempOrder = item.order;
    item.order = nextItem.order;
    nextItem.order = tempOrder;

    normalizeProviderOrders();
    saveProvidersState();
  }
};

function getActiveProvider(type) {
  const match = providersList.find(p => p.type === type && p.isDefault);
  if (match) return match;
  const fallback = providersList.find(p => p.type === type);
  if (fallback) return fallback;
  if (type === 'WATER') {
    return { name: 'PUB Water', model: 'SG_TIERED', t1Tariff: 1.21, t1Wct: 0.72, t1Wbf: 1.09, t2Tariff: 1.81, t2Wct: 1.18, t2Wbf: 1.40, flatRate: 1.20, gst: 9.0 };
  }
  if (type === 'ELECTRICITY') {
    return { name: 'SP Group', tariff: 0.2324, gst: 9.0 };
  }
  return { name: 'Refuse Fee', fee: 9.76, gst: 9.0 };
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

// Format date explicitly as DD/MM/YYYY
function formatDateDMY(dateMs) {
  const dt = new Date(dateMs || Date.now());
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getReadingCycleInfo(dateMs, cycleDay = 28) {
  const dt = new Date(dateMs || Date.now());
  let year = dt.getFullYear();
  let month = dt.getMonth();
  
  if (dt.getDate() < cycleDay) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  
  const cycleDate = new Date(year, month, 1);
  const monthName = cycleDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  
  const startDate = new Date(year, month, cycleDay);
  let endMonth = month + 1;
  let endYear = year;
  if (endMonth > 11) {
    endMonth = 0;
    endYear += 1;
  }
  const endDate = new Date(endYear, endMonth, cycleDay - 1);
  
  const rangeStr = `${formatDateDMY(startDate.getTime())} - ${formatDateDMY(endDate.getTime())}`;
  
  return { monthName, year, month, rangeStr };
}

// Calculation Helpers
function calculateWaterEst() {
  const prevInput = document.getElementById('waterPrevInput');
  const currInput = document.getElementById('waterCurrInput');
  const usageEst = document.getElementById('waterUsageEst');
  const taxEst = document.getElementById('waterTaxEst');
  const totalEst = document.getElementById('waterTotalEst');

  const prev = parseFloat(prevInput ? prevInput.value : 0) || 0;
  const curr = parseFloat(currInput ? currInput.value : 0) || 0;
  const usage = Math.max(0, curr - prev);

  const provider = getActiveProvider('WATER');
  let baseAmount = 0;

  if (provider.model === 'FLAT') {
    baseAmount = usage * (provider.flatRate || 1.20);
  } else {
    const t1Tariff = (provider.t1Tariff || 1.21) + (provider.t1Wct || 0.72) + (provider.t1Wbf || 1.09);
    const t2Tariff = (provider.t2Tariff || 1.81) + (provider.t2Wct || 1.18) + (provider.t2Wbf || 1.40);

    if (usage <= 40) {
      baseAmount = usage * t1Tariff;
    } else {
      baseAmount = (40 * t1Tariff) + ((usage - 40) * t2Tariff);
    }
  }

  const tax = baseAmount * ((provider.gst || 9.0) / 100);
  const total = baseAmount + tax;

  if (usageEst) usageEst.innerText = `${usage.toFixed(3)} m³`;
  if (taxEst) taxEst.innerText = `S$${tax.toFixed(2)}`;
  if (totalEst) totalEst.innerText = `S$${total.toFixed(2)}`;

  return { usage, tax, total };
}

function calculateElecEst() {
  const prevInput = document.getElementById('elecPrevInput');
  const currInput = document.getElementById('elecCurrInput');
  const usageEst = document.getElementById('elecUsageEst');
  const totalEst = document.getElementById('elecTotalEst');

  const prev = Math.round(parseFloat(prevInput ? prevInput.value : 0) || 0);
  const curr = Math.round(parseFloat(currInput ? currInput.value : 0) || 0);
  const usage = Math.max(0, curr - prev);

  const provider = getActiveProvider('ELECTRICITY');
  const tariff = provider.tariff || 0.2324;
  const gst = provider.gst || 9.0;

  const baseAmount = usage * tariff;
  const total = baseAmount * (1 + (gst / 100));

  if (usageEst) usageEst.innerText = `${Math.round(usage)} kWh`;
  if (totalEst) totalEst.innerText = `S$${total.toFixed(2)}`;

  return { usage, total };
}

// Auto-fill Previous Reading from History & Local Storage
function autofillLatestReadings() {
  const waterPrevInput = document.getElementById('waterPrevInput');
  const elecPrevInput = document.getElementById('elecPrevInput');

  let waterVal = localStorage.getItem('utility_last_water_reading') || '';
  if (currentUser) {
    const userWater = localStorage.getItem(`utility_last_water_reading_${currentUser.uid}`);
    if (userWater) waterVal = userWater;
  }

  let elecVal = localStorage.getItem('utility_last_elec_reading') || '';
  if (currentUser) {
    const userElec = localStorage.getItem(`utility_last_elec_reading_${currentUser.uid}`);
    if (userElec) elecVal = userElec;
  }

  if (userReadings && userReadings.length > 0) {
    const waterReadings = userReadings
      .filter(r => r.type === 'WATER' && (r.currentReading !== undefined || r.reading !== undefined))
      .sort((a, b) => (b.readingDate || b.timestamp || 0) - (a.readingDate || a.timestamp || 0));

    if (waterReadings.length > 0) {
      const latest = waterReadings[0];
      const v = latest.currentReading !== undefined ? latest.currentReading : latest.reading;
      if (v !== undefined && v !== null && v !== '') {
        waterVal = v;
      }
    }

    const elecReadings = userReadings
      .filter(r => r.type === 'ELECTRICITY' && (r.currentReading !== undefined || r.reading !== undefined))
      .sort((a, b) => (b.readingDate || b.timestamp || 0) - (a.readingDate || a.timestamp || 0));

    if (elecReadings.length > 0) {
      const latest = elecReadings[0];
      const v = latest.currentReading !== undefined ? latest.currentReading : latest.reading;
      if (v !== undefined && v !== null && v !== '') {
        elecVal = v;
      }
    }
  }

  if (waterVal !== '' && waterVal !== null && waterPrevInput) {
    waterPrevInput.value = parseFloat(waterVal).toFixed(3);
    localStorage.setItem('utility_last_water_reading', waterVal.toString());
    if (currentUser) {
      localStorage.setItem(`utility_last_water_reading_${currentUser.uid}`, waterVal.toString());
    }
  }

  if (elecVal !== '' && elecVal !== null && elecPrevInput) {
    elecPrevInput.value = Math.round(parseFloat(elecVal) || 0).toString();
    localStorage.setItem('utility_last_elec_reading', elecVal.toString());
    if (currentUser) {
      localStorage.setItem(`utility_last_elec_reading_${currentUser.uid}`, elecVal.toString());
    }
  }

  calculateWaterEst();
  calculateElecEst();
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
  return `
    <div style="display:flex; gap:6px; align-items:center;">
      <button type="button" data-action="edit-provider" data-id="${p.id}" class="btn-icon-action" title="Edit Provider">
        <span class="material-icons-round" style="pointer-events:none; font-size:20px;">edit</span>
      </button>
      <button type="button" data-action="delete-provider" data-id="${p.id}" class="btn-icon-action text-danger" title="Delete Provider">
        <span class="material-icons-round" style="pointer-events:none; font-size:20px;">delete</span>
      </button>
    </div>
  `;
}

function saveProvidersState() {
  normalizeProviderOrders();
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

function renderProviders() {
  const refuseList = document.getElementById('refuseProvidersList');
  const elecList = document.getElementById('elecProvidersList');
  const waterList = document.getElementById('waterProvidersList');

  if (!refuseList || !elecList || !waterList) return;

  normalizeProviderOrders();
  const refuseItems = providersList.filter(p => p.type === 'REFUSE').sort((a, b) => (a.order || 0) - (b.order || 0));
  const elecItems = providersList.filter(p => p.type === 'ELECTRICITY').sort((a, b) => (a.order || 0) - (b.order || 0));
  const waterItems = providersList.filter(p => p.type === 'WATER').sort((a, b) => (a.order || 0) - (b.order || 0));

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

  const reorderModal = document.getElementById('reorderModal');
  if (reorderModal && !reorderModal.classList.contains('hidden')) {
    renderReorderModalContent();
  }
}

// Reorder Overlay Modal Functions
window.openReorderModal = function() {
  renderReorderModalContent();
  const modal = document.getElementById('reorderModal');
  if (modal) modal.classList.remove('hidden');
};

window.closeReorderModal = function() {
  const modal = document.getElementById('reorderModal');
  if (modal) modal.classList.add('hidden');
};

function renderReorderModalContent() {
  const container = document.getElementById('reorderModalContent');
  if (!container) return;

  normalizeProviderOrders();

  const categories = [
    { type: 'REFUSE', title: '🗑️ Refuse Providers', items: providersList.filter(p => p.type === 'REFUSE').sort((a, b) => (a.order || 0) - (b.order || 0)) },
    { type: 'ELECTRICITY', title: '⚡ Electricity Providers', items: providersList.filter(p => p.type === 'ELECTRICITY').sort((a, b) => (a.order || 0) - (b.order || 0)) },
    { type: 'WATER', title: '💧 Water Providers', items: providersList.filter(p => p.type === 'WATER').sort((a, b) => (a.order || 0) - (b.order || 0)) }
  ];

  let html = '';

  categories.forEach(cat => {
    html += `
      <div style="margin-bottom:14px;">
        <div style="font-size:0.8rem; font-weight:800; color:#0f172a; margin-bottom:6px;">${cat.title}</div>
        ${cat.items.length === 0 ? '<p style="font-size:0.72rem; color:#94a3b8; font-style:italic;">No providers added.</p>' : cat.items.map((p, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === cat.items.length - 1;
          return `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:10px 12px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong style="font-size:0.82rem; color:#0f172a; display:block;">${p.name}</strong>
                ${p.isDefault ? '<span class="badge-default">★ Default</span>' : ''}
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <button type="button" class="btn-reorder" data-action="reorder-up" data-id="${p.id}" ${isFirst ? 'disabled' : ''}>
                  <span class="material-icons-round" style="pointer-events:none; font-size:18px;">arrow_upward</span>
                </button>
                <button type="button" class="btn-reorder" data-action="reorder-down" data-id="${p.id}" ${isLast ? 'disabled' : ''}>
                  <span class="material-icons-round" style="pointer-events:none; font-size:18px;">arrow_downward</span>
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  });

  container.innerHTML = html;
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

// Dynamic Input Formatting & Estimation Handlers
const waterPrevEl = document.getElementById('waterPrevInput');
const waterCurrEl = document.getElementById('waterCurrInput');
const elecPrevEl = document.getElementById('elecPrevInput');
const elecCurrEl = document.getElementById('elecCurrInput');

if (waterPrevEl) {
  waterPrevEl.addEventListener('input', calculateWaterEst);
  waterPrevEl.addEventListener('blur', () => {
    if (waterPrevEl.value.trim() !== '') {
      const v = parseFloat(waterPrevEl.value);
      if (!isNaN(v)) waterPrevEl.value = v.toFixed(3);
    }
  });
}

if (waterCurrEl) {
  waterCurrEl.addEventListener('input', calculateWaterEst);
  waterCurrEl.addEventListener('blur', () => {
    if (waterCurrEl.value.trim() !== '') {
      const v = parseFloat(waterCurrEl.value);
      if (!isNaN(v)) waterCurrEl.value = v.toFixed(3);
    }
  });
}

if (elecPrevEl) {
  elecPrevEl.addEventListener('input', calculateElecEst);
  elecPrevEl.addEventListener('blur', () => {
    if (elecPrevEl.value.trim() !== '') {
      const v = parseFloat(elecPrevEl.value);
      if (!isNaN(v)) elecPrevEl.value = Math.round(v).toString();
    }
  });
}

if (elecCurrEl) {
  elecCurrEl.addEventListener('input', calculateElecEst);
  elecCurrEl.addEventListener('blur', () => {
    if (elecCurrEl.value.trim() !== '') {
      const v = parseFloat(elecCurrEl.value);
      if (!isNaN(v)) elecCurrEl.value = Math.round(v).toString();
    }
  });
}

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
  renderHistory();
});

const btnElecPlus = document.getElementById('btnElecCyclePlus');
if (btnElecPlus) btnElecPlus.addEventListener('click', () => {
  elecCycleStartDay = elecCycleStartDay >= 31 ? 1 : elecCycleStartDay + 1;
  localStorage.setItem('utility_elec_cycle_start_day', elecCycleStartDay.toString());
  updateCycleLabels();
  syncCycleToFirebase();
  renderHistory();
});

const btnWaterMinus = document.getElementById('btnWaterCycleMinus');
if (btnWaterMinus) btnWaterMinus.addEventListener('click', () => {
  waterCycleStartDay = waterCycleStartDay <= 1 ? 31 : waterCycleStartDay - 1;
  localStorage.setItem('utility_water_cycle_start_day', waterCycleStartDay.toString());
  updateCycleLabels();
  syncCycleToFirebase();
  renderHistory();
});

const btnWaterPlus = document.getElementById('btnWaterCyclePlus');
if (btnWaterPlus) btnWaterPlus.addEventListener('click', () => {
  waterCycleStartDay = waterCycleStartDay >= 31 ? 1 : waterCycleStartDay + 1;
  localStorage.setItem('utility_water_cycle_start_day', waterCycleStartDay.toString());
  updateCycleLabels();
  syncCycleToFirebase();
  renderHistory();
});

// Tab Navigation (Electricity, Water, Rates, History)
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const type = btn.getAttribute('data-type');
    document.querySelectorAll('.tab-section').forEach(sec => sec.classList.add('hidden'));
    if (type === 'ELECTRICITY') document.getElementById('sectionElectricity').classList.remove('hidden');
    if (type === 'WATER') document.getElementById('sectionWater').classList.remove('hidden');
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
  if (waterCurrEl && waterCurrEl.value.trim() !== '') {
    waterCurrEl.value = parseFloat(waterCurrEl.value).toFixed(3);
  }

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
    previousReading: parseFloat(prev.toFixed(3)),
    currentReading: parseFloat(curr.toFixed(3)),
    reading: parseFloat(curr.toFixed(3)),
    usage: parseFloat(est.usage.toFixed(3)),
    totalAmount: est.total,
    readingDate: Date.now(),
    timestamp: Date.now(),
    date: new Date().toISOString(),
    cycleStartDate: cycleDate
  };

  await saveAndSyncReading(item);
  if (waterPrevEl) waterPrevEl.value = curr.toFixed(3);
  localStorage.setItem('utility_last_water_reading', curr.toFixed(3));
  if (currentUser) localStorage.setItem(`utility_last_water_reading_${currentUser.uid}`, curr.toFixed(3));
  if (waterCurrEl) waterCurrEl.value = '';
  alert('Water reading saved and synced!');
});

const btnSaveE = document.getElementById('btnSaveElectricity');
if (btnSaveE) btnSaveE.addEventListener('click', async () => {
  if (elecCurrEl && elecCurrEl.value.trim() !== '') {
    elecCurrEl.value = Math.round(parseFloat(elecCurrEl.value)).toString();
  }

  const est = calculateElecEst();
  const prev = Math.round(parseFloat(elecPrevEl ? elecPrevEl.value : 0) || 0);
  const curr = Math.round(parseFloat(elecCurrEl ? elecCurrEl.value : 0) || 0);
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
    usage: Math.round(est.usage),
    totalAmount: est.total,
    readingDate: Date.now(),
    timestamp: Date.now(),
    date: new Date().toISOString(),
    cycleStartDate: cycleDate
  };

  await saveAndSyncReading(item);
  if (elecPrevEl) elecPrevEl.value = curr.toString();
  localStorage.setItem('utility_last_elec_reading', curr.toString());
  if (currentUser) localStorage.setItem(`utility_last_elec_reading_${currentUser.uid}`, curr.toString());
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
  autofillLatestReadings();
  renderHistory();
}

// Modal state for Detailed Breakdown
let activeBreakdownGroupKey = null;

// RENDER HISTORY SCREEN
function renderHistory() {
  const historyList = document.getElementById('historyList');
  if (!historyList) return;

  const refuseP = getActiveProvider('REFUSE');
  const refuseFee = (refuseP.fee || 9.76) * (1 + ((refuseP.gst || 9.0) / 100));

  const currentCycleInfo = getReadingCycleInfo(Date.now(), waterCycleStartDay);
  
  const cycleGroups = {};
  
  userReadings.forEach(item => {
    const itemDate = item.readingDate || item.timestamp || Date.now();
    const cycleInfo = getReadingCycleInfo(itemDate, item.type === 'ELECTRICITY' ? elecCycleStartDay : waterCycleStartDay);
    const key = cycleInfo.monthName;
    
    if (!cycleGroups[key]) {
      cycleGroups[key] = {
        key: key,
        rangeStr: cycleInfo.rangeStr,
        year: cycleInfo.year,
        month: cycleInfo.month,
        elec: [],
        water: []
      };
    }
    
    if (item.type === 'ELECTRICITY') {
      cycleGroups[key].elec.push(item);
    } else if (item.type === 'WATER') {
      cycleGroups[key].water.push(item);
    }
  });

  if (!cycleGroups[currentCycleInfo.monthName]) {
    cycleGroups[currentCycleInfo.monthName] = {
      key: currentCycleInfo.monthName,
      rangeStr: currentCycleInfo.rangeStr,
      year: currentCycleInfo.year,
      month: currentCycleInfo.month,
      elec: [],
      water: []
    };
  }

  const currGroup = cycleGroups[currentCycleInfo.monthName];
  const currElecTotal = currGroup.elec.reduce((s, x) => s + (x.totalAmount || 0), 0);
  const currWaterTotal = currGroup.water.reduce((s, x) => s + (x.totalAmount || 0), 0);
  const currCycleGrandTotal = currElecTotal + currWaterTotal + refuseFee;

  let html = `
    <!-- Top Current Cycle Monitor Banner -->
    <div class="current-cycle-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span style="font-weight:800; font-size:0.92rem; color:#0f172a;">Current Cycle Monitor</span>
        <span style="font-weight:700; font-size:0.78rem; color:#64748b;">${currentCycleInfo.monthName}</span>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:14px; text-align:center;">
        <div class="cycle-metric-box">
          <div style="color:#ef4444; font-size:0.75rem; font-weight:700;">⚡ Electricity</div>
          <div style="font-size:0.95rem; font-weight:800; color:#ef4444; margin-top:2px;">S$${currElecTotal.toFixed(2)}</div>
        </div>
        <div class="cycle-metric-box">
          <div style="color:#0284c7; font-size:0.75rem; font-weight:700;">💧 Water</div>
          <div style="font-size:0.95rem; font-weight:800; color:#0284c7; margin-top:2px;">S$${currWaterTotal.toFixed(2)}</div>
        </div>
        <div class="cycle-metric-box">
          <div style="color:#64748b; font-size:0.75rem; font-weight:700;">🗑️ Refuse</div>
          <div style="font-size:0.95rem; font-weight:800; color:#64748b; margin-top:2px;">S$${refuseFee.toFixed(2)}</div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px dashed #cbd5e1; padding-top:10px;">
        <span style="font-weight:700; font-size:0.85rem; color:#0f172a;">Estimated Cycle Total</span>
        <span style="font-weight:800; font-size:1.18rem; color:#0f172a;">S$${currCycleGrandTotal.toFixed(2)}</span>
      </div>
    </div>

    <!-- Past Calculations History Header -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin:16px 0 10px 0;">
      <h3 style="font-size:0.92rem; font-weight:800; color:#f8fafc;">Past Calculations History</h3>
      <span class="badge-cycle-info">Grouped: Cycle (⚡ ${elecCycleStartDay}th | 💧 ${waterCycleStartDay}th)</span>
    </div>
  `;

  const sortedKeys = Object.keys(cycleGroups).sort((a, b) => {
    return (cycleGroups[b].year * 12 + cycleGroups[b].month) - (cycleGroups[a].year * 12 + cycleGroups[a].month);
  });

  if (sortedKeys.length === 0) {
    html += `<p style="text-align:center; color:var(--text-muted); padding:16px; font-size:0.8rem;">No saved calculation logs found.</p>`;
  } else {
    html += sortedKeys.map(key => {
      const g = cycleGroups[key];
      const elecTotal = g.elec.reduce((s, x) => s + (x.totalAmount || 0), 0);
      const elecUsage = g.elec.reduce((s, x) => s + (x.usage || 0), 0);
      
      const waterTotal = g.water.reduce((s, x) => s + (x.totalAmount || 0), 0);
      const waterUsage = g.water.reduce((s, x) => s + (x.usage || 0), 0);
      
      const periodGrandTotal = elecTotal + waterTotal + refuseFee;

      return `
        <div class="history-period-card">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="material-icons-round" style="color:#0f172a; font-size:22px;">format_list_bulleted</span>
              <div>
                <strong style="font-size:0.98rem; font-weight:800; color:#0f172a; display:block; line-height:1.2;">${g.key}</strong>
                <span style="font-size:0.7rem; color:#64748b; font-weight:600;">Billing Cycle Period</span>
              </div>
            </div>
            <div style="text-align:right;">
              <span style="font-size:0.68rem; color:#64748b; font-weight:700; display:block;">Total Period Bill</span>
              <strong style="font-size:1.05rem; font-weight:800; color:#0f172a;">S$${periodGrandTotal.toFixed(2)}</strong>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
            <!-- Electricity Sub Card -->
            <div class="history-subcard-elec">
              <div style="font-weight:700; font-size:0.76rem; color:#dc2626; display:flex; align-items:center; gap:4px;">⚡ Electricity</div>
              <div style="font-weight:800; font-size:0.92rem; color:#dc2626; margin:4px 0 2px 0;">S$${elecTotal.toFixed(4)}</div>
              <div style="font-size:0.72rem; color:#0f172a; font-weight:700;">${Math.round(elecUsage)} kWh</div>
              <div style="font-size:0.68rem; color:#94a3b8; margin-top:2px;">${g.elec.length} entries</div>
            </div>

            <!-- Water Sub Card -->
            <div class="history-subcard-water">
              <div style="font-weight:700; font-size:0.76rem; color:#0284c7; display:flex; align-items:center; gap:4px;">💧 Water</div>
              <div style="font-weight:800; font-size:0.92rem; color:#0284c7; margin:4px 0 2px 0;">S$${waterTotal.toFixed(4)}</div>
              <div style="font-size:0.72rem; color:#0f172a; font-weight:700;">${waterUsage.toFixed(3)} m³</div>
              <div style="font-size:0.68rem; color:#94a3b8; margin-top:2px;">${g.water.length} entries</div>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-top:1px solid #f1f5f9; margin-bottom:8px;">
            <span style="font-size:0.76rem; font-weight:700; color:#475569; display:flex; align-items:center; gap:6px;">
              🗑️ Refuse Collection Fee
            </span>
            <strong style="font-size:0.82rem; font-weight:800; color:#475569;">S$${refuseFee.toFixed(2)}</strong>
          </div>

          <button type="button" class="btn-see-history" onclick="window.openBreakdownModal('${g.key}')">
            ➔ See History
          </button>
        </div>
      `;
    }).join('');
  }

  historyList.innerHTML = html;
  autofillLatestReadings();
}

// Open Detailed Breakdown Modal
window.openBreakdownModal = function(groupKey) {
  activeBreakdownGroupKey = groupKey;
  renderBreakdownModalContent();
  const modal = document.getElementById('breakdownModal');
  if (modal) modal.classList.remove('hidden');
};

function renderBreakdownModalContent() {
  if (!activeBreakdownGroupKey) return;

  const refuseP = getActiveProvider('REFUSE');
  const refuseFee = (refuseP.fee || 9.76) * (1 + ((refuseP.gst || 9.0) / 100));

  const items = userReadings.filter(item => {
    const itemDate = item.readingDate || item.timestamp || Date.now();
    const cycleInfo = getReadingCycleInfo(itemDate, item.type === 'ELECTRICITY' ? elecCycleStartDay : waterCycleStartDay);
    return cycleInfo.monthName === activeBreakdownGroupKey;
  });

  // Sort logs descending (Latest record first)
  const elecItems = items
    .filter(x => x.type === 'ELECTRICITY')
    .sort((a, b) => (b.readingDate || b.timestamp || 0) - (a.readingDate || a.timestamp || 0));

  const waterItems = items
    .filter(x => x.type === 'WATER')
    .sort((a, b) => (b.readingDate || b.timestamp || 0) - (a.readingDate || a.timestamp || 0));

  const elecTotal = elecItems.reduce((s, x) => s + (x.totalAmount || 0), 0);
  const elecUsage = elecItems.reduce((s, x) => s + (x.usage || 0), 0);
  const waterTotal = waterItems.reduce((s, x) => s + (x.totalAmount || 0), 0);
  const waterUsage = waterItems.reduce((s, x) => s + (x.usage || 0), 0);

  const grandTotal = elecTotal + waterTotal + refuseFee;

  const cycleInfo = getReadingCycleInfo(Date.now(), waterCycleStartDay);

  const titleEl = document.getElementById('breakdownTitle');
  if (titleEl) titleEl.innerText = activeBreakdownGroupKey.toUpperCase();

  const container = document.getElementById('breakdownContent');
  if (!container) return;

  const activeElecP = getActiveProvider('ELECTRICITY');
  const activeWaterP = getActiveProvider('WATER');

  container.innerHTML = `
    <!-- Combined Grand Total Banner -->
    <div style="background:#ffffff; border-radius:16px; padding:14px 16px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      <div>
        <span style="font-size:0.72rem; color:#64748b; font-weight:700; display:block;">Combined Grand Total</span>
        <strong style="font-size:1.35rem; font-weight:800; color:#0f172a;">S$${grandTotal.toFixed(2)}</strong>
      </div>
      <span class="material-icons-round" style="color:#10b981; font-size:32px;">check_circle</span>
    </div>

    <!-- Electricity Details Card -->
    <div style="margin-bottom:14px;">
      <div style="font-size:0.82rem; font-weight:800; color:#ef4444; margin-bottom:6px; display:flex; align-items:center; gap:4px;">
        ⚡ Electricity Details
      </div>
      <div style="background:#ffffff; border-radius:16px; padding:12px 14px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="background:#fef2f2; color:#ef4444; width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-weight:800;">⚡</div>
            <div>
              <strong style="font-size:0.82rem; font-weight:800; color:#ef4444; display:block;">Electricity Compiled</strong>
              <span style="font-size:0.68rem; color:#64748b; font-weight:600;">${cycleInfo.rangeStr}</span>
            </div>
          </div>
          <span style="background:#fef2f2; color:#ef4444; font-size:0.68rem; font-weight:800; padding:3px 8px; border-radius:10px;">${elecItems.length} entries</span>
        </div>

        <div style="display:flex; justify-content:space-between; font-size:0.74rem; color:#64748b; padding:6px 0; border-top:1px solid #f1f5f9;">
          <span>Providers: <strong style="color:#0f172a;">${elecItems[0]?.providerName || activeElecP.name}</strong></span>
          <span>Total Usage: <strong style="color:#0f172a;">${Math.round(elecUsage)} kWh</strong></span>
          <span>Est. Bill: <strong style="color:#ef4444;">S$${elecTotal.toFixed(4)}</strong></span>
        </div>

        <!-- Logs Breakdown (Latest record first) -->
        <div style="margin-top:8px; border-top:1px dashed #e2e8f0; padding-top:6px;">
          ${elecItems.length === 0 ? '<p style="font-size:0.72rem; color:#94a3b8; font-style:italic;">No electricity entries.</p>' : elecItems.map(item => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; font-size:0.74rem;">
              <div>
                <span style="color:#0f172a; font-weight:700;">${formatDateDMY(item.readingDate || item.timestamp)}</span>
                <span style="color:#64748b; margin-left:6px;">(${Math.round(item.previousReading)} ➔ ${Math.round(item.currentReading)})</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <strong style="color:#ef4444;">S$${(item.totalAmount || 0).toFixed(2)}</strong>
                <button type="button" onclick="window.deleteReadingItem('${item.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:2px;">
                  <span class="material-icons-round" style="pointer-events:none; font-size:16px;">delete</span>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Water Details Card -->
    <div style="margin-bottom:14px;">
      <div style="font-size:0.82rem; font-weight:800; color:#0284c7; margin-bottom:6px; display:flex; align-items:center; gap:4px;">
        💧 Water Details
      </div>
      <div style="background:#ffffff; border-radius:16px; padding:12px 14px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="background:#f0f9ff; color:#0284c7; width:32px; height:32px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-weight:800;">💧</div>
            <div>
              <strong style="font-size:0.82rem; font-weight:800; color:#0284c7; display:block;">Water Compiled</strong>
              <span style="font-size:0.68rem; color:#64748b; font-weight:600;">${cycleInfo.rangeStr}</span>
            </div>
          </div>
          <span style="background:#f0f9ff; color:#0284c7; font-size:0.68rem; font-weight:800; padding:3px 8px; border-radius:10px;">${waterItems.length} entries</span>
        </div>

        <div style="display:flex; justify-content:space-between; font-size:0.74rem; color:#64748b; padding:6px 0; border-top:1px solid #f1f5f9;">
          <span>Providers: <strong style="color:#0f172a;">${waterItems[0]?.providerName || activeWaterP.name}</strong></span>
          <span>Total Usage: <strong style="color:#0f172a;">${waterUsage.toFixed(3)} m³</strong></span>
          <span>Est. Bill: <strong style="color:#0284c7;">S$${waterTotal.toFixed(4)}</strong></span>
        </div>

        <!-- Logs Breakdown (Latest record first) -->
        <div style="margin-top:8px; border-top:1px dashed #e2e8f0; padding-top:6px;">
          ${waterItems.length === 0 ? '<p style="font-size:0.72rem; color:#94a3b8; font-style:italic;">No water entries.</p>' : waterItems.map(item => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; font-size:0.74rem;">
              <div>
                <span style="color:#0f172a; font-weight:700;">${formatDateDMY(item.readingDate || item.timestamp)}</span>
                <span style="color:#64748b; margin-left:6px;">(${parseFloat(item.previousReading || 0).toFixed(3)} ➔ ${parseFloat(item.currentReading || 0).toFixed(3)})</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <strong style="color:#0284c7;">S$${(item.totalAmount || 0).toFixed(2)}</strong>
                <button type="button" onclick="window.deleteReadingItem('${item.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:2px;">
                  <span class="material-icons-round" style="pointer-events:none; font-size:16px;">delete</span>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Refuse Details Card -->
    <div style="margin-bottom:14px;">
      <div style="font-size:0.82rem; font-weight:800; color:#475569; margin-bottom:6px; display:flex; align-items:center; gap:4px;">
        🗑️ Refuse Collection Details
      </div>
      <div style="background:#ffffff; border-radius:16px; padding:12px 14px; box-shadow:0 2px 8px rgba(0,0,0,0.1); display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong style="font-size:0.82rem; font-weight:800; color:#0f172a; display:block;">Monthly Flat Charge</strong>
          <span style="font-size:0.68rem; color:#64748b;">Calculated based on active refuse provider rates</span>
        </div>
        <strong style="font-size:0.95rem; font-weight:800; color:#0f172a;">S$${refuseFee.toFixed(2)}</strong>
      </div>
    </div>
  `;
}

window.deleteReadingItem = async function(id) {
  if (!confirm('Delete this reading entry?')) return;
  userReadings = userReadings.filter(x => x.id !== id);
  localStorage.setItem('utility_readings_local', JSON.stringify(userReadings));
  if (currentUser) {
    localStorage.setItem(`utility_readings_${currentUser.uid}`, JSON.stringify(userReadings));
  }
  await syncReadingsToFirebase();
  renderHistory();
  renderBreakdownModalContent();
  autofillLatestReadings();
};

window.closeBreakdownModal = function() {
  const modal = document.getElementById('breakdownModal');
  if (modal) modal.classList.add('hidden');
};

// Central Delegated Event Handler for Provider Actions (Edit, Delete, Reorder, Modals)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  
  const action = btn.getAttribute('data-action');
  const id = btn.getAttribute('data-id');

  if (action === 'edit-provider') {
    e.preventDefault();
    const p = providersList.find(x => x.id === id);
    if (p) openModalForProvider(p);
  } else if (action === 'delete-provider') {
    e.preventDefault();
    if (confirm('Are you sure you want to delete this provider?')) {
      providersList = providersList.filter(x => x.id !== id);
      saveProvidersState();
      renderReorderModalContent();
    }
  } else if (action === 'reorder-up') {
    e.preventDefault();
    window.moveProviderUp(id);
    renderReorderModalContent();
  } else if (action === 'reorder-down') {
    e.preventDefault();
    window.moveProviderDown(id);
    renderReorderModalContent();
  } else if (action === 'open-reorder-modal') {
    e.preventDefault();
    window.openReorderModal();
  } else if (action === 'close-reorder-modal') {
    e.preventDefault();
    window.closeReorderModal();
  }
});

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
autofillLatestReadings();

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
            autofillLatestReadings();
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
        autofillLatestReadings();

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

// Global Logout Handler
window.handleLogout = async function() {
  if (readingsUnsub) { try { readingsUnsub(); } catch(e){} readingsUnsub = null; }
  if (providersUnsub) { try { providersUnsub(); } catch(e){} providersUnsub = null; }
  if (cycleUnsub) { try { cycleUnsub(); } catch(e){} cycleUnsub = null; }

  if (window.FirebaseSDK) {
    try {
      if (!auth) {
        const { getAuth } = window.FirebaseSDK;
        auth = getAuth();
      }
      if (auth) {
        const { signOut } = window.FirebaseSDK;
        await signOut(auth);
      }
    } catch(e) {
      console.error('Logout error:', e);
    }
  }

  currentUser = null;

  const mainHeader = document.getElementById('mainHeader');
  const authLanding = document.getElementById('authLandingScreen');
  const mainContainer = document.getElementById('mainContainer');
  if (mainHeader) mainHeader.classList.add('hidden');
  if (authLanding) authLanding.classList.remove('hidden');
  if (mainContainer) mainContainer.classList.add('hidden');

  const localSaved = localStorage.getItem('utility_readings_local');
  try { userReadings = localSaved ? JSON.parse(localSaved) : []; } catch(e) { userReadings = []; }

  const localProv = localStorage.getItem('utility_providers');
  try { if (localProv) providersList = JSON.parse(localProv); } catch(e) {}

  renderHistory();
  autofillLatestReadings();
  renderProviders();
  updateRateLabels();
};

const btnLogout = document.getElementById('btnLogout');
if (btnLogout) {
  btnLogout.addEventListener('click', (e) => {
    e.preventDefault();
    window.handleLogout();
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
