"""Offline, escaped, data-first office document renderer. No model or network calls."""
from __future__ import annotations
import hashlib
import html
import json
import math
from pathlib import Path

SCENARIOS = {'dashboard': ('经营驾驶舱', '#216c61'), 'research': ('研究报告', '#395f9d'), 'project': ('项目进展', '#6750a4'), 'comparison': ('决策比较', '#926320'), 'operations': ('运营工作台', '#296681')}
COLORS = ['#247769', '#528bc0', '#c28d35', '#8665ac', '#b65d67', '#617d46']


def text(value, limit=20000):
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise ValueError('Expected text or number')
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError('Non-finite text number')
    value = str(value)
    if len(value) > limit:
        raise ValueError('Text exceeds limit')
    return html.escape(value, quote=True)


def seq(value, limit=100):
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError(f'Expected list with at most {limit} items')
    return value


def table(headers, rows, caption='数据明细'):
    headers = seq(headers, 30)
    if not headers:
        raise ValueError('Table requires headers')
    rows = seq(rows, 2000)
    body = []
    for row in rows:
        if len(seq(row, 30)) != len(headers):
            raise ValueError('Table row length differs from headers')
        body.append('<tr>' + ''.join(f'<td>{text(v)}</td>' for v in row) + '</tr>')
    if not rows:
        body.append(f'<tr><td colspan="{len(headers)}" class="empty-state">暂无记录</td></tr>')
    return '<div class="table-scroll" tabindex="0" role="region" aria-label="' + text(caption) + '"><table><caption>' + text(caption) + '</caption><thead><tr>' + ''.join('<th scope="col">' + text(v) + '</th>' for v in headers) + '</tr></thead><tbody>' + ''.join(body) + '</tbody></table></div>'


def chart_svg(chart, chart_id):
    if not isinstance(chart, dict):
        raise ValueError('Chart must be an object')
    kind = chart.get('type')
    if kind not in ('bar', 'line', 'pie'):
        raise ValueError('HTML charts support bar, line and pie')
    categories = seq(chart.get('categories'), 60)
    series = seq(chart.get('series'), 6)
    if not categories and not series:
        return '<p class="empty-state" role="status">暂无图表数据。未将缺失数据解释为零。</p>'
    if not categories or not series:
        raise ValueError('Chart needs both categories and series')
    for category in categories:
        text(category, 500)
    for s in series:
        text(s['name'], 500)
        values = seq(s['values'], 60)
        if len(values) != len(categories):
            raise ValueError('Chart series and category length mismatch')
        if any(isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) or abs(v) > 1e15 for v in values):
            raise ValueError('Chart values must be bounded finite numbers')
    title = text(chart.get('title', '数据图表'), 200)
    parts = [f'<svg viewBox="0 0 800 340" role="img" aria-labelledby="{chart_id}-title {chart_id}-desc"><title id="{chart_id}-title">{title}</title><desc id="{chart_id}-desc">完整数据见下方可展开数据表。</desc>']
    if kind == 'pie':
        if len(series) != 1 or len(categories) > 12:
            raise ValueError('Pie requires one series and at most 12 categories')
        values = series[0]['values']
        total = sum(values)
        if min(values) < 0 or total <= 0:
            raise ValueError('Pie requires nonnegative values and a positive total')
        start = -math.pi / 2
        for i, v in enumerate(values):
            end = start + 2 * math.pi * v / total
            color = COLORS[i % len(COLORS)]
            if v == total:
                parts.append(f'<circle cx="240" cy="165" r="120" fill="{color}"/>')
            elif v:
                x1, y1 = 240 + 120 * math.cos(start), 165 + 120 * math.sin(start)
                x2, y2 = 240 + 120 * math.cos(end), 165 + 120 * math.sin(end)
                parts.append(f'<path d="M240 165 L{x1:.3f} {y1:.3f} A120 120 0 {int(end-start > math.pi)} 1 {x2:.3f} {y2:.3f} Z" fill="{color}" stroke="white" stroke-width="2"/>')
            parts.append(f'<rect x="440" y="{30+i*24}" width="10" height="10" rx="3" fill="{color}"/><text x="462" y="{40+i*24}">{text(str(categories[i])[:18] + ('…' if len(str(categories[i])) > 18 else ''))}: {v/total:.1%}</text>')
            start = end
    else:
        vals = [v for s in series for v in s['values']]
        low, high = min(0, min(vals)), max(0, max(vals))
        if high == low:
            high = low + 1
        span = high - low
        y = lambda v: 270 - (v - low) / span * 230
        zero = y(0)
        parts.append(f'<line class="zero-axis" x1="72" y1="{zero}" x2="775" y2="{zero}" stroke="#728786" stroke-width="1.5"/>')
        for i in range(5):
            val = low + span * i / 4
            py = y(val)
            parts.append(f'<line x1="72" y1="{py}" x2="775" y2="{py}" stroke="#dce4e5"/><text x="62" y="{py+4}" text-anchor="end">{val:,.3g}</text>')
        step = 690 / len(categories)
        for i, label in enumerate(categories):
            x = 80 + (i + .5) * step
            if len(categories) <= 12 or i % math.ceil(len(categories) / 12) == 0:
                short = str(label) if len(str(label)) <= 9 else str(label)[:8] + '…'
                parts.append(f'<text x="{x}" y="292" text-anchor="middle">{text(short)}</text>')
        for si, s in enumerate(series):
            color = COLORS[si]
            points = []
            for i, val in enumerate(s['values']):
                x = 80 + (i + .5) * step
                py = y(val)
                if kind == 'bar':
                    width = min(52, step * .8 / len(series))
                    bx = x - width * len(series) / 2 + si * width
                    parts.append(f'<rect x="{bx}" y="{min(py,zero)}" width="{max(.2,width-2)}" height="{abs(py-zero)}" rx="2" fill="{color}"><title>{text(categories[i])} / {text(s["name"])}: {val}</title></rect>')
                else:
                    points.append(f'{x},{py}')
                    parts.append(f'<circle cx="{x}" cy="{py}" r="3" fill="{color}"><title>{text(categories[i])} / {text(s["name"])}: {val}</title></circle>')
            if kind == 'line':
                parts.append(f'<polyline points="{" ".join(points)}" fill="none" stroke="{color}" stroke-width="2.5"/>')
    parts.append('</svg>')
    legend = '<div class="legend">' + ''.join(f'<span><i style="background:{COLORS[i]}"></i>{text(s["name"])}{(" · " + text(chart["unit"])) if chart.get("unit") else ""}</span>' for i, s in enumerate(series)) + '</div>'
    rows = [[cat] + [s['values'][i] for s in series] for i, cat in enumerate(categories)]
    return '<p class="scroll-hint">小屏可横向滚动图表；完整标签与数值见下方数据表。</p><div class="chart-scroll" tabindex="0" role="region" aria-label="可横向滚动的图表">' + ''.join(parts) + '</div>' + legend + '<details><summary>查看图表数据 / Chart data</summary>' + table(['类别'] + [s['name'] for s in series], rows, chart.get('title', '图表数据')) + '</details>'


CSS = '''
:focus-visible{outline:3px solid #c37e23;outline-offset:4px}.empty-state{padding:24px;color:#637778;background:#f4f7f5;text-align:center}.scroll-hint{display:none;font-size:11px;color:#637778}thead{display:table-header-group}tr{break-inside:avoid}
:root{color-scheme:light;--ink:#203536;--muted:#637778;--paper:#f1f4f2;--line:#dce5e1;--accent:ACCENT}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;line-height:1.65}a{color:var(--accent)}.shell{max-width:1280px;margin:auto;padding:36px 42px 56px}header{border-top:5px solid var(--accent);padding:28px 0 30px;display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end}.eyebrow,.label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:700}h1{font-size:clamp(28px,4vw,48px);letter-spacing:-.035em;line-height:1.17;margin:12px 0 16px;overflow-wrap:anywhere}h2{font-size:21px;line-height:1.4;margin:0 0 18px}h3{margin:0 0 8px;font-size:16px}p{margin:0 0 12px;overflow-wrap:anywhere}.subtitle{color:var(--muted);max-width:800px}.stamp{border:1px solid var(--line);padding:12px 18px;border-radius:10px;color:var(--muted);font-size:12px}.layout{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:22px}.section{grid-column:span 12;background:white;border:1px solid var(--line);border-radius:14px;padding:26px;min-width:0;box-shadow:0 8px 24px #20353603}.section.half{grid-column:span 6}.section.block-kpis{background:transparent;border:0;padding:0;box-shadow:none}.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:16px}.kpi{padding:23px 24px;background:white;border:1px solid var(--line);border-radius:12px;min-width:0}.kpi .value{font-size:32px;font-weight:750;letter-spacing:-.04em;line-height:1.3;margin:10px 0;overflow-wrap:anywhere}.kpi .note{font-size:12px;color:var(--muted)}.kpi:first-child{background:var(--accent);color:white}.kpi:first-child .label,.kpi:first-child .note{color:#ffffffdf}.table-scroll{overflow-x:auto;max-width:100%;border:1px solid var(--line);border-radius:8px}table{border-collapse:collapse;width:100%;font-size:13px}caption{text-align:left;padding:10px 14px;font-weight:600;color:var(--muted)}th,td{text-align:left;padding:12px 14px;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere;min-width:90px}th{background:#f4f7f5;color:var(--muted);font-size:12px}tbody tr:nth-child(even){background:#fafcfb}.chart-scroll{overflow-x:auto;max-width:100%}.chart-scroll svg{min-width:560px}svg{width:100%;height:auto;display:block}svg text{font-family:inherit;font-size:11px;fill:#637778}.legend{display:flex;flex-wrap:wrap;gap:18px;font-size:12px;color:var(--muted);margin:12px 0}.legend span{overflow-wrap:anywhere;min-width:0}.legend i{display:inline-block;width:9px;height:9px;margin-right:7px;border-radius:3px}details{border-top:1px solid var(--line);padding-top:12px;margin-top:16px}summary{cursor:pointer;font-size:12px;color:var(--accent);font-weight:650}details[open] summary{margin-bottom:12px}.timeline{list-style:none;margin:0;padding:0}.timeline li{display:grid;grid-template-columns:100px 1fr;gap:20px;padding:0 0 22px}.timeline time{font-size:12px;color:var(--muted)}.timeline article{border-left:2px solid var(--line);padding-left:20px}.timeline p{font-size:14px;color:var(--muted)}.callout{border-left:4px solid var(--accent);background:#f4f7f5;padding:20px}.board{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:18px}.lane{background:#f4f7f5;padding:16px;border-radius:9px;min-width:0}.card{background:white;padding:16px;border:1px solid var(--line);border-radius:8px;margin-top:12px}.card p{font-size:13px;color:var(--muted)}.badge{font-size:11px;border-radius:4px;padding:3px 7px;background:#e7efeb;color:var(--accent);display:inline-block;overflow-wrap:anywhere;max-width:100%}.prose{max-width:80ch;white-space:pre-line}footer{padding-top:25px;color:var(--muted);font-size:11px;display:flex;justify-content:space-between;gap:20px}.research .shell{max-width:1100px}.research h1{font-family:Georgia,"Songti SC",serif}.research .section{border-radius:3px}.research header{padding-bottom:40px}.comparison .section{border-top:3px solid var(--accent)}.operations .shell{max-width:1440px}.project header{border-top-width:2px}h2,h3,.label,.badge{overflow-wrap:anywhere}@media(max-width:760px){.scroll-hint{display:block}.shell{padding:20px 16px 36px}header{grid-template-columns:1fr;gap:8px}.stamp{justify-self:start}.section{padding:20px}.section.half{grid-column:span 12}.timeline li{grid-template-columns:75px 1fr;gap:8px}.layout{gap:16px}.kpi .value{font-size:28px}footer{flex-direction:column;gap:4px}}@media print{.kpi-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.kpi{padding:12px}.kpi .value{font-size:22px}.kpi .label{font-size:10px}.chart-scroll svg{max-height:260px}.table-scroll{break-inside:avoid}table{font-size:11px}th,td{padding:8px}.legend{font-size:10px}@page{size:A4;margin:15mm}body{background:white}.shell{max-width:none;padding:0}.layout{display:block}.section{box-shadow:none;break-inside:auto;border-radius:0;margin:0 0 14px;padding:16px}.kpi,.card,.timeline li{break-inside:avoid}.block-kpis,.block-callout{break-inside:avoid}.chart-scroll{break-inside:avoid}.scroll-hint{display:none}h2,h3{break-after:avoid}.section.half{grid-column:span 12}header{padding-top:10px}.table-scroll,.chart-scroll{overflow:visible}.chart-scroll svg{min-width:0}th,td{min-width:0}details{display:block}details>*{display:block}summary{display:none}footer{position:static}h1{font-size:30px}}
'''


def render_html(spec, output):
    if not isinstance(spec, dict) or spec.get('version') != 1:
        raise ValueError('HTML spec requires version 1')
    if len(json.dumps(spec, ensure_ascii=False)) > 2_000_000:
        raise ValueError('HTML spec exceeds 2 MB')
    scenario = spec.get('scenario', 'dashboard')
    if scenario not in SCENARIOS:
        raise ValueError('Unknown HTML scenario')
    title = text(spec['title'], 300)
    sections = seq(spec.get('sections'), 80)
    if not sections:
        raise ValueError('Document requires sections')
    rendered, charts = [], []
    for i, s in enumerate(sections):
        if not isinstance(s, dict):
            raise ValueError('Section must be an object')
        kind = s.get('type')
        heading = f'<h2 id="section-{i}">{text(s["title"], 300)}</h2>' if s.get('title') else ''
        body = ''
        if kind == 'kpis':
            items = seq(s.get('items'), 8)
            body = '<div class="kpi-grid">' + ''.join('<article class="kpi"><div class="label">' + text(k['label'], 100) + '</div><div class="value">' + text(k['value'], 100) + '</div><div class="note">' + text(k.get('note', ''), 300) + '</div></article>' for k in items) + '</div>'
        elif kind == 'table':
            body = table(s.get('headers'), s.get('rows'), s.get('caption', s.get('title', '数据明细')))
        elif kind == 'chart':
            body = chart_svg(s['chart'], f'chart-{i}')
            charts.append(s['chart'])
        elif kind == 'text':
            body = '<div class="prose">' + text(s.get('body', '')) + '</div>'
        elif kind == 'callout':
            body = '<div class="callout"><p>' + text(s.get('body', '')) + '</p></div>'
        elif kind == 'timeline':
            body = '<ol class="timeline">' + ''.join('<li><time>' + text(e['date'], 100) + '</time><article><h3>' + text(e['title'], 300) + '</h3><p>' + text(e.get('body', '')) + '</p></article></li>' for e in seq(s.get('items'), 100)) + '</ol>'
        elif kind == 'board':
            lanes = []
            for lane in seq(s.get('columns'), 6):
                cards = ''.join('<article class="card"><h3>' + text(c['title'], 300) + '</h3><p>' + text(c.get('body', '')) + '</p><span class="badge">' + text(c.get('tag', ''), 150) + '</span></article>' for c in seq(lane.get('items'), 100))
                lanes.append('<div class="lane"><h3>' + text(lane['title'], 150) + '</h3>' + cards + '</div>')
            body = '<div class="board">' + ''.join(lanes) + '</div>'
        else:
            raise ValueError('Unsupported section type')
        width = s.get('width', 'full')
        if width not in ('full', 'half'):
            raise ValueError('Section width must be full or half')
        rendered.append(f'<section class="section block-{kind} {width}">{heading}{body}</section>')
    label, accent = SCENARIOS[scenario]
    markup = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'"><title>' + title + '</title><style>' + CSS.replace('ACCENT', accent) + '</style></head><body class="' + scenario + '"><main class="shell" id="main-content"><header><div><div class="eyebrow">' + text(spec.get('eyebrow', label), 200) + '</div><h1>' + title + '</h1><p class="subtitle">' + text(spec.get('subtitle', ''), 2000) + '</p></div><div class="stamp">' + text(spec.get('period', '内部资料 · 本地生成'), 200) + '</div></header><div class="layout">' + ''.join(rendered) + '</div><footer><span>' + text(spec.get('footer', '仅供内部使用 · 数据以业务来源为准'), 500) + '</span><span>OFFICE / ' + text(label) + '</span></footer></main></body></html>'
    path = Path(output)
    if path.suffix.lower() != '.html':
        raise ValueError('Output must end with .html')
    # Validation is complete before exclusive creation. Remove only our own file
    # if a disk/encoding failure interrupts the write. Existing files stay untouched.
    f = path.open('x', encoding='utf-8')
    inode = path.stat().st_ino
    try:
        with f:
            f.write(markup)
    except BaseException:
        if path.exists() and path.stat().st_ino == inode:
            path.unlink()
        raise
    return {'version': 1, 'artifact': str(path), 'scenario': scenario, 'sections': len(sections), 'charts': len(charts), 'chart_data_sha256': hashlib.sha256(json.dumps(charts, sort_keys=True, ensure_ascii=False).encode()).hexdigest(), 'sha256': hashlib.sha256(markup.encode()).hexdigest(), 'network_dependencies': [], 'qa': 'pending_browser_and_visual_review'}
