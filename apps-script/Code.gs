
/**
 * Meyaar Finance — Google Sheets API
 * Compatible with the existing A:L columns.
 *
 * A Date
 * B Type
 * C Amount
 * D Category
 * E Notes
 * F Account
 * G Payment
 * H Currency
 * I Fee
 * J AssetCode
 * K Quantity
 * L Price
 */

const CONFIG = {
  // Transaction contract: do not rename or reorder these A:L columns.
  SHEET_NAME: 'DB_TRANSACTIONS',
  HEADERS: [
    'Date',
    'Type',
    'Amount',
    'Category',
    'Notes',
    'Account',
    'Payment',
    'Currency',
    'Fee',
    'AssetCode',
    'Quantity',
    'Price'
  ],
  COLUMN_COUNT: 12,

  // Shared app settings are stored separately and never in DB_TRANSACTIONS.
  SETTINGS_SHEET_NAME: 'SYS_APP_SETTINGS',
  SETTINGS_RECORD_KEY: 'MEYAAR_SHARED_STATE_V1',
  SETTINGS_HEADERS: ['Key', 'StateJSON', 'UpdatedAt', 'Revision'],
  SHARED_STATE_KEYS: [
    'rates', 'baseRates', 'rateHistory', 'recurringSchedules',
    'generatedOccurrences', 'financialGoals', 'incomeSources', 'plannerTasks',
    'budget', 'warn', 'accounts', 'prices'
  ],
  COLLECTION_KEY_PARTS: {
    rateHistory: ['cur', 'date'],
    recurringSchedules: ['id'],
    generatedOccurrences: ['key'],
    financialGoals: ['id'],
    incomeSources: ['id'],
    plannerTasks: ['id'],
    accounts: ['code'],
    prices: ['code']
  },
  OBJECT_MAP_KEYS: ['rates', 'baseRates', 'budget']
};

/**
 * Returns JSON response.
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Get the spreadsheet.
 * Works when this script is bound to the target spreadsheet.
 */
function getSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error(
      'No active spreadsheet. Open Apps Script from the target Google Sheet.'
    );
  }

  return ss;
}

/**
 * Shared app settings are intentionally isolated from DB_TRANSACTIONS.
 * The one-row state record is JSON in a dedicated system sheet.
 * If an existing sheet has an unfamiliar layout, fail safely instead of overwriting it.
 */
function getSharedSettingsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SETTINGS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SETTINGS_SHEET_NAME);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CONFIG.SETTINGS_HEADERS.length)
      .setValues([CONFIG.SETTINGS_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  if (sheet.getLastColumn() < CONFIG.SETTINGS_HEADERS.length) {
    throw new Error(
      'SYS_APP_SETTINGS already exists with an unexpected layout. ' +
      'No settings or transactions were changed. Review the sheet before migrating it.'
    );
  }

  const actualHeaders = sheet
    .getRange(1, 1, 1, CONFIG.SETTINGS_HEADERS.length)
    .getDisplayValues()[0]
    .map(value => String(value).trim());

  if (!CONFIG.SETTINGS_HEADERS.every((header, index) => actualHeaders[index] === header)) {
    throw new Error(
      'SYS_APP_SETTINGS has an unknown header layout. ' +
      'No data was overwritten; back up and review this sheet before migration.'
    );
  }

  if (sheet.getLastRow() > 2) {
    throw new Error(
      'SYS_APP_SETTINGS contains extra rows beyond its single state record. ' +
      'No data was overwritten; review the sheet before migration.'
    );
  }

  return sheet;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function jsonEqual(left, right) {
  return JSON.stringify(left === undefined ? null : left) ===
    JSON.stringify(right === undefined ? null : right);
}

function sanitizeSharedSettingsState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Shared settings must be a JSON object.');
  }

  const state = {};
  CONFIG.SHARED_STATE_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      state[key] = cloneJson(value[key]);
    }
  });

  Object.keys(CONFIG.COLLECTION_KEY_PARTS).forEach(key => {
    if (Object.prototype.hasOwnProperty.call(state, key) && !Array.isArray(state[key])) {
      throw new Error('Shared settings field "' + key + '" must be an array.');
    }
  });

  CONFIG.OBJECT_MAP_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(state, key) &&
        (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key]))) {
      throw new Error('Shared settings field "' + key + '" must be an object.');
    }
  });

  if (Object.prototype.hasOwnProperty.call(state, 'warn')) {
    const warn = Number(state.warn);
    if (!Number.isFinite(warn) || warn <= 0 || warn > 1) {
      throw new Error('Shared settings warning threshold must be between 0 and 1.');
    }
    state.warn = warn;
  }

  return state;
}

function readSharedSettingsRecord(sheet) {
  if (sheet.getLastRow() < 2) {
    return { state: null, updatedAt: '', revision: 0 };
  }

  const row = sheet.getRange(2, 1, 1, CONFIG.SETTINGS_HEADERS.length).getValues()[0];
  const recordKey = String(row[0] || '').trim();
  const json = String(row[1] || '');

  if (!recordKey && !json) {
    return { state: null, updatedAt: '', revision: 0 };
  }
  if (recordKey !== CONFIG.SETTINGS_RECORD_KEY || !json) {
    throw new Error('SYS_APP_SETTINGS state row is malformed. No data was changed.');
  }

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error('SYS_APP_SETTINGS contains invalid JSON. No data was changed.');
  }

  return {
    state: sanitizeSharedSettingsState(parsed),
    updatedAt: row[2] ? String(row[2]) : '',
    revision: Math.max(0, Math.trunc(Number(row[3]) || 0))
  };
}

function stableCollectionKey(field, item) {
  if (!item || typeof item !== 'object') return '';
  const parts = CONFIG.COLLECTION_KEY_PARTS[field];
  if (!parts) return '';
  const values = parts.map(part => String(item[part] === undefined || item[part] === null ? '' : item[part]));
  if (values.some(value => !value)) return '';
  return values.join('|');
}

function mergeSharedCollection(field, baseItems, localItems, remoteItems) {
  const keyFor = item => stableCollectionKey(field, item);
  const toMap = items => {
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach(item => {
      const key = keyFor(item);
      if (key) map.set(key, item);
    });
    return map;
  };

  const baseMap = toMap(baseItems);
  const localMap = toMap(localItems);
  const mergedMap = toMap(remoteItems);
  const changedKeys = new Set([...baseMap.keys(), ...localMap.keys()]);

  changedKeys.forEach(key => {
    const hasBase = baseMap.has(key);
    const hasLocal = localMap.has(key);
    const baseItem = hasBase ? baseMap.get(key) : undefined;
    const localItem = hasLocal ? localMap.get(key) : undefined;
    if (hasBase === hasLocal && jsonEqual(baseItem, localItem)) return;
    if (hasLocal) mergedMap.set(key, cloneJson(localItem));
    else mergedMap.delete(key);
  });

  // Preserve malformed legacy items from the remote snapshot rather than deleting them.
  const keyed = [...mergedMap.values()];
  const unkeyedRemote = (Array.isArray(remoteItems) ? remoteItems : []).filter(item => !keyFor(item));
  return [...keyed, ...unkeyedRemote];
}

function mergeSharedSettingsState(baseValue, incomingValue, remoteValue) {
  const incoming = sanitizeSharedSettingsState(incomingValue);
  const remote = sanitizeSharedSettingsState(remoteValue || {});
  if (!baseValue || typeof baseValue !== 'object' || Array.isArray(baseValue)) {
    return incoming;
  }
  const base = sanitizeSharedSettingsState(baseValue);
  const merged = cloneJson(remote);

  CONFIG.SHARED_STATE_KEYS.forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) return;
    const baseHas = Object.prototype.hasOwnProperty.call(base, key);
    const localValue = incoming[key];
    const remoteValueForKey = remote[key];
    const baseField = base[key];

    if (Object.prototype.hasOwnProperty.call(CONFIG.COLLECTION_KEY_PARTS, key)) {
      // If this client predates a field, merge additions without treating its
      // default empty array as a deletion of the newer client's existing records.
      merged[key] = mergeSharedCollection(
        key,
        baseHas ? baseField : [],
        localValue,
        Array.isArray(remoteValueForKey) ? remoteValueForKey : []
      );
      return;
    }

    if (CONFIG.OBJECT_MAP_KEYS.includes(key)) {
      const baseMap = baseField && typeof baseField === 'object' && !Array.isArray(baseField) ? baseField : {};
      const localMap = localValue && typeof localValue === 'object' && !Array.isArray(localValue) ? localValue : {};
      const remoteMap = remoteValueForKey && typeof remoteValueForKey === 'object' && !Array.isArray(remoteValueForKey) ? remoteValueForKey : {};
      const nextMap = { ...remoteMap };
      new Set([...Object.keys(baseMap), ...Object.keys(localMap)]).forEach(property => {
        const hasBase = Object.prototype.hasOwnProperty.call(baseMap, property);
        const hasLocal = Object.prototype.hasOwnProperty.call(localMap, property);
        if (hasBase === hasLocal && jsonEqual(baseMap[property], localMap[property])) return;
        if (hasLocal) nextMap[property] = cloneJson(localMap[property]);
        else delete nextMap[property];
      });
      merged[key] = nextMap;
      return;
    }

    if (!baseHas) {
      if (!Object.prototype.hasOwnProperty.call(remote, key)) merged[key] = cloneJson(localValue);
      return;
    }
    if (!jsonEqual(baseField, localValue)) merged[key] = cloneJson(localValue);
  });

  return sanitizeSharedSettingsState(merged);
}

function getSharedSettingsResponse() {
  const sheet = getSharedSettingsSheet();
  const record = readSharedSettingsRecord(sheet);
  return {
    success: true,
    state: record.state,
    updatedAt: record.updatedAt,
    revision: record.revision
  };
}

function saveSharedSettings(data) {
  const sheet = getSharedSettingsSheet();
  const current = readSharedSettingsRecord(sheet);
  const incoming = sanitizeSharedSettingsState(data.state);
  let merged;

  if (!current.state) {
    // The first cloud snapshot is allowed only when this dedicated sheet is empty.
    merged = incoming;
  } else {
    if (!data.baseState || typeof data.baseState !== 'object' || Array.isArray(data.baseState)) {
      throw new Error(
        'Shared settings already exist. Reload this device before syncing to avoid overwriting another device.'
      );
    }
    merged = mergeSharedSettingsState(data.baseState, incoming, current.state);
  }

  const stateJson = JSON.stringify(merged);
  if (stateJson.length > 45000) {
    throw new Error('Shared settings are too large to save safely in one Google Sheets cell.');
  }

  const updatedAt = new Date().toISOString();
  const revision = current.revision + 1;
  sheet.getRange(2, 1, 1, CONFIG.SETTINGS_HEADERS.length)
    .setValues([[CONFIG.SETTINGS_RECORD_KEY, stateJson, updatedAt, revision]]);

  return {
    success: true,
    message: 'Shared settings saved successfully.',
    state: merged,
    updatedAt,
    revision
  };
}

/**
 * Get or create the transactions sheet.
 * Existing headers are checked without adding ID or Name columns.
 */
function getTransactionsSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.getRange(1, 1, 1, CONFIG.COLUMN_COUNT)
      .setValues([CONFIG.HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CONFIG.COLUMN_COUNT)
      .setValues([CONFIG.HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  const actualHeaders = sheet
    .getRange(1, 1, 1, CONFIG.COLUMN_COUNT)
    .getDisplayValues()[0]
    .map(value => String(value).trim());

  const matches = CONFIG.HEADERS.every(
    (header, index) => actualHeaders[index] === header
  );

  if (!matches) {
    throw new Error(
      'The sheet headers do not match the required A:L layout. ' +
      'Expected: ' + CONFIG.HEADERS.join(' | ')
    );
  }

  return sheet;
}

/**
 * Convert spreadsheet values into JSON-safe values.
 */
function normalizeCell(value, columnIndex) {
  if (value instanceof Date) {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }

  if (value === null || value === undefined) {
    return '';
  }

  // Keep date values as strings and preserve numeric fields.
  if ([2, 8, 10, 11].includes(columnIndex)) {
    if (value === '') return '';
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }

  return value;
}

/**
 * GET:
 * Returns an array of rows, including the header row,
 * so the frontend can map columns A:L.
 */
function doGet(e) {
  try {
    const action = String(e && e.parameter && e.parameter.action || '').toLowerCase();
    if (action === 'state') {
      return jsonResponse(getSharedSettingsResponse());
    }

    // Default GET contract stays unchanged: transaction rows A:L, including headers.
    const sheet = getTransactionsSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return jsonResponse([CONFIG.HEADERS]);
    }

    const values = sheet
      .getRange(1, 1, lastRow, CONFIG.COLUMN_COUNT)
      .getValues();

    const output = values.map((row, rowIndex) => {
      if (rowIndex === 0) {
        return CONFIG.HEADERS;
      }

      return row.map((value, columnIndex) =>
        normalizeCell(value, columnIndex)
      );
    });

    return jsonResponse(output);

  } catch (error) {
    return jsonResponse({
      success: false,
      error: error.message || String(error)
    });
  }
}

/**
 * Parse incoming POST body.
 */
function readRequest(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Request body is missing.');
  }

  let data;

  try {
    data = JSON.parse(e.postData.contents);
  } catch (error) {
    throw new Error('Request body must be valid JSON.');
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Request must contain a JSON object.');
  }

  return data;
}

/**
 * Normalize a date for comparisons and storage.
 */
function normalizeDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(
      value,
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );
  }

  const text = String(value || '').trim();
  if (!text) return '';

  // ISO date: yyyy-MM-dd or ISO datetime.
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  // Support dd/MM/yyyy.
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    return [
      dmy[3],
      String(dmy[2]).padStart(2, '0'),
      String(dmy[1]).padStart(2, '0')
    ].join('-');
  }

  return text;
}

/**
 * Convert a value to a finite number.
 */
function numberValue(value, fieldName, defaultValue) {
  if (value === '' || value === null || value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(fieldName + ' is required.');
  }

  const result = Number(value);

  if (!Number.isFinite(result)) {
    throw new Error(fieldName + ' must be a valid number.');
  }

  return result;
}

/**
 * Accept frontend property names in either common style:
 * Date / date, Amount / amt, AssetCode / code, etc.
 */
function pick(data, names, fallback) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(data, name)) {
      return data[name];
    }
  }

  return fallback;
}

/**
 * Build the exact A:L row.
 */
function buildTransactionRow(data) {
  const date = normalizeDate(pick(data, ['Date', 'date'], ''));
  const type = String(pick(data, ['Type', 'type', 'name'], '')).trim();
  const amount = numberValue(
    pick(data, ['Amount', 'amount', 'amt'], ''),
    'Amount'
  );
  const category = String(
    pick(data, ['Category', 'category'], '')
  ).trim();

  const notes = String(
    pick(data, ['Notes', 'notes', 'note'], '')
  ).trim();

  const account = String(
    pick(data, ['Account', 'account', 'acc'], '')
  ).trim();

  const payment = String(
    pick(data, ['Payment', 'payment', 'pay'], '')
  ).trim();

  const currency = String(
    pick(data, ['Currency', 'currency', 'cur'], 'EGP') || 'EGP'
  ).trim();

  const fee = numberValue(
    pick(data, ['Fee', 'fee'], 0),
    'Fee',
    0
  );

  const assetCode = String(
    pick(data, ['AssetCode', 'assetCode', 'code'], '')
  ).trim();

  const quantity = numberValue(
    pick(data, ['Quantity', 'quantity', 'qty'], ''),
    'Quantity',
    ''
  );

  const price = numberValue(
    pick(data, ['Price', 'price'], ''),
    'Price',
    ''
  );

  if (!date) throw new Error('Date is required.');
  if (!type) throw new Error('Type is required.');
  if (amount <= 0) throw new Error('Amount must be greater than zero.');
  if (!category) throw new Error('Category is required.');
  if (fee < 0) throw new Error('Fee cannot be negative.');
  if (quantity !== '' && quantity < 0) {
    throw new Error('Quantity cannot be negative.');
  }
  if (price !== '' && price < 0) {
    throw new Error('Price cannot be negative.');
  }

  return [
    date,       // A Date
    type,       // B Type
    amount,     // C Amount
    category,   // D Category
    notes,      // E Notes
    account,    // F Account
    payment,    // G Payment
    currency,   // H Currency
    fee,        // I Fee
    assetCode,  // J AssetCode
    quantity,   // K Quantity
    price       // L Price
  ];
}

/**
 * Compare cell values for safe deletion.
 */
function comparable(value, columnIndex) {
  if (columnIndex === 0) {
    return normalizeDate(value);
  }

  if ([2, 8, 10, 11].includes(columnIndex)) {
    if (value === '' || value === null || value === undefined) {
      return '';
    }

    const number = Number(value);
    return Number.isFinite(number) ? String(number) : String(value).trim();
  }

  return String(value === null || value === undefined ? '' : value).trim();
}

/**
 * DELETE:
 * Matches the supplied fields against existing rows.
 *
 * If only the older frontend fields are supplied, deletion is allowed
 * only when exactly one row matches. This avoids deleting duplicate
 * transactions accidentally.
 */
function deleteTransaction(sheet, data) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    throw new Error('There are no transactions to delete.');
  }

  const criteria = [
    ['Date', 'date'],
    ['Type', 'type', 'name'],
    ['Amount', 'amount', 'amt'],
    ['Category', 'category'],
    ['Notes', 'notes', 'note'],
    ['Account', 'account', 'acc'],
    ['Payment', 'payment', 'pay'],
    ['Currency', 'currency', 'cur'],
    ['Fee', 'fee'],
    ['AssetCode', 'assetCode', 'code'],
    ['Quantity', 'quantity', 'qty'],
    ['Price', 'price']
  ];

  const supplied = [];

  criteria.forEach((names, index) => {
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(data, name)) {
        supplied.push({
          columnIndex: index,
          value: data[name]
        });
        break;
      }
    }
  });

  const requiredIndexes = [0, 1, 2, 3, 4];
  const suppliedIndexes = supplied.map(item => item.columnIndex);

  if (!requiredIndexes.every(index => suppliedIndexes.includes(index))) {
    throw new Error(
      'Delete requires at least Date, Type, Amount, Category and Notes.'
    );
  }

  const rows = sheet
    .getRange(2, 1, lastRow - 1, CONFIG.COLUMN_COUNT)
    .getValues();

  const matches = [];

  rows.forEach((row, offset) => {
    const isMatch = supplied.every(item =>
      comparable(row[item.columnIndex], item.columnIndex) ===
      comparable(item.value, item.columnIndex)
    );

    if (isMatch) matches.push(offset + 2);
  });

  if (matches.length === 0) {
    throw new Error('No matching transaction was found.');
  }

  if (matches.length > 1) {
    throw new Error(
      'More than one transaction matches. Nothing was deleted. ' +
      'Send Account, Payment, Currency, Fee and asset details too, ' +
      'or add a unique transaction ID in a future schema version.'
    );
  }

  sheet.deleteRow(matches[0]);

  return {
    success: true,
    message: 'Transaction deleted successfully.'
  };
}

/**
 * POST:
 * Supports add and delete actions.
 */
function doPost(e) {
  let lock;
  let lockAcquired = false;

  try {
    const data = readRequest(e);
    lock = LockService.getScriptLock();
    lock.waitLock(20000);
    lockAcquired = true;

    const action = String(data.action || 'add').toLowerCase();

    // The settings endpoint uses its own sheet and never reads or writes DB_TRANSACTIONS.
    if (action === 'savestate') {
      return jsonResponse(saveSharedSettings(data));
    }

    const sheet = getTransactionsSheet();
    if (action === 'delete') {
      return jsonResponse(deleteTransaction(sheet, data));
    }

    if (action !== 'add' && action !== 'create') {
      throw new Error('Unsupported action: ' + action);
    }

    const row = buildTransactionRow(data);

    // Store dates in a consistent, sortable format.
    const targetRow = Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(targetRow, 1, 1, CONFIG.COLUMN_COUNT)
      .setValues([row]);

    return jsonResponse({
      success: true,
      message: 'Transaction saved successfully.',
      row: targetRow,
      data: row
    });

  } catch (error) {
    return jsonResponse({
      success: false,
      error: error.message || String(error)
    });

  } finally {
    if (lockAcquired && lock) {
      lock.releaseLock();
    }
  }
}
