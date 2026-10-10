/**
 * SpendGuard — CSV Ingestion Controller (Module 2)
 * Handles file dropzone, mapping preview, processing commit, and history logs.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Ensure user is authenticated
  if (!api.isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }

  // Setup logout
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    api.auth.logout();
  });

  // State
  let currentFile = null;
  let previewData = null;

  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const browseBtn = document.getElementById('browse-btn');
  const loadSampleBtn = document.getElementById('load-sample-btn');

  const uploadSection = document.getElementById('upload-section');
  const mappingSection = document.getElementById('mapping-section');
  const summarySection = document.getElementById('summary-section');

  const step1 = document.getElementById('step-1-indicator');
  const step2 = document.getElementById('step-2-indicator');
  const step3 = document.getElementById('step-3-indicator');

  const selectDateCol = document.getElementById('select-date-col');
  const selectDescCol = document.getElementById('select-desc-col');
  const selectAmtCol = document.getElementById('select-amt-col');
  const selectDateFormat = document.getElementById('select-date-format');

  const confirmBtn = document.getElementById('confirm-import-btn');
  const cancelBtn = document.getElementById('cancel-mapping-btn');
  const importAnotherBtn = document.getElementById('import-another-btn');

  // Load initial history log
  loadHistoryLogs();

  // -----------------------------------------------------------------
  // Drag & Drop Handlers
  // -----------------------------------------------------------------
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleFileSelected(files[0]);
    }
  });

  browseBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0]);
    }
  });

  // -----------------------------------------------------------------
  // Sample Bank CSV Generator for Quick Testing
  // -----------------------------------------------------------------
  loadSampleBtn.addEventListener('click', () => {
    const sampleCsvContent = `Account Number: 5010049281729
Customer Name: Rohan Verma
Statement Period: 01/08/2026 to 05/10/2026
Branch: Indiranagar, Bengaluru

Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
05/08/2026,UPI/524312/NETFLIX COM/POS 8007,REF001,05/08/2026,649.00,,42350.00
10/08/2026,SWIGGY BANGALORE IN 9931,REF002,10/08/2026,450.00,,41900.00
15/08/2026,SALARY CREDIT AUG 2026,REF003,15/08/2026,,85000.00,126900.00
20/08/2026,ACH WDL SPOTIFY INDIA,REF004,20/08/2026,119.00,,126781.00
25/08/2026,UPI/UBER TRIPS/150,REF005,25/08/2026,150.00,,126631.00
25/08/2026,UPI/UBER TRIPS/150,REF006,25/08/2026,150.00,,126481.00
05/09/2026,UPI/524312/NETFLIX COM/POS 8007,REF007,05/09/2026,649.00,,125832.00
20/09/2026,ACH WDL SPOTIFY INDIA,REF008,20/09/2026,119.00,,125713.00
05/10/2026,UPI/524312/NETFLIX COM/POS 8007,REF009,05/10/2026,649.00,,125064.00
31/02/2026,MALFORMED DATE RECORD,REF010,31/02/2026,500.00,,124564.00
`;

    const blob = new Blob([sampleCsvContent], { type: 'text/csv' });
    const sampleFile = new File([blob], 'hdfc_sample_statement.csv', { type: 'text/csv' });
    handleFileSelected(sampleFile);
  });

  // -----------------------------------------------------------------
  // File Preview Handler
  // -----------------------------------------------------------------
  async function handleFileSelected(file) {
    if (!file.name.toLowerCase().endsWith('.csv') && !file.type.includes('csv') && !file.type.includes('text')) {
      api.showToast('Please upload a valid .csv file.', 'error');
      return;
    }

    currentFile = file;
    browseBtn.disabled = true;
    browseBtn.textContent = 'Analyzing CSV...';

    try {
      previewData = await api.import.preview(file);

      // Transition to Step 2
      uploadSection.style.display = 'none';
      mappingSection.classList.add('active');

      step1.classList.remove('active');
      step1.classList.add('completed');
      step2.classList.add('active');

      document.getElementById('active-filename').textContent = previewData.filename;
      document.getElementById('active-delimiter').textContent = `Delimiter: ${previewData.delimiter === '\t' ? 'Tab' : previewData.delimiter}`;

      // Populate Dropdowns
      populateDropdown(selectDateCol, previewData.headers, previewData.suggestedMapping.date);
      populateDropdown(selectDescCol, previewData.headers, previewData.suggestedMapping.description);
      populateDropdown(selectAmtCol, previewData.headers, previewData.suggestedMapping.amount);

      if (previewData.detectedDateFormat) {
        selectDateFormat.value = previewData.detectedDateFormat;
      }

      // Render Preview Table
      renderPreviewTable(previewData.headers, previewData.previewRows);

      api.showToast('CSV analyzed successfully. Please review column mappings.', 'info');
    } catch (err) {
      api.showToast(err.message || 'Error parsing CSV file', 'error');
    } finally {
      browseBtn.disabled = false;
      browseBtn.textContent = 'Browse Computer';
    }
  }

  function populateDropdown(selectElem, headers, preselected) {
    selectElem.innerHTML = '';
    headers.forEach(h => {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      if (h === preselected) {
        opt.selected = true;
      }
      selectElem.appendChild(opt);
    });
  }

  function renderPreviewTable(headers, rows) {
    const thead = document.getElementById('preview-thead');
    const tbody = document.getElementById('preview-tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    document.getElementById('preview-count').textContent = `${rows.length} Rows Sample`;

    const trHead = document.createElement('tr');
    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    rows.forEach(row => {
      const tr = document.createElement('tr');
      headers.forEach(h => {
        const td = document.createElement('td');
        td.textContent = row[h] || '';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  // Cancel mapping
  cancelBtn.addEventListener('click', () => {
    resetToUpload();
  });

  // -----------------------------------------------------------------
  // Process Import Commit Handler
  // -----------------------------------------------------------------
  confirmBtn.addEventListener('click', async () => {
    if (!currentFile) return;

    const columnMapping = {
      date: selectDateCol.value,
      description: selectDescCol.value,
      amount: selectAmtCol.value
    };

    const dateFormat = selectDateFormat.value;

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = `<div class="spinner"></div> <span>Ingesting Transactions...</span>`;

    try {
      const result = await api.import.process(currentFile, columnMapping, dateFormat);

      // Transition to Step 3
      mappingSection.classList.remove('active');
      summarySection.style.display = 'block';

      step2.classList.remove('active');
      step2.classList.add('completed');
      step3.classList.add('active');
      step3.classList.add('completed');

      // Populate summary metrics
      document.getElementById('sum-total').textContent = result.summary.total;
      document.getElementById('sum-imported').textContent = result.summary.imported;
      document.getElementById('sum-duplicates').textContent = result.summary.duplicates;
      document.getElementById('sum-skipped-credits').textContent = result.summary.skippedCredits;
      document.getElementById('sum-errors').textContent = result.summary.errors;

      // Render Error Rows (if any)
      const errorBox = document.getElementById('error-rows-container');
      const errorList = document.getElementById('error-list');
      errorList.innerHTML = '';

      if (result.errorRows && result.errorRows.length > 0) {
        document.getElementById('error-count-badge').textContent = result.errorRows.length;
        errorBox.style.display = 'block';

        result.errorRows.forEach(err => {
          const item = document.createElement('div');
          item.textContent = `Row ${err.row}: ${err.reason}`;
          errorList.appendChild(item);
        });
      } else {
        errorBox.style.display = 'none';
      }

      api.showToast(`Import completed! ${result.summary.imported} transactions ingested.`, 'success');

      // Refresh upload logs
      loadHistoryLogs();

    } catch (err) {
      api.showToast(err.message || 'Import process failed', 'error');
    } finally {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm & Ingest Transactions';
    }
  });

  // Upload Another
  importAnotherBtn.addEventListener('click', () => {
    resetToUpload();
  });

  function resetToUpload() {
    currentFile = null;
    previewData = null;
    fileInput.value = '';

    uploadSection.style.display = 'block';
    mappingSection.classList.remove('active');
    summarySection.style.display = 'none';

    step1.className = 'step-item active';
    step2.className = 'step-item';
    step3.className = 'step-item';
  }

  // -----------------------------------------------------------------
  // Load Upload History Logs
  // -----------------------------------------------------------------
  async function loadHistoryLogs() {
    try {
      const data = await api.import.getHistory(10);
      const tbody = document.getElementById('history-tbody');
      tbody.innerHTML = '';

      if (!data.batches || data.batches.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">
              No statements imported yet.
            </td>
          </tr>
        `;
        return;
      }

      data.batches.forEach(b => {
        const tr = document.createElement('tr');
        const dt = new Date(b.created_at).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short'
        });

        tr.innerHTML = `
          <td style="font-family: monospace; color: var(--primary);">#${b.id}</td>
          <td style="font-weight: 600;">${b.filename}</td>
          <td style="color: var(--text-secondary);">${dt}</td>
          <td>${b.total_rows}</td>
          <td style="color: var(--success); font-weight: 600;">${b.imported_count}</td>
          <td style="color: var(--warning);">${b.duplicate_count}</td>
          <td style="color: ${b.error_count > 0 ? 'var(--danger)' : 'var(--text-muted)'};">${b.error_count}</td>
          <td>
            <span class="badge ${b.error_count === 0 ? 'badge-success' : 'badge-warning'}">
              ${b.error_count === 0 ? 'Success' : 'Partial'}
            </span>
          </td>
        `;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  }
});
