/* Seasonal dress for the brand mark, shared by the lobby screen and the manager app.
   window.lobbySeason(date) returns the US holiday or season in effect, or null on ordinary days:
   { key, label, color, icon } where icon is SVG markup drawn on a 24 by 24 grid. */
(function () {
  const nth = (y, m, weekday, n) => { const d = new Date(y, m, 1); const first = (weekday - d.getDay() + 7) % 7; return new Date(y, m, 1 + first + (n - 1) * 7); };
  const last = (y, m, weekday) => { const d = new Date(y, m + 1, 0); return new Date(y, m, d.getDate() - ((d.getDay() - weekday + 7) % 7)); };
  const day = (y, m, d) => new Date(y, m, d);
  const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const ICON = {
    spark: '<path d="M12 12V3M12 12v9M12 12H3M12 12h9M12 12L5.600 5.600M12 12l6.400 6.400M12 12l-6.400 6.400M12 12l6.400-6.400" fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round"/>',
    star: '<path d="M12 2.500l2.900 6.100 6.600.800-4.900 4.600 1.300 6.600L12 17.300l-5.900 3.300 1.300-6.600-4.900-4.600 6.600-.800z" fill="{c}"/>',
    heart: '<path d="M12 21C6 16.500 2.500 13 2.500 8.800A4.800 4.800 0 0 1 12 6.900a4.800 4.800 0 0 1 9.500 1.900C21.500 13 18 16.500 12 21z" fill="{c}"/>',
    clover: '<circle cx="8.200" cy="8.200" r="4.200" fill="{c}"/><circle cx="15.800" cy="8.200" r="4.200" fill="{c}"/><circle cx="12" cy="14.200" r="4.200" fill="{c}"/><path d="M12 14v8" stroke="{c}" stroke-width="2.200" stroke-linecap="round"/>',
    flag: '<path d="M5 3v18" stroke="{c}" stroke-width="2.200" stroke-linecap="round"/><path d="M5 4.500c5-2.500 8 2.500 14 0v9c-6 2.500-9-2.500-14 0z" fill="{c}"/>',
    pumpkin: '<ellipse cx="12" cy="14" rx="9" ry="7.500" fill="{c}"/><path d="M12 6.500V3.500l2.500-1" fill="none" stroke="#6BBF59" stroke-width="2.200" stroke-linecap="round"/><path d="M8 15.500l2-2.500 2 2.500 2-2.500 2 2.500" fill="none" stroke="#0B1220" stroke-width="1.600" stroke-linejoin="round"/>',
    leaf: '<path d="M12.500 2C6.500 4.500 3 10 4.500 16c.600 2.300 2.500 4 5 4.500 5.500 1 10-3.500 10.500-9.500.300-3.500-1-6.500-3-8.500-1.200 1.500-2.800 1.800-4.500-.500z" fill="{c}"/><path d="M5 21.500c2.500-5.500 6-9.500 10.500-12.500M9.500 15.500l-3.300-.800M12.500 12l-.600-3.400" fill="none" stroke="#0B1220" stroke-width="1.400" stroke-linecap="round" opacity="0.55"/>',
    tree: '<path d="M12 2l5 7h-3l4.500 6.500h-4L18 20H6l3.500-4.500h-4L10 9H7z" fill="{c}"/><rect x="10.500" y="20" width="3" height="2.500" fill="#8B5E3C"/><circle cx="12" cy="2.600" r="1.600" fill="#F5B544"/>'
  };
  window.lobbySeason = function (date) {
    const d = date || new Date(), y = d.getFullYear(), t = new Date(y, d.getMonth(), d.getDate()).getTime();
    const tg = nth(y, 10, 4, 4);                                  // Thanksgiving: 4th Thursday of November
    const table = [                                                // [key, label, from, to, color, icon]: first match wins
      ['newyear', "Happy New Year", day(y, 0, 1), day(y, 0, 2), '#F5B544', 'spark'],
      ['newyear', "Happy New Year", day(y, 11, 27), day(y, 11, 31), '#F5B544', 'spark'],
      ['christmas', 'Happy Holidays', add(tg, 4), day(y, 11, 26), '#5FCB8B', 'tree'],
      ['thanksgiving', 'Happy Thanksgiving', add(tg, -4), add(tg, 3), '#E8935A', 'leaf'],
      ['veterans', 'Veterans Day', day(y, 10, 10), day(y, 10, 11), '#8FB8FF', 'flag'],
      ['halloween', 'Happy Halloween', day(y, 9, 24), day(y, 9, 31), '#F28C28', 'pumpkin'],
      ['labor', 'Labor Day', add(nth(y, 8, 1, 1), -2), nth(y, 8, 1, 1), '#8FB8FF', 'flag'],
      ['july4', 'Happy Fourth of July', day(y, 6, 1), day(y, 6, 4), '#FF6B6B', 'flag'],
      ['juneteenth', 'Juneteenth', day(y, 5, 18), day(y, 5, 19), '#F5B544', 'star'],
      ['memorial', 'Memorial Day', add(last(y, 4, 1), -2), last(y, 4, 1), '#8FB8FF', 'flag'],
      ['stpatrick', "St. Patrick's Day", day(y, 2, 15), day(y, 2, 17), '#5FCB8B', 'clover'],
      ['valentine', "Happy Valentine's Day", day(y, 1, 10), day(y, 1, 14), '#FF8FA3', 'heart'],
      ['presidents', "Presidents' Day", add(nth(y, 1, 1, 3), -2), nth(y, 1, 1, 3), '#8FB8FF', 'flag'],
      ['mlk', 'Martin Luther King Jr. Day', add(nth(y, 0, 1, 3), -2), nth(y, 0, 1, 3), '#F5B544', 'star']
    ];
    const hit = table.find((r) => t >= r[2].getTime() && t <= r[3].getTime());
    return hit ? { key: hit[0], label: hit[1], color: hit[4], icon: ICON[hit[5]].replace(/\{c\}/g, hit[4]).replace(/(\d)\.(\d)00\b/g, '$1.$2') } : null;
  };

  /* The ECSG monogram is the app's mascot: the "g" with its smile wears a hat for the season, and the dot beside it
     turns into an ornament, a pumpkin, a heart and so on. window.lobbyMascot(date, fill) returns the whole SVG. */
  const LETTERS = '<path d="M205.48,71.81v.07c.01.64-.08,1.27-.19,1.9-.26,1.64-.63,3.26-1.09,4.85-.41,1.45-1.06,2.76-1.7,4.12-1.78,3.2-4.11,5.94-6.99,8.21-2.88,2.28-6.24,4.01-10.09,5.22-3.83,1.2-8.06,1.81-12.66,1.81-7.5,0-13.97-1.56-19.39-4.67-5.4-3.11-9.57-7.46-12.46-13.01-2.9-5.56-4.35-12.04-4.35-19.42s1.45-13.92,4.35-19.48c2.89-5.57,7.06-9.9,12.46-13.01,5.42-3.11,11.88-4.67,19.39-4.67,4.6,0,8.81.6,12.64,1.81,3.81,1.2,7.16,2.9,10.04,5.12,2.88,2.21,5.22,4.9,7,8.05,3.34,5.94,5.08,15.23-4.72,18.93-.5.19-1.04.34-1.57.41-3.85.5-7.41-1.2-9.58-4.26-1-1.41-1.49-3.26-2.28-4.83-1.5-3-3.53-6-6.79-7.25-1.36-.52-2.84-.77-4.48-.77-2.88,0-5.32.78-7.34,2.35-2.02,1.57-3.55,3.85-4.6,6.83-1.06,2.99-1.58,6.54-1.58,10.65s.52,7.69,1.58,10.69c1.05,3.01,2.58,5.32,4.6,6.93,2.02,1.62,4.46,2.42,7.34,2.42,1.68,0,3.19-.27,4.51-.8,1.33-.54,2.52-1.33,3.57-2.38,1.06-1.05,1.94-2.35,2.64-3.87.42-.92.93-1.79,1.33-2.74.44-1,.84-2.02,1.33-3,1.7-3.36,5.09-5.43,8.87-5.43,4.92,0,9.92,3.94,10.17,9.07.01.06.01.12.01.18Z"/><path d="M205.12,47.47h-.01v-.07s.01.05.01.07Z"/><path d="M276.16,73.57c0,5.14-1.51,9.63-4.53,13.44-3.03,3.81-7.19,6.76-12.47,8.84-5.29,2.09-11.36,3.13-18.22,3.13-8.58,0-17.72-1.86-24.86-6.87-5.14-3.6-8.86-9.37-8.86-15.79,0-5.62,4.55-10.16,10.17-10.16,3.17,0,6.35,1.42,8.08,4.12,1.05,1.63,1.71,3.48,2.7,5.16,2.97,4.98,8.01,7.07,13.64,7.07,3.27,0,5.85-.57,7.73-1.71,1.89-1.14,2.82-2.65,2.82-4.53,0-1.76-.74-3.15-2.24-4.21-1.51-1.05-3.82-1.89-6.96-2.51l-13.11-2.56c-7.43-1.43-13-3.95-16.7-7.56-3.7-3.6-5.55-8.3-5.55-14.08,0-5.01,1.35-9.3,4.06-12.84,2.71-3.54,6.55-6.27,11.49-8.17,4.96-1.91,10.8-2.86,17.51-2.86,6.28,0,11.73.84,16.37,2.51,4.65,1.69,8.39,4.08,11.23,7.2,3.17,3.48,5.64,8.6,5.22,13.4-.39,4.41-3.76,8.13-8.1,8.96-.62.12-1.25.18-1.88.18-2.79,0-5.5-1.19-7.38-3.25-.94-1.03-1.65-2.24-2.11-3.55-.69-1.99-1.12-3.58-2.58-5.18-2.68-2.91-6.46-4.14-10.34-4.14-2.83,0-5.22.57-7.16,1.71-1.95,1.14-2.93,2.68-2.93,4.6,0,1.53.6,2.86,1.82,4,1.2,1.14,3.42,2.03,6.65,2.65l14.38,2.69c7.43,1.44,12.98,3.81,16.64,7.13,3.65,3.32,5.47,7.71,5.47,13.18Z"/><path d="M314.22,96.92c23.18,1.47,42.24-17.71,40.77-40.88-1.21-19.08-16.69-34.56-35.78-35.78-23.17-1.47-42.35,17.6-40.88,40.78,1.21,19.14,16.74,34.67,35.89,35.88ZM318.74,38.07c9.69.92,17.53,8.76,18.45,18.45,1.24,13.07-9.69,23.82-22.65,22.49-9.57-.98-17.31-8.72-18.29-18.29-1.33-12.96,9.42-23.89,22.49-22.65Z"/><path d="M342.95,98.07c1.46-.01,2.92.31,4.22,1,2.17,1.15,3.85,3.24,4.42,5.63.57,2.41.05,4.96-.88,7.26-3.69,9.06-10.56,16.63-19.43,20.83-5.12,2.43-10.76,3.68-16.42,3.68-9.21,0-18.25-3.36-25.2-9.4-2.85-2.48-5.34-5.37-7.36-8.57-2.19-3.48-4.76-8.03-4.49-12.26.18-2.87,1.89-5.6,4.39-7.03s5.7-1.54,8.3-.31c4.58,2.16,4.92,7.34,7.62,11.09,2.64,3.66,6.48,6.41,10.8,7.72,1.92.59,3.93.89,5.95.89,4.72,0,9.35-1.65,13-4.63,3.1-2.53,5.14-6.03,6.64-9.68,1.02-2.49,2.44-4.5,5.01-5.53,1.09-.44,2.27-.67,3.46-.68Z"/><path d="M132.39,76.32c.01.07.03.13.03.2.02-.06.03-.13.06-.19h-.09Z"/><path d="M134.84,59.12c0-6.06-.86-11.41-2.59-16.04-1.72-4.64-4.18-8.53-7.34-11.7-3.16-3.16-6.9-5.56-11.2-7.17-4.31-1.62-9.03-2.42-14.18-2.42-7.33,0-13.71,1.58-19.11,4.74-5.42,3.16-9.61,7.59-12.54,13.26-2.95,5.67-4.43,12.27-4.43,19.77s1.48,14.54,4.43,20.18c2.94,5.63,7.19,9.96,12.73,12.99,5.55,3.04,12.14,4.55,19.77,4.55,5.95,0,11.2-.85,15.75-2.55,6.67-2.49,14.65-7.96,16.11-15.47,1.81-9.32-10.45-15.42-16.86-8.49-3.18,3.44-4.15,7.47-9.01,9.1-1.68.57-3.54.85-5.6.85-2.97,0-5.57-.63-7.8-1.87-2.22-1.25-3.97-3.13-5.21-5.64-1.12-2.27-1.73-5.05-1.84-8.35h48.9v-5.77ZM86.06,51.59c.21-2.09.71-3.98,1.46-5.67,1.06-2.38,2.63-4.24,4.68-5.57,2.05-1.33,4.55-1.99,7.53-1.99s5.45.65,7.47,1.96c2.01,1.31,3.52,3.2,4.54,5.64.7,1.65,1.16,3.53,1.38,5.63h-27.07Z"/>';
  const DOT = '<circle cx="387.31" cy="63.69" r="25.37"/>';
  const star = (cx, cy, r, c) => { let d = ''; for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, q = k % 2 ? r * 0.42 : r; d += (k ? 'L' : 'M') + (cx + q * Math.cos(a)).toFixed(1) + ' ' + (cy + q * Math.sin(a)).toFixed(1); } return '<path d="' + d + 'z" fill="' + c + '"/>'; };
  // hats sit on the g (centre 316.7, top of the ring at y = 20); "dot" replaces the round dot (centre 387.3, 63.7, radius 25.4)
  const COSTUME = {
    christmas: { hat: '<path d="M284 27C290-16 330-36 352-6c9 12 14 26 17 40l-16-8-6 3z" fill="#D7263D"/><path d="M352-6c9 12 14 26 17 40" fill="none" stroke="#A81B2D" stroke-width="3"/><rect x="276" y="18" width="80" height="17" rx="8.5" fill="#FFFFFF"/><circle cx="368" cy="33" r="9" fill="#FFFFFF"/>',
      dot: '<circle cx="387.3" cy="66" r="24" fill="#D7263D"/><path d="M369 58c10-7 26-7 36 0" fill="none" stroke="#FFFFFF" stroke-width="3.5" opacity="0.85"/><rect x="380.3" y="34" width="14" height="10" rx="2.5" fill="#F5B544"/><path d="M387.3 34v-7" stroke="#F5B544" stroke-width="3" stroke-linecap="round"/>' },
    newyear: { hat: '<path d="M290 26L322-44l28 68z" fill="#F5B544"/><path d="M304-5l33-2M296 13l48-3" stroke="#0B1220" stroke-width="5" opacity="0.35"/><circle cx="322" cy="-45" r="8" fill="#FF8FA3"/><rect x="284" y="20" width="72" height="11" rx="5.5" fill="#FF8FA3"/>',
      dot: '<circle cx="387.3" cy="63.7" r="25.4" fill="#F5B544"/>' + star(387.3, 64.5, 15, '#FFFFFF') },
    thanksgiving: { hat: '<rect x="296" y="-26" width="42" height="50" rx="3" fill="#2B2118"/><rect x="296" y="4" width="42" height="12" fill="#8B5E3C"/><rect x="309" y="2" width="16" height="16" rx="2" fill="none" stroke="#F5B544" stroke-width="4"/><rect x="276" y="19" width="82" height="11" rx="5.5" fill="#2B2118"/>',
      dot: '<ellipse cx="387.3" cy="66" rx="26" ry="22.5" fill="#F28C28"/><path d="M387.3 44v44M374 47c-7 11-7 27 0 38M400.600 47c7 11 7 27 0 38" fill="none" stroke="#C96A12" stroke-width="2.500"/><path d="M387.3 44c0-6 2-10 7-12" fill="none" stroke="#5FCB8B" stroke-width="5" stroke-linecap="round"/>' },
    halloween: { hat: '<path d="M292 24L326-48l22 72z" fill="#3B1A4A"/><ellipse cx="317" cy="24" rx="50" ry="9" fill="#3B1A4A"/><path d="M297 14l46 0-3-10-40 0z" fill="#F28C28"/>',
      dot: '<ellipse cx="387.3" cy="66" rx="26" ry="22.500" fill="#F28C28"/><path d="M387.3 44c0-6 2-10 7-12" fill="none" stroke="#5FCB8B" stroke-width="5" stroke-linecap="round"/><path d="M372 60l8-8 5 8zM390 60l5-8 8 8zM371 72l7 6 5-5 4.300 5 4.300-5 5 5 7-6c-3 9-9 13-16.300 13S374 81 371 72z" fill="#0B1220"/>' },
    july4: { hat: '<rect x="294" y="-34" width="46" height="58" rx="3" fill="#FFFFFF"/><path d="M303-34v38M317-34v38M331-34v38" stroke="#D7263D" stroke-width="7"/><rect x="294" y="2" width="46" height="18" fill="#2F5FD0"/>' + star(306, 11, 5, '#FFFFFF') + star(317, 11, 5, '#FFFFFF') + star(328, 11, 5, '#FFFFFF') + '<rect x="276" y="19" width="82" height="11" rx="5.5" fill="#FFFFFF"/>',
      dot: '<circle cx="387.3" cy="63.7" r="25.4" fill="#2F5FD0"/>' + star(387.3, 64.5, 16, '#FFFFFF') },
    patriotic: { hat: '', dot: '<circle cx="387.3" cy="63.7" r="25.4" fill="#2F5FD0"/><circle cx="387.3" cy="63.7" r="21" fill="none" stroke="#D7263D" stroke-width="4"/>' + star(387.3, 64.5, 13, '#FFFFFF') },
    stpatrick: { hat: '<rect x="296" y="-26" width="42" height="50" rx="3" fill="#2E9E5B"/><rect x="296" y="4" width="42" height="12" fill="#14532D"/><rect x="309" y="2" width="16" height="16" rx="2" fill="none" stroke="#F5B544" stroke-width="4"/><rect x="276" y="19" width="82" height="11" rx="5.5" fill="#2E9E5B"/>',
      dot: '<circle cx="377" cy="54" r="12.500" fill="#5FCB8B"/><circle cx="397.600" cy="54" r="12.500" fill="#5FCB8B"/><circle cx="387.3" cy="71" r="12.500" fill="#5FCB8B"/><path d="M387.3 68c1 9 3 15 8 21" fill="none" stroke="#5FCB8B" stroke-width="5" stroke-linecap="round"/>' },
    valentine: { hat: '', dot: '<path d="M387.3 90c-17-12-27-22-27-34.500a14.500 14.500 0 0 1 27-7.500 14.500 14.500 0 0 1 27 7.500c0 12.500-10 22.500-27 34.500z" fill="#FF6B8A"/>' },
    gold: { hat: '', dot: '<circle cx="387.3" cy="63.7" r="25.4" fill="#F5B544"/>' + star(387.3, 64.5, 15, '#0B1220') }
  };
  const WEAR = { christmas: 'christmas', newyear: 'newyear', thanksgiving: 'thanksgiving', halloween: 'halloween', july4: 'july4', memorial: 'patriotic', veterans: 'patriotic', labor: 'patriotic', presidents: 'patriotic',
    stpatrick: 'stpatrick', valentine: 'valentine', mlk: 'gold', juneteenth: 'gold' };
  /* The season's dress for the building's own logo: a hat (or, on days without a hat, a small badge) that the pages
     place on the top corner of whatever logo the building uploaded. Returns { kind: 'hat' | 'badge', label, svg } or null. */
  window.lobbyDress = function (date) {
    const s = window.lobbySeason(date), c = s ? COSTUME[WEAR[s.key]] : null;
    if (!c) return null;
    const hat = !!c.hat, body = hat ? c.hat : c.dot, box = hat ? '266 -56 112 96' : '358 30 58 62';
    return { kind: hat ? 'hat' : 'badge', label: s.label, svg: ('<svg viewBox="' + box + '" role="img" aria-label="' + s.label.replace(/"/g, '') + '">' + body + '</svg>').replace(/(\d)\.(\d)00\b/g, '$1.$2') };
  };
  window.lobbyMascot = function (date, fill) {
    const s = window.lobbySeason(date), c = s ? COSTUME[WEAR[s.key]] : null, f = /^#[0-9a-fA-F]{6}$/.test(fill || '') ? fill : '#F4F7FB';
    const label = 'ECSG Display' + (s ? ' — ' + s.label : '');
    return ('<svg viewBox="56 -58 370 202" role="img" aria-label="' + label.replace(/"/g, '') + '"><g fill="' + f + '">' + LETTERS + (c && c.dot ? '' : DOT) + '</g>' + (c ? c.dot + c.hat : '') + '</svg>').replace(/(\d)\.(\d)00\b/g, '$1.$2');
  };
})();
