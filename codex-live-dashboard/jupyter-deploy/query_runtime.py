"""Bounded read-only work, reusable exclusive sessions, and in-flight coalescing."""
from concurrent.futures import Future, ThreadPoolExecutor
from queue import LifoQueue
import hashlib, json, logging, threading, time
from logging.handlers import RotatingFileHandler
from pathlib import Path

class BusyError(Exception): pass

class SingleFlight:
    def __init__(self, limit=8):
        self.lock = threading.Lock()
        self.pending = {}
        self.limit = limit

    def run(self, key, work):
        with self.lock:
            future = self.pending.get(key)
            shared = future is not None
            if not shared:
                if len(self.pending) >= self.limit: raise BusyError('查询较多，请稍后重试')
                future = self.pending[key] = Future()
        if shared: return future.result(timeout=85), True
        try:
            value = work()
            future.set_result(value)
            return value, False
        except BaseException as error:
            future.set_exception(error)
            raise
        finally:
            with self.lock: self.pending.pop(key, None)

class QueryRuntime:
    def __init__(self, factory, concurrency=2):
        self.factory = factory
        self.executor = ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix='query')
        self.sessions = LifoQueue()
        for _ in range(concurrency): self.sessions.put(None)
        self.flights = SingleFlight()

    def submit(self, scope, stage, operation):
        queued = time.monotonic()
        def work():
            started = time.monotonic()
            slot = self.sessions.get(timeout=15)
            client = None
            reused = slot is not None and slot[0] == scope
            try:
                if slot is not None and not reused and hasattr(slot[1], 'close'): slot[1].close()
                client = slot[1] if reused else self.factory()
                connected = time.monotonic()
                value = operation(client)
                return value, {'stage':stage,'queueMs':round((started-queued)*1000),
                    'sessionMs':round((connected-started)*1000),
                    'queryMs':round((time.monotonic()-connected)*1000),'sessionReused':reused}
            except Exception:
                # A failed session is discarded; no automatic replay of unknown operations.
                if client is not None and hasattr(client, 'close'): client.close()
                client = None
                raise
            finally:
                self.sessions.put((scope,client) if client is not None else None)
        return self.executor.submit(work)

    def close(self):
        self.executor.shutdown(wait=True)
        while not self.sessions.empty():
            slot = self.sessions.get_nowait()
            if slot is not None and hasattr(slot[1], 'close'): slot[1].close()

def credential_scope():
    # The hash is used only in memory. Never log credentials or SQL.
    import tomllib
    cfg = tomllib.loads((Path.home()/'.config/codex-live-dashboard/config.toml').read_text(encoding='utf-8'))['mcp_servers']['data-gateway']
    return hashlib.sha256(json.dumps(cfg,sort_keys=True).encode()).hexdigest()

logger = logging.getLogger('dashboard.performance')
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = RotatingFileHandler(Path(__file__).with_name('performance.log'),maxBytes=2_000_000,backupCount=3,encoding='utf-8')
    logger.addHandler(handler)

def record(value): logger.info(json.dumps(value,ensure_ascii=False))
