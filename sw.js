/* ================================================================
 * Service worker – cho app MỞ ĐƯỢC KHI MẤT MẠNG.
 *
 * - Trang app (index.html): ưu tiên tải bản mới từ mạng; mất mạng / mạng quá chậm
 *   thì mở bản đã lưu lần trước. Vì vậy cơ chế tự cập nhật (APP_VER) vẫn chạy như cũ,
 *   KHÔNG cần đổi file này mỗi lần sửa index.html.
 * - config.js, manifest.json: cũng ưu tiên mạng, mất mạng mới dùng bản đã lưu.
 * - Font Google + thư viện CDN (xlsx, đọc mã vạch): lưu lại sau lần tải đầu tiên.
 * - Gọi máy chủ Apps Script (POST) và lệnh kiểm tra phiên bản (?vc=...) KHÔNG đi qua
 *   cache, nên hàng chờ quét QR / kiểm kê vẫn hoạt động y như trước.
 * Chỉ cần đổi CACHE khi muốn xóa sạch bộ nhớ đệm cũ trên máy người dùng.
 * ================================================================ */
const CACHE = 'annt-shell-v1';
const RUNTIME = 'annt-runtime-v1';
const SHELL = ['./', 'manifest.json', 'config.js'];
const NET_TIMEOUT = 6000;      // mạng chậm quá 6 giây thì mở bản đã lưu cho nhanh

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    // config.js có thể không có → lưu từng tệp, tệp nào lỗi thì bỏ qua
    Promise.all(SHELL.map(u => fetch(u, { cache: 'no-store' })
      .then(r => r.ok ? c.put(u, r) : null).catch(() => null)))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== RUNTIME).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Tải từ mạng (có giới hạn thời gian); thành công thì lưu vào cache dưới khóa `key`
function networkFirst(req, key) {
  return caches.open(CACHE).then(cache => {
    const net = fetch(req).then(r => {
      if (r && r.ok) cache.put(key, r.clone());
      return r;
    });
    const fallback = () => cache.match(key);
    const timer = new Promise(res => setTimeout(res, NET_TIMEOUT)).then(fallback);
    // Ai xong trước dùng nấy: mạng tốt → bản mới; mạng chậm/mất → bản đã lưu
    return Promise.race([
      net.catch(() => fallback().then(c => c || Promise.reject(new Error('offline')))),
      timer.then(c => c || net)
    ]).catch(() => fallback().then(c => c || Response.error()));
  });
}

// Thư viện có số phiên bản cố định → dùng bản đã lưu, chưa có thì tải và lưu lại
function cacheFirst(req) {
  return caches.open(RUNTIME).then(cache => cache.match(req).then(hit => hit || fetch(req).then(r => {
    if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone());
    return r;
  })));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // gọi máy chủ (POST) → không can thiệp
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.searchParams.has('vc')) return;          // kiểm tra phiên bản mới → luôn hỏi mạng
    const scope = new URL(self.registration.scope);
    if (req.mode === 'navigate' && url.pathname.startsWith(scope.pathname)) {
      // Mọi lần mở app (kể cả ?v=... sau khi cập nhật) đều dùng chung một bản lưu
      e.respondWith(networkFirst(req, './'));
      return;
    }
    const file = url.pathname.slice(scope.pathname.length);
    if (file === 'config.js' || file === 'manifest.json') e.respondWith(networkFirst(req, file));
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' ||
      url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(cacheFirst(req));
  }
});
