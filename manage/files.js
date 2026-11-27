/* Reads a resident list from a .csv or .xlsx file, in the browser. The file itself is never uploaded: only the three
   columns First name, Last name and Email are taken from it and sent, after the manager confirms.
   window.readResidentFile(file) resolves to { rows: [{ firstName, lastName, email }] } or rejects with a message. */
(function () {
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  const COLS = {
    firstName: ['firstname', 'first', 'nombre', 'nombres', 'name', 'givenname', 'primernombre'],
    lastName: ['lastname', 'last', 'apellido', 'apellidos', 'surname', 'familyname'],
    email: ['email', 'emailaddress', 'correo', 'correoelectronico', 'mail']
  };
  function toRows(table) {
    const grid = table.filter((r) => r.some((c) => String(c == null ? '' : c).trim() !== ''));
    if (!grid.length) throw new Error('The file is empty.');
    const head = grid[0].map(norm), at = {};
    for (const k of Object.keys(COLS)) at[k] = head.findIndex((h) => COLS[k].includes(h));
    if (at.email < 0) throw new Error('No "Email" column was found. The first row must have the column names: First name, Last name, Email. Download the template to see the layout.');
    if (at.firstName < 0 && at.lastName < 0) throw new Error('No "First name" or "Last name" column was found. Download the template to see the layout.');
    const cell = (r, i) => (i < 0 ? '' : String(r[i] == null ? '' : r[i]).trim());
    const rows = grid.slice(1).map((r) => ({ firstName: cell(r, at.firstName), lastName: cell(r, at.lastName), email: cell(r, at.email) }));
    if (!rows.length) throw new Error('The file has the column names but no residents under them.');
    return rows;
  }
  /* CSV: commas, semicolons or tabs (Excel uses semicolons in some regions), quotes, and line breaks inside quotes. */
  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/)[0] || '';
    const sep = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const out = []; let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === sep) { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); out.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur.length || row.length) { row.push(cur); out.push(row); }
    return out;
  }
  /* XLSX: a zip of XML files. Only the shared strings and the first sheet are read. */
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf, wanted) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf), files = {};
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('That does not look like an Excel .xlsx file.');
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    for (let n = 0; n < count && p + 46 <= buf.byteLength; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      if (wanted(name)) {
        if (usize > 40 * 1024 * 1024) throw new Error('That spreadsheet is too large.');
        const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
        const data = u8.subarray(start, start + csize);
        files[name] = new TextDecoder().decode(method === 0 ? data : await inflate(data));
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }
  async function parseXlsx(buf) {
    const files = await unzip(buf, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const sheetName = Object.keys(files).filter((n) => n.startsWith('xl/worksheets/')).sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10))[0];
    if (!sheetName) throw new Error('No sheet was found in that Excel file.');
    const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
    const text = (el) => [...el.getElementsByTagName('t')].map((t) => t.textContent).join('');
    const shared = files['xl/sharedStrings.xml'] ? [...xml(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(text) : [];
    const colOf = (ref) => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    return [...xml(files[sheetName]).getElementsByTagName('row')].map((row) => {
      const out = [];
      for (const c of row.getElementsByTagName('c')) {
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        const val = t === 's' ? shared[Number(v && v.textContent)] : t === 'inlineStr' ? text(c) : v ? v.textContent : '';
        out[colOf(c.getAttribute('r') || '')] = val == null ? '' : val;
      }
      return Array.from(out, (x) => (x == null ? '' : x));
    });
  }
  window.readResidentFile = async function (file) {
    if (!file) throw new Error('Choose a file first.');
    if (file.size > 10 * 1024 * 1024) throw new Error('That file is larger than 10 MB. A resident list should be far smaller.');
    const name = file.name.toLowerCase();
    if (name.endsWith('.xls')) throw new Error('Old .xls files are not supported. In Excel choose Save As and pick .xlsx or .csv.');
    if (name.endsWith('.xlsx')) return { rows: toRows(await parseXlsx(await file.arrayBuffer())) };
    if (name.endsWith('.csv') || name.endsWith('.txt')) return { rows: toRows(parseCsv(await file.text())) };
    throw new Error('Use a .csv or .xlsx file.');
  };
  window.residentTemplateCsv = '﻿First name,Last name,Email\r\nMaria,Example,maria.example@example.com\r\n';
})();
