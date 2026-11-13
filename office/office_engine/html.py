"""Offline, escaped, data-first office document renderer. No model or network calls."""
from __future__ import annotations
import hashlib
import html
import json
import math
import re
from decimal import Decimal, localcontext, ROUND_FLOOR, ROUND_CEILING
from urllib.parse import urlsplit
from pathlib import Path

SCENARIOS = {'dashboard': ('经营驾驶舱', '#216c61'), 'research': ('研究报告', '#395f9d'), 'project': ('项目进展', '#6750a4'), 'comparison': ('决策比较', '#926320'), 'operations': ('运营工作台', '#296681')}
COLORS = ['#247769', '#528bc0', '#c28d35', '#8665ac', '#b65d67', '#617d46']


def fields(obj, allowed, context):
    """Fail closed on unknown model intent rather than silently dropping it."""
    if not isinstance(obj, dict):
        raise ValueError(f'{context} must be an object')
    unknown = set(obj) - set(allowed)
    if unknown:
        raise ValueError(f'{context}: unsupported fields: {", ".join(sorted(unknown))}')
    return obj


def table_cell(value):
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'true' if value else 'false'
    return text(value)


def validate_section(section):
    kinds = {'kpis': {'items'}, 'table': {'headers', 'rows', 'caption', 'interactive'},
             'timeline': {'items'}, 'chart': {'chart'}, 'callout': {'body', 'source_ids'},
             'text': {'body', 'source_ids'}, 'board': {'columns'}, 'sources': {'items'}}
    if not isinstance(section, dict) or section.get('type') not in kinds:
        raise ValueError('Unsupported section type')
    kind = section['type']
    fields(section, {'type', 'title', 'width', 'role'} | kinds[kind], f'{kind} section')
    if section.get('role', 'evidence') not in ('lead', 'evidence', 'aside', 'action', 'reference'):
        raise ValueError('Unknown section role')
    if kind == 'sources':
        for item in seq(section.get('items'), 100):
            fields(item, {'id', 'title', 'publisher', 'date', 'note', 'url'}, 'Source')
            if not isinstance(item.get('id'), str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', item['id']):
                raise ValueError('Source id must be a bounded ASCII identifier')
            text(item['title'], 500)
            if 'url' in item:
                if not isinstance(item['url'], str) or len(item['url']) > 2048:
                    raise ValueError('Source URL must be bounded text')
                url = urlsplit(item['url'])
                if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or any(c.isspace() for c in item['url']):
                    raise ValueError('Source URL must be http(s) without credentials')
    elif kind == 'kpis':
        for item in seq(section.get('items'), 8):
            fields(item, {'label', 'value', 'note'}, 'KPI')
    elif kind == 'timeline':
        for item in seq(section.get('items'), 100):
            fields(item, {'date', 'title', 'body'}, 'Timeline item')
    elif kind == 'board':
        for lane in seq(section.get('columns'), 6):
            fields(lane, {'title', 'items'}, 'Board column')
            for item in seq(lane.get('items'), 100):
                fields(item, {'title', 'body', 'tag'}, 'Board card')


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


def table(headers, rows, caption='数据明细', interactive=False):
    headers = seq(headers, 30)
    if not headers:
        raise ValueError('Table requires headers')
    rows = seq(rows, 2000)
    body = []
    for row in rows:
        if len(seq(row, 30)) != len(headers):
            raise ValueError('Table row length differs from headers')
        body.append('<tr>' + ''.join('<td' + (f' data-office-number="{v}"' if interactive and isinstance(v, (int, float)) and not isinstance(v, bool) else '') + '>' + table_cell(v) + '</td>' for v in row) + '</tr>')
    if not rows:
        body.append(f'<tr data-office-empty><td colspan="{len(headers)}" class="empty-state">暂无记录</td></tr>')
    header_markup = ''.join('<th scope="col">' + (f'<button type="button" data-office-sort="{i}" aria-label="按{text(value)}排序">' + text(value) + '</button>' if interactive else text(value)) + '</th>' for i, value in enumerate(headers))
    markup = '<div class="table-scroll" tabindex="0" role="region" aria-label="' + text(caption) + '"><table><caption>' + text(caption) + '</caption><thead><tr>' + header_markup + '</tr></thead><tbody>' + ''.join(body) + '</tbody></table></div>'
    if interactive:
        controls = '<div class="table-controls"><label>搜索本表 <input type="search" maxlength="300" data-office-search aria-label="搜索本表：' + text(caption) + '"></label><button type="button" data-office-clear>清空并恢复原序</button><span data-office-status role="status" aria-live="polite"></span></div>'
        markup = '<div data-office-table>' + controls + markup + '</div>'
        return '<div class="interactive-screen">' + markup + '</div><div class="interactive-print">' + table(headers, rows, caption, False) + '</div>'
    if len(headers) > 8:
        records = []
        for i, row in enumerate(rows):
            pairs = ''.join('<div><dt>' + text(key) + '</dt><dd>' + table_cell(value) + '</dd></div>' for key, value in zip(headers, row))
            records.append(f'<article class="print-record"><h3>记录 {i+1}</h3><dl>{pairs}</dl></article>')
        return '<div class="wide-table-screen">' + markup + '</div><div class="wide-table-print"><h3>' + text(caption) + '</h3>' + ''.join(records) + '</div>'
    return markup


def nice_axis(values):
    """Zero-inclusive decimal ticks, bounded before float SVG geometry conversion."""
    if not values or any(isinstance(v, bool) or not isinstance(v, (int, float)) or abs(v) > 1e15 or not math.isfinite(v) for v in values):
        raise ValueError('Axis needs bounded finite values')
    with localcontext() as context:
        context.prec = 50
        low = min(Decimal(0), *(Decimal(str(v)) for v in values))
        high = max(Decimal(0), *(Decimal(str(v)) for v in values))
        if low == high:
            high = Decimal(1)
        raw = (high - low) / 5
        power = Decimal(10) ** raw.adjusted()
        step = next(Decimal(n) * power for n in ('1', '2', '2.5', '5', '10') if Decimal(n) * power >= raw)
        start = (low / step).to_integral_value(rounding=ROUND_FLOOR)
        end = (high / step).to_integral_value(rounding=ROUND_CEILING)
        ticks = [(start + i) * step for i in range(int(end - start) + 1)]
        numbers = [float(v) for v in ticks]
        span = numbers[-1] - numbers[0]
        if not math.isfinite(span) or span <= 0 or float(step) <= 0 or len(set(numbers)) != len(numbers):
            raise ValueError('Axis range cannot be represented safely in SVG')
        def label(v):
            if not v:
                return '0'
            return format(v.normalize(), 'f') if Decimal('0.0001') <= abs(v) < Decimal('1e9') else format(v.normalize(), '.4g')
        return numbers[0], numbers[-1], [(n, label(v)) for n, v in zip(numbers, ticks)]


def chart_svg(chart, chart_id):
    fields(chart, {'type', 'title', 'unit', 'categories', 'series'}, 'Chart')
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
        fields(s, {'name', 'values'}, 'Chart series')
        text(s['name'], 500)
        values = seq(s['values'], 60)
        if len(values) != len(categories):
            raise ValueError('Chart series and category length mismatch')
        if any(isinstance(v, bool) or not isinstance(v, (float, int)) or abs(v) > 1e15 or not math.isfinite(v) for v in values):
            raise ValueError('Chart values must be bounded finite numbers')
    title = text(chart.get('title', '数据图表'), 200)
    parts = [f'<svg viewBox="0 0 800 340" role="img" aria-labelledby="{chart_id}-title {chart_id}-desc"><title id="{chart_id}-title">{title}</title><desc id="{chart_id}-desc">完整数据见下方可展开数据表。</desc>']
    if kind == 'pie':
        parts[0] = parts[0].replace('viewBox="0 0 800 340"', 'class="pie-chart" viewBox="100 25 280 280"')
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
            start = end
    else:
        vals = [v for s in series for v in s['values']]
        low, high, ticks = nice_axis(vals)
        span = high - low
        y = lambda v: 270 - (v - low) / span * 230
        zero = y(0)
        for val, label in ticks:
            py = y(val)
            parts.append(f'<line x1="72" y1="{py}" x2="775" y2="{py}" stroke="#dce4e5"/><text class="axis-tick" x="62" y="{py+4}" text-anchor="end">{label}</text>')
        parts.append(f'<line class="zero-axis" x1="72" y1="{zero}" x2="775" y2="{zero}" stroke="#728786" stroke-width="1.5"/>')
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
    if kind == 'pie':
        legend = '<ul class="legend pie-legend" aria-label="构成类别与占比">' + ''.join('<li><i aria-hidden="true" style="background:' + COLORS[i % len(COLORS)] + '"></i><span>' + text(category, 500) + '</span><strong>' + format(series[0]['values'][i] / total, '.1%') + '</strong></li>' for i, category in enumerate(categories)) + '</ul>'
    rows = [[cat] + [s['values'][i] for s in series] for i, cat in enumerate(categories)]
    chart_container = '<div class="pie-container">' if kind == 'pie' else '<p class="scroll-hint">小屏可横向滚动图表；完整标签与数值见下方数据表。</p><div class="chart-scroll" tabindex="0" role="region" aria-label="可横向滚动的图表">'
    return chart_container + ''.join(parts) + '</div>' + legend + '<details><summary>查看图表数据 / Chart data</summary>' + table(['类别'] + [s['name'] for s in series], rows, chart.get('title', '图表数据')) + '</details><div class="print-chart-data">' + table(['类别'] + [s['name'] for s in series], rows, chart.get('title', '图表数据') + ' · 图表原始数据（打印）') + '</div>'


CSS = '''
.print-chart-data,.wide-table-print,.interactive-print{display:none}.table-controls{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:12px;font-size:12px}.table-controls input{font:inherit;padding:8px;border:1px solid var(--line);border-radius:5px;max-width:220px}.table-controls button,th button{font:inherit;color:var(--accent);background:transparent;border:1px solid var(--line);padding:7px;border-radius:4px;cursor:pointer}th button{border:0;padding:0;text-align:left}th[aria-sort=ascending] button::after{content:" ↑"}th[aria-sort=descending] button::after{content:" ↓"}.source-list{list-style:none;padding:0;margin:0}.source-list li{padding:16px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}.source-meta{color:var(--muted);font-size:12px}.source-refs{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;margin-top:16px}.source-list a{overflow-wrap:anywhere}:focus-visible{outline:3px solid #c37e23;outline-offset:4px}.empty-state{padding:24px;color:#637778;background:#f4f7f5;text-align:center}.scroll-hint{display:none;font-size:11px;color:#637778}thead{display:table-header-group}tr{break-inside:avoid}
:root{color-scheme:light;--ink:#203536;--muted:#637778;--paper:#f1f4f2;--line:#dce5e1;--accent:ACCENT}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;line-height:1.65}a{color:var(--accent)}.shell{max-width:1280px;margin:auto;padding:36px 42px 56px}header{border-top:5px solid var(--accent);padding:28px 0 30px;display:grid;grid-template-columns:1fr auto;gap:24px;align-items:end}.eyebrow,.label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:700}h1{font-size:clamp(28px,4vw,48px);letter-spacing:-.035em;line-height:1.17;margin:12px 0 16px;overflow-wrap:anywhere}h2{font-size:21px;line-height:1.4;margin:0 0 18px}h3{margin:0 0 8px;font-size:16px}p{margin:0 0 12px;overflow-wrap:anywhere}.subtitle{color:var(--muted);max-width:800px}.stamp{border:1px solid var(--line);padding:12px 18px;border-radius:10px;color:var(--muted);font-size:12px}.layout{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:22px}.section{grid-column:span 12;background:white;border:1px solid var(--line);border-radius:14px;padding:26px;min-width:0;box-shadow:0 8px 24px #20353603}.section.half{grid-column:span 6}.section.block-kpis{background:transparent;border:0;padding:0;box-shadow:none}.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:16px}.kpi{padding:23px 24px;background:white;border:1px solid var(--line);border-radius:12px;min-width:0}.kpi .value{font-size:32px;font-weight:750;letter-spacing:-.04em;line-height:1.3;margin:10px 0;overflow-wrap:anywhere}.kpi .note{font-size:12px;color:var(--muted)}.kpi:first-child{background:var(--accent);color:white}.kpi:first-child .label,.kpi:first-child .note{color:#ffffffdf}.table-scroll{overflow-x:auto;max-width:100%;border:1px solid var(--line);border-radius:8px}table{border-collapse:collapse;width:100%;font-size:13px}caption{text-align:left;padding:10px 14px;font-weight:600;color:var(--muted)}th,td{text-align:left;padding:12px 14px;border-top:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere;min-width:90px}th{background:#f4f7f5;color:var(--muted);font-size:12px}tbody tr:nth-child(even){background:#fafcfb}.chart-scroll{overflow-x:auto;max-width:100%}.chart-scroll svg{min-width:560px}svg{width:100%;height:auto;display:block}svg text{font-family:inherit;font-size:11px;fill:#637778}.legend{display:flex;flex-wrap:wrap;gap:18px;font-size:12px;color:var(--muted);margin:12px 0}.legend span{overflow-wrap:anywhere;min-width:0}.legend i{display:inline-block;width:9px;height:9px;margin-right:7px;border-radius:3px}details{border-top:1px solid var(--line);padding-top:12px;margin-top:16px}summary{cursor:pointer;font-size:12px;color:var(--accent);font-weight:650}details[open] summary{margin-bottom:12px}.timeline{list-style:none;margin:0;padding:0}.timeline li{display:grid;grid-template-columns:100px 1fr;gap:20px;padding:0 0 22px}.timeline time{font-size:12px;color:var(--muted)}.timeline article{border-left:2px solid var(--line);padding-left:20px}.timeline p{font-size:14px;color:var(--muted)}.callout{border-left:4px solid var(--accent);background:#f4f7f5;padding:20px}.board{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:18px}.lane{background:#f4f7f5;padding:16px;border-radius:9px;min-width:0}.card{background:white;padding:16px;border:1px solid var(--line);border-radius:8px;margin-top:12px}.card p{font-size:13px;color:var(--muted)}.badge{font-size:11px;border-radius:4px;padding:3px 7px;background:#e7efeb;color:var(--accent);display:inline-block;overflow-wrap:anywhere;max-width:100%}.prose{max-width:80ch;white-space:pre-line;overflow-wrap:anywhere}.source-refs a{overflow-wrap:anywhere;min-width:0;max-width:100%}footer{padding-top:25px;color:var(--muted);font-size:11px;display:flex;justify-content:space-between;gap:20px}.research .shell{max-width:1100px}.research h1{font-family:Georgia,"Songti SC",serif}.research .section{border-radius:3px}.research header{padding-bottom:40px}.comparison .section{border-top:3px solid var(--accent)}.operations .shell{max-width:1440px}.project header{border-top-width:2px}h2,h3,.label,.badge{overflow-wrap:anywhere}@media(max-width:760px){.scroll-hint{display:block}.shell{padding:20px 16px 36px}header{grid-template-columns:1fr;gap:8px}.stamp{justify-self:start}.section{padding:20px}.section.half{grid-column:span 12}.timeline li{grid-template-columns:75px 1fr;gap:8px}.layout{gap:16px}.kpi .value{font-size:28px}footer{flex-direction:column;gap:4px}}@media print{.interactive-screen{display:none}.interactive-print{display:block}.table-controls{display:none}th button{color:inherit;border:0}.wide-table-screen{display:none}.wide-table-print{display:block}.print-record{break-inside:avoid;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}.print-record dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 18px;font-size:10px}.print-record dl>div{min-width:0}.print-record dt{color:var(--muted);font-weight:600}.print-record dd{margin:0;overflow-wrap:anywhere}.source-list li{break-inside:avoid}.kpi-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.kpi{padding:12px}.kpi .value{font-size:22px}.kpi .label{font-size:10px}.chart-scroll svg{max-height:260px}.table-scroll{break-inside:avoid}table{font-size:11px}th,td{padding:8px}.legend{font-size:10px}@page{size:A4;margin:15mm}body{background:white}.shell{max-width:none;padding:0}.layout{display:block}.section{box-shadow:none;break-inside:auto;border-radius:0;margin:0 0 14px;padding:16px}.kpi,.card,.timeline li{break-inside:avoid}.block-kpis,.block-callout{break-inside:avoid}.chart-scroll{break-inside:avoid}.scroll-hint{display:none}h2,h3{break-after:avoid}.section.half{grid-column:span 12}header{padding-top:10px}.table-scroll,.chart-scroll{overflow:visible}.chart-scroll svg{min-width:0}th,td{min-width:0}details{display:none}.print-chart-data{display:block}summary{display:none}footer{position:static}h1{font-size:30px}}
'''


CSS += '\n/* Composition is driven by explicit information roles, not child position. */\nbody{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif;background:#f5f7f8;color:#22313c}\n.shell{max-width:1320px}.section{box-shadow:none;border-radius:5px;padding:28px}.section.main{grid-column:span 8}.section.rail{grid-column:span 4}.section.role-lead{border:0;border-top:3px solid var(--accent);background:#edf3f5}.section.role-aside{background:#f0f3f5;border:0}.section.role-action{border-left:4px solid var(--accent)}.section.role-reference{background:transparent;border:0;border-top:1px solid var(--line)}\nheader{border-top:0;border-bottom:1px solid var(--line);padding:16px 0 32px;margin-bottom:32px}.eyebrow,.label{letter-spacing:0;text-transform:none}.eyebrow{font-weight:600}.stamp{border:0;border-radius:0;border-left:1px solid var(--line)}h1{max-width:26ch;letter-spacing:-.025em}h2{font-size:20px;scroll-margin-top:24px}h3{font-size:15px}.subtitle{max-width:68ch}.layout{gap:24px}.kpi-grid{gap:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.kpi,.kpi:first-child{background:transparent;color:var(--ink);border:0;border-radius:0;padding:20px;border-right:1px solid var(--line)}.kpi:first-child .label,.kpi:first-child .note{color:var(--muted)}.kpi .value{font-variant-numeric:tabular-nums;font-size:30px}.kpi .label{color:var(--muted)}.callout{background:transparent;padding:0;border:0}.role-lead .callout{font-size:19px;line-height:1.8}.prose{line-height:1.9;max-width:72ch}td{font-variant-numeric:tabular-nums}.skip-link{position:absolute;left:16px;top:-100px;background:white;padding:12px;z-index:10}.skip-link:focus{top:10px}\n.dashboard .role-lead{padding:24px 32px}.dashboard .role-aside h2{font-size:17px}.dashboard .role-aside .callout{font-size:15px}.dashboard .role-aside td{padding:9px}.dashboard .main .chart-scroll svg{min-width:500px}\n.research .shell{max-width:1240px}.research header{max-width:1020px;margin-left:190px;padding-bottom:32px}.research h1{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:42px;max-width:22ch}.research .document-body{display:grid;grid-template-columns:160px minmax(0,1fr);gap:30px}.report-toc{font-size:12px;align-self:start;position:sticky;top:24px;display:grid;gap:14px;padding-top:12px}.report-toc a{text-decoration:none;color:var(--muted);overflow-wrap:anywhere}.report-toc a:hover{color:var(--accent);text-decoration:underline}.research .section{border:0;border-radius:0;background:transparent;padding:12px 0 28px;border-bottom:1px solid var(--line)}.research .section.main{grid-column:span 8}.research .section.rail{grid-column:span 4;padding:18px;background:#eaf0f5;align-self:start}.research .role-lead{grid-column:span 12;border-top:3px solid var(--accent);padding-top:24px}.research .prose{font-size:16px;line-height:2;max-width:68ch}.research .role-aside{font-size:13px}.research .role-aside h2{font-size:17px}.research .role-aside .callout{font-size:14px}.research .role-reference{font-size:13px}\n.project .section{border-radius:2px}.project .role-action{background:#f0edf6;border-left:4px solid var(--accent)}.project .block-timeline.main{background:transparent;border:0;padding-left:0}.project .timeline li{grid-template-columns:100px 1fr;padding-bottom:32px}.project .timeline article{border-left:3px solid var(--accent);padding-left:24px}.project .timeline time{font-weight:650;color:var(--accent)}.project .role-aside{align-self:start}.project header{border-bottom:3px solid var(--accent)}\n.comparison .section{border-top:0}.comparison .role-lead{background:transparent;border-bottom:2px solid var(--accent);padding-left:0;padding-right:0}.comparison .role-action{background:#f5f1e8}.comparison .block-table.full{padding:24px 0;border:0;background:transparent}.comparison .kpi-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;border:0}.comparison .kpi{border:1px solid var(--line);padding:24px;background:white}.comparison .role-aside{border-top:2px solid var(--accent)}\n.operations .shell{max-width:1480px;padding-top:24px}.operations header{padding:8px 0 20px;margin-bottom:20px;align-items:center}.operations h1{font-size:32px;margin:8px 0}.operations .layout{gap:16px}.operations .section{padding:20px;border-radius:2px}.operations .kpi{padding:12px 20px}.operations .kpi .value{font-size:26px;margin:4px 0}.operations .block-board{border:0;background:transparent;padding:0}.operations .lane{border-radius:0;background:#eaf0f3;border-top:3px solid var(--accent);padding:16px}.operations .card{border-radius:2px;padding:12px;margin-top:10px}.operations .block-table{padding:0;border:0}.operations .block-table h2{padding:4px 0}.operations td,.operations th{padding:9px 12px}.operations .role-action{background:white}.operations .block-timeline .timeline li{padding-bottom:16px}\n@media(max-width:1000px){.research header{margin-left:0}.research .document-body{grid-template-columns:1fr}.report-toc{position:static;display:flex;flex-wrap:wrap;gap:10px 18px;border-bottom:1px solid var(--line);padding:0 0 20px}.report-toc strong{width:100%}}\n@media(max-width:760px){.section.main,.section.rail,.research .section.main,.research .section.rail{grid-column:span 12}.shell{padding:20px 16px 36px}.section,.dashboard .role-lead{padding:20px}.research h1{font-size:32px}.research .prose{font-size:15px}.research .section.rail{padding:20px}.comparison .kpi-grid{grid-template-columns:1fr}.comparison .kpi{padding:18px}.kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.kpi{padding:16px}.kpi .value{font-size:26px}.stamp{padding-left:0;border:0}.project .timeline li{grid-template-columns:75px 1fr;gap:8px}.operations .shell{padding:20px 16px}.operations h1{font-size:28px}.operations .section{padding:18px}.operations .block-table,.operations .block-board{padding:0}.dashboard .main .chart-scroll svg{min-width:500px}.role-lead .callout{font-size:16px}}\n@media print{.skip-link,.report-toc{display:none}.research .document-body{display:block}.research header{margin-left:0}.section,.section.role-lead,.section.role-action,.section.role-aside,.research .section.rail{background:white;padding:12px;margin-bottom:14px}.project .timeline li{padding-bottom:16px}.dashboard .main .chart-scroll svg{min-width:0}.research h1{font-size:30px}.operations .shell{padding:0}.kpi .value{font-size:22px}.research .prose{font-size:12px;line-height:1.8}.comparison .kpi-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}\n'

CSS += '.aside-records article{padding:14px 0;border-top:1px solid var(--line)}.aside-records dl{margin:0;font-size:12px}.aside-records dl>div{display:grid;grid-template-columns:64px minmax(0,1fr);gap:10px;margin:5px 0}.aside-records dt{color:var(--muted)}.aside-records dd{margin:0;overflow-wrap:anywhere}.block-chart.full svg{max-height:400px}.comparison h1{max-width:30ch;text-wrap:balance}.research h1{text-wrap:balance}.project .role-action.rail{align-self:start}@media print{.block-chart.full svg{max-height:260px}.aside-records article{break-inside:avoid}}'

CSS += '.title-line{display:block;overflow-wrap:anywhere}h1:has(.title-line){max-width:none;text-wrap:wrap}'

CSS += 'svg text{font-size:16px}.chart-scroll svg,.dashboard .main .chart-scroll svg{min-width:620px}.block-chart.full svg text{font-size:13px}@media print{.chart-scroll svg,.dashboard .main .chart-scroll svg{min-width:0}svg text{font-size:16px}}'

CSS += '.pie-container{width:100%;max-width:360px;margin:12px auto}.pie-container svg{width:100%;min-width:0;max-height:320px}.pie-legend{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px 20px;font-size:14px}.pie-legend li{display:grid;grid-template-columns:12px minmax(0,1fr) auto;gap:8px;align-items:baseline;min-width:0}.pie-legend li span{overflow-wrap:anywhere}.pie-legend strong{font-weight:600;font-variant-numeric:tabular-nums}.pie-legend i{margin:0}@media print{.pie-container{max-width:240px}.pie-legend{font-size:11px}}'

def render_html(spec, output):
    fields(spec, {'version', 'scenario', 'title', 'subtitle', 'eyebrow', 'period', 'footer', 'sections', 'interaction', 'title_lines'}, 'HTML spec')
    if type(spec.get('version')) is not int or spec.get('version') != 1:
        raise ValueError('HTML spec requires version 1')
    if len(json.dumps(spec, ensure_ascii=False)) > 2_000_000:
        raise ValueError('HTML spec exceeds 2 MB')
    scenario = spec.get('scenario', 'dashboard')
    if scenario not in SCENARIOS:
        raise ValueError('Unknown HTML scenario')
    interaction = spec.get('interaction', 'static')
    if interaction not in ('static', 'first-party-table'):
        raise ValueError('Unknown interaction mode')
    title = text(spec['title'], 300)
    title_markup = title
    if 'title_lines' in spec:
        lines = spec['title_lines']
        if not isinstance(lines, list) or not 1 <= len(lines) <= 3 or any(not isinstance(line, str) or not line for line in lines) or ''.join(lines) != spec['title']:
            raise ValueError('title_lines requires 1..3 nonempty strings joining exactly to title')
        title_markup = ''.join('<span class="title-line">' + text(line, 300) + '</span>' for line in lines)
    sections = seq(spec.get('sections'), 80)
    if not sections:
        raise ValueError('Document requires sections')
    source_ids = set()
    for section in sections:
        validate_section(section)
        if section['type'] == 'sources':
            for item in section['items']:
                if item['id'] in source_ids:
                    raise ValueError('Duplicate source id')
                source_ids.add(item['id'])
    for section in sections:
        for source_id in seq(section.get('source_ids', []), 30):
            if not isinstance(source_id, str) or source_id not in source_ids:
                raise ValueError('Unknown source reference')
    rendered, charts = [], []
    for i, s in enumerate(sections):
        validate_section(s)
        kind = s.get('type')
        heading = f'<h2 id="section-{i}">{text(s["title"], 300)}</h2>' if s.get('title') else ''
        body = ''
        if kind == 'kpis':
            items = seq(s.get('items'), 8)
            body = '<div class="kpi-grid">' + ''.join('<article class="kpi"><div class="label">' + text(k['label'], 100) + '</div><div class="value">' + text(k['value'], 100) + '</div><div class="note">' + text(k.get('note', ''), 300) + '</div></article>' for k in items) + '</div>'
        elif kind == 'table':
            if 'interactive' in s and type(s['interactive']) is not bool:
                raise ValueError('interactive must be boolean')
            if s.get('interactive') is True and interaction != 'first-party-table':
                raise ValueError('interactive table requires first-party-table interaction mode')
            body = table(s.get('headers'), s.get('rows'), s.get('caption', s.get('title', '数据明细')), interaction == 'first-party-table' and s.get('interactive', True))
            if s.get('role') == 'aside' and s.get('width') == 'rail' and interaction == 'static':
                body = '<div class="aside-records">' + ''.join('<article><dl>' + ''.join('<div><dt>' + text(h) + '</dt><dd>' + table_cell(value) + '</dd></div>' for h, value in zip(s['headers'], row)) + '</dl></article>' for row in s['rows']) + '</div>'
        elif kind == 'chart':
            body = chart_svg(s['chart'], f'chart-{i}')
            charts.append(s['chart'])
        elif kind == 'text':
            body = '<div class="prose">' + text(s.get('body', '')) + '</div>'
        elif kind == 'callout':
            body = '<div class="callout"><p>' + text(s.get('body', '')) + '</p></div>'
        elif kind == 'timeline':
            body = '<ol class="timeline">' + ''.join('<li><time>' + text(e['date'], 100) + '</time><article><h3>' + text(e['title'], 300) + '</h3><p>' + text(e.get('body', '')) + '</p></article></li>' for e in seq(s.get('items'), 100)) + '</ol>'
        elif kind == 'sources':
            entries = []
            for source in s['items']:
                meta = ' · '.join(text(source[k], 300) for k in ('publisher', 'date') if source.get(k))
                link = '<p><a rel="noopener noreferrer" href="' + text(source['url']) + '">' + text(source['url']) + '</a></p>' if source.get('url') else ''
                entries.append('<li id="source-' + source['id'] + '"><h3>[' + source['id'] + '] ' + text(source['title'], 500) + '</h3><p class="source-meta">' + meta + '</p><p>' + text(source.get('note', '')) + '</p>' + link + '</li>')
            body = '<ol class="source-list">' + ''.join(entries) + '</ol>'
        elif kind == 'board':
            lanes = []
            for lane in seq(s.get('columns'), 6):
                cards = ''.join('<article class="card"><h3>' + text(c['title'], 300) + '</h3><p>' + text(c.get('body', '')) + '</p><span class="badge">' + text(c.get('tag', ''), 150) + '</span></article>' for c in seq(lane.get('items'), 100))
                lanes.append('<div class="lane"><h3>' + text(lane['title'], 150) + '</h3>' + cards + '</div>')
            body = '<div class="board">' + ''.join(lanes) + '</div>'
        else:
            raise ValueError('Unsupported section type')
        if s.get('source_ids'):
            body += '<nav class="source-refs" aria-label="本节来源">' + ''.join('<a href="#source-' + sid + '">来源 [' + sid + ']</a>' for sid in s['source_ids']) + '</nav>'
        width = s.get('width', 'full')
        if width not in ('full', 'half', 'main', 'rail'):
            raise ValueError('Section width must be full, half, main or rail')
        role = s.get('role', 'evidence')
        rendered.append(f'<section class="section block-{kind} {width} role-{role}">{heading}{body}</section>')
    toc = '<nav class="report-toc" aria-label="报告目录"><strong>阅读导航</strong>' + ''.join(f'<a href="#section-{i}">' + text(section['title'], 300) + '</a>' for i, section in enumerate(sections) if section.get('title')) + '</nav>' if scenario == 'research' else ''
    label, accent = SCENARIOS[scenario]
    markup = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'"><title>' + title + '</title><style>' + CSS.replace('ACCENT', accent) + '</style></head><body class="' + scenario + '"><a class="skip-link" href="#main-content">跳到正文</a><main class="shell" id="main-content"><header><div><div class="eyebrow">' + text(spec.get('eyebrow', label), 200) + '</div><h1>' + title_markup + '</h1><p class="subtitle">' + text(spec.get('subtitle', ''), 2000) + '</p></div><div class="stamp">' + text(spec.get('period', '内部资料 · 本地生成'), 200) + '</div></header><div class="document-body">' + toc + '<div class="layout">' + ''.join(rendered) + '</div></div><footer><span>' + text(spec.get('footer', '仅供内部使用 · 数据以业务来源为准'), 500) + '</span><span>OFFICE / ' + text(label) + '</span></footer></main></body></html>'
    if interaction == 'first-party-table':
        import base64
        runtime = (Path(__file__).resolve().parents[1] / 'first-party-table.js').read_text(encoding='utf-8')
        runtime_hash = base64.b64encode(hashlib.sha256(runtime.encode()).digest()).decode()
        policy = "default-src 'none'; script-src 'sha256-" + runtime_hash + "'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'"
        markup = markup.replace("default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'", policy)
        markup = markup.replace('</body>', '<script>' + runtime + '</script></body>')
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
    return {'version': 1, 'artifact': str(path), 'scenario': scenario, 'sections': len(sections), 'charts': len(charts), 'chart_data_sha256': hashlib.sha256(json.dumps(charts, sort_keys=True, ensure_ascii=False).encode()).hexdigest(), 'sha256': hashlib.sha256(markup.encode()).hexdigest(), 'network_dependencies': [], 'interaction': interaction, 'qa': 'pending_browser_and_visual_review'}
