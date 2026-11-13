/* Fixed offline table controls. No network, HTML parsing, dynamic code, or navigation. */
(() => {
  'use strict';
  const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase('zh-CN');
  const compare = new Intl.Collator('zh-CN', {numeric: true, sensitivity: 'base'});
  for (const region of document.querySelectorAll('[data-office-table]')) {
    const table = region.querySelector('table');
    const search = region.querySelector('[data-office-search]');
    const clear = region.querySelector('[data-office-clear]');
    const status = region.querySelector('[data-office-status]');
    if (!table || !search || !clear || !status || table.tBodies.length !== 1) continue;
    const body = table.tBodies[0];
    const original = Array.from(body.rows).filter(row => !row.hasAttribute('data-office-empty'));
    const headers = Array.from(table.tHead?.rows[0]?.cells || []);
    if (original.length > 2000 || headers.length > 30 || headers.length === 0) continue;
    const order = new Map(original.map((row, i) => [row, i]));
    let currentColumn = -1, ascending = true;
    const filter = () => {
      const term = normalize(search.value.slice(0, 300));
      let visible = 0;
      for (const row of original) {
        row.hidden = term !== '' && !normalize(row.textContent).includes(term);
        if (!row.hidden) visible++;
      }
      status.textContent = `显示 ${visible} / ${original.length} 条记录`;
    };
    search.addEventListener('input', filter);
    clear.addEventListener('click', () => {
      search.value = '';
      currentColumn = -1; ascending = true;
      for (const header of headers) header.removeAttribute('aria-sort');
      for (const row of original) body.appendChild(row);
      filter();
    });
    for (const button of region.querySelectorAll('[data-office-sort]')) {
      const column = Number(button.getAttribute('data-office-sort'));
      if (!Number.isInteger(column) || column < 0 || column >= headers.length) continue;
      button.addEventListener('click', () => {
        ascending = currentColumn === column ? !ascending : true;
        currentColumn = column;
        const populated = original.map(row => row.cells[column]).filter(cell => cell && cell.textContent.trim() !== '');
        const numeric = populated.length > 0 && populated.every(cell => cell.hasAttribute('data-office-number') && Number.isFinite(Number(cell.getAttribute('data-office-number'))));
        const sorted = [...original].sort((a, b) => {
          const ac = a.cells[column], bc = b.cells[column];
          const av = ac?.textContent.trim() || '', bv = bc?.textContent.trim() || '';
          if (av === '' && bv !== '') return 1;
          if (bv === '' && av !== '') return -1;
          const difference = numeric && av && bv ? Number(ac.getAttribute('data-office-number')) - Number(bc.getAttribute('data-office-number')) : compare.compare(av, bv);
          return difference ? (ascending ? difference : -difference) : order.get(a) - order.get(b);
        });
        for (const header of headers) header.removeAttribute('aria-sort');
        headers[column].setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
        for (const row of sorted) body.appendChild(row);
        filter();
      });
    }
    filter();
    region.setAttribute('data-office-ready', 'true');
  }
})();
