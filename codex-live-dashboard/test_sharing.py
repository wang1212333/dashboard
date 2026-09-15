import json,threading,unittest,urllib.request,urllib.error,time
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from sharing import Shares
from server import Handler

class ShareChecks(unittest.TestCase):
 def test_expiry_scope_and_revoke(self):
  store=Shares();token,item=store.create({'start':'2026-09-01'},'scope',1)
  self.assertIsNotNone(store.get(token,'scope'))
  self.assertIsNone(store.get(token,'different'))
  self.assertNotIn(token,str(store.items))
  with patch('sharing.time.time',return_value=time.time()+3601):self.assertIsNone(store.get(token,'scope'))
  store.revoke(item['id']);self.assertIsNone(store.get(token,'scope'))
 def test_http_scoped_share(self):
  store=Shares()
  with patch('server.SHARES',store),patch('server.credential_scope',return_value='scope'),patch('server.lan_address',return_value='10.1.2.3'):
   http=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
   base=f'http://127.0.0.1:{http.server_port}'
   def request(path,remote=False,token=None,body=None,origin=True):
    host='10.1.2.3:4319' if remote else '127.0.0.1:4319'
    headers={'Host':host}
    if token:headers['Cookie']='dashboard_share='+token
    if body is not None:
     headers['Content-Type']='application/json'
     if origin:headers['Origin']='http://'+host
    req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
    try:
     with urllib.request.urlopen(req) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
   try:
    self.assertEqual(request('/api/dashboard',True)[0],403)
    self.assertEqual(request('/api/shares',True,body={})[0],403)
    self.assertEqual(request('/api/shares',body={},origin=False)[0],403)
    code,share=request('/api/shares',body={'start':'2026-09-01','end':'2026-09-03','brand':'TECNO','hours':1})
    self.assertEqual(code,200);token=share['url'].split('/s/')[1]
    code,access=request('/api/access',True,token)
    self.assertFalse(access['owner']);self.assertEqual(access['filters']['brand'],'TECNO')
    with patch('server.dashboard',return_value={'requestId':'test','timings':[]}) as query:
     self.assertEqual(request('/api/dashboard?start=2020-01-01&end=2026-09-03&brand=itel',True,token)[0],200)
     query.assert_called_once_with(30,'TECNO','2026-09-01','2026-09-03')
    self.assertEqual(request('/api/shares',True,token)[0],403)
    self.assertEqual(request('/api/shares/revoke',body={'id':share['id']})[0],200)
    self.assertEqual(request('/api/dashboard',True,token)[0],403)
   finally:http.shutdown();http.server_close();thread.join()
if __name__=='__main__':unittest.main()
