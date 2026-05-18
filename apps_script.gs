// ═══════════════════════════════════════════════════════════════════════
// GOOGLE APPS SCRIPT — Mis Finanzas
// Pega este código en: Google Sheets > Extensiones > Apps Script
// ═══════════════════════════════════════════════════════════════════════

function doGet(e) {
  var action = e.parameter.action;
  if (action === 'ping') return jsonResponse({ ok: true });

  if (action === 'getAll') {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var result = {};

    ['Gastos','Ingresos','Inversiones','PagosTDC','Metas','Recurrentes'].forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      if (sheet && sheet.getLastRow() > 1) {
        migrateHeaders(sheet, name);
        var key = name.charAt(0).toLowerCase() + name.slice(1);
        result[key] = sheetToArray(sheet);
      }
    });

    // CuentasInv
    var cs = ss.getSheetByName('CuentasInv');
    if (cs && cs.getLastRow() > 1) {
      var ci = {};
      sheetToArray(cs).forEach(function(r) {
        if (r.nombre) {
          ci[r.nombre] = {
            saldo: parseFloat(r.saldo) || 0,
            ultimaAct: r.ultimaAct || '',
            tramos: r.tramos ? (typeof r.tramos === 'string' ? JSON.parse(r.tramos) : r.tramos) : [{limite:null,tasa:0}]
          };
        }
      });
      result.cuentasInv = ci;
    }

    // AppConfig
    var cfgSheet = ss.getSheetByName('AppConfig');
    if (cfgSheet) {
      try {
        var val = cfgSheet.getRange('A1').getValue();
        if (val) result.appConfig = JSON.parse(val);
      } catch(e) {}
    }

    return jsonResponse(result);
  }

  return jsonResponse({ error: 'Unknown action' });
}

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Agregar fila
  if (data.action === 'append') {
    var sheet = getOrCreateSheet(ss, data.sheet);
    migrateHeaders(sheet, data.sheet);
    sheet.appendRow(data.row);
    return jsonResponse({ ok: true });
  }

  // Eliminar filas por ID
  if (data.action === 'delete') {
    var sheet = ss.getSheetByName(data.sheet);
    if (!sheet || sheet.getLastRow() <= 1) return jsonResponse({ ok: true });
    migrateHeaders(sheet, data.sheet);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var idCol = headers.indexOf('id');
    if (idCol === -1) return jsonResponse({ error: 'No id column in ' + data.sheet });
    var ids = (data.ids || []).map(function(v) { return String(v); });
    var allData = sheet.getDataRange().getValues();
    var rowsToDelete = [];
    for (var i = 1; i < allData.length; i++) {
      if (ids.indexOf(String(allData[i][idCol])) !== -1) {
        rowsToDelete.push(i + 1);
      }
    }
    rowsToDelete.sort(function(a, b) { return b - a; });
    rowsToDelete.forEach(function(row) { sheet.deleteRow(row); });
    return jsonResponse({ ok: true, deleted: rowsToDelete.length });
  }

  // Sincronizar hoja completa
  if (data.action === 'syncSheet') {
    var sheet = getOrCreateSheet(ss, data.sheet);
    var headers = getHeaders(data.sheet);
    sheet.clear();
    sheet.appendRow(headers);
    if (data.rows && data.rows.length > 0) {
      data.rows.forEach(function(row) {
        var r = headers.map(function(h) { return row[h] !== undefined ? row[h] : ''; });
        sheet.appendRow(r);
      });
    }
    return jsonResponse({ ok: true });
  }

  // Limpiar hoja
  if (data.action === 'clearSheet') {
    var sheet = ss.getSheetByName(data.sheet);
    if (sheet) {
      var headers = [];
      if (sheet.getLastRow() > 0) headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      sheet.clear();
      if (headers.length) sheet.appendRow(headers);
    }
    return jsonResponse({ ok: true });
  }

  // Sincronizar CuentasInv
  if (data.action === 'syncCuentasInv') {
    var sheet = getOrCreateSheet(ss, 'CuentasInv');
    sheet.clear();
    sheet.appendRow(['nombre', 'saldo', 'ultimaAct', 'tramos']);
    Object.keys(data.cuentas).forEach(function(nombre) {
      var c = data.cuentas[nombre];
      sheet.appendRow([
        nombre,
        c.saldo || 0,
        c.ultimaAct || '',
        JSON.stringify(c.tramos || [])
      ]);
    });
    return jsonResponse({ ok: true });
  }

  // Sincronizar configuración
  if (data.action === 'syncConfig') {
    var sheet = getOrCreateSheet(ss, 'AppConfig');
    sheet.clear();
    sheet.getRange('A1').setValue(JSON.stringify(data.config));
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Unknown action' });
}

// ── Helpers ──

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheetToArray(sheet) {
  if (sheet.getLastRow() <= 1) return [];
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) row[headers[j]] = data[i][j];
    }
    result.push(row);
  }
  return result;
}

function getOrCreateSheet(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    var headers = getHeaders(name);
    if (headers.length) sheet.appendRow(headers);
  }
  return sheet;
}

// IMPORTANTE: El orden debe coincidir con objToSheetRow() en index.html
// id va AL FINAL (no al inicio)
function getHeaders(sheetName) {
  var map = {
    'Gastos': ['fecha','desc','cat','monto','tdc','mes','msi','meses','notas','ciclo','id'],
    'Ingresos': ['fecha','tipo','desc','monto','mes','id'],
    'Inversiones': ['periodo','cuenta','ant','actual','dif','notas','id'],
    'PagosTDC': ['fecha','tdc','mes','consumo','monto','dif','estado','notas','ciclo','id'],
    'Metas': ['nombre','objetivo','fecha','actual','notas','id'],
    'Recurrentes': ['desc','monto','dia','cat','tdc','id'],
    'CuentasInv': ['nombre','saldo','ultimaAct','tramos']
  };
  return map[sheetName] || [];
}

/**
 * Auto-migra columnas faltantes a hojas existentes.
 * Compara los headers actuales de la hoja con los esperados y agrega las columnas que falten.
 * Tambien genera IDs unicos para filas que no tengan.
 */
function migrateHeaders(sheet, sheetName) {
  var expected = getHeaders(sheetName);
  if (!expected.length) return;
  if (sheet.getLastRow() < 1) return;

  var currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim(); })
    .filter(function(h) { return h !== ''; });

  var missing = [];
  expected.forEach(function(h) {
    if (currentHeaders.indexOf(h) === -1) missing.push(h);
  });

  if (missing.length === 0) {
    fillMissingIds(sheet, currentHeaders);
    return;
  }

  // Agregar columnas faltantes al final
  missing.forEach(function(col) {
    var nextCol = currentHeaders.length + 1;
    sheet.getRange(1, nextCol).setValue(col);
    currentHeaders.push(col);
  });

  fillMissingIds(sheet, currentHeaders);
}

/**
 * Rellena IDs vacíos en la columna 'id' con un timestamp único.
 */
function fillMissingIds(sheet, headers) {
  var idCol = headers.indexOf('id');
  if (idCol === -1) return;
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  var idRange = sheet.getRange(2, idCol + 1, lastRow - 1, 1);
  var ids = idRange.getValues();
  var changed = false;
  var baseTs = Date.now();

  for (var i = 0; i < ids.length; i++) {
    if (!ids[i][0] || String(ids[i][0]).trim() === '') {
      ids[i][0] = baseTs + i + 1;
      changed = true;
    }
  }

  if (changed) {
    idRange.setValues(ids);
  }
}
