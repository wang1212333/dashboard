from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qs
import json, re, time, uuid
from gateway import Gateway
from sharing import SHARES, lan_address, cookie_token
from query_runtime import QueryRuntime, BusyError, credential_scope, record

ROOT = Path(__file__).parent
TABLE = 'sql_chat.sql_chat_siso_d_en'
SOURCE = 'SCM_SR_PRO'
RUNTIME = QueryRuntime(Gateway, concurrency=2)

def parse_result(result):
    if result.get('isError'): raise ValueError('数据源拒绝查询')
    text = '\n'.join(c.get('text','') for c in result.get('content',[]))
    lines = text.splitlines()
    divider = next((i for i,s in enumerate(lines) if re.fullmatch('-{10,}',s.strip())), None)
    if divider is None: raise ValueError('数据源返回格式异常')
    keys = [s.strip() for s in lines[divider-1].split(' | ')]
    rows = []
    for line in lines[divider+1:]:
        if not line.strip(): continue
        values = [s.strip() for s in line.split(' | ')]
        if len(values) != len(keys): raise ValueError('数据源字段数量不一致')
        rows.append(dict(zip(keys, [None if v.lower() in ('null','none') else v for v in values])))
    match = re.search(r'返回行数:\s*(\d+)', text)
    if not match or int(match[1]) != len(rows) or len(rows) >= 5000: raise ValueError('结果可能不完整')
    return rows

def query(client, sql):
    return parse_result(client.call('tools/call', {'name':'query_data','arguments':{'sql':sql,'datasource_name':SOURCE}}))

def numeric(rows, fields):
    for row in rows:
        for field in fields:
            row[field] = float(row[field]) if row.get(field) is not None else None
    return rows

def validate_dates(start, end):
    try:
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', start) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', end): raise ValueError()
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError: raise ValueError('请选择有效的开始日期和结束日期')
    if first > last: raise ValueError('开始日期不能晚于结束日期')
    if (last-first).days >= 366: raise ValueError('单次查询最多选择 366 天')
    if last > datetime.now(timezone(timedelta(hours=8))).date(): raise ValueError('结束日期不能晚于今天')
    return first, last

def dashboard(days, brand, start_date=None, end_date=None):
    started = time.monotonic()
    scope = credential_scope()
    timings = []
    futures = []
    def submit(stage, sql):
        future = RUNTIME.submit(scope, stage, lambda client: query(client,sql))
        futures.append(future)
        return future
    def collect(future):
        rows, timing = future.result()
        timings.append(timing)
        return rows
    try:
        today = datetime.now(timezone(timedelta(hours=8))).date()
        if start_date is not None or end_date is not None:
            first, end = validate_dates(start_date or '', end_date or '')
            days = (end-first).days+1
        else:
            anchor = collect(submit('latest_date',f"SELECT MAX(invoice_date) AS latest_date FROM {TABLE} WHERE invoice_date <= '{today}'"))[0]['latest_date']
            if not anchor: raise ValueError('当前权限内没有数据')
            latest = date.fromisoformat(anchor)
            end = latest
            first = latest-timedelta(days=days-1)
        start = first.isoformat()
        where = f"invoice_date >= '{start}' AND invoice_date <= '{end}'"
        brands_future = submit('brands', f"SELECT COALESCE(brand, '未标注') AS brand FROM {TABLE} WHERE {where} GROUP BY COALESCE(brand, '未标注') ORDER BY brand")
        if brand:
            where += " AND COALESCE(brand, '未标注') = '" + brand.replace("'", "''") + "'"
        daily_future = submit('daily', f"SELECT invoice_date, SUM(si) AS si, SUM(so) AS so, COUNT(*) AS records FROM {TABLE} WHERE {where} GROUP BY invoice_date ORDER BY invoice_date")
        countries_future = submit('countries', f"SELECT country_code, COALESCE(country_zh, country_code, '未标注') AS country, SUM(si) AS si, SUM(so) AS so FROM {TABLE} WHERE {where} GROUP BY country_code, country_zh ORDER BY si DESC LIMIT 10")
        options = [r['brand'] for r in collect(brands_future)]
        if brand and brand not in options: raise ValueError('所选品牌在当前期间不可用')
        daily = numeric(collect(daily_future), ['si','so','records'])
        if not daily: raise ValueError('当前筛选没有数据')
        anchor = daily[-1]['invoice_date']
        totals = numeric(collect(submit('totals', f"SELECT SUM(si) AS si, SUM(so) AS so, SUM(CASE WHEN invoice_date = '{anchor}' THEN total_stock_qty ELSE NULL END) AS stock, COUNT(*) AS records, COUNT(DISTINCT country_code) AS countries FROM {TABLE} WHERE {where}")), ['si','so','stock','records','countries'])[0]
        country_rows = numeric(collect(countries_future), ['si','so'])

        for field in ['si','so','records']:
            values = [r[field] for r in daily if r[field] is not None]
            if values and abs(sum(values)-(totals[field] or 0)) > .01: raise ValueError('汇总与趋势数据核对不一致，请稍后刷新')
        if not daily: raise ValueError('当前筛选没有数据')
        observed = {r['invoice_date'] for r in daily}
        missing = [(end-timedelta(days=i)).isoformat() for i in range(days) if (end-timedelta(days=i)).isoformat() not in observed]
        return {'requestId':str(uuid.uuid4()),'queriedAt':datetime.now(timezone.utc).isoformat(), 'durationMs':round((time.monotonic()-started)*1000), 'source':SOURCE,'table':TABLE,'dataDate':anchor,'startDate':start,'endDate':end.isoformat(),'days':days,'brand':brand,'brands':options,'totals':totals,'daily':daily,'countries':country_rows,'missingDates':missing,'dataLagDays':(today-date.fromisoformat(anchor)).days,'validated':True,'timings':timings}
    finally:
        for future in futures: future.cancel()
        for future in futures:
            if not future.cancelled():
                try: future.result()
                except Exception: pass


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def respond(self, status, value, content_type='application/json; charset=utf-8', headers=None):
        data = json.dumps(value,ensure_ascii=False).encode() if isinstance(value,dict) else value
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control','no-store')
        self.send_header('Referrer-Policy','no-referrer')
        for key,value in (headers or {}).items(): self.send_header(key,value)
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def local_owner(self):
        return self.client_address[0] in ('127.0.0.1','::1') and self.headers.get('Host') in ('127.0.0.1:4319','localhost:4319')
    def allowed_host(self):
        host=self.headers.get('Host')
        if host in ('127.0.0.1:4319','localhost:4319'):return True
        try:return host==lan_address()+':4319'
        except OSError:return False
    def share_access(self):
        return SHARES.get(cookie_token(self.headers.get('Cookie')),credential_scope())
    def do_POST(self):
        if not self.local_owner() or self.headers.get('Origin') != 'http://'+self.headers.get('Host','') or self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.respond(403,{'error':'分享管理仅限本机页面操作'})
        if self.headers.get('Content-Type') != 'application/json': return self.respond(400,{'error':'请求格式不正确'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=4096: return self.respond(400,{'error':'请求长度不正确'})
            body=json.loads(self.rfile.read(size))
            if self.path == '/api/shares/revoke':
                SHARES.revoke(str(body.get('id','')))
                return self.respond(200,{'ok':True})
            if self.path != '/api/shares': return self.respond(404,{'error':'未找到页面'})
            start,end=body.get('start',''),body.get('end','')
            validate_dates(start,end)
            brand=body.get('brand','')
            if not isinstance(brand,str) or len(brand)>80:raise ValueError('品牌无效')
            hours=body.get('hours',24)
            if hours not in (1,24,168):raise ValueError('有效期无效')
            token,item=SHARES.create({'start':start,'end':end,'brand':brand},credential_scope(),hours)
            return self.respond(200,{'url':'http://'+lan_address()+':4319/s/'+token,'id':item['id'],'expiresAt':item['expiresAt']})
        except (ValueError,TypeError): return self.respond(400,{'error':'请选择有效日期、品牌和有效期'})
        except Exception: return self.respond(503,{'error':'暂时无法生成分享链接'})
    def do_GET(self):
        if not self.allowed_host():return self.respond(403,{'error':'访问地址不允许'})
        parsed=urlparse(self.path)
        owner=self.local_owner()
        if parsed.path.startswith('/s/'):
            token=parsed.path[3:]
            access=SHARES.get(token,credential_scope())
            if not access:return self.respond(403,{'error':'分享链接已失效或已撤销，请联系分享人'})
            return self.respond(303,b'',headers={'Location':'/','Set-Cookie':'dashboard_share='+token+'; HttpOnly; SameSite=Lax; Path=/; Max-Age='+str(max(0,int(access['expiresAt']-time.time())))})
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':return self.respond(403,{'error':'不允许跨站请求'})
        if self.headers.get('Origin') not in (None,'http://'+self.headers.get('Host','')):return self.respond(403,{'error':'来源不允许'})
        access=None if owner else self.share_access()
        if not owner and not access:return self.respond(403,{'error':'需要有效分享链接；链接可能已过期、被撤销或服务已重启'})
        if parsed.path == '/': return self.respond(200,(ROOT/'index.html').read_bytes(),'text/html; charset=utf-8')
        if parsed.path == '/healthz': return self.respond(200,{'status':'ok'})
        if parsed.path == '/api/access':return self.respond(200,{'owner':owner,'filters':None if owner else access['filters'],'expiresAt':None if owner else access['expiresAt']})
        if parsed.path == '/api/shares':
            if not owner:return self.respond(403,{'error':'仅分享人可管理链接'})
            return self.respond(200,{'shares':SHARES.list()})
        if parsed.path != '/api/dashboard': return self.respond(404,{'error':'未找到页面'})
        args = parse_qs(parsed.query) if owner else {k:[v] for k,v in access['filters'].items()}
        request_started = time.monotonic()
        try:
            days = int(args.get('days',['30'])[0]); brand = args.get('brand',[''])[0]
            if days not in (7,30,90) or len(brand)>80: return self.respond(400,{'error':'筛选条件无效'})
            start_date, end_date = args.get('start',[None])[0], args.get('end',[None])[0]
            if start_date is not None or end_date is not None: validate_dates(start_date or '',end_date or '')
            request_started = time.monotonic()
            key = (credential_scope(), SOURCE, TABLE, start_date, end_date, None if start_date else days, brand)
            result, shared = RUNTIME.flights.run(key,lambda: dashboard(days,brand,start_date,end_date))
            elapsed = round((time.monotonic()-request_started)*1000)
            result = {**result,'sharedRequest':shared,'responseMs':elapsed}
            record({'requestId':result['requestId'],'status':'ok','responseMs':elapsed,'sharedRequest':shared,'timings':result['timings']})
            if not owner and not self.share_access():return self.respond(403,{'error':'分享链接已失效或已撤销'})
            self.respond(200,result)
        except BusyError as error: self.respond(429,{'error':str(error)})
        except ValueError as error:
            record({'status':'rejected','responseMs':round((time.monotonic()-request_started)*1000)})
            self.respond(422,{'error':str(error)})
        except Exception:
            record({'status':'failed','error':'query_failed','responseMs':round((time.monotonic()-request_started)*1000)})
            self.respond(502,{'error':'MCP 查询暂时失败，请检查网络或访问权限后重试'})

if __name__ == '__main__':
    print('Live dashboard: http://127.0.0.1:4319',flush=True)
    ThreadingHTTPServer(('0.0.0.0',4319),Handler).serve_forever()
