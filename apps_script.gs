// ═══════════════════════════════════════════════════════════════════════
// GOOGLE APPS SCRIPT — Mis Finanzas
// Pega este código en: Google Sheets → Extensiones → Apps Script
// ═══════════════════════════════════════════════════════════════════════

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doGet(e) {
  const action = e.parameter.action;
  
  if (action === 'ping') {
    return jsonResponse({ ok: true });
  }
  
  if (action === 'getAll') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const result = {};
    const sheets = ['Gastos','Ingresos','Inversiones','PagosTDC','Metas'];
    
    sheets.forEach(name => {
      const sheet = ss.getSheetByName(name);
      if (!sheet) return;
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      result[name.toLowerCase()] = data.slice(1)
        .filter(row => row[0] !== '')
        .map((row, i) => {
          const obj = { id: i + 1 };
          headers.forEach((h, j) => obj[h] = row[j]);
          return obj;
        });
    });
    
    return jsonResponse(result);
  }
  
  return jsonResponse({ error: 'Accion no reconocida' });
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  
  if (body.action === 'append') {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(body.sheet);
    
    if (!sheet) {
      sheet = ss.insertSheet(body.sheet);
      // Agregar encabezados según la hoja
      const headers = getHeaders(body.sheet);
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length)
        .setBackground('#534AB7')
        .setFontColor('#FFFFFF')
        .setFontWeight('bold');
    }
    
    sheet.appendRow(body.row);
    return jsonResponse({ ok: true });
  }
  
  return jsonResponse({ error: 'Accion no reconocida' });
}

function getHeaders(sheet) {
  const h = {
    Gastos: ['fecha','desc','cat','monto','tdc','mes','msi','meses','notas'],
    Ingresos: ['fecha','tipo','desc','monto','mes'],
    Inversiones: ['periodo','cuenta','ant','actual','dif','notas'],
    PagosTDC: ['fecha','tdc','mes','consumo','monto','dif','estado','notas'],
    Metas: ['nombre','objetivo','fecha','actual','notas']
  };
  return h[sheet] || [];
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
