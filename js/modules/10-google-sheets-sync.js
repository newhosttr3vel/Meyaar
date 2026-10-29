function sameRemoteCore(tx, remote) {
  return normalizeGoogleDate(tx.date) === normalizeGoogleDate(remote.date) &&
    String(tx.type || '').trim() === String(remote.type || '').trim() &&
    String(tx.cat || '').trim() === String(remote.cat || '').trim() &&
    Number.isFinite(Number(tx.amt)) &&
    Math.abs(Number(tx.amt) - Number(remote.amt)) < 0.005;
}

function pendingTransactionKey(tx) {
  return [
    String(tx.id ?? ''),
    normalizeGoogleDate(tx.date),
    String(tx.type || ''),
    String(Number(tx.amt) || 0),
    String(tx.cat || ''),
    googleNotes(tx)
  ].join('|');
}

function pendingTransactions() {
  return Array.isArray(S.pendingLocalTx) ? S.pendingLocalTx : [];
}

async function syncPendingTransactionsToGoogle() {
  if (!googleTransactionsLoaded) {
    alert('لا توجد قراءة مؤكدة من Google Sheets حتى الآن. أعد تحميل الصفحة ثم حاول مرة أخرى.');
    return;
  }

  const pending = pendingTransactions();
  if (!pending.length) {
    alert('لا توجد معاملات محلية معلقة خارج Google Sheets.');
    return;
  }

  const safeToUpload = pending.filter(tx =>
    !googleRemoteTransactions.some(remote => sameRemoteCore(tx, remote))
  );
  const ambiguous = pending.length - safeToUpload.length;

  const confirmed = confirm(
    'يوجد ' + pending.length + ' معاملة محلية لا تظهر في بيانات Google الحالية.\\n' +
    'سيتم رفع ' + safeToUpload.length + ' معاملة فقط إذا لم يوجد صف سحابي له نفس التاريخ والنوع والمبلغ والتصنيف.\\n' +
    'سيتم ترك ' + ambiguous + ' معاملة للمراجعة بدل إنشاء تكرار محتمل.\\n\\n' +
    'تأكد أنك على الجهاز الذي يحتوي على البيانات الصحيحة. متابعة؟'
  );
  if (!confirmed) return;

  let uploaded = 0;
  const failures = [];

  for (const tx of safeToUpload) {
    try {
      await saveTransactionToGoogle(tx);
      tx.googleSynced = true;
      S.tx.push(tx);
      S.pendingLocalTx = pendingTransactions().filter(
        item => pendingTransactionKey(item) !== pendingTransactionKey(tx)
      );
      googleRemoteTransactions.push({
        date: normalizeGoogleDate(tx.date),
        type: tx.type,
        amt: Number(tx.amt),
        cat: tx.cat,
        notes: googleNotes(tx)
      });
      save();
      uploaded++;
    } catch (error) {
      failures.push(
        (tx.name || tx.note || ('معاملة #' + tx.id)) + ': ' +
        (error && error.message ? error.message : String(error))
      );
    }
  }

  await loadDataFromGoogle({ renderAfter: false });
  render();

  const lines = [
    'انتهت محاولة توحيد المعاملات.',
    'تم رفع: ' + uploaded,
    'تحتاج مراجعة لأن لها معاملة مشابهة في Google: ' + ambiguous,
    'فشل رفع: ' + failures.length
  ];
  if (failures.length) lines.push('', 'الأخطاء:', ...failures.slice(0, 5));
  alert(lines.join('\\n'));
}

// Google currently stores only Date, Type, Amount, Category and Notes.
// Merge those rows into local records instead of replacing richer local records with partial data.
async function loadDataFromGoogle({ renderAfter = true } = {}) {
  try {
    const response = await fetch(API_URL, { method: 'GET', cache: 'no-store' });
    if (!response.ok) throw new Error('Google Sheets HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(data && (data.message || data.error) || 'صيغة البيانات القادمة من Google Sheets غير صحيحة');
    }

    const firstRow = Array.isArray(data[0]) ? data[0].map(v => String(v || '').trim().toLowerCase()) : [];
    const hasHeaders = firstRow.includes('date') && firstRow.includes('type') &&
      firstRow.includes('amount') && firstRow.includes('category');
    const hasFullSchema = ['account', 'payment', 'currency', 'fee', 'assetcode', 'quantity', 'price']
      .every(header => firstRow.includes(header));
    const rows = data.slice(hasHeaders ? 1 : 0).filter(row =>
      Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== '')
    );
    const localPool = S.tx.map(tx => ({ tx, used: false }));
    const imported = [];
    const usedIds = new Set(S.tx.map(tx => String(tx.id)));
    let nextId = Math.max(0, ...S.tx.map(tx => Number(tx.id) || 0)) + 1;
    const allocateId = () => {
      while (usedIds.has(String(nextId))) nextId++;
      const id = nextId++;
      usedIds.add(String(id));
      return id;
    };

    rows.forEach(row => {
      const date = normalizeGoogleDate(row[0]);
      const type = String(row[1] || 'مصروف').trim();
      const amount = Number(row[2]);
      const cat = String(row[3] || 'أخرى').trim();
      const notes = String(row[4] || '').trim();
      if (!isValidISODate(date) || !Number.isFinite(amount) || amount <= 0) return;

      const transferMeta = parseTransferCloudNote(notes);
      const recurringMeta = parseRecurringCloudNote(notes);
      const remote = { date, type, amt: amount, cat, notes };
      let match = localPool.find(item => !item.used && sameRemoteCore(item.tx, remote) && googleNotes(item.tx) === notes);
      if (!match) {
        const candidates = localPool.filter(item => !item.used && sameRemoteCore(item.tx, remote));
        if (candidates.length === 1) match = candidates[0];
      }

      const remoteDetails = {
        // Blank cells in legacy rows must not erase richer details held on the primary device.
        acc: hasFullSchema ? String(row[5] || '') : '',
        pay: hasFullSchema ? String(row[6] || '') : '',
        cur: hasFullSchema ? String(row[7] || '') : '',
        fee: hasFullSchema ? numericCell(row[8], '') : '',
        code: hasFullSchema ? String(row[9] || '') : '',
        qty: hasFullSchema ? numericCell(row[10], '') : '',
        price: hasFullSchema ? numericCell(row[11], '') : ''
      };

      if (match) {
        match.used = true;
        const tx = { ...match.tx, date, type, amt: amount, cat, googleNotes: notes };
        const previousNotes = googleNotes(match.tx);
        if (previousNotes !== notes) {
          if (!match.tx.name || match.tx.name === previousNotes) tx.name = notes;
          if (!match.tx.note || match.tx.note === previousNotes) tx.note = notes;
        }
        if (hasFullSchema) {
          // Empty sheet cells may be legacy blanks; don't destroy richer local values during migration.
          tx.acc = remoteDetails.acc || match.tx.acc || 'CASH';
          tx.pay = remoteDetails.pay || match.tx.pay || 'نقدي';
          tx.cur = remoteDetails.cur || match.tx.cur || 'EGP';
          tx.fee = row[8] === '' || row[8] === null || row[8] === undefined ? fee(match.tx) : remoteDetails.fee;
          tx.code = remoteDetails.code || match.tx.code || '';
          tx.qty = remoteDetails.qty === '' ? (match.tx.qty ?? '') : remoteDetails.qty;
          tx.price = remoteDetails.price === '' ? (match.tx.price ?? '') : remoteDetails.price;
        } else {
          tx.acc = match.tx.acc || 'CASH';
          tx.pay = match.tx.pay || 'نقدي';
          tx.cur = match.tx.cur || 'EGP';
          tx.fee = fee(match.tx);
          tx.code = match.tx.code || '';
          tx.qty = match.tx.qty ?? '';
          tx.price = match.tx.price ?? '';
        }
        if (transferMeta) {
          tx.transferId = transferMeta.id;
          tx.transferFrom = transferMeta.from;
          tx.transferTo = transferMeta.to;
          tx.transferNote = transferMeta.note;
          tx.note = transferMeta.note;
          tx.name = transferDisplayName(type, transferMeta);
        }
        if (recurringMeta) {
          tx.recurringId = recurringMeta.id;
          tx.recurringDate = recurringMeta.date;
          tx.recurringNote = recurringMeta.note;
          tx.note = recurringMeta.note;
          tx.name = recurringMeta.name;
        }
        tx.googleSynced = true;
        imported.push(tx);
      } else {
        imported.push({
          id: allocateId(), date, type, amt: amount, cat,
          note: recurringMeta ? recurringMeta.note : (transferMeta ? transferMeta.note : notes),
          googleNotes: notes, googleSynced: true,
          name: recurringMeta ? recurringMeta.name : (transferMeta ? transferDisplayName(type, transferMeta) : (notes || 'معاملة من Google Sheets')),
          transferId: transferMeta ? transferMeta.id : '',
          transferFrom: transferMeta ? transferMeta.from : '',
          transferTo: transferMeta ? transferMeta.to : '',
          transferNote: transferMeta ? transferMeta.note : '',
          recurringId: recurringMeta ? recurringMeta.id : '',
          recurringDate: recurringMeta ? recurringMeta.date : '',
          recurringNote: recurringMeta ? recurringMeta.note : '',
          fee: hasFullSchema ? remoteDetails.fee : 0,
          pay: hasFullSchema ? remoteDetails.pay : 'نقدي',
          acc: hasFullSchema ? remoteDetails.acc : 'CASH',
          code: hasFullSchema ? remoteDetails.code : '',
          qty: hasFullSchema ? remoteDetails.qty : '',
          price: hasFullSchema ? remoteDetails.price : '',
          sub: '', cur: hasFullSchema ? remoteDetails.cur : 'EGP'
        });
      }
    });

    // Retain never-synced local transactions for safety. Previously synced rows missing from
    // Google are removed locally so deletions propagate to other devices.
    googleRemoteTransactions = rows
      .map(row => ({
        date: normalizeGoogleDate(row[0]),
        type: String(row[1] || 'مصروف').trim(),
        amt: Number(row[2]),
        cat: String(row[3] || 'أخرى').trim(),
        notes: String(row[4] || '').trim()
      }))
      .filter(row => isValidISODate(row.date) && Number.isFinite(row.amt) && row.amt > 0);
    googleTransactionsLoaded = true;

    // Make Google Sheets the canonical dataset for calculations on every device.
    // Keep unsynced local-only rows separately for explicit, duplicate-safe reconciliation.
    const localOnly = localPool
      .filter(item => !item.used && !item.tx.googleSynced)
      .map(item => ({ ...item.tx, googleSynced: false }));
    const existingPending = pendingTransactions();
    const pendingByKey = new Map();
    [...existingPending, ...localOnly].forEach(tx => {
      pendingByKey.set(pendingTransactionKey(tx), tx);
    });
    S.pendingLocalTx = [...pendingByKey.values()];
    S.tx = imported;
    // Rebuild the generation ledger from sheet markers if saving shared settings was interrupted.
    S.tx.forEach(tx => {
      const meta = parseRecurringCloudNote(googleNotes(tx));
      if (meta) markOccurrenceGenerated(meta.id, meta.date, String(tx.id));
    });
    save();
  } catch (error) {
    googleTransactionsLoaded = false;
    console.error('تعذر تحميل المعاملات من Google Sheets:', error);
  } finally {
    if (renderAfter && typeof render === 'function') render();
  }
}

async function postGooglePayload(payload) {
  const response = await fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }
  });
  if (!response.ok) throw new Error(`Google Sheets HTTP ${response.status}`);
  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch (_) {
    const preview = String(raw || '').replace(/\s+/g, ' ').slice(0, 180);
    throw new Error('استجابة Google Sheets ليست JSON صالحة' + (preview ? ': ' + preview : ''));
  }
  if (result && (result.status === 'error' || result.success === false)) {
    throw new Error(result.message || result.error || 'رفض Google Sheets العملية');
  }
  return result;
}

async function loadSharedSettingsFromGoogle({ renderAfter = true } = {}) {
  try {
    const response = await fetch(API_URL + '?action=state&_=' + Date.now(), {
      method: 'GET',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('Google Sheets HTTP ' + response.status);
    const result = await response.json();

    // Older Apps Script deployments return the transaction array for every GET.
    if (!result || Array.isArray(result) || result.success === false ||
        !Object.prototype.hasOwnProperty.call(result, 'state')) {
      if (result && result.success === false) {
        throw new Error(result.message || result.error || 'تعذر قراءة الإعدادات المشتركة');
      }
      cloudSettingsStatus = 'خدمة Google تحتاج تحديثًا لدعم مزامنة الإعدادات';
      return false;
    }

    if (!result.state) {
      // Keep the local state intact. Seeding the first cloud snapshot must be explicit
      // so a new device's defaults can never replace the primary device's settings.
      cloudSettingsInitialized = false;
      cloudSettingsStatus = 'لم تُحفظ الإعدادات المشتركة بعد. افتح النظام على جهازك الأساسي واضغط «مزامنة إعدادات هذا الجهاز».';
      return true;
    }

    const previousBaseline = cloudSettingsBaseline ? sharedSettingsClone(cloudSettingsBaseline) : null;
    const localSnapshot = normalizeSharedSettingsSnapshot(sharedSettingsPayload());
    const remoteState = normalizeState({
      ...seed(),
      ...result.state,
      ui: S.ui,
      tx: S.tx
    });
    const remoteSnapshot = normalizeSharedSettingsSnapshot(sharedSettingsPayload(remoteState));
    let mergedSnapshot;

    if (previousBaseline) {
      // Preserve local edits made while offline or during another device's update.
      // Three-way merge only applies local deltas and preserves unrelated remote edits.
      mergedSnapshot = mergeSharedSettingsSnapshots(previousBaseline, localSnapshot, remoteSnapshot);
    } else {
      // Legacy devices may contain locally edited settings but no saved cloud baseline yet.
      // Use a known seed snapshot as the base: untouched defaults do not overwrite the
      // cloud, while non-default local edits and added records are preserved and merged.
      // Same-key conflicts cannot be reconstructed without a historical baseline, so the
      // local version of a non-default edited item wins during this one-time migration.
      mergedSnapshot = mergeLegacySharedSettingsSnapshots(localSnapshot, remoteSnapshot);
    }

    S = normalizeState({ ...S, ...mergedSnapshot, ui: S.ui, tx: S.tx });
    setCloudSettingsBaseline(remoteSnapshot, result.revision);
    cloudSettingsInitialized = true;
    cloudSettingsLastUpdated = result.updatedAt || '';
    cloudSettingsStatus = 'تم تحميل الإعدادات المشتركة من Google Sheets' +
      (cloudSettingsLastUpdated ? ' — ' + cloudSettingsLastUpdated : '');
    save();

    const localPending = !sharedSettingsEqual(sharedSettingsPayload(), remoteSnapshot) ||
      (S.pendingRecurringScheduleIds || []).length > 0 ||
      (S.pendingFinancialGoalIds || []).length > 0;
    if (localPending) scheduleSharedSettingsSync();

    if (renderAfter && S.ui.tab === 'set') render();
    return true;
  } catch (error) {
    cloudSettingsStatus = 'تعذرت مزامنة الإعدادات: ' +
      (error && error.message ? error.message : String(error));
    console.error('تعذر تحميل الإعدادات المشتركة من Google Sheets:', error);
    return false;
  }
}

async function saveSharedSettingsToGoogle({ manual = false } = {}) {
  if (cloudSettingsSyncInFlight) return false;
  cloudSettingsSyncInFlight = true;
  cloudSettingsStatus = 'جارٍ حفظ الإعدادات المشتركة…';
  if (S.ui.tab === 'set') render();

  const sentSnapshot = normalizeSharedSettingsSnapshot(sharedSettingsPayload());
  const baseSnapshot = cloudSettingsBaseline ? sharedSettingsClone(cloudSettingsBaseline) : null;
  const baseRevision = cloudSettingsRevision;
  let succeeded = false;
  let shouldFollowupSync = false;

  try {
    const result = await postGooglePayload({
      action: 'savestate',
      state: sentSnapshot,
      baseState: baseSnapshot,
      expectedRevision: baseRevision
    });
    if (!result || result.success === false || result.status === 'error' ||
        !result.state || typeof result.state !== 'object' || Array.isArray(result.state)) {
      throw new Error((result && (result.message || result.error)) ||
        'لم تؤكد Google حفظ الإعدادات المشتركة. حدّث كود Apps Script وانشر إصدارًا جديدًا.');
    }

    const serverSnapshot = normalizeSharedSettingsSnapshot(result.state);
    const localAtResponse = normalizeSharedSettingsSnapshot(sharedSettingsPayload());
    // Keep edits made while the request was in flight, while also incorporating
    // changes from other devices returned by the server.
    const reconciledSnapshot = mergeSharedSettingsSnapshots(sentSnapshot, localAtResponse, serverSnapshot);
    S = normalizeState({ ...S, ...reconciledSnapshot, ui: S.ui, tx: S.tx });
    setCloudSettingsBaseline(serverSnapshot, result.revision);
    cloudSettingsInitialized = true;
    cloudSettingsLastUpdated = result.updatedAt || new Date().toISOString();
    cloudSettingsStatus = 'تمت مزامنة الإعدادات مع Google Sheets';
    S.pendingRecurringScheduleIds = [];
    S.pendingFinancialGoalIds = [];
    save();
    succeeded = true;
    shouldFollowupSync = !sharedSettingsEqual(sharedSettingsPayload(), serverSnapshot);
    if (S.ui.tab === 'set') render();
    return true;
  } catch (error) {
    cloudSettingsStatus = 'فشلت مزامنة الإعدادات: ' +
      (error && error.message ? error.message : String(error));
    console.error('فشلت مزامنة الإعدادات المشتركة:', error);
    if (manual) {
      alert(cloudSettingsStatus +
        '\nتأكد من تحديث ونشر كود Google Apps Script الداعم لـ GET?action=state وPOST action=savestate.');
    }
    if (S.ui.tab === 'set') render();
    return false;
  } finally {
    cloudSettingsSyncInFlight = false;
    if (succeeded && shouldFollowupSync && cloudSettingsInitialized) scheduleSharedSettingsSync();
  }
}

function scheduleSharedSettingsSync() {
  // First cloud initialization must be explicit so a new device's defaults
  // cannot overwrite the settings that already exist on the primary device.
  if (!cloudSettingsInitialized) return;
  if (cloudSettingsSyncTimer) clearTimeout(cloudSettingsSyncTimer);
  cloudSettingsSyncTimer = setTimeout(() => {
    cloudSettingsSyncTimer = null;
    saveSharedSettingsToGoogle();
  }, 700);
}

async function saveTransactionToGoogle(tx) {
  const dataToSend = {
    Date: tx.date ? String(tx.date).substring(0, 10) : '',
    Type: tx.type,
    Amount: Number(tx.amt),
    Category: tx.cat,
    Notes: googleNotes(tx) || tx.name,
    Account: tx.acc || 'CASH',
    Payment: tx.pay || 'نقدي',
    Currency: tx.cur || 'EGP',
    Fee: fee(tx),
    AssetCode: tx.code || '',
    Quantity: tx.qty === '' || tx.qty === null || tx.qty === undefined ? '' : Number(tx.qty),
    Price: tx.price === '' || tx.price === null || tx.price === undefined ? '' : Number(tx.price)
  };
  const result = await postGooglePayload(dataToSend);
  if (result && (result.status === 'error' || result.success === false)) {
    throw new Error(result.message || result.error || 'لم يتم تأكيد الحفظ في Google Sheets');
  }
  tx.googleSynced = true;
  return result;
}

async function syncTransactionDetailsToGoogle(tx) {
  const notes = googleNotes(tx) || tx.name || '';
  const payload = {
    action: 'syncdetails',
    Date: tx.date, Type: tx.type, Amount: Number(tx.amt), Category: tx.cat, Notes: notes,
    Account: tx.acc || 'CASH', Payment: tx.pay || 'نقدي', Currency: tx.cur || 'EGP',
    Fee: fee(tx), AssetCode: tx.code || '',
    Quantity: tx.qty === '' || tx.qty === null || tx.qty === undefined ? '' : Number(tx.qty),
    Price: tx.price === '' || tx.price === null || tx.price === undefined ? '' : Number(tx.price)
  };
  const result = await postGooglePayload(payload);
  if (!result || result.success === false || result.status === 'error') {
    throw new Error(result && (result.message || result.error) || 'تعذر مزامنة تفاصيل المعاملة');
  }
  return result;
}

async function syncExistingTransactionDetailsToGoogle() {
  const candidates = S.tx.filter(tx => tx.googleSynced);
  if (!candidates.length) {
    alert('لم يتم تحميل معاملات من Google Sheets بعد. أعد تحميل الصفحة ثم حاول مرة أخرى.');
    return;
  }

  const confirmed = confirm(
    'سيتم تحديث تفاصيل المعاملات الموجودة بالفعل في Google Sheets من بيانات هذا الجهاز، ' +
    'بما في ذلك الحساب والعملة والرسوم ورمز الأصل والكمية والسعر. لن تتم إضافة صفوف جديدة.\n\n' +
    'نفّذ هذه الخطوة من الكمبيوتر الذي يحتوي على التفاصيل الصحيحة. هل تريد المتابعة؟'
  );
  if (!confirmed) return;

  let updated = 0;
  const failures = [];
  for (const tx of candidates) {
    try {
      await syncTransactionDetailsToGoogle(tx);
      updated++;
    } catch (error) {
      failures.push({
        id: tx.id,
        name: tx.name || tx.note || 'بدون اسم',
        message: error && error.message ? error.message : String(error)
      });
    }
  }

  const skippedLocal = S.tx.length - candidates.length;
  const summary = [
    'انتهت مزامنة التفاصيل.',
    'تم تحديث: ' + updated,
    'تعذر تحديث: ' + failures.length,
    'معاملات محلية غير موجودة/غير مؤكدة في Google وتم تخطيها: ' + skippedLocal
  ];
  if (failures.length) {
    summary.push('', 'أول الأخطاء:');
    failures.slice(0, 5).forEach(item =>
      summary.push('#' + item.id + ' — ' + item.name + ': ' + item.message)
    );
  }
  alert(summary.join('\n'));
  await loadDataFromGoogle();
}

async function deleteTransactionFromGoogle(tx) {
  const notes = googleNotes(tx);
  // Send the full row identity. Older Apps Script deployments may ignore extra fields,
  // while updated deployments can use Amount/Type/Category to avoid deleting the wrong same-date row.
  const result = await postGooglePayload({
    action: 'delete',
    Date: tx.date, Type: tx.type, Amount: Number(tx.amt), Category: tx.cat, Notes: notes,
    Account: tx.acc || 'CASH', Payment: tx.pay || 'نقدي', Currency: tx.cur || 'EGP',
    Fee: fee(tx), AssetCode: tx.code || '',
    Quantity: tx.qty === '' || tx.qty === null || tx.qty === undefined ? '' : Number(tx.qty),
    Price: tx.price === '' || tx.price === null || tx.price === undefined ? '' : Number(tx.price),
    date: tx.date, type: tx.type, amount: Number(tx.amt), category: tx.cat, notes,
    account: tx.acc || 'CASH', payment: tx.pay || 'نقدي', currency: tx.cur || 'EGP',
    fee: fee(tx), assetCode: tx.code || '',
    quantity: tx.qty === '' || tx.qty === null || tx.qty === undefined ? '' : Number(tx.qty),
    price: tx.price === '' || tx.price === null || tx.price === undefined ? '' : Number(tx.price)
  });
  if (result && (result.found === false || result.deleted === false || result.success === false || result.status === 'error')) {
    throw new Error(result.message || result.error || 'خدمة Google لم تؤكد حذف الصف. قد يكون التاريخ أو الملاحظات غير مطابقين للصف، أو قد لا تدعم الخدمة الحذف بالحقول الحالية.');
  }
  return result;
}

