/* ── Supabase client ── */
const { createClient } = supabase;
const sb = createClient(
  'https://ykijxovmdkffpofzckmn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraWp4b3ZtZGtmZnBvZnpja21uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MDY1NTcsImV4cCI6MjA5NzI4MjU1N30._TJt0rwVXleuN2iJZ4pkvvblhjQNONp9s_2EIKzKoNA'
);

/* ── In-memory state ── */
let expenses   = [];
let categories = [];
let incomes    = [];
let catBudgets = {}; // { [categoryId]: amount }

/* ── Helpers ── */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function fmt(n) { return '₱' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 }); }

// DB row → app object (snake_case → camelCase)
const expFromDb  = r => ({ id: r.id, name: r.name, date: r.date, categoryId: r.category_id, amount: Number(r.amount) });
const expToDb    = e => ({ id: e.id, name: e.name, date: e.date, category_id: e.categoryId, amount: e.amount });
const incFromDb  = r => ({ id: r.id, source: r.source, amount: Number(r.amount), date: r.date });
const cbFromDb   = rows => Object.fromEntries(rows.map(r => [r.category_id, Number(r.amount)]));

/* ── View state ── */
const NOW     = new Date();
let activeMonth = NOW.getMonth();
let activeYear  = NOW.getFullYear();
let bdgMonth    = NOW.getMonth();
let bdgYear     = NOW.getFullYear();
let ovMonth     = NOW.getMonth();

/* ── Chart instances ── */
let doughnutChart = null;
let barChart      = null;

/* ── Loading overlay ── */
function showLoading(on) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !on);
}

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', async () => {
  showLoading(true);
  buildOvTabs();
  buildMonthTabs();
  await initData();
  renderAll();
  bindEvents();
  document.getElementById('expenseDate').valueAsDate = new Date();
  document.getElementById('incomeDate').valueAsDate  = new Date();
  document.getElementById('chartYear').textContent   = activeYear;
  updateBudgetMonthLabel();
  showLoading(false);
});

/* ── Load all data from Supabase ── */
async function initData() {
  const [expRes, catRes, incRes, cbRes] = await Promise.all([
    sb.from('expenses').select('*'),
    sb.from('categories').select('*'),
    sb.from('incomes').select('*'),
    sb.from('cat_budgets').select('*'),
  ]);

  expenses   = (expRes.data  || []).map(expFromDb);
  categories = catRes.data   || [];
  incomes    = (incRes.data  || []).map(incFromDb);
  catBudgets = cbFromDb(cbRes.data || []);

  // Seed default categories on first run
  if (categories.length === 0) {
    categories = [
      { id: uid(), name: 'Food',      color: '#FFB3B3' },
      { id: uid(), name: 'Transport', color: '#B8DDED' },
      { id: uid(), name: 'Shopping',  color: '#FFE5A0' },
      { id: uid(), name: 'Bills',     color: '#C3B8ED' },
    ];
    await sb.from('categories').insert(categories);
  }
}

/* ── Render orchestrator ── */
function renderAll() {
  renderTracker();
  renderOverview();
  renderBudget();
}

/* ── Period helpers ── */
function monthIncomes(year, month) {
  return incomes.filter(i => { const d = new Date(i.date); return d.getFullYear() === year && d.getMonth() === month; });
}
function monthIncomeTotal(year, month) { return monthIncomes(year, month).reduce((s, i) => s + i.amount, 0); }
function monthExpenses(year, month) {
  return expenses.filter(e => { const d = new Date(e.date); return d.getFullYear() === year && d.getMonth() === month; });
}
function monthExpenseTotal(year, month) { return monthExpenses(year, month).reduce((s, e) => s + e.amount, 0); }

/* ──────────────────────────────────────────────────────
   OVERVIEW
────────────────────────────────────────────────────── */
function buildOvTabs() {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const wrap = document.getElementById('ovMonthTabs');
  wrap.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'ov-tab' + (ovMonth === -1 ? ' active' : '');
  allBtn.textContent = 'All Year';
  allBtn.addEventListener('click', () => setOvMonth(-1));
  wrap.appendChild(allBtn);
  MONTHS.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.className = 'ov-tab' + (ovMonth === i ? ' active' : '');
    btn.textContent = m;
    btn.addEventListener('click', () => setOvMonth(i));
    wrap.appendChild(btn);
  });
}

function setOvMonth(i) {
  ovMonth = i;
  document.querySelectorAll('.ov-tab').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === (i === -1 ? 0 : i + 1));
  });
  renderOverview();
}

function renderOverview() {
  const allYear  = ovMonth === -1;
  const yr       = activeYear;
  const periodExp = allYear
    ? expenses.filter(e => new Date(e.date).getFullYear() === yr)
    : monthExpenses(yr, ovMonth);
  const periodIncome = allYear
    ? incomes.filter(i => new Date(i.date).getFullYear() === yr).reduce((s, i) => s + i.amount, 0)
    : monthIncomeTotal(yr, ovMonth);
  const totalSpent = periodExp.reduce((s, e) => s + e.amount, 0);
  const remaining  = periodIncome - totalSpent;

  document.getElementById('ovSpentLabel').textContent    = allYear ? 'Total Spent (Year)'  : 'Total Spent';
  document.getElementById('ovBudgetLabel').textContent   = allYear ? 'Total Income (Year)' : 'Income';
  document.getElementById('ovRemainingLabel').textContent = remaining >= 0 ? 'Remaining' : 'Overspent';
  document.getElementById('ovTotalSpent').textContent    = fmt(totalSpent);
  document.getElementById('ovBudget').textContent        = fmt(periodIncome);
  document.getElementById('ovRemaining').textContent     = fmt(Math.abs(remaining));
  document.getElementById('ovCount').textContent         = periodExp.length;

  const savedCard     = document.getElementById('ovSavedCard');
  const remainingCard = document.getElementById('ovRemainingCard');
  if (allYear) {
    savedCard.style.display     = '';
    remainingCard.style.display = 'none';
    const yrIncome = incomes.filter(i => new Date(i.date).getFullYear() === yr).reduce((s, i) => s + i.amount, 0);
    const yrSpent  = expenses.filter(e => new Date(e.date).getFullYear() === yr).reduce((s, e) => s + e.amount, 0);
    const saved    = yrIncome - yrSpent;
    document.getElementById('ovSaved').textContent = fmt(saved);
    document.getElementById('ovSaved').style.color = saved < 0 ? 'var(--danger)' : '';
  } else {
    savedCard.style.display     = 'none';
    remainingCard.style.display = '';
  }

  renderCatCards(periodExp, totalSpent);
  renderDoughnut(periodExp);
  renderBar();
}

function renderCatCards(periodExp, total) {
  const container = document.getElementById('catCards');
  const bycat = groupByCategory(periodExp);
  container.innerHTML = categories.map(c => {
    const spent   = bycat[c.id] || 0;
    const pct     = total > 0 ? ((spent / total) * 100).toFixed(1) : '0.0';
    const cap     = catBudgets[c.id];
    const overCap = cap && spent > cap;
    const warnHtml = overCap ? `<span class="cat-card-warn">⚠️ Over cap by ${fmt(spent - cap)}</span>` : '';
    return `
      <div class="cat-card${overCap ? ' over-cap' : ''}">
        <span class="cat-chip" style="background:${c.color}"></span>
        <div class="cat-card-info">
          <span class="cat-card-name-row"
                onclick="startCatNameEdit(this.querySelector('.cat-card-name'),'${c.id}')"
                title="Click to rename" style="cursor:pointer;display:flex;align-items:center;gap:.35rem">
            <span class="cat-card-name">${esc(c.name)}</span>
            <span class="cat-edit-icon">✏️</span>
          </span>
          <span class="cat-card-amount">${fmt(spent)}</span>
          <span class="cat-card-pct">${pct}% of spend</span>
          ${warnHtml}
        </div>
      </div>`;
  }).join('');
}

function startCatNameEdit(span, catId) {
  const current = categories.find(c => c.id === catId).name;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = current;
  input.className = 'cat-card-name-input';
  span.replaceWith(input);
  input.focus();
  input.select();
  async function commit() {
    const newName = input.value.trim();
    if (newName && newName !== current) {
      const idx = categories.findIndex(c => c.id === catId);
      categories[idx].name = newName;
      await sb.from('categories').update({ name: newName }).eq('id', catId);
      renderAll();
    } else {
      renderAll();
    }
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = current; input.blur(); }
  });
}
window.startCatNameEdit = startCatNameEdit;

function renderDoughnut(periodExp) {
  const ctx   = document.getElementById('doughnutChart').getContext('2d');
  const bycat = groupByCategory(periodExp);
  const cats  = categories.filter(c => bycat[c.id]);
  if (doughnutChart) doughnutChart.destroy();
  if (cats.length === 0) { ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); return; }
  doughnutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: cats.map(c => c.name),
      datasets: [{ data: cats.map(c => bycat[c.id]), backgroundColor: cats.map(c => c.color), borderWidth: 2, borderColor: '#fff' }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 10 } } } }
  });
}

function renderBar() {
  const ctx    = document.getElementById('barChart').getContext('2d');
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (barChart) barChart.destroy();
  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        { label: 'Income', data: MONTHS.map((_, i) => monthIncomeTotal(activeYear, i)),  backgroundColor: '#FFF5B7', borderColor: '#FFE566', borderWidth: 1.5, borderRadius: 6 },
        { label: 'Spent',  data: MONTHS.map((_, i) => monthExpenseTotal(activeYear, i)), backgroundColor: '#B8DDED', borderColor: '#7BBDD4', borderWidth: 1.5, borderRadius: 6 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'top', labels: { font: { size: 11 } } } },
      scales: { y: { beginAtZero: true, ticks: { callback: v => '₱' + v.toLocaleString() } } }
    }
  });
}

/* ──────────────────────────────────────────────────────
   BUDGET / INCOME
────────────────────────────────────────────────────── */
function updateBudgetMonthLabel() {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('bdgMonthLabel').textContent = `${MONTHS[bdgMonth]} ${bdgYear}`;
}

function renderBudget() {
  updateBudgetMonthLabel();
  const totalIncome = monthIncomeTotal(bdgYear, bdgMonth);
  const totalSpent  = monthExpenseTotal(bdgYear, bdgMonth);
  const saved       = totalIncome - totalSpent;
  const over        = totalSpent > totalIncome && totalIncome > 0;
  const pct         = totalIncome > 0 ? Math.min((totalSpent / totalIncome) * 100, 100) : 0;

  document.getElementById('bdgBudget').textContent    = fmt(totalIncome);
  document.getElementById('bdgSpent').textContent     = fmt(totalSpent);
  document.getElementById('bdgRemaining').textContent = fmt(Math.abs(saved));
  document.getElementById('bdgRemainingLabel').textContent = over ? 'Overspent' : 'Saved / Remaining';

  const bar = document.getElementById('budgetBar');
  bar.style.width = pct + '%';
  bar.classList.toggle('over', over);
  document.getElementById('budgetBarPct').textContent = totalIncome > 0 ? Math.round(pct) + '%' : '';

  const status = document.getElementById('budgetStatus');
  if (totalIncome === 0) {
    status.textContent = 'Add income above to start tracking this month.';
    status.className   = 'budget-status';
  } else if (over) {
    status.textContent = `⚠️ Overspent by ${fmt(Math.abs(saved))} this month!`;
    status.className   = 'budget-status over';
  } else {
    status.textContent = '';
    status.className   = 'budget-status';
  }

  // Income log
  const monthInc  = monthIncomes(bdgYear, bdgMonth).sort((a, b) => new Date(b.date) - new Date(a.date));
  const incomeList  = document.getElementById('incomeList');
  const incomeEmpty = document.getElementById('incomeEmpty');
  if (monthInc.length === 0) {
    incomeList.innerHTML = '';
    incomeEmpty.style.display = '';
  } else {
    incomeEmpty.style.display = 'none';
    incomeList.innerHTML = monthInc.map(i => {
      const dateStr = new Date(i.date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
      return `
        <li class="income-list-item">
          <span class="income-source">${esc(i.source)}</span>
          <span class="income-date">${dateStr}</span>
          <span class="income-amount">+${fmt(i.amount)}</span>
          <button class="btn-icon-sm" onclick="deleteIncome('${i.id}')" title="Delete">🗑️</button>
        </li>`;
    }).join('');
  }

  // All-time savings
  const allTimeIncome = incomes.reduce((s, i) => s + i.amount, 0);
  const allTimeSpent  = expenses.reduce((s, e) => s + e.amount, 0);
  const allTimeSaved  = allTimeIncome - allTimeSpent;
  document.getElementById('totalSavings').textContent = fmt(Math.abs(allTimeSaved));
  document.getElementById('totalSavings').className   = 'savings-value' + (allTimeSaved < 0 ? ' negative' : '');
  document.getElementById('savingsIncome').textContent = `Income: ${fmt(allTimeIncome)}`;
  document.getElementById('savingsSpent').textContent  = `Spent: ${fmt(allTimeSpent)}`;

  // Per-category caps
  const curMonthExp = monthExpenses(bdgYear, bdgMonth);
  const bycat = groupByCategory(curMonthExp);
  document.getElementById('catBudgetList').innerHTML = categories.map(c => {
    const spent   = bycat[c.id] || 0;
    const cap     = catBudgets[c.id] || null;
    const overCap = cap && spent > cap;
    const pctCap  = cap ? Math.min((spent / cap) * 100, 100) : 0;
    const barHtml = cap
      ? `<div class="progress-bar-row">
           <div class="cap-bar-wrap"><div class="cap-bar${overCap ? ' over' : ''}" style="width:${pctCap}%"></div></div>
           <span class="progress-pct${overCap ? ' over' : ''}">${Math.round((spent / cap) * 100)}%</span>
         </div>`
      : '';
    const warnHtml = overCap ? `<span class="cat-over-warn">⚠️ Over by ${fmt(spent - cap)}</span>` : '';
    return `
      <div class="cat-budget-row${overCap ? ' over-cap' : ''}">
        <div class="cat-budget-row-top">
          <span class="cat-chip" style="background:${c.color}"></span>
          <span class="cat-name">${esc(c.name)}</span>
          <input class="field-input" type="number" min="0" step="0.01"
                 placeholder="No cap" value="${cap || ''}"
                 data-catid="${c.id}" onchange="saveCatBudget(this)" />
          <span class="cat-spent">${fmt(spent)} spent</span>
          ${warnHtml}
        </div>
        ${barHtml}
      </div>`;
  }).join('');
}

/* ── Income CRUD ── */
async function addIncome() {
  const source = document.getElementById('incomeSource').value.trim();
  const amount = parseFloat(document.getElementById('incomeAmount').value);
  const date   = document.getElementById('incomeDate').value;
  if (!source)                      return toast('Enter an income source.');
  if (isNaN(amount) || amount <= 0) return toast('Enter a valid amount.');
  if (!date)                        return toast('Pick a date.');

  const entry = { id: uid(), source, amount, date };
  incomes.push(entry);
  renderAll();
  document.getElementById('incomeSource').value    = '';
  document.getElementById('incomeAmount').value    = '';
  document.getElementById('incomeDate').valueAsDate = new Date();
  await sb.from('incomes').insert(entry);
  toast('Income added!');
}

async function deleteIncome(id) {
  if (!confirm('Remove this income entry?')) return;
  incomes = incomes.filter(i => i.id !== id);
  renderAll();
  await sb.from('incomes').delete().eq('id', id);
  toast('Income removed.');
}
window.deleteIncome = deleteIncome;

async function saveCatBudget(input) {
  const id  = input.dataset.catid;
  const val = parseFloat(input.value);
  if (!isNaN(val) && val > 0) {
    catBudgets[id] = val;
    await sb.from('cat_budgets').upsert({ category_id: id, amount: val });
  } else {
    delete catBudgets[id];
    await sb.from('cat_budgets').delete().eq('category_id', id);
  }
  renderAll();
}
window.saveCatBudget = saveCatBudget;

/* ──────────────────────────────────────────────────────
   TRACKER
────────────────────────────────────────────────────── */
function buildMonthTabs() {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const wrap = document.getElementById('monthTabs');
  wrap.innerHTML = '';
  const allTab = document.createElement('button');
  allTab.className = 'month-tab' + (activeMonth === -1 ? ' active' : '');
  allTab.textContent = 'All Year';
  allTab.addEventListener('click', () => setMonth(-1));
  wrap.appendChild(allTab);
  MONTHS.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.className = 'month-tab' + (activeMonth === i ? ' active' : '');
    btn.textContent = m;
    btn.addEventListener('click', () => setMonth(i));
    wrap.appendChild(btn);
  });
}

function setMonth(i) {
  activeMonth = i;
  document.querySelectorAll('.month-tab').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === (i === -1 ? 0 : i + 1));
  });
  renderTracker();
}

function getFilteredExpenses() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const catId  = document.getElementById('filterCategory').value;
  return expenses.filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === activeYear
      && (activeMonth === -1 || d.getMonth() === activeMonth)
      && (!search || e.name.toLowerCase().includes(search))
      && (!catId  || e.categoryId === catId);
  }).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function renderTracker() {
  populateCategoryDropdowns();
  const rows  = getFilteredExpenses();
  const tbody = document.getElementById('expenseTableBody');
  const empty = document.getElementById('emptyState');
  if (rows.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = '';
  } else {
    empty.style.display = 'none';
    tbody.innerHTML = rows.map(e => {
      const cat = categories.find(c => c.id === e.categoryId);
      const catBadge = cat
        ? `<span class="badge" style="background:${hexToRgba(cat.color,.25)};color:${darken(cat.color)}">
             <span class="dot" style="background:${cat.color}"></span>${esc(cat.name)}
           </span>`
        : '<span class="badge" style="background:#eee;color:#888">Uncategorized</span>';
      const dateStr = new Date(e.date + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
      return `
        <tr>
          <td>${dateStr}</td>
          <td>${esc(e.name)}</td>
          <td>${catBadge}</td>
          <td class="amount-cell">${fmt(e.amount)}</td>
          <td>
            <div class="action-btns">
              <button class="btn-icon-sm" onclick="editExpense('${e.id}')" title="Edit">✏️</button>
              <button class="btn-icon-sm" onclick="deleteExpense('${e.id}')" title="Delete">🗑️</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }
  const total = rows.reduce((s, e) => s + e.amount, 0);
  document.getElementById('rowCount').textContent      = rows.length;
  document.getElementById('filteredTotal').textContent = fmt(total);
}

function populateCategoryDropdowns() {
  const filterSel  = document.getElementById('filterCategory');
  const expSel     = document.getElementById('expenseCategory');
  const prevFilter = filterSel.value;
  const prevExp    = expSel.value;
  filterSel.innerHTML = '<option value="">All Categories</option>' +
    categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  filterSel.value = prevFilter;
  expSel.innerHTML = categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  expSel.value = prevExp;
}

/* ──────────────────────────────────────────────────────
   EXPENSE CRUD
────────────────────────────────────────────────────── */
function openExpenseModal(id = null) {
  document.getElementById('expenseId').value        = id || '';
  document.getElementById('modalTitle').textContent = id ? 'Edit Expense' : 'Add Expense';
  populateCategoryDropdowns();
  if (id) {
    const e = expenses.find(x => x.id === id);
    document.getElementById('expenseName').value     = e.name;
    document.getElementById('expenseDate').value     = e.date;
    document.getElementById('expenseCategory').value = e.categoryId;
    document.getElementById('expenseAmount').value   = e.amount;
  } else {
    document.getElementById('expenseName').value     = '';
    document.getElementById('expenseDate').valueAsDate = new Date();
    document.getElementById('expenseCategory').value = categories[0]?.id || '';
    document.getElementById('expenseAmount').value   = '';
  }
  document.getElementById('expenseModal').classList.add('open');
}

function closeExpenseModal() { document.getElementById('expenseModal').classList.remove('open'); }

async function saveExpense() {
  const id     = document.getElementById('expenseId').value;
  const name   = document.getElementById('expenseName').value.trim();
  const date   = document.getElementById('expenseDate').value;
  const catId  = document.getElementById('expenseCategory').value;
  const amount = parseFloat(document.getElementById('expenseAmount').value);

  if (!name)                        return toast('Please enter a name.');
  if (!date)                        return toast('Please pick a date.');
  if (isNaN(amount) || amount <= 0) return toast('Please enter a valid amount.');

  if (id) {
    const idx = expenses.findIndex(e => e.id === id);
    expenses[idx] = { id, name, date, categoryId: catId, amount };
    closeExpenseModal();
    renderAll();
    await sb.from('expenses').update({ name, date, category_id: catId, amount }).eq('id', id);
    toast('Expense updated!');
  } else {
    const newId = uid();
    const entry = { id: newId, name, date, categoryId: catId, amount };
    expenses.push(entry);
    closeExpenseModal();
    renderAll();
    await sb.from('expenses').insert(expToDb(entry));
    toast('Expense added!');
  }
}

async function editExpense(id) { openExpenseModal(id); }

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  expenses = expenses.filter(e => e.id !== id);
  renderAll();
  await sb.from('expenses').delete().eq('id', id);
  toast('Expense deleted.');
}

window.editExpense   = editExpense;
window.deleteExpense = deleteExpense;

/* ──────────────────────────────────────────────────────
   CATEGORY CRUD
────────────────────────────────────────────────────── */
function openCatModal()  { renderCatList(); resetCatForm(); document.getElementById('catModal').classList.add('open'); }
function closeCatModal() { document.getElementById('catModal').classList.remove('open'); }

function renderCatList() {
  document.getElementById('catList').innerHTML = categories.map(c => `
    <li class="cat-list-item">
      <span class="cat-chip" style="background:${c.color};width:18px;height:18px;border-radius:50%;display:inline-block"></span>
      <span class="cat-name">${esc(c.name)}</span>
      <div class="cat-actions">
        <button class="btn-icon-sm" onclick="startEditCat('${c.id}')" title="Edit">✏️</button>
        <button class="btn-icon-sm" onclick="deleteCat('${c.id}')" title="Delete">🗑️</button>
      </div>
    </li>`).join('');
}

function resetCatForm() {
  document.getElementById('editCatId').value     = '';
  document.getElementById('catNameInput').value  = '';
  document.getElementById('catColorInput').value = '#B8DDED';
  document.getElementById('cancelCatEdit').style.display = 'none';
}

function startEditCat(id) {
  const c = categories.find(x => x.id === id);
  document.getElementById('editCatId').value     = id;
  document.getElementById('catNameInput').value  = c.name;
  document.getElementById('catColorInput').value = c.color;
  document.getElementById('cancelCatEdit').style.display = '';
}
window.startEditCat = startEditCat;

async function saveCat() {
  const id    = document.getElementById('editCatId').value;
  const name  = document.getElementById('catNameInput').value.trim();
  const color = document.getElementById('catColorInput').value;
  if (!name) return toast('Enter a category name.');

  if (id) {
    const idx = categories.findIndex(c => c.id === id);
    categories[idx] = { id, name, color };
    await sb.from('categories').update({ name, color }).eq('id', id);
  } else {
    const newCat = { id: uid(), name, color };
    categories.push(newCat);
    await sb.from('categories').insert(newCat);
  }
  resetCatForm();
  renderCatList();
  renderAll();
}

async function deleteCat(id) {
  if (!confirm('Delete this category? Expenses in it will become uncategorized.')) return;
  categories = categories.filter(c => c.id !== id);
  expenses.forEach(e => { if (e.categoryId === id) e.categoryId = ''; });
  renderCatList();
  renderAll();
  await sb.from('categories').delete().eq('id', id);
  await sb.from('expenses').update({ category_id: '' }).eq('category_id', id);
}
window.deleteCat = deleteCat;

/* ──────────────────────────────────────────────────────
   EVENT BINDINGS
────────────────────────────────────────────────────── */
function bindEvents() {
  document.getElementById('openAddExpense').addEventListener('click',  () => openExpenseModal());
  document.getElementById('closeExpenseModal').addEventListener('click', closeExpenseModal);
  document.getElementById('cancelExpense').addEventListener('click',   closeExpenseModal);
  document.getElementById('saveExpense').addEventListener('click',     saveExpense);
  document.getElementById('openNewCat').addEventListener('click', () => { closeExpenseModal(); openCatModal(); });

  document.getElementById('openCatManager').addEventListener('click', openCatModal);
  document.getElementById('closeCatModal').addEventListener('click',  closeCatModal);
  document.getElementById('saveCat').addEventListener('click',        saveCat);
  document.getElementById('cancelCatEdit').addEventListener('click',  resetCatForm);

  document.getElementById('saveIncome').addEventListener('click', addIncome);

  document.getElementById('bdgPrevMonth').addEventListener('click', () => {
    bdgMonth--; if (bdgMonth < 0)  { bdgMonth = 11; bdgYear--; } renderBudget();
  });
  document.getElementById('bdgNextMonth').addEventListener('click', () => {
    bdgMonth++; if (bdgMonth > 11) { bdgMonth = 0;  bdgYear++; } renderBudget();
  });

  document.getElementById('searchInput').addEventListener('input',    renderTracker);
  document.getElementById('filterCategory').addEventListener('change', renderTracker);

  document.getElementById('expenseModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeExpenseModal(); });
  document.getElementById('catModal').addEventListener('click',     e => { if (e.target === e.currentTarget) closeCatModal(); });

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      document.querySelector(link.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth' });
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });
}

/* ──────────────────────────────────────────────────────
   HELPERS
────────────────────────────────────────────────────── */
function groupByCategory(list) {
  return list.reduce((acc, e) => { acc[e.categoryId] = (acc[e.categoryId] || 0) + e.amount; return acc; }, {});
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function darken(hex) {
  const r = Math.max(0, parseInt(hex.slice(1,3),16)-60);
  const g = Math.max(0, parseInt(hex.slice(3,5),16)-60);
  const b = Math.max(0, parseInt(hex.slice(5,7),16)-60);
  return `rgb(${r},${g},${b})`;
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer = null;
function toast(msg) {
  let el = document.querySelector('.toast');
  if (el) el.remove();
  if (toastTimer) clearTimeout(toastTimer);
  el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  toastTimer = setTimeout(() => el.remove(), 2800);
}
