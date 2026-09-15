import threading, time, unittest
from concurrent.futures import ThreadPoolExecutor
from query_runtime import QueryRuntime, SingleFlight, BusyError

class RuntimeChecks(unittest.TestCase):
 def test_parallel_limit_reuse_and_discard(self):
  created=[]; lock=threading.Lock(); active=0; peak=0; gate=threading.Event(); both=threading.Event()
  def factory():
   value=object();created.append(value);return value
  runtime=QueryRuntime(factory,2)
  def operation(client):
   nonlocal active,peak
   with lock:
    active+=1;peak=max(peak,active)
    if active==2: both.set()
   gate.wait(3)
   with lock: active-=1
   return 1
  try:
   jobs=[runtime.submit('scope','stage',operation) for _ in range(6)]
   self.assertTrue(both.wait(2));gate.set()
   for j in jobs:self.assertEqual(j.result()[0],1)
   self.assertEqual(peak,2);self.assertEqual(len(created),2)
   value,timing=runtime.submit('scope','stage',lambda c:2).result()
   self.assertTrue(timing['sessionReused'])
   def fail(c):raise RuntimeError('failure')
   with self.assertRaises(RuntimeError):runtime.submit('scope','stage',fail).result()
   runtime.submit('scope','stage',lambda c:3).result()
   self.assertEqual(len(created),3)
   runtime.submit('new-scope','stage',lambda c:4).result()
   self.assertEqual(len(created),4)
  finally:gate.set();runtime.close()
 def test_coalescing_no_cache_and_failure_cleanup(self):
  flights=SingleFlight(limit=1);entered=threading.Event();release=threading.Event();calls=[]
  def work():calls.append(1);entered.set();release.wait(3);return 42
  with ThreadPoolExecutor(max_workers=3) as executor:
   first=executor.submit(flights.run,'same',work);self.assertTrue(entered.wait(2))
   second=executor.submit(flights.run,'same',work)
   time.sleep(.05)
   with self.assertRaises(BusyError):flights.run('different',work)
   release.set()
   self.assertEqual(first.result(),(42,False));self.assertEqual(second.result(),(42,True))
  self.assertEqual(len(calls),1)
  flights.run('same',work);self.assertEqual(len(calls),2)
  def fail():raise ValueError('failure')
  with self.assertRaises(ValueError):flights.run('error',fail)
  self.assertEqual(flights.run('error',lambda:9),(9,False))
if __name__=='__main__':unittest.main()
