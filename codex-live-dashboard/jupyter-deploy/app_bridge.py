import time
from server import dashboard, RUNTIME, SOURCE, TABLE, credential_scope, record, validate_dates

def run_query(params):
    started=time.monotonic()
    try:
        start,end,brand=params.get('start'),params.get('end'),params.get('brand','')
        if start is not None or end is not None:validate_dates(start or '',end or '')
        if not isinstance(brand,str) or len(brand)>80:raise ValueError('品牌无效')
        key=(credential_scope(),SOURCE,TABLE,start,end,brand)
        result,shared=RUNTIME.flights.run(key,lambda:dashboard(30,brand,start,end))
        result={**result,'sharedRequest':shared,'responseMs':round((time.monotonic()-started)*1000)}
        record({'requestId':result['requestId'],'status':'ok','responseMs':result['responseMs'],'timings':result['timings']})
        return result
    except Exception:
        record({'status':'failed','error':'query_failed'})
        return {'error':'服务器查询失败，请检查数据源连接和访问权限'}
