/**
 * SpendGuard — Transactions & Categorization Controller (Module 3)
 * Search, category filters, inline editing, bulk propagation, and custom rules.
 */

document.addEventListener('DOMContentLoaded', async () => {
  if (!api.isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }

  // Logout handler
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    api.auth.logout();
  });

  // State
  let categories = [];
  let currentPage = 1;
  const limit = 15;
  let activeCategory = 'All';
  let isNeedsReviewOnly = false;
  let searchDebounceTimeout = null;

  // DOM Elements
  const tabTransactions = document.getElementById('tab-transactions');
  const tabRules = document.getElementById('tab-rules');
  const viewTxnsContainer = document.getElementById('view-transactions-container');
  const viewRulesContainer = document.getElementById('view-rules-container');

  const searchInput = document.getElementById('search-input');
  const startDateInput = document.getElementById('start-date-input');
  const endDateInput = document.getElementById('end-date-input');
  const categoryPillsContainer = document.getElementById('category-pills-container');
  const toggleNeedsReviewBtn = document.getElementById('toggle-needs-review-btn');
  const txnsTbody = document.getElementById('transactions-tbody');

  const prevPageBtn = document.getElementById('prev-page-btn');
  const nextPageBtn = document.getElementById('next-page-btn');
  const pageIndicator = document.getElementById('page-indicator');
  const pagFrom = document.getElementById('pag-from');
  const pagTo = document.getElementById('pag-to');
  const pagTotal = document.getElementById('pag-total');

  // Edit Modal Elements
  const editModal = document.getElementById('edit-txn-modal');
  const closeEditModalBtn = document.getElementById('close-edit-modal-btn');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const saveEditBtn = document.getElementById('save-edit-btn');
  const modalRawDesc = document.getElementById('modal-raw-desc');
  const modalTxnId = document.getElementById('modal-txn-id');
  const modalMerchantInput = document.getElementById('modal-merchant-input');
  const modalCategorySelect = document.getElementById('modal-category-select');
  const modalApplyMatchingCheckbox = document.getElementById('modal-apply-matching-checkbox');

  // Rules Form Elements
  const createRuleForm = document.getElementById('create-rule-form');
  const rulePatternInput = document.getElementById('rule-pattern');
  const ruleMerchantInput = document.getElementById('rule-merchant');
  const ruleCategorySelect = document.getElementById('rule-category');
  const rulesTbody = document.getElementById('rules-tbody');

  // -----------------------------------------------------------------
  // 1. Initialize Categories & Dropdowns
  // -----------------------------------------------------------------
  try {
    const catRes = await api.transactions.getCategories();
    categories = catRes.categories || [];

    // Populate category pills (excluding All and Review button)
    categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'category-pill';
      btn.setAttribute('data-category', cat);
      btn.textContent = cat;
      btn.addEventListener('click', () => {
        setCategoryFilter(cat);
      });
      categoryPillsContainer.insertBefore(btn, toggleNeedsReviewBtn);
    });

    // Populate Selects
    [modalCategorySelect, ruleCategorySelect].forEach(select => {
      select.innerHTML = '';
      categories.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
      });
    });

  } catch (err) {
    console.error('Failed to load categories:', err);
  }

  // -----------------------------------------------------------------
  // 2. Tab Switcher
  // -----------------------------------------------------------------
  tabTransactions.addEventListener('click', () => {
    tabTransactions.classList.add('active');
    tabRules.classList.remove('active');
    viewTxnsContainer.style.display = 'block';
    viewRulesContainer.classList.remove('active');
    loadTransactions();
  });

  tabRules.addEventListener('click', () => {
    tabRules.classList.add('active');
    tabTransactions.classList.remove('active');
    viewTxnsContainer.style.display = 'none';
    viewRulesContainer.classList.add('active');
    loadRules();
  });

  // -----------------------------------------------------------------
  // 3. Search & Filter Handlers
  // -----------------------------------------------------------------
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      currentPage = 1;
      loadTransactions();
    }, 300);
  });

  [startDateInput, endDateInput].forEach(inp => {
    inp.addEventListener('change', () => {
      currentPage = 1;
      loadTransactions();
    });
  });

  // Category pill click handler for "All"
  document.querySelector('.category-pill[data-category="All"]').addEventListener('click', () => {
    setCategoryFilter('All');
  });

  function setCategoryFilter(cat) {
    activeCategory = cat;
    document.querySelectorAll('.category-pill').forEach(pill => {
      if (pill.getAttribute('data-category') === cat) {
        pill.classList.add('active');
      } else {
        pill.classList.remove('active');
      }
    });
    currentPage = 1;
    loadTransactions();
  }

  toggleNeedsReviewBtn.addEventListener('click', () => {
    isNeedsReviewOnly = !isNeedsReviewOnly;
    toggleNeedsReviewBtn.classList.toggle('active', isNeedsReviewOnly);
    currentPage = 1;
    loadTransactions();
  });

  // -----------------------------------------------------------------
  // 4. Load & Render Transactions
  // -----------------------------------------------------------------
  async function loadTransactions() {
    txnsTbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 36px;">
          <div class="spinner" style="margin: 0 auto 8px;"></div>
          <span>Loading transactions...</span>
        </td>
      </tr>
    `;

    try {
      const data = await api.transactions.list({
        page: currentPage,
        limit,
        search: searchInput.value.trim(),
        category: activeCategory,
        needsReview: isNeedsReviewOnly ? '1' : undefined,
        startDate: startDateInput.value,
        endDate: endDateInput.value
      });

      const txns = data.transactions || [];
      const pag = data.pagination || { total: 0, totalPages: 1 };

      // Update Pagination UI
      pagTotal.textContent = pag.total;
      pagFrom.textContent = pag.total > 0 ? (currentPage - 1) * limit + 1 : 0;
      pagTo.textContent = Math.min(currentPage * limit, pag.total);
      pageIndicator.textContent = `Page ${currentPage} of ${pag.totalPages}`;
      prevPageBtn.disabled = currentPage <= 1;
      nextPageBtn.disabled = currentPage >= pag.totalPages;

      // Update Needs Review Count badge
      const reviewQuery = await api.transactions.list({ limit: 1, needsReview: '1' });
      document.getElementById('needs-review-count').textContent = reviewQuery.pagination?.total || 0;

      if (txns.length === 0) {
        txnsTbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 36px;">
              No transactions found matching the selected filters.
            </td>
          </tr>
        `;
        return;
      }

      txnsTbody.innerHTML = '';
      txns.forEach(t => {
        const tr = document.createElement('tr');
        const formattedAmt = Number(t.amount).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });

        const reviewBadgeHtml = t.needs_review === 1
          ? `<span class="badge-needs-review" title="Flagged for user review">⚠️ Review</span>`
          : '';

        tr.innerHTML = `
          <td style="color: var(--text-secondary);">${t.date}</td>
          <td style="font-weight: 700;">
            ${t.merchant}
            ${reviewBadgeHtml}
          </td>
          <td class="narration-cell" title="${t.original_description}">${t.original_description}</td>
          <td>
            <span class="badge-cat badge-cat-${t.category}">
              ${t.category}
            </span>
          </td>
          <td class="amount-cell" style="text-align: right;">₹${formattedAmt}</td>
          <td style="text-align: center;">
            <button class="btn btn-outline btn-sm edit-txn-btn" style="padding: 4px 10px; font-size: 0.78rem;">
              Edit
            </button>
          </td>
        `;

        // Attach edit listener
        const editBtn = tr.querySelector('.edit-txn-btn');
        editBtn.addEventListener('click', () => {
          openEditModal(t);
        });

        txnsTbody.appendChild(tr);
      });

    } catch (err) {
      txnsTbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--danger); padding: 24px;">
            Failed to load transactions: ${err.message}
          </td>
        </tr>
      `;
    }
  }

  // Pagination navigation
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      loadTransactions();
    }
  });

  nextPageBtn.addEventListener('click', () => {
    currentPage++;
    loadTransactions();
  });

  // -----------------------------------------------------------------
  // 5. Edit Transaction Modal Handlers (EC-3.9)
  // -----------------------------------------------------------------
  function openEditModal(txn) {
    modalTxnId.value = txn.id;
    modalRawDesc.textContent = txn.original_description;
    modalMerchantInput.value = txn.merchant;
    modalCategorySelect.value = txn.category;
    modalApplyMatchingCheckbox.checked = false;
    editModal.classList.add('active');
  }

  function closeEditModal() {
    editModal.classList.remove('active');
  }

  closeEditModalBtn.addEventListener('click', closeEditModal);
  cancelEditBtn.addEventListener('click', closeEditModal);

  saveEditBtn.addEventListener('click', async () => {
    const id = modalTxnId.value;
    const newMerchant = modalMerchantInput.value.trim();
    const newCategory = modalCategorySelect.value;
    const applyToMatching = modalApplyMatchingCheckbox.checked;

    if (!newMerchant) {
      api.showToast('Merchant name is required', 'error');
      return;
    }

    saveEditBtn.disabled = true;
    saveEditBtn.textContent = 'Saving...';

    try {
      await api.transactions.update(id, {
        merchant: newMerchant,
        category: newCategory,
        applyToMatching,
        createRule: applyToMatching
      });

      api.showToast(
        applyToMatching
          ? 'Transaction updated & rule applied to matching records!'
          : 'Transaction updated successfully!',
        'success'
      );

      closeEditModal();
      loadTransactions();

    } catch (err) {
      api.showToast(err.message || 'Failed to update transaction', 'error');
    } finally {
      saveEditBtn.disabled = false;
      saveEditBtn.textContent = 'Save Changes';
    }
  });

  // -----------------------------------------------------------------
  // 6. Custom Rules Management Handlers (EC-3.8)
  // -----------------------------------------------------------------
  async function loadRules() {
    rulesTbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">
          <div class="spinner" style="margin: 0 auto 8px;"></div>
          <span>Loading rules...</span>
        </td>
      </tr>
    `;

    try {
      const data = await api.rules.list();
      const rules = data.rules || [];

      if (rules.length === 0) {
        rulesTbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
              No custom rules found. Add one above to automatically classify specific merchants.
            </td>
          </tr>
        `;
        return;
      }

      rulesTbody.innerHTML = '';
      rules.forEach(r => {
        const tr = document.createElement('tr');
        const dt = new Date(r.created_at).toLocaleDateString('en-IN', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });

        tr.innerHTML = `
          <td style="color: var(--primary); font-family: monospace;">#${r.id}</td>
          <td style="font-weight: 600; font-family: monospace; color: #fde68a;">"${r.pattern}"</td>
          <td style="font-weight: 700;">${r.canonical_merchant}</td>
          <td>
            <span class="badge-cat badge-cat-${r.category}">
              ${r.category}
            </span>
          </td>
          <td style="color: var(--text-muted);">${dt}</td>
          <td style="text-align: center;">
            <button class="btn btn-danger btn-sm delete-rule-btn" style="padding: 4px 10px; font-size: 0.76rem;">
              Delete
            </button>
          </td>
        `;

        const delBtn = tr.querySelector('.delete-rule-btn');
        delBtn.addEventListener('click', async () => {
          if (confirm(`Delete rule for pattern "${r.pattern}"?`)) {
            try {
              await api.rules.delete(r.id);
              api.showToast('Rule deleted successfully', 'info');
              loadRules();
            } catch (delErr) {
              api.showToast(delErr.message, 'error');
            }
          }
        });

        rulesTbody.appendChild(tr);
      });

    } catch (err) {
      rulesTbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--danger); padding: 24px;">
            Failed to load rules: ${err.message}
          </td>
        </tr>
      `;
    }
  }

  createRuleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pattern = rulePatternInput.value.trim();
    const merchant = ruleMerchantInput.value.trim();
    const category = ruleCategorySelect.value;

    if (!pattern || !merchant) {
      api.showToast('Please provide both pattern and canonical merchant name', 'error');
      return;
    }

    try {
      await api.rules.create(pattern, merchant, category);
      api.showToast('Custom merchant rule created successfully!', 'success');
      rulePatternInput.value = '';
      ruleMerchantInput.value = '';
      loadRules();
    } catch (err) {
      api.showToast(err.message || 'Failed to create rule', 'error');
    }
  });

  // Initial load
  loadTransactions();
});
