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

  // Agregar fila (idempotente: no duplica si el ID ya existe)
  if (data.action === 'append') {
    var sheet = getOrCreateSheet(ss, data.sheet);
    migrateHeaders(sheet, data.sheet);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function(h) { return String(h).trim(); });

    // Remapear array del cliente al orden REAL de columnas de la hoja
    // El cliente envía en el orden de getHeaders(), la hoja puede tener otro orden
    var expectedHeaders = getHeaders(data.sheet);
    var rowToAppend;
    if (data.row && expectedHeaders.length > 0 && data.row.length === expectedHeaders.length) {
      var named = {};
      for (var j = 0; j < expectedHeaders.length; j++) {
        named[expectedHeaders[j]] = data.row[j];
      }
      rowToAppend = headers.map(function(h) { return named[h] !== undefined ? named[h] : ''; });
    } else {
      rowToAppend = data.row;
    }

    // Verificar duplicados por ID
    var idCol = headers.indexOf('id');
    if (idCol !== -1 && rowToAppend[idCol]) {
      var newId = String(rowToAppend[idCol]);
      if (sheet.getLastRow() > 1) {
        var existingIds = sheet.getRange(2, idCol + 1, sheet.getLastRow() - 1, 1).getValues();
        for (var i = 0; i < existingIds.length; i++) {
          if (String(existingIds[i][0]) === newId) {
            return jsonResponse({ ok: true, duplicate: true });
          }
        }
      }
    }
    sheet.appendRow(rowToAppend);
    SpreadsheetApp.flush();
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
    SpreadsheetApp.flush();
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
    SpreadsheetApp.flush();
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
    SpreadsheetApp.flush();
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
    SpreadsheetApp.flush();
    return jsonResponse({ ok: true });
  }

  // Deduplicar filas con mismo contenido (distinto ID)
  if (data.action === 'dedup') {
    var sheetNames = ['Gastos','Ingresos','Inversiones','PagosTDC','Metas','Recurrentes'];
    var totalRemoved = 0;
    sheetNames.forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet || sheet.getLastRow() <= 1) return;
      migrateHeaders(sheet, name);
      var all = sheet.getDataRange().getValues();
      var hdrs = all[0];
      var idCol = hdrs.indexOf('id');
      var seen = {};
      var rowsToDelete = [];
      for (var i = 1; i < all.length; i++) {
        var sig = [];
        for (var j = 0; j < hdrs.length; j++) {
          if (j === idCol) continue;
          sig.push(String(all[i][j] || ''));
        }
        var key = sig.join('|');
        if (seen[key]) {
          rowsToDelete.push(i + 1);
        } else {
          seen[key] = true;
        }
      }
      rowsToDelete.sort(function(a, b) { return b - a; });
      rowsToDelete.forEach(function(row) { sheet.deleteRow(row); });
      totalRemoved += rowsToDelete.length;
    });
    SpreadsheetApp.flush();
    return jsonResponse({ ok: true, removed: totalRemoved });
  }

  // Sincronizar configuración
  if (data.action === 'syncConfig') {
    var sheet = getOrCreateSheet(ss, 'AppConfig');
    sheet.clear();
    sheet.getRange('A1').setValue(JSON.stringify(data.config));
    SpreadsheetApp.flush();
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
 * Auto-migra columnas faltantes a hojas existentes y reordena al orden esperado.
 * Compara los headers actuales de la hoja con los esperados, agrega las que falten,
 * y reordena todas las columnas (incluidos datos) para que coincidan con getHeaders().
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

  // Si faltan columnas, agregarlas al final primero
  if (missing.length > 0) {
    missing.forEach(function(col) {
      var nextCol = currentHeaders.length + 1;
      sheet.getRange(1, nextCol).setValue(col);
      currentHeaders.push(col);
    });
  }

  // Verificar si el orden actual coincide con el esperado
  var needsReorder = false;
  for (var i = 0; i < expected.length; i++) {
    if (currentHeaders[i] !== expected[i]) { needsReorder = true; break; }
  }

  if (needsReorder && sheet.getLastRow() >= 1) {
    // Leer TODOS los datos, reordenar columnas, reescribir
    var allData = sheet.getDataRange().getValues();
    var colMap = {};
    for (var c = 0; c < currentHeaders.length; c++) {
      colMap[currentHeaders[c]] = c;
    }
    var reordered = allData.map(function(row, idx) {
      if (idx === 0) return expected; // header row
      return expected.map(function(h) {
        return colMap[h] !== undefined ? row[colMap[h]] : '';
      });
    });
    sheet.clear();
    if (reordered.length > 0) {
      sheet.getRange(1, 1, reordered.length, expected.length).setValues(reordered);
    }
    SpreadsheetApp.flush();
  }

  fillMissingIds(sheet, expected);
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
 