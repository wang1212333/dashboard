import json, unittest, urllib.request, urllib.error, threading
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from server import parse_result, Handler, validate_dates

def result(text): return {'content':[{'type':'text','text':text}]}
class Checks(unittest.TestCase):
 def test_custom_date_validation(self):
  first,last=validate_dates('2026-09-01','2026-09-01')
  self.assertEqual(first,last)
  for start,end in [('2026-09-02','2026-09-01'),('2026-02-30','2026-03-01'),('2024-01-01','2026-01-01'),('', '2026-09-01'),("2026-09-01'",'2026-09-02')]:
   with self.assertRaises(ValueError): validate_dates(start,end)
 def test_null_is_not_zero(self):
  rows=parse_result(result('返回行数: 1\n\na | b\n--------------------\nnull | 0\n'))
  self.assertEqual(rows,[{'a':None,'b':'0'}])
 def test_truncated_results_rejected(self):
  with self.assertRaises(ValueError): parse_result(result('返回行数: 2\n\na\n--------------------\n1\n'))
 def test_errors_rejected(self):
  with self.assertRaises(ValueError): parse_result({'isError':True})
 def test_schema_mismatch_rejected(self):
  with self.assertRaises(ValueError): parse_result(result('返回行数: 1\n\na | b\n--------------------\n1\n'))
 def test_http_failure_and_origin_protection(self):
  server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  url=f'http://127.0.0.1:{server.server_port}/api/dashboard'
  try:
   with patch('server.dashboard',side_effect=RuntimeError('private failure details')):
    request=urllib.request.Request(url,headers={'Host':'127.0.0.1:4319'})
    with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(request)
    self.assertEqual(error.exception.code,502)
    self.assertNotIn('private',error.exception.read().decode())
   request=urllib.request.Request(url,headers={'Host':'127.0.0.1:4319','Sec-Fetch-Site':'cross-site'})
   with self.assertRaises(urllib.error.HTTPError) as error: urllib.request.urlopen(request)
   self.assertEqual(error.exception.code,403)
  finally: server.shutdown();server.server_close();thread.join()
if __name__=='__main__': unittest.main()
