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
})();
