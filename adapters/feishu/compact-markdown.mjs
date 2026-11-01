// Account for JSON escaping as well as UTF-8; controls/quotes cannot silently
// double the card payload after pagination.
const bytes = text => new TextEncoder().encode(JSON.stringify(text)).length - 2;

function pieces(text, limit) {
  const result = [];
  while (bytes(text) > limit) {
    let n = 0, end = 0;
    for (const char of text) {
      const size = bytes(char);
      if (n + size > limit) break;
      n += size; end += char.length;
    }
    if (!end) throw new Error('Markdown page budget too small');
    const newline = text.lastIndexOf('\n', end - 1);
    if (newline >= end / 2) end = newline + 1;
    result.push(text.slice(0, end)); text = text.slice(end);
  }
  if (text) result.push(text);
  return result;
}

function blocks(text) {
  const result = []; let prose = '', code = null;
  const flush = () => { if (prose) result.push({raw:prose}); prose = ''; };
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)\n?$/);
    if (!code && match) {
      flush(); code = {header:line, fence:match[1], body:'', closing:''};
    } else if (code) {
      if (match && match[1][0] === code.fence[0] && match[1].length >= code.fence.length && !match[2].trim()) {
        code.closing = line; result.push(code); code = null;
      } else code.body += line;
    } else prose += line;
  }
  flush(); if (code) result.push(code);
  return result;
}

export function cleanMarkdown(text) {
  return blocks(String(text).replace(/\r\n?/g, '\n')).map(block => {
    if (block.header) return block.header + block.body + (block.closing || ((block.body.endsWith('\n') ? '' : '\n') + block.fence));
    return block.raw.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-zA-Z][^>]*>/g, '');
  }).join('');
}

// raw retains every source character. text adds fence wrappers only where a
// code block spans cards, retaining its language and Unicode code points.
export function splitMarkdownPages(text, limit = 12000) {
  if (limit < 512) throw new Error('Markdown page budget too small');
  const atoms = [];
  for (const block of blocks(String(text))) {
    if (!block.header) {
      for (const paragraph of block.raw.match(/[\s\S]+?(?:\n\n+|$)/g) ?? []) {
        for (const part of pieces(paragraph, limit)) atoms.push({text:part,raw:part});
      }
      continue;
    }
    const raw = block.header + block.body + block.closing;
    const header = block.header.endsWith('\n') ? block.header : block.header + '\n';
    const closing = block.fence;
    const whole = header + block.body + (block.closing || ((block.body.endsWith('\n') ? '' : '\n') + closing));
    if (bytes(whole) <= limit) { atoms.push({text:whole,raw}); continue; }
    const budget = limit - bytes(header) - bytes(closing) - 8;
    if (budget < 4) throw new Error('Code fence header exceeds card budget');
    const parts = pieces(block.body, budget);
    parts.forEach((part, i) => atoms.push({
      text:header + part + (part.endsWith('\n') ? '' : '\n') + closing + '\n',
      raw:(i === 0 ? block.header : '') + part + (i === parts.length - 1 ? block.closing : '')
    }));
  }
  const pages = []; let page = {text:'',raw:''};
  for (const atom of atoms) {
    if (page.text && bytes(page.text + atom.text) > limit) { pages.push(page); page = {text:'',raw:''}; }
    page.text += atom.text; page.raw += atom.raw;
  }
  if (page.text) pages.push(page);
  return pages.length ? pages : [{text:'',raw:''}];
}
