/*******************************************************
 * ÂN NAM NHA TRANG – WEB APP
 * Báo cáo giao hàng • Tra cứu đơn • Thông tin TK • Lịch giao hàng
 * Đăng nhập theo vai trò • Lên đơn hàng Tết theo Scheme
 *******************************************************/

/* ================== CẤU HÌNH ================== */
/* ID các file/thư mục Google Drive được lưu trong Script Properties (không viết thẳng trong code).
 * Cài một lần: Apps Script → Cài đặt dự án (⚙) → Thuộc tính tập lệnh → thêm 7 khóa:
 *   APP_SS_ID, DATA_SS_ID, OPS_BARCODE_SS, STOCK_FOLDER_ID, WRITE_OFF_SS, QLCN_FOLDER_ID, BCS_FOLDER_ID */
const CFG_ = PropertiesService.getScriptProperties();
function cfg_(key) {
  const v = CFG_.getProperty(key);
  if (!v) console.error('Thiếu Script Property "' + key + '". Vào Cài đặt dự án → Thuộc tính tập lệnh để thêm.');
  return v || '';
}

const APP_SS_ID   = cfg_('APP_SS_ID'); // file chứa code, User, Scheme, DonTet
const DATA_SS_ID  = cfg_('DATA_SS_ID'); // file dữ liệu BC Giao hang / BCGH Data / AFF / Ref
const CS_EMAIL    = 'cs.nhatrang@annam-group.com';
const VAT_RATE    = 0.08;
const SESSION_HOURS = 8;           // phiên đăng nhập giữ 8 giờ kể từ lần thao tác cuối
const HASH_ROUNDS = 500;

// Biểu tượng tab trình duyệt khi mở bằng link Apps Script (tùy chọn).
// Dán link ảnh PNG công khai, VD: https://<tên>.github.io/<repo>/icon-192.png ; để trống nếu chưa có.
const APP_ICON_URL = '';

const SHEET_USER   = 'User';
const SHEET_SCHEME = 'Scheme';
const SHEET_TET    = 'DonTet';

const USER_HEADERS = ['Username', 'Role', 'Tên nhân viên', 'Email', 'Mật khẩu', 'Salt', 'Trạng thái', 'Đổi MK lần cuối',
                      'Tính năng riêng', 'Phạm vi dữ liệu'];
// I: để trống = theo vai trò; hoặc danh sách mã cách nhau dấu phẩy (scan,waiting,mine,tetnew,tetlist)
// J: để trống = theo vai trò; "all" = xem tất cả + bộ lọc; "own" = chỉ đơn của mình
const TET_HEADERS  = ['Mã đơn', 'Thời gian gửi', 'Username', 'Nhân viên', 'Nhóm KH', 'Mã KH', 'Tên KH',
                      'Ngày giao', 'Ghi chú', 'STT', 'Loại dòng', 'Mã hàng', 'Mô tả', 'Chương trình',
                      'Số lượng', 'Đơn giá', 'Thành tiền', 'Tiền hàng (đơn)', 'VAT 8%', 'Tổng thanh toán'];

const ROLE_LABELS = {
  admin: 'Admin', manager: 'Manager', sale: 'Sale', deliveryman: 'Delivery man',
  storekeeper: 'Store keeper', customerservice: 'Customer service', accountant: 'Accountant',
  tramin: 'Trạm in'
};
/* ---------- PHÂN NHÓM TÍNH NĂNG THEO VAI TRÒ ----------
 * COMMON_FEATURES : tính năng chung, ai đăng nhập cũng thấy.
 * ROLE_FEATURES   : tính năng riêng của từng vai trò (hiện ở nhóm "Công việc của tôi").
 *   scan    = Quét mã QR        waiting = Đơn chờ giao     mine = Đơn của tôi (giao hàng)
 *   tetnew  = Lên đơn Tết       tetlist = Đơn Tết đã gửi
 * Muốn mở/tắt tính năng cho vai trò nào, chỉ cần thêm/bớt mã ở đây.
 */
const COMMON_FEATURES = ['bc', 'update', 'lookup', 'bank', 'schedule'];
const ROLE_FEATURES = {
  admin:           ['scan', 'waiting', 'mine', 'tetnew', 'tetlist', 'kiemke', 'huyhang', 'soanhang', 'bcsoan', 'congno', 'intem', 'tramin', 'pallet'],
  manager:         ['scan', 'tetnew', 'tetlist', 'congno'],
  sale:            ['scan', 'tetnew', 'tetlist', 'congno'],
  deliveryman:     ['scan', 'waiting', 'mine'],
  storekeeper:     ['scan', 'waiting', 'kiemke', 'huyhang', 'soanhang', 'bcsoan', 'intem', 'pallet'],
  customerservice: ['scan', 'tetnew', 'tetlist', 'bcsoan', 'intem'],
  accountant:      ['scan', 'congno', 'intem'],
  tramin:          ['tramin']        // tài khoản riêng cho máy trạm in: chỉ màn hình Trạm in
};
// Danh sách tính năng riêng mà admin có thể gán cho từng user trên màn hình Quản trị
const FEATURE_LABELS = {
  scan: 'Quét mã QR', waiting: 'Đơn chờ giao', mine: 'Đơn của tôi (giao hàng)',
  tetnew: 'Lên đơn Tết', tetlist: 'Đơn Tết đã gửi',
  kiemke: 'Kiểm kê', huyhang: 'BC Hủy hàng', soanhang: 'Soạn hàng',
  bcsoan: 'Báo cáo soạn hàng', congno: 'Công nợ',
  intem: 'In tem', tramin: 'Trạm in tem (máy tính cạnh máy in)', pallet: 'Quản lý pallet'
};
/* Phạm vi dữ liệu mặc định theo vai trò:
 *   own = chỉ xem đơn của chính mình, không có bộ lọc (Sale)
 *   all = xem tất cả, có bộ lọc Bộ phận / Nhân viên (Manager, CS, Admin...) */
const ROLE_SCOPE = { sale: 'own' };

/* ---------- CÁC NÚT TRONG MÀN HÌNH QUÉT MÃ QR ----------
 * Mỗi nút: trạng thái ghi vào cột E của Log Detail + các vai trò được dùng.
 * Sau này thêm nút mới (VD: hoàn chứng từ) chỉ cần thêm 1 dòng ở đây và 1 dòng QR_MODES trong index.html.
 */
const SCAN_MODES = {
  // target 'log'  : ghi vào sheet Log Detail (A thời gian | B user | C mã | D ghi chú | E trạng thái | F người thực hiện)
  // target 'hct'  : ghi vào sheet "Hoan chung tu" (A ngày | B mã đơn | C ghi chú)
  XUAT:    { status: 'Đang giao',     target: 'log', roles: ['admin', 'deliveryman', 'storekeeper'] },
  GIAO:    { status: 'Đã giao',       target: 'log', roles: ['admin', 'deliveryman', 'storekeeper', 'sale', 'manager'] },
  HOAN_CT: { status: 'Hoàn chứng từ', target: 'hct', roles: ['admin', 'customerservice', 'accountant'] },
  // target 'ho'   : ghi vào sheet "Hand Over" (bàn giao chứng từ giữa các nhân viên) – MỌI nhân viên đều dùng được (xem scanModesOf_)
  BAN_GIAO:{ status: 'Bàn giao chứng từ', target: 'ho', roles: ['*'] }
};

const PERM = {
  deliveryAll: ['admin', 'manager']                      // xem "Đơn của tôi" của mọi NV giao hàng
};

/* ================== WEB APP ================== */
const CODE_VERSION = '2026-11-25d';

function doGet(e) {
  // Kiểm tra kết nối: mở <link /exec>?ping=1 trên trình duyệt để xem máy chủ có chạy không
  if (e && e.parameter && e.parameter.ping) {
    const out = { ok: true, app: 'Ân Nam Nha Trang', version: CODE_VERSION, time: Utilities.formatDate(new Date(), 'GMT+7', 'HH:mm:ss dd/MM/yyyy') };
    try { const sh = getUserSheet_(); out.users = Math.max(0, sh.getLastRow() - 1); } catch (err) { out.ok = false; out.error = 'Không đọc được sheet User: ' + err.message; }
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
  }
  const t = HtmlService.createTemplateFromFile('index');
  t.promoSource = computePromotion_.toString(); // dùng chung 1 logic khuyến mãi cho client & server
  const out = t.evaluate().setTitle('Ân Nam Nha Trang');
  if (APP_ICON_URL) out.setFaviconUrl(APP_ICON_URL);
  return out
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ================== API cho trang host ngoài (GitHub Pages) ================== */
const API_FUNCS = {
  login, getSession, logout, changePassword, getFormData, getDashboardData,
  getUpdateRequests, checkOrderData, getTetInit, submitTetOrder, getTetOrders,
  scanBatch, getWaitingOrders, getMyDelivery, getSchedule,
  adminListUsers, adminSaveUser, adminResetPassword, adminSaveSchedule,
  getOpsMaster, kkGetState, kkSave, kkSummary, kkFinish, adminImportStock, adminCreateCampaign, adminReopenCampaign, kkClaim, kkRelease,
  whSaveWriteOff, pickSearch, pickConfirm, pickOrders, pickComplete, pickHistory,
  listStaff, docsPending, adminSetPrioBy, bdHome, bdPost, bdWish, bdImage, setMyDob, getMyDob, msgInbox, msgSend, msgRead, debtReport, debtSetStatus, debtCustList, debtCustSave, debtCustDelete, debtOpenSave, debtSetAmount, debtExport, debtSaveRows, debtOrders, notifList, notifRead,
  debtThread, debtPostMsg, debtSaveNote, debtUpload, debtFile, cctvList, adminSaveCctv, bcsUpload, bcsSave, bcsSearch, bcsPhoto,
  printRequest, printList, printCancel, printNext, printDone,
  plMap, plInfo, plPutaway, plMove, plPick
};
function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = API_FUNCS[req.fn];
    if (!fn) throw new Error('Hàm không hợp lệ: ' + req.fn);
    stationGuard_(req);
    out = { ok: true, data: fn.apply(null, req.args || []) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* Tài khoản Trạm in (vai trò tramin) chỉ được gọi các hàm của Trạm in và đăng nhập/đổi mật khẩu */
const STATION_FUNCS = ['login', 'getSession', 'logout', 'changePassword', 'printNext', 'printDone'];
function stationGuard_(req) {
  if (STATION_FUNCS.indexOf(req.fn) !== -1) return;
  const tk = req.args && req.args[0];
  if (typeof tk !== 'string' || !tk) return;
  const s = readSession_(tk);
  if (s && s.u && normRole_(s.u.role) === 'tramin') throw new Error('Tài khoản Trạm in chỉ dùng được màn hình Trạm in.');
}

/* ================== CÀI ĐẶT BAN ĐẦU (chạy 1 lần) ================== */
function setup() {
  const ss = SpreadsheetApp.openById(APP_SS_ID);

  let u = ss.getSheetByName(SHEET_USER);
  if (!u) {
    u = newSheet_(ss, SHEET_USER);
    u.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS])
      .setFontWeight('bold').setBackground('#0b5cab').setFontColor('#ffffff');
    u.setFrozenRows(1);
    u.getRange('A:A').setNumberFormat('@');
    u.getRange('E:F').setNumberFormat('@');
    u.getRange(2, 1, 1, 7).setValues([['admin', 'admin', 'Quản trị viên', '', '123456', '', 'Active']]);
    const roleRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['admin', 'manager', 'sale', 'deliveryman', 'store keeper', 'customer service', 'accountant', 'tramin'], true).build();
    u.getRange('B2:B1000').setDataValidation(roleRule);
    const stRule = SpreadsheetApp.newDataValidation().requireValueInList(['Active', 'Khóa'], true).build();
    u.getRange('G2:G1000').setDataValidation(stRule);
    u.setColumnWidths(1, 8, 150);
    u.getRange('E1').setNote('Admin nhập mật khẩu mặc định (chữ thường) và XÓA ô Salt. ' +
      'User sẽ bị bắt đổi mật khẩu ở lần đăng nhập đầu, sau đó mật khẩu được mã hóa.');
  }

  // Bổ sung cột mới cho sheet User đã tạo từ trước
  // (sheet User có thể đã được chuyển thành "Bảng" có cột định kiểu → chỉ ghi khi thiếu, lỗi định dạng thì bỏ qua)
  const curH = u.getRange(1, 1, 1, USER_HEADERS.length).getValues()[0];
  USER_HEADERS.forEach((h, i) => { if (String(curH[i]).trim() !== h) safe_(() => u.getRange(1, i + 1).setValue(h)); });
  safe_(() => u.getRange(1, 1, 1, USER_HEADERS.length).setFontWeight('bold'));
  // Danh sách chọn vai trò ở cột B: thêm "tramin" (tài khoản Trạm in) nếu ô đang dùng danh sách chọn
  safe_(() => {
    const r = u.getRange('B2:B1000'), dv = r.getDataValidation();
    if (!dv || dv.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return;
    const list = dv.getCriteriaValues()[0] || [];
    if (list.indexOf('tramin') === -1) r.setDataValidation(dv.copy().requireValueInList(list.concat(['tramin']), dv.getCriteriaValues()[1]).build());
  });

  // Luôn cập nhật danh sách vai trò (kể cả khi sheet User đã tồn tại)
  safe_(() => u.getRange('B2:B1000').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['admin', 'manager', 'sale', 'deliveryman', 'store keeper', 'customer service', 'accountant'], true).build()));

  // Sheet cho chức năng kho
  appSheet_(SH_KK_DETAIL, KK_DETAIL_HEADERS);
  appSheet_(SH_KK_REPORT);
  appSheet_(SH_ORDER, ORDER_HEADERS);
  appSheet_(SH_PICK_LOG, PICK_LOG_HEADERS);
  appSheet_(SH_TFO, ['Item number', 'Product name', 'Batch number', 'Configuration', 'Transfer quantity', 'Available physical', 'Inventory unit', 'Shipped quantity', 'Spec']);
  appSheet_(SH_STOCK);
  appSheet_(SH_STOCK_KK);
  DriveApp.getFolderById(STOCK_FOLDER_ID).getName();   // xin quyền Google Drive (lưu file tồn kho)
  // Bàn giao chứng từ, Công nợ, BC Soạn hàng
  appSheet_(SH_HANDOVER, HO_HEADERS);
  appSheet_(SH_DEBT_CUST, CUST_HEADERS).getRange(1, 1, 1, CUST_HEADERS.length).setValues([CUST_HEADERS]);
  appSheet_(SH_DEBT, DEBT_HEADERS);
  appSheet_(SH_DEBT_AMT, AMT_HEADERS).getRange(1, 1, 1, AMT_HEADERS.length).setValues([AMT_HEADERS]);
  appSheet_(SH_DEBT_OPEN, OPEN_HEADERS2).getRange(1, 1, 1, OPEN_HEADERS2.length).setValues([OPEN_HEADERS2]);
  appSheet_(SH_DEBT_TALK, DEBT_TALK_HEADERS);
  appSheet_(SH_NOTIF, NOTIF_HEADERS);
  safe_(() => dobCol_(u, true));       // cột "Ngày sinh" trong sheet User
  appSheet_(SH_WISH, WISH_HEADERS);
  appSheet_(SH_MSG, MSG_HEADERS);
  appSheet_(SH_MSG_READ, MSG_READ_HEADERS);
  bdFolder_();      // thư mục ảnh lời chúc sinh nhật
  appSheet_(SH_CCTV, CCTV_HEADERS);
  DriveApp.getFolderById(QLCN_FOLDER_ID).getName();    // thư mục QL Cong no (tệp đính kèm công nợ)
  appSheet_(SH_BCS, BCS_HEADERS);
  DriveApp.getFolderById(BCS_FOLDER_ID).getName();     // thư mục ảnh soạn hàng
  // In tem: hàng chờ lệnh in + danh sách mã tem pallet đã tạo
  printSheet_();
  appSheet_(SH_TEM, TEM_HEADERS);
  // Quản lý pallet
  plSheet_();
  appSheet_(SH_PL_LOG, PL_LOG_HEADERS);

  let t = ss.getSheetByName(SHEET_TET);
  if (!t) {
    t = newSheet_(ss, SHEET_TET);
    t.getRange(1, 1, 1, TET_HEADERS.length).setValues([TET_HEADERS])
      .setFontWeight('bold').setBackground('#b71c1c').setFontColor('#ffffff');
    t.setFrozenRows(1);
    t.getRange('F:F').setNumberFormat('@');
    t.getRange('H:H').setNumberFormat('@');
    t.getRange('L:L').setNumberFormat('@');
    t.getRange('O:T').setNumberFormat('#,##0');
  }
  return 'OK';
}

/* ================== XÁC THỰC ================== */
function login(username, password) {
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');
  if (!username || !password) throw new Error('Vui lòng nhập tên đăng nhập và mật khẩu.');

  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('Tài khoản tạm khóa 10 phút do nhập sai nhiều lần.');

  const rec = findUser_(username);
  if (!rec || !isActive_(rec.status) || !checkPassword_(rec, password)) {
    cache.put(failKey, String(fails + 1), 600);
    throw new Error('Sai tên đăng nhập hoặc mật khẩu.');
  }
  cache.remove(failKey);

  purgeSessions_();
  const user = sessionFromRec_(rec);
  const token = Utilities.getUuid();
  putSession_(token, user);
  return { token: token, user: publicUser_(user) };
}

function getSession(token) {
  const u = requireUser_(token, true);
  const rec = findUser_(u.username.toLowerCase());
  if (!rec || !isActive_(rec.status)) {
    removeSession_(token);
    throw new Error('SESSION_EXPIRED');
  }
  const fresh = sessionFromRec_(rec);
  putSession_(token, fresh);
  return publicUser_(fresh);
}

function logout(token) {
  if (token) removeSession_(token);
  return true;
}

/* ---- lưu phiên (PropertiesService, không giới hạn 6 giờ như CacheService) ---- */
function putSession_(token, user) {
  const data = { u: user, exp: Date.now() + SESSION_HOURS * 3600000 };
  PropertiesService.getScriptProperties().setProperty('sess_' + token, JSON.stringify(data));
}
function readSession_(token) {
  const raw = PropertiesService.getScriptProperties().getProperty('sess_' + token);
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (!data.exp || data.exp < Date.now()) { removeSession_(token); return null; }
  return data;
}
function removeSession_(token) {
  PropertiesService.getScriptProperties().deleteProperty('sess_' + token);
}
function purgeSessions_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(k => {
    if (k.indexOf('sess_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

function changePassword(token, oldPw, newPw) {
  const u = requireUser_(token, true);
  oldPw = String(oldPw || ''); newPw = String(newPw || '');
  if (newPw.length < 6) throw new Error('Mật khẩu mới phải có ít nhất 6 ký tự.');
  if (newPw === oldPw) throw new Error('Mật khẩu mới phải khác mật khẩu hiện tại.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const rec = findUser_(u.username.toLowerCase());
    if (!rec || !checkPassword_(rec, oldPw)) throw new Error('Mật khẩu hiện tại không đúng.');
    const salt = Utilities.getUuid().replace(/-/g, '');
    const sh = getUserSheet_();
    sh.getRange(rec.row, 5, 1, 2).setValues([[hash_(newPw, salt), salt]]);
    sh.getRange(rec.row, 8).setValue(new Date());
  } finally {
    lock.releaseLock();
  }
  u.mustChange = false;
  putSession_(token, u);
  return publicUser_(u);
}

/* ---- helpers xác thực ---- */
function requireUser_(token, allowMustChange) {
  if (!token) throw new Error('SESSION_EXPIRED');
  const s = readSession_(token);
  if (!s) throw new Error('SESSION_EXPIRED');
  let u = s.u;
  // Làm mới vai trò / tính năng từ sheet User mỗi 5 phút (admin đổi quyền sẽ có hiệu lực nhanh)
  if (!u.r || Date.now() - u.r > 5 * 60000) {
    const rec = findUser_(String(u.username).toLowerCase());
    if (!rec || !isActive_(rec.status)) { removeSession_(token); throw new Error('SESSION_EXPIRED'); }
    const mc = u.mustChange && !rec.salt;
    u = sessionFromRec_(rec); u.mustChange = mc || !rec.salt;
    putSession_(token, u);
  } else if (s.exp - Date.now() < (SESSION_HOURS - 0.5) * 3600000) {
    putSession_(token, u);   // gia hạn phiên
  }
  if (u.mustChange && !allowMustChange) throw new Error('MUST_CHANGE_PASSWORD');
  return u;
}

function featuresOf_(u) {
  const own = String(u.features || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(f => FEATURE_LABELS[f]);
  if (String(u.features || '').trim().toLowerCase() === 'none') return [];
  return own.length ? own : (ROLE_FEATURES[u.role] || []).slice();
}
function scopeOf_(u) {
  if (u.scope === 'all' || u.scope === 'own') return u.scope;
  return ROLE_SCOPE[u.role] || 'all';
}
function hasFeature_(u, f) { return featuresOf_(u).indexOf(f) !== -1; }
function scanModesOf_(u) {
  // Các nút quét theo vai trò (cần tính năng "Quét mã QR"); riêng Bàn giao chứng từ: mọi nhân viên đều dùng được
  const out = hasFeature_(u, 'scan') ? Object.keys(SCAN_MODES).filter(m => m !== 'BAN_GIAO' && SCAN_MODES[m].roles.indexOf(u.role) !== -1) : [];
  out.push('BAN_GIAO');
  return out;
}
function can_(u, perm) {
  switch (perm) {
    case 'tetCreate': return hasFeature_(u, 'tetnew');
    case 'tetList':   return hasFeature_(u, 'tetnew') || hasFeature_(u, 'tetlist');
    case 'scanWrite': return scanModesOf_(u).length > 0;
    case 'tetViewAll': return scopeOf_(u) === 'all';
    case 'admin':     return u.role === 'admin';
    case 'waiting':   return hasFeature_(u, 'waiting');
    case 'mine':      return hasFeature_(u, 'mine');
    default:          return (PERM[perm] || []).indexOf(u.role) !== -1;
  }
}

function publicUser_(u) {
  return {
    username: u.username, name: u.name, role: u.role, email: u.email, mustChange: !!u.mustChange, ver: CODE_VERSION,
    common: u.role === 'tramin' ? [] : COMMON_FEATURES.slice(),
    features: featuresOf_(u),
    scanModes: scanModesOf_(u),
    scope: scopeOf_(u),
    perms: { tetCreate: can_(u, 'tetCreate'), tetViewAll: can_(u, 'tetViewAll'), tetList: can_(u, 'tetList'),
             scanWrite: can_(u, 'scanWrite'), deliveryAll: can_(u, 'deliveryAll'), admin: can_(u, 'admin') }
  };
}

function sessionFromRec_(rec) {
  return { username: rec.username, name: rec.name || rec.username, role: rec.role, email: rec.email, mustChange: !rec.salt,
           features: rec.features, scope: rec.scope, r: Date.now() };
}

function getUserSheet_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SHEET_USER);
  if (!sh) throw new Error('Chưa có sheet User. Hãy chạy hàm setup() trong Apps Script.');
  return sh;
}

function findUser_(username) {
  const v = getUserSheet_().getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]).trim().toLowerCase() === username) {
      return {
        row: i + 1, username: String(v[i][0]).trim(), role: normRole_(v[i][1]),
        name: String(v[i][2]).trim(), email: String(v[i][3]).trim(),
        password: String(v[i][4]), salt: String(v[i][5]).trim(), status: String(v[i][6]).trim(),
        features: String(v[i][8] || '').trim(), scope: String(v[i][9] || '').trim().toLowerCase()
      };
    }
  }
  return null;
}

function normRole_(r) { const k = String(r || '').toLowerCase().replace(/[\s_\-]/g, ''); return k === 'printstation' ? 'tramin' : k; }
function isActive_(s) { s = String(s || '').trim().toLowerCase(); return !s || s === 'active' || s === 'hoạt động'; }

function checkPassword_(rec, pw) {
  if (!rec.salt) return rec.password === pw;          // mật khẩu mặc định do admin đặt
  return hash_(pw, rec.salt) === rec.password;          // mật khẩu đã mã hóa
}

function hash_(pw, salt) {
  let h = salt + '|' + pw;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  }
  return 'sha256$' + h;
}

/* ================== BÁO CÁO GIAO HÀNG ================== */
function getFormData(token) {
  const u = requireUser_(token);
  const refSheet = SpreadsheetApp.openById(DATA_SS_ID).getSheetByName('Ref');
  const refData = refSheet.getDataRange().getValues().slice(1);
  const uniq = arr => [...new Set(arr.map(v => String(v).trim()).filter(v => v))];
  return {
    dept: uniq(refData.map(r => r[1])),
    sales: uniq(refData.map(r => r[0])),
    lockedSales: scopeOf_(u) === 'own' ? u.name : ''
  };
}

function getDashboardData(token, dept, sales) {
  const u = requireUser_(token);
  if (scopeOf_(u) === 'own') sales = u.name; // chỉ xem đơn của mình

  const ss = SpreadsheetApp.openById(DATA_SS_ID);
  const sheet = ss.getSheetByName('BC Giao hang');
  const affSheet = ss.getSheetByName('AFF');

  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  const col = {};
  headers.forEach((h, i) => col[String(h).trim()] = i);

  // Thời gian cập nhật: dòng đầu tiên sau tiêu đề của sheet AFF
  let affTime = '';
  if (affSheet) {
    const aff = affSheet.getDataRange().getValues();
    if (aff.length > 1) {
      let idx = aff[0].indexOf('Created date and time');
      if (idx === -1) idx = aff[0].indexOf('Created date');
      if (idx !== -1) affTime = fmtDateTime_(aff[1][idx], 'HH:mm dd/MM/yyyy');
    }
  }

  const filtered = data.filter(r => {
    const rSales = String(r[col['Sales responsible']] || '').trim();
    const rDept = String(r[col['Dept']] || '').trim();
    return (!sales || rSales === sales) && (!dept || rDept === dept);
  });

  const from = new Date(Date.now() - 14 * 86400000); from.setHours(0, 0, 0, 0);
  const statusOrder = ['Đang giao', 'Đã soạn hàng', 'Chưa xác nhận', 'Chờ lịch giao', 'Đã giao'];
  const result = [];

  statusOrder.forEach(status => {
    const rows = filtered.filter(r => {
      if (String(r[col['Status']] || '').trim() !== status) return false;
      if (status !== 'Đã giao') return true;
      const d = r[col['Delivery date']];
      if (!(d instanceof Date)) return false;
      const c = new Date(d.getTime()); c.setHours(0, 0, 0, 0);
      return c.getTime() >= from.getTime();
    });
    if (!rows.length) return;

    let updateTime = affTime;
    if (status === 'Đang giao' || status === 'Đã giao') {
      let max = 0;
      rows.forEach(r => { const t = toTime_(r[col['Delivery date']]); if (t > max) max = t; });
      updateTime = max ? Utilities.formatDate(new Date(max), 'GMT+7', 'HH:mm dd/MM/yyyy') : '';
    }

    result.push({
      status: status,
      updateTime: updateTime,
      rows: rows.map(r => mapOrderRow_(r, col))
    });
  });
  return result;
}

function checkOrderData(token, searchValue) {
  requireUser_(token);
  const q = String(searchValue || '').toLowerCase().trim();
  if (!q) return [];
  const ss = SpreadsheetApp.openById(DATA_SS_ID);
  let out = [];

  ['BC Giao hang', 'BCGH Data'].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    const col = {};
    data[0].forEach((h, i) => col[String(h).trim()] = i);

    let regex = null;
    if (q.indexOf('*') !== -1) {
      const esc = q.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      regex = new RegExp('^' + esc);
    }
    data.slice(1).forEach(r => {
      const so = String(r[col['Sales order']] || '').toLowerCase();
      const po = String(r[col['Customer requisition']] || '').toLowerCase();
      const cu = String(r[col['Customer name']] || '').toLowerCase();
      const ok = so.includes(q) || po.includes(q) || (regex ? regex.test(cu) : cu.includes(q));
      if (ok && (so || po || cu)) {
        const m = mapOrderRow_(r, col); m.source = name; out.push(m);
      }
    });
  });
  return out.slice(0, 300);
}

/* ================== QUẢN TRỊ (chỉ admin) ================== */
function requireAdmin_(token) {
  const u = requireUser_(token);
  if (u.role !== 'admin') throw new Error('Chỉ admin mới dùng được chức năng này.');
  return u;
}
const ROLE_SHEET_VALUE = { admin: 'admin', manager: 'manager', sale: 'sale', deliveryman: 'deliveryman',
  storekeeper: 'store keeper', customerservice: 'customer service', accountant: 'accountant', tramin: 'tramin' };

function adminListUsers(token) {
  requireAdmin_(token);
  const v = getUserSheet_().getDataRange().getValues();
  const users = [], dob = dobMap_();
  for (let i = 1; i < v.length; i++) {
    const username = String(v[i][0]).trim();
    if (!username) continue;
    const role = normRole_(v[i][1]);
    users.push({ dob: dob[key_(username)] || '',
      username: username, role: role, name: String(v[i][2]).trim(), email: String(v[i][3]).trim(),
      status: isActive_(v[i][6]) ? 'Active' : 'Khóa', mustChange: !String(v[i][5]).trim(),
      features: String(v[i][8] || '').trim(), scope: String(v[i][9] || '').trim().toLowerCase(),
      lastChange: v[i][7] instanceof Date ? Utilities.formatDate(v[i][7], 'GMT+7', 'dd/MM/yyyy HH:mm') : ''
    });
  }
  return {
    users: users,
    roles: Object.keys(ROLE_LABELS).map(k => ({ key: k, label: ROLE_LABELS[k], features: ROLE_FEATURES[k] || [], scope: ROLE_SCOPE[k] || 'all' })),
    features: Object.keys(FEATURE_LABELS).map(k => ({ key: k, label: FEATURE_LABELS[k] }))
  };
}

/** Thêm mới (isNew=true, kèm password mặc định) hoặc cập nhật user */
function adminSaveUser(token, d, isNew) {
  const me = requireAdmin_(token);
  d = d || {};
  const username = String(d.username || '').trim();
  if (!/^[A-Za-z0-9._\-]{2,40}$/.test(username)) throw new Error('Tên đăng nhập chỉ gồm chữ không dấu, số, dấu . _ - (2–40 ký tự).');
  const role = normRole_(d.role);
  if (!ROLE_LABELS[role]) throw new Error('Vai trò không hợp lệ.');
  if (String(d.dob || '').trim() && !normDob_(d.dob)) throw new Error('Ngày sinh không hợp lệ – nhập dạng ngày/tháng, VD 25/12.');
  const name = String(d.name || '').trim();
  if (!name) throw new Error('Vui lòng nhập tên nhân viên.');
  const status = d.status === 'Khóa' ? 'Khóa' : 'Active';
  const scope = d.scope === 'all' || d.scope === 'own' ? d.scope : '';
  let features = '';
  if (d.features === 'none') features = 'none';
  else if (Array.isArray(d.features)) {
    const list = d.features.filter(f => FEATURE_LABELS[f]);
    features = list.length ? list.join(',') : 'none';
  }
  const isMe = username.toLowerCase() === me.username.toLowerCase();
  if (isMe && (role !== 'admin' || status !== 'Active')) throw new Error('Không thể tự hạ quyền hoặc khóa chính tài khoản admin đang đăng nhập.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = getUserSheet_();
    const rec = findUser_(username.toLowerCase());
    if (isNew) {
      if (rec) throw new Error('Tên đăng nhập "' + username + '" đã tồn tại.');
      const pw = String(d.password || '').trim();
      if (pw.length < 4) throw new Error('Mật khẩu mặc định phải có ít nhất 4 ký tự.');
      const row = sh.getLastRow() + 1;
      safe_(() => sh.getRange(row, 1, 1, 1).setNumberFormat('@'));
      safe_(() => sh.getRange(row, 5, 1, 2).setNumberFormat('@'));
      sh.getRange(row, 1, 1, 10).setValues([[username, ROLE_SHEET_VALUE[role], name, String(d.email || '').trim(),
                                            pw, '', status, '', features, scope]]);
    } else {
      if (!rec) throw new Error('Không tìm thấy user ' + username);
      sh.getRange(rec.row, 2, 1, 3).setValues([[ROLE_SHEET_VALUE[role], name, String(d.email || '').trim()]]);
      sh.getRange(rec.row, 7).setValue(status);
      sh.getRange(rec.row, 9, 1, 2).setValues([[features, scope]]);
    }
    if (d.dob !== undefined) setDob_(username, d.dob);    // ngày sinh (cột "Ngày sinh" sheet User)
  } finally {
    lock.releaseLock();
  }
  return adminListUsers(token);
}

/** Đặt lại mật khẩu mặc định: user sẽ phải đổi mật khẩu khi đăng nhập lần sau */
function adminResetPassword(token, username, pw) {
  requireAdmin_(token);
  pw = String(pw || '').trim();
  if (pw.length < 4) throw new Error('Mật khẩu mặc định phải có ít nhất 4 ký tự.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const rec = findUser_(String(username || '').trim().toLowerCase());
    if (!rec) throw new Error('Không tìm thấy user.');
    const sh = getUserSheet_();
    safe_(() => sh.getRange(rec.row, 5, 1, 2).setNumberFormat('@'));
    sh.getRange(rec.row, 5, 1, 2).setValues([[pw, '']]);
  } finally {
    lock.releaseLock();
  }
  return true;
}

/* ================== LỊCH GIAO HÀNG (admin sửa trên app) ================== */
const DEFAULT_SCHEDULE = {
  days: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'],
  driverLabel: 'Giao hàng xe máy',
  drivers: ['Duy', 'Cảnh', 'Huy', 'Duy', 'Cảnh', 'Huy'],
  sessions: [
    { name: 'Sáng', cells: [
      { priority: '', route: 'Tuyến phía Bắc', stores: 'Lotte Mart\nCo.op Mart', center: 'MTI/GT/HRC trung tâm' },
      { priority: '', route: '', stores: 'Mega Market', center: 'MTI/GT/HRC trung tâm' },
      { priority: 'Đảo Hòn Tre', route: 'Tuyến phía Bắc', stores: '', center: 'MTI/GT/HRC trung tâm' },
      { priority: 'Cam Ranh', route: '', stores: 'Lotte Mart\nWinmart Trần Phú', center: 'MTI/GT/HRC trung tâm' },
      { priority: '', route: 'Tuyến phía Bắc', stores: 'Winmart Lê Thánh Tôn\nWinmart Thái Nguyên', center: 'MTI/GT/HRC trung tâm' },
      { priority: 'Cam Ranh, Đảo Hòn Tre', route: '', stores: 'Go Nha Trang\nLotte Gold Coast', center: 'MTI/GT/HRC trung tâm' }
    ] },
    { name: 'Chiều', cells: [
      { priority: '', route: 'Tuyến phía Nam', stores: '', center: 'MTI/GT/HRC trung tâm' },
      { priority: 'Cam Ranh, Trảng É', route: 'Tuyến phía Nam', stores: 'Lotte Gold Coast\nWinmart Trần Phú', center: 'MTI/GT/HRC trung tâm' },
      { priority: '', route: 'Tuyến phía Nam', stores: 'Go Nha Trang', center: 'MTI/GT/HRC trung tâm' },
      { priority: '', route: 'Tuyến phía Nam', stores: 'Lotte Gold Coast\nMega Market\nCo.op Mart', center: 'MTI/GT/HRC trung tâm' },
      { priority: '', route: 'Tuyến phía Nam', stores: '', center: 'MTI/GT/HRC trung tâm' },
      { priority: '', route: 'Tuyến phía Nam', stores: '', center: 'MTI/GT/HRC trung tâm' }
    ] }
  ],
  notes: [
    { label: 'Đảo Hòn Tre / Cam Ranh', style: 'priority', text: 'Lịch giao cố định, ưu tiên' },
    { label: 'Tuyến phía Bắc', style: 'route', text: 'Giao cách ngày' },
    { label: 'MT/GT/HRC trung tâm:', style: 'center', text: 'Giao hàng ngày, lưu ý tần suất giao hàng mỗi khách, không giao 2 ngày liên tiếp.' }
  ],
  updatedAt: '', updatedBy: ''
};

function scheduleRaw_() {
  const raw = PropertiesService.getScriptProperties().getProperty('SCHEDULE_JSON');
  if (raw) { try { return JSON.parse(raw); } catch (e) {} }
  return JSON.parse(JSON.stringify(DEFAULT_SCHEDULE));
}
/** Lịch giao + danh sách nhân viên giao hàng (sheet User, vai trò deliveryman) để app nhận ra "tên cuối" trong lịch là ai */
function getSchedule(token) {
  requireUser_(token);
  const s = scheduleRaw_();
  s.men = deliverymen_();
  return s;
}
/** Tách ô "Cố định / ưu tiên" thành từng tuyến: "Cam Ranh, Đảo Hòn Tre" → ['Cam Ranh', 'Đảo Hòn Tre'] */
const prioRoutes_ = t => String(t || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
/** Admin gán người phụ trách 1 tuyến ưu tiên (nhãn nhỏ trên tuyến) */
function adminSetPrioBy(token, day, ses, route, name) {
  const u = requireAdmin_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const s = scheduleRaw_();
    const cell = s.sessions[ses] && s.sessions[ses].cells[day];
    if (!cell) throw new Error('Không tìm thấy ô lịch.');
    if (prioRoutes_(cell.priority).indexOf(String(route)) === -1) throw new Error('Tuyến "' + route + '" không có trong ô này.');
    cell.prioBy = cell.prioBy || {};
    if (String(name || '').trim()) cell.prioBy[route] = String(name).trim().slice(0, 60); else delete cell.prioBy[route];
    s.updatedAt = Utilities.formatDate(new Date(), 'GMT+7', 'HH:mm dd/MM/yyyy'); s.updatedBy = u.name;
    delete s.men;
    PropertiesService.getScriptProperties().setProperty('SCHEDULE_JSON', JSON.stringify(s));
    s.men = deliverymen_();
    return s;
  } finally { lock.releaseLock(); }
}

function adminSaveSchedule(token, sch) {
  const u = requireAdmin_(token);
  const s = v => String(v == null ? '' : v).trim().slice(0, 300);
  if (!sch || !Array.isArray(sch.days) || !sch.days.length || !Array.isArray(sch.sessions)) throw new Error('Dữ liệu lịch không hợp lệ.');
  const n = Math.min(sch.days.length, 7);
  const clean = {
    days: sch.days.slice(0, n).map(s),
    driverLabel: s(sch.driverLabel) || 'Giao hàng xe máy',
    drivers: Array.from({ length: n }, (_, i) => s((sch.drivers || [])[i])),
    sessions: sch.sessions.slice(0, 4).map(se => ({
      name: s(se.name),
      cells: Array.from({ length: n }, (_, i) => {
        const c = (se.cells || [])[i] || {};
        const pr = s(c.priority), by = {};
        prioRoutes_(pr).forEach(r => { const v = c.prioBy && c.prioBy[r]; if (String(v || '').trim()) by[r] = s(v).slice(0, 60); });
        return { priority: pr, prioBy: by, route: s(c.route), stores: s(c.stores), center: s(c.center) };
      })
    })),
    notes: (sch.notes || []).slice(0, 10).map(x => ({ label: s(x.label), style: ['priority', 'route', 'center'].indexOf(x.style) !== -1 ? x.style : 'center', text: s(x.text) }))
                                           .filter(x => x.label || x.text),
    updatedAt: Utilities.formatDate(new Date(), 'GMT+7', 'HH:mm dd/MM/yyyy'),
    updatedBy: u.name
  };
  PropertiesService.getScriptProperties().setProperty('SCHEDULE_JSON', JSON.stringify(clean));
  clean.men = deliverymen_();
  return clean;
}

/* ================== QUÉT MÃ QR ================== */
const LOG_SHEET = 'Log Detail';      // A thời gian | B user | C mã | D ghi chú | E trạng thái | F người thực hiện
const SCAN_STATUS = { XUAT: SCAN_MODES.XUAT.status, GIAO: SCAN_MODES.GIAO.status };
const SCAN_ALLOW_DUPLICATE = false;  // false = chặn mã đã có cùng trạng thái trong Log Detail
const SCAN_MAX_BATCH = 50;
const LOG_TAIL_ROWS = 6000;          // số dòng cuối Log Detail được đọc cho màn hình giao hàng (giữ app nhanh)

function logSheet_() {
  const sh = SpreadsheetApp.openById(DATA_SS_ID).getSheetByName(LOG_SHEET);
  if (!sh) throw new Error('Không tìm thấy sheet ' + LOG_SHEET);
  return sh;
}

// Dòng cuối có dữ liệu ở cột A
function lastRowInColA_(sh) {
  const maxRow = sh.getMaxRows();
  const bottom = sh.getRange(maxRow, 1);
  if (bottom.getValue() !== '') return maxRow;
  return bottom.getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
}

// Chuyển giá trị thời gian trong Log Detail (Date hoặc chuỗi "dd/MM/yyyy, HH:mm:ss") về Date
function logDate_(v) {
  if (v instanceof Date) return v;
  const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\D*(\d{1,2})?:?(\d{2})?:?(\d{2})?/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function scanTime_(ts) {
  const n = Number(ts);
  if (n && Math.abs(Date.now() - n) < 2 * 24 * 3600 * 1000) return new Date(n);
  return new Date();
}

const HCT_SHEET = 'Hoan chung tu';

// Dòng cuối có dữ liệu ở 1 cột bất kỳ
function lastRowInCol_(sh, col) {
  const maxRow = sh.getMaxRows();
  const bottom = sh.getRange(maxRow, col);
  if (bottom.getValue() !== '') return maxRow;
  return bottom.getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
}

function fmtDup_(status, time, by) {
  const d = logDate_(time);
  return 'Đã "' + status + '" lúc ' + (d ? Utilities.formatDate(d, 'GMT+7', 'HH:mm dd/MM') : String(time || '')) + (by ? ' bởi ' + by : '');
}

/**
 * Nhận 1 lô mã từ điện thoại (gửi nền, không chặn việc quét).
 * Mỗi mã trả về Success / Duplicate / Error để hiện trong lịch sử quét.
 */
function scanBatch(token, items) {
  const u = requireUser_(token);
  items = Array.isArray(items) ? items.slice(0, SCAN_MAX_BATCH) : [];
  if (!items.length) return [];
  const allowed = scanModesOf_(u);
  if (!allowed.length) throw new Error('Tài khoản của bạn chưa được mở chức năng quét mã.');

  const results = {}, groups = { log: [], hct: [], ho: [] };
  items.forEach(it => {
    const m = allowed.indexOf(it.mode) !== -1 ? SCAN_MODES[it.mode] : null;
    const code = String(it.code || '').trim();
    if (!m) results[it.id] = { id: it.id, result: 'Error', message: 'Bạn không được dùng chức năng này' };
    else if (!code) results[it.id] = { id: it.id, result: 'Error', message: 'Mã rỗng' };
    else groups[m.target].push({ id: it.id, code: code, status: m.status, note: String(it.note || '').trim(), ts: it.ts,
                                 from: String(it.from || '').trim(), to: String(it.to || '').trim(), ret: !!it.ret });
  });

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (groups.log.length) writeLogScans_(u, groups.log, results);
    if (groups.hct.length) writeHctScans_(u, groups.hct, results);
    if (groups.ho.length) writeHandOver_(u, groups.ho, results);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return items.map(it => results[it.id] || { id: it.id, result: 'Error', message: 'Không xử lý được' });
}

function writeLogScans_(u, list, results) {
  const sh = logSheet_();
  const lastRow = lastRowInColA_(sh);
  const existing = {};
  if (!SCAN_ALLOW_DUPLICATE && lastRow >= 2) {
    const v = sh.getRange(2, 3, lastRow - 1, 3).getValues();      // chỉ đọc C:E (mã, ghi chú, trạng thái) cho nhanh
    for (let i = v.length - 1; i >= 0; i--) {
      const k = String(v[i][0]).trim() + '|' + String(v[i][2]).trim();
      if (!(k in existing)) existing[k] = i + 2;
    }
  }
  const rows = [], seen = {};
  list.forEach(it => {
    const k = it.code + '|' + it.status;
    if (!SCAN_ALLOW_DUPLICATE) {
      if (seen[k]) return results[it.id] = { id: it.id, result: 'Duplicate', message: 'Trùng trong lượt gửi' };
      if (existing[k]) {
        const r = sh.getRange(existing[k], 1, 1, 2).getValues()[0];
        return results[it.id] = { id: it.id, result: 'Duplicate', message: fmtDup_(it.status, r[0], r[1]) };
      }
    }
    seen[k] = true;
    rows.push([scanTime_(it.ts), u.username, it.code, it.note, it.status, u.name]);
    results[it.id] = { id: it.id, result: 'Success' };
  });
  if (!rows.length) return;
  const start = lastRow + 1, need = start + rows.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 100);
  safe_(() => { sh.getRange(start, 3, rows.length, 1).setNumberFormat('@'); });
  safe_(() => { if (lastRow >= 2) sh.getRange(start, 1, rows.length, 1).setNumberFormat(sh.getRange(lastRow, 1).getNumberFormat()); });
  sh.getRange(start, 1, rows.length, 6).setValues(rows);
}

function writeHctScans_(u, list, results) {
  // Hoàn chứng từ: KHÔNG kiểm tra trùng – mã đã có trong cột B vẫn ghi thêm dòng mới
  const sh = SpreadsheetApp.openById(DATA_SS_ID).getSheetByName(HCT_SHEET);
  if (!sh) { list.forEach(it => results[it.id] = { id: it.id, result: 'Error', message: 'Không tìm thấy sheet ' + HCT_SHEET }); return; }
  const lastRow = lastRowInCol_(sh, 2);
  const rows = list.map(it => {
    results[it.id] = { id: it.id, result: 'Success' };
    return [scanTime_(it.ts), it.code, it.note];
  });
  const start = lastRow + 1, need = start + rows.length - 1;
  if (need > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows() + 100);
  safe_(() => { sh.getRange(start, 2, rows.length, 1).setNumberFormat('@'); });
  safe_(() => { sh.getRange(start, 1, rows.length, 1).setNumberFormat(lastRow >= 2 ? sh.getRange(lastRow, 1).getNumberFormat() : 'dd/MM/yyyy'); });
  sh.getRange(start, 1, rows.length, 3).setValues(rows);
}

/** Tra cứu nhanh danh sách mã (dùng cho user quét để xem thông tin) */
function lookupCodes(token, codes) {
  requireUser_(token);
  const want = {};
  (codes || []).slice(0, 50).forEach(c => { c = String(c || '').trim().toUpperCase(); if (c) want[c] = true; });
  const out = {};
  const ss = SpreadsheetApp.openById(DATA_SS_ID);
  ['BC Giao hang', 'BCGH Data'].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const v = sh.getDataRange().getValues();
    const col = {};
    v[0].forEach((h, i) => col[String(h).trim()] = i);
    for (let i = 1; i < v.length; i++) {
      const so = String(v[i][col['Sales order']] || '').trim().toUpperCase();
      const po = String(v[i][col['Customer requisition']] || '').trim().toUpperCase();
      const key = want[so] ? so : (want[po] ? po : '');
      if (key && !out[key]) out[key] = mapOrderRow_(v[i], col);
    }
  });
  return out;
}

/* ================== GIAO HÀNG (dành cho Deliveryman) ================== */
function normName_(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
}
// "Nguyễn Văn Duy" khớp với "Duy" (tên gọi trong cột Delivery man)
function sameMan_(fullName, short) {
  const a = normName_(fullName), b = normName_(short);
  if (!a || !b) return false;
  return a === b || a.split(' ').pop() === b || b.split(' ').pop() === a;
}

function readLogTail_() {
  const sh = logSheet_();
  const last = lastRowInColA_(sh);
  if (last < 2) return [];
  const start = Math.max(2, last - LOG_TAIL_ROWS + 1);
  return sh.getRange(start, 1, last - start + 1, 6).getValues();
}

function reportIndex_() {
  const v = SpreadsheetApp.openById(DATA_SS_ID).getSheetByName('BC Giao hang').getDataRange().getValues();
  const col = {};
  v[0].forEach((h, i) => col[String(h).trim()] = i);
  const map = {};
  for (let i = 1; i < v.length; i++) {
    const so = String(v[i][col['Sales order']] || '').trim();
    if (so) map[so] = v[i];
  }
  return { rows: v, col: col, map: map };
}

function orderInfo_(rep, code, time) {
  const r = rep.map[code], c = rep.col;
  return {
    time: time, so: code,
    req: r ? String(r[c['Customer requisition']] || '') : '',
    customer: r ? String(r[c['Customer name']] || '') : '(chưa có trong BC Giao hàng)',
    sales: r ? String(r[c['Sales responsible']] || '') : '',
    dept: r ? String(r[c['Dept']] || '') : '',
    doc: r && c['Document'] !== undefined ? docDate_(r[c['Document']]) : ''
  };
}

/** Đơn đã quét XUẤT HÀNG hôm nay nhưng chưa quét GIAO HÀNG */
function getWaitingOrders(token) {
  const u = requireUser_(token);
  if (!can_(u, 'waiting')) throw new Error('Bạn không có quyền xem mục này.');
  const today = Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd');
  const log = readLogTail_();
  const delivered = {};
  log.forEach(r => { if (String(r[4]).trim() === SCAN_STATUS.GIAO) delivered[String(r[2]).trim()] = true; });

  const rep = reportIndex_(), seen = {}, out = [];
  log.forEach(r => {
    const code = String(r[2]).trim(), d = logDate_(r[0]);
    if (!code || seen[code] || delivered[code] || String(r[4]).trim() !== SCAN_STATUS.XUAT) return;
    if (!d || Utilities.formatDate(d, 'GMT+7', 'yyyyMMdd') !== today) return;
    seen[code] = true;
    const o = orderInfo_(rep, code, Utilities.formatDate(d, 'GMT+7', 'HH:mm'));
    o.by = String(r[5] || r[1] || '');
    out.push(o);
  });
  return out.reverse();
}

/** Đơn của tôi: đã giao hôm nay + KPI giao hàng trong tháng */
/* ================== DASHBOARD NHÂN VIÊN GIAO HÀNG ==================
 * Nguồn: Log Detail – mỗi mã quét "Đã giao" = 1 đơn giao thành công.
 * Ghi chú có chữ "Xe máy" (nút Giao hàng xe máy) → đơn xe máy, còn lại → xe tải.
 * Danh sách nhân viên: sheet User, vai trò deliveryman. */
const DELI_RATE = { truck: 4000, bike: 6000 };      // đơn giá / đơn giao thành công
function deliverymen_() {
  const v = getUserSheet_().getDataRange().getValues(), out = [];
  for (let i = 1; i < v.length; i++) {
    const un = String(v[i][0]).trim();
    if (un && normRole_(v[i][1]) === 'deliveryman' && isActive_(v[i][6])) out.push({ u: un, name: String(v[i][2]).trim() || un });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
/** Đọc Log Detail từ dưới lên theo từng khối cho tới khi gặp dòng trước thời điểm `since` */
function readLogSince_(since) {
  const sh = logSheet_(), last = lastRowInColA_(sh), out = [];
  const CH = 4000;
  for (let end = last; end >= 2; end -= CH) {
    const start = Math.max(2, end - CH + 1);
    const v = sh.getRange(start, 1, end - start + 1, 6).getValues();
    let older = 0;
    for (let i = v.length - 1; i >= 0; i--) {
      const d = logDate_(v[i][0]);
      if (!d) continue;
      if (d.getTime() < since.getTime()) { older++; continue; }
      v[i][0] = d; out.push(v[i]);
    }
    if (older > v.length * 0.9) break;     // khối này gần như toàn dòng cũ → dừng
  }
  return out;
}
const isBike_ = note => normName_(note).indexOf('xe may') !== -1;

function getMyDelivery(token, who, month) {
  const u = requireUser_(token);
  if (!can_(u, 'mine')) throw new Error('Bạn không có quyền xem mục này.');
  const men = deliverymen_();
  let man = men.find(m => key_(m.u) === key_(u.username)) || { u: u.username, name: u.name };
  if (can_(u, 'deliveryAll') && who) man = men.find(m => key_(m.u) === key_(who)) || man;
  else if (can_(u, 'deliveryAll') && !men.some(m => key_(m.u) === key_(u.username)) && men.length) man = men[0];

  const now = new Date();
  const curM = Utilities.formatDate(now, 'GMT+7', 'yyyy-MM');
  month = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : curM;
  const [y, mo] = month.split('-').map(Number);
  const since = new Date(Date.UTC(y, mo - 1, 1, -7));                        // 00:00 ngày 1 giờ VN
  const until = new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1, -7));
  const todayK = Utilities.formatDate(now, 'GMT+7', 'yyyyMMdd');
  const rep = reportIndex_();

  const seen = {}, days = {}, list = [];
  readLogSince_(since).forEach(r => {
    const d = r[0];
    if (d.getTime() >= until.getTime()) return;
    if (String(r[4]).trim() !== SCAN_STATUS.GIAO) return;
    if (key_(r[1]) !== key_(man.u) && !sameMan_(man.name, r[5])) return;
    const code = String(r[2]).trim(); if (!code || seen[key_(code)]) return;
    seen[key_(code)] = 1;
    const bike = isBike_(r[3]);
    const dk = Utilities.formatDate(d, 'GMT+7', 'yyyyMMdd');
    const o = days[dk] || (days[dk] = { day: Utilities.formatDate(d, 'GMT+7', 'dd/MM'), truck: 0, bike: 0 });
    bike ? o.bike++ : o.truck++;
    const info = orderInfo_(rep, code, Utilities.formatDate(d, 'GMT+7', 'dd/MM HH:mm'));
    list.push({ t: d.getTime(), today: dk === todayK, time: info.time, so: code, customer: info.customer, doc: info.doc, vehicle: bike ? 'Xe máy' : 'Xe tải',
                note: String(r[3] || '') });
  });
  const money = o => o.truck * DELI_RATE.truck + o.bike * DELI_RATE.bike;
  const dayArr = Object.keys(days).sort().map(k => Object.assign(days[k], { money: money(days[k]), total: days[k].truck + days[k].bike }));
  const tot = dayArr.reduce((s, x) => ({ truck: s.truck + x.truck, bike: s.bike + x.bike }), { truck: 0, bike: 0 });
  const td = days[todayK] || { truck: 0, bike: 0 };
  const months = [];
  for (let i = 0; i < 6; i++) { const d = new Date(Date.UTC(Number(curM.slice(0, 4)), Number(curM.slice(5)) - 1 - i, 15)); months.push(Utilities.formatDate(d, 'GMT+7', 'yyyy-MM')); }
  list.sort((a, b) => b.t - a.t);
  return {
    man: man, men: can_(u, 'deliveryAll') ? men : [], month: month, months: months, isCurrent: month === curM, rates: DELI_RATE,
    today: { truck: td.truck, bike: td.bike, total: td.truck + td.bike, money: money(td) },
    total: { truck: tot.truck, bike: tot.bike, total: tot.truck + tot.bike, money: money(tot), days: dayArr.length },
    days: dayArr, orders: list.slice(0, 600)
  };
}

/* ================== CCTV (admin khai báo, dùng cho BC Soạn hàng) ================== */
const SH_CCTV = 'CCTV';
const CCTV_HEADERS = ['Mã CCTV', 'Vị trí', 'Ghi chú'];
function cctvRead_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_CCTV);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().filter(r => String(r[0]).trim())
           .map(r => ({ code: String(r[0]).trim(), name: String(r[1]).trim(), note: String(r[2] || '').trim() }));
}
function cctvList(token) {
  const u = requireUser_(token);
  if (!hasFeature_(u, 'bcsoan') && u.role !== 'admin') throw new Error('Bạn không có quyền.');
  return { list: cctvRead_(), at: nowStr_() };
}
function adminSaveCctv(token, rows) {
  requireAdmin_(token);
  const out = [], seen = {}, errors = [];
  (rows || []).forEach((r, i) => {
    const code = String(r.code || '').trim(), name = String(r.name || '').trim();
    if (!code && !name) return;
    if (!code) errors.push('Dòng ' + (i + 1) + ': thiếu Mã CCTV');
    else if (seen[key_(code)]) errors.push('Dòng ' + (i + 1) + ': trùng mã ' + code);
    if (!name) errors.push('Dòng ' + (i + 1) + ': thiếu Vị trí');
    seen[key_(code)] = 1;
    out.push([code, name, String(r.note || '').trim()]);
  });
  if (errors.length) throw new Error(errors.slice(0, 8).join('\n'));
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = appSheet_(SH_CCTV, CCTV_HEADERS);
    if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 3).clearContent();
    if (out.length) { safe_(() => sh.getRange(2, 1, out.length, 1).setNumberFormat('@')); sh.getRange(2, 1, out.length, 3).setValues(out); }
  } finally { lock.releaseLock(); }
  return { list: cctvRead_() };
}

/* ================== YÊU CẦU KIỂM TRA (logic DashboardCheck) ================== */
function getUpdateRequests(token, dept, sales) {
  const u = requireUser_(token);
  if (scopeOf_(u) === 'own') sales = u.name;

  const ss = SpreadsheetApp.openById(DATA_SS_ID);
  const data1 = ss.getSheetByName('BC Giao hang').getDataRange().getValues();
  const headers = data1[0].map(h => String(h).trim());
  const col = {};
  headers.forEach((h, i) => col[h] = i);

  // Gộp BCGH Data theo đúng thứ tự cột của BC Giao hang
  let rows = data1.slice(1);
  const sh2 = ss.getSheetByName('BCGH Data');
  if (sh2) {
    const data2 = sh2.getDataRange().getValues();
    const col2 = {};
    data2.shift().forEach((h, i) => col2[String(h).trim()] = i);
    rows = rows.concat(data2.map(r2 => headers.map(h => col2[h] === undefined ? '' : r2[col2[h]])));
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(23, 59, 59, 999);

  const defs = [
    { title: 'Đơn hàng ĐÃ POST - Chưa có thông tin giao hàng', rows: [] },
    { title: 'Đơn hàng ĐÃ XUẤT HÀNG - Chưa có báo cáo giao hàng', rows: [] },
    { title: 'Đơn hàng ĐÃ GIAO HÀNG - Chưa cập nhật báo cáo giao hàng', rows: [] },
    { title: 'Đơn hàng CHƯA HOÀN CHỨNG TỪ', rows: [] }
  ];
  const seen = [{}, {}, {}, {}];
  const add = (g, r) => {
    const so = String(r[col['Sales order']] || '').trim();
    if (so && seen[g][so]) return;      // bỏ trùng đơn xuất hiện ở cả 2 sheet
    if (so) seen[g][so] = true;
    defs[g].rows.push(r);
  };

  rows.forEach(r => {
    const status = String(r[col['Status']] || '').trim();
    if (!status || status === 'Đã hủy' || status === 'RETURN') return;
    if (sales && String(r[col['Sales responsible']] || '').trim() !== sales) return;
    if (dept && String(r[col['Dept']] || '').trim() !== dept) return;

    const dStatus = String(r[col['Delivery Status']] || '').trim();
    const dDate = r[col['Delivery date']];
    const doc = col['Document'] === undefined ? '' : r[col['Document']];

    if (status === 'Đã soạn hàng') add(0, r);
    if (dStatus === 'Đã xuất hàng' && dDate instanceof Date && dDate <= yesterday && !doc) add(1, r);
    if ((status === 'Đang giao' || status === 'Đã soạn hàng') && doc) add(2, r);
    if (status === 'Đã giao' && !doc) add(3, r);
  });

  defs[3].rows.sort((a, b) => toTime_(b[col['Delivery date']]) - toTime_(a[col['Delivery date']]));

  return {
    time: Utilities.formatDate(new Date(), 'GMT+7', 'HH:mm dd/MM/yyyy'),
    groups: defs.map(d => ({ title: d.title, rows: d.rows.map(r => mapOrderRow_(r, col)) }))
  };
}

function mapOrderRow_(r, col) {
  const g = k => (col[k] === undefined ? '' : r[col[k]]);
  return {
    created: fmtDateTime_(g('Created date and time'), 'dd/MM/yy - HH:mm'),
    so: String(g('Sales order') || ''),
    req: String(g('Customer requisition') || ''),
    customer: String(g('Customer name') || ''),
    sales: String(g('Sales responsible') || ''),
    status: String(g('Status') || ''),
    deliveryStatus: String(g('Delivery Status') || ''),
    deliveryDate: fmtDateTime_(g('Delivery date'), 'dd/MM/yy - HH:mm'),
    deliveryMan: String(g('Delivery man') || ''),
    doc: docDate_(g('Document'))            // ngày hoàn chứng từ
  };
}

/** Ngày hoàn chứng từ: ô ngày → dd/MM/yyyy; chữ thì giữ nguyên (không tự đoán kiểu ngày để tránh đảo ngày/tháng) */
function docDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'GMT+7', 'dd/MM/yyyy');
  return String(v == null ? '' : v).trim();
}
function fmtDateTime_(v, pattern) {
  if (v instanceof Date) return Utilities.formatDate(v, 'GMT+7', pattern);
  if (!v) return '';
  const p = Date.parse(v);
  return isNaN(p) ? String(v) : Utilities.formatDate(new Date(p), 'GMT+7', pattern);
}
function toTime_(v) {
  if (v instanceof Date) return v.getTime();
  const p = v ? Date.parse(v) : NaN;
  return isNaN(p) ? 0 : p;
}

/* ================== ĐƠN HÀNG TẾT ================== */
function getTetInit(token) {
  const u = requireUser_(token);
  if (!can_(u, 'tetCreate')) throw new Error('Bạn không có quyền lên đơn Tết.');
  return { catalog: loadCatalog_(), customers: loadCustomers_(), vatRate: VAT_RATE,
           promoSource: computePromotion_.toString() };
}

function loadCatalog_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SHEET_SCHEME);
  if (!sh) throw new Error('Không tìm thấy sheet Scheme.');
  const last = sh.getLastRow();
  if (last < 3) return { GT: {}, MTI: {} };
  return parseSchemeRows_(sh.getRange(3, 1, last - 2, 11).getDisplayValues());
}

/**
 * Đọc sheet Scheme (từ dòng 3, cột A:K).
 * Dòng "MOQ" (cột C) hoặc dòng tiêu đề (cột D có tên, B/C trống) + có số ở G:K => bắt đầu 1 khối mới.
 * Dòng hàng có chữ "Buy x get y" ở H:K => cập nhật bộ scheme cho các mã phía dưới trong khối.
 */
function parseSchemeRows_(rows) {
  const clean = s => String(s == null ? '' : s).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const num = s => { s = clean(s).replace(/[^\d.]/g, ''); return s === '' ? null : Number(s); };
  const out = { GT: {}, MTI: {} };
  let block = null, schemes = [], seq = 0;

  rows.forEach(r => {
    const grp = clean(r[0]).toUpperCase();
    if (!out[grp]) return;
    const b = clean(r[1]), c = clean(r[2]), d = clean(r[3]);
    const isHeader = c.toUpperCase() === 'MOQ' || (!b && !c && d);
    if (isHeader) {
      const moq = [6, 7, 8, 9, 10].map(i => num(r[i]));
      if (moq.some(x => x !== null)) {
        block = { id: grp + '-B' + (++seq), name: c.toUpperCase() === 'MOQ' ? '' : d, moq: moq };
        schemes = [];
      }
      return;
    }
    if (!c || !block) return;

    const texts = [7, 8, 9, 10].map(i => clean(r[i]).replace(/"/g, '').replace(/\s+/g, ' '));
    if (texts.some(t => t)) {
      schemes = [];
      texts.forEach((t, k) => {
        const m = t.match(/buy\s*(\d+)\s*get\s*(\d+)/i);
        const moq = block.moq[k + 1];
        if (m && moq !== null) {
          schemes.push({ idx: k + 1, buy: Number(m[1]), get: Number(m[2]),
                         mix: /mix\s*flavou?r/i.test(t), moq: moq, text: t });
        }
      });
    }
    if (!block.name) block.name = d.split(/\s+/).slice(0, 2).join(' ');
    out[grp][c] = {
      code: c, desc: d, type: clean(r[4]), price: num(r[5]) || 0, pmf: clean(r[6]),
      itemGroup: b || c, blockId: block.id, blockName: block.name, schemes: schemes
    };
  });
  return out;
}

function loadCustomers_() {
  const sh = SpreadsheetApp.openById(DATA_SS_ID).getSheetByName('BCGH Data');
  if (!sh) return [];
  const v = sh.getDataRange().getValues();
  const head = v[0].map(h => String(h).trim());
  let ci = head.indexOf('Customer account'), ni = head.indexOf('Customer name');
  if (ci === -1) ci = 3;
  if (ni === -1) ni = 4;
  const seen = {}, out = [];
  for (let i = 1; i < v.length; i++) {
    const code = String(v[i][ci] || '').trim(), name = String(v[i][ni] || '').trim();
    if (!code || code === 'Mã Khách hàng' || seen[code]) continue;
    seen[code] = true;
    out.push([code, name]);
  }
  return out;
}

/**
 * LOGIC KHUYẾN MÃI – dùng chung cho trình duyệt và server (được nhúng vào index.html).
 * lines: [{code, qty}] theo thứ tự sale nhập; catalog: {code: item}; splits: {poolKey: {code: qty}}
 * - Gom số lượng theo nhóm cột B để chọn Scheme cao nhất đạt MOQ.
 * - Scheme có chữ "mix flavour": xét MOQ & tính hàng tặng trên tổng cả khối (FOX, DEKA).
 * - Hàng tặng = floor(SL / buy) * get; giao cho mã mua nhiều nhất; >= 4 hộp và nhóm có >= 2 mã => 2 dòng để sale chia.
 * - Scheme 0: mỗi hộp mua có mã PMF => tặng 1 PMF, cộng dồn cuối đơn.
 */
function computePromotion_(lines, catalog, splits) {
  splits = splits || {};
  function best(schemes, qty, mix) {
    var b = null;
    schemes.forEach(function (s) {
      if (!!s.mix === mix && qty >= s.moq && (!b || s.idx > b.idx)) b = s;
    });
    return b;
  }
  function next(schemes, qty, mix) {
    var n = null;
    schemes.forEach(function (s) {
      if (!!s.mix === mix && s.moq > qty && (!n || s.moq < n.moq)) n = s;
    });
    return n;
  }

  var clean = [], blockQty = {};
  (lines || []).forEach(function (l, i) {
    var it = catalog[l.code];
    if (!it) return;
    var q = Math.floor(Number(l.qty));
    if (!(q > 0)) q = 0;
    clean.push({ index: i, code: l.code, qty: q, item: it });
    blockQty[it.blockId] = (blockQty[it.blockId] || 0) + q;
  });

  var pools = {}, poolOrder = [], pmf = {}, pmfOrder = [], amount = 0, soldQty = 0;
  clean.forEach(function (l, k) {
    var it = l.item;
    var mixBest = best(it.schemes, blockQty[it.blockId], true);
    var key = mixBest ? it.blockId + '|*MIX*' : it.blockId + '|' + it.itemGroup;
    var p = pools[key];
    if (!p) {
      p = pools[key] = { key: key, blockId: it.blockId, blockName: it.blockName, itemGroup: it.itemGroup,
                         mix: !!mixBest, schemes: it.schemes, qty: 0, blockQty: blockQty[it.blockId], items: [] };
      poolOrder.push(key);
    }
    p.qty += l.qty;
    var found = null;
    p.items.forEach(function (x) { if (x.code === l.code) found = x; });
    if (found) found.qty += l.qty; else p.items.push({ code: l.code, qty: l.qty, desc: it.desc });
    p.last = k;
    l.poolKey = key;
    amount += l.qty * (it.price || 0);
    soldQty += l.qty;
    if (it.pmf && l.qty > 0) {
      if (!(it.pmf in pmf)) { pmf[it.pmf] = 0; pmfOrder.push(it.pmf); }
      pmf[it.pmf] += l.qty;
    }
  });

  var giftQty = 0;
  poolOrder.forEach(function (key) {
    var p = pools[key];
    p.scheme = best(p.schemes, p.qty, p.mix);
    p.free = p.scheme ? Math.floor(p.qty / p.scheme.buy) * p.scheme.get : 0;
    var sorted = p.items.filter(function (x) { return x.qty > 0; })
                        .sort(function (a, b) { return b.qty - a.qty; });
    p.giftCodes = !sorted.length ? [] :
      (p.free >= 4 && sorted.length >= 2 ? [sorted[0].code, sorted[1].code] : [sorted[0].code]);

    p.gifts = [];
    if (p.free > 0 && p.giftCodes.length === 1) {
      p.gifts = [{ code: p.giftCodes[0], qty: p.free }];
    } else if (p.free > 0) {
      var s = splits[key] || {}, a = Math.floor(Number(s[p.giftCodes[0]])), b = Math.floor(Number(s[p.giftCodes[1]]));
      if (!(a >= 0 && b >= 0 && a + b === p.free)) { a = p.free; b = 0; }
      p.gifts = [{ code: p.giftCodes[0], qty: a }, { code: p.giftCodes[1], qty: b }];
    }
    giftQty += p.free;

    var multi = p.items.length > 1 || p.itemGroup !== p.items[0].code;
    p.label = p.mix ? p.blockName + ' – mix flavour (cả khối)' : (multi ? 'Nhóm ' + p.itemGroup : p.items[0].desc);

    p.hints = [];
    if (p.mix) {
      var nm = next(p.schemes, p.qty, true);
      if (nm) p.hints.push({ need: nm.moq - p.qty, scheme: nm, scope: 'block' });
    } else {
      var ng = next(p.schemes, p.qty, false);
      if (ng) p.hints.push({ need: ng.moq - p.qty, scheme: ng, scope: 'group' });
      var nb = next(p.schemes, p.blockQty, true);
      if (nb) p.hints.push({ need: nb.moq - p.blockQty, scheme: nb, scope: 'block' });
    }
  });

  var rows = [];
  clean.forEach(function (l, k) {
    rows.push({ type: 'sale', index: l.index, code: l.code, qty: l.qty, poolKey: l.poolKey });
    if (pools[l.poolKey].last === k) rows.push({ type: 'pool', poolKey: l.poolKey });
  });

  return {
    rows: rows, pools: pools, poolOrder: poolOrder,
    pmf: pmfOrder.map(function (c) { return { code: c, qty: pmf[c] }; }),
    soldQty: soldQty, giftQty: giftQty,
    pmfQty: pmfOrder.reduce(function (s, c) { return s + pmf[c]; }, 0),
    amount: amount
  };
}

function submitTetOrder(token, p) {
  const u = requireUser_(token);
  if (!can_(u, 'tetCreate')) throw new Error('Bạn không có quyền lên đơn Tết.');
  p = p || {};
  const group = p.group === 'MTI' ? 'MTI' : (p.group === 'GT' ? 'GT' : null);
  if (!group) throw new Error('Chưa chọn nhóm khách hàng GT / MTI.');
  const custCode = String(p.customerCode || '').trim(), custName = String(p.customerName || '').trim();
  if (!custCode) throw new Error('Chưa chọn khách hàng.');
  if (!p.deliveryDate) throw new Error('Chưa nhập ngày giao.');

  const catalog = loadCatalog_()[group];
  const lines = (p.lines || []).map(l => ({ code: String(l.code), qty: Math.floor(Number(l.qty)) }))
                               .filter(l => catalog[l.code] && l.qty > 0);
  if (!lines.length) throw new Error('Đơn hàng chưa có sản phẩm.');

  const r = computePromotion_(lines, catalog, p.splits || {});
  const vat = Math.round(r.amount * VAT_RATE);
  const total = r.amount + vat;

  const now = new Date();
  const orderId = 'TET-' + Utilities.formatDate(now, 'GMT+7', 'yyMMdd-HHmmss') + '-' +
                  Math.floor(Math.random() * 90 + 10);
  let deliveryStr = String(p.deliveryDate).trim();
  const iso = deliveryStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) deliveryStr = iso[3] + '/' + iso[2] + '/' + iso[1];
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(deliveryStr)) throw new Error('Ngày giao phải theo định dạng dd/mm/yyyy.');
  const note = String(p.note || '').trim();

  // Dòng chi tiết theo đúng thứ tự hiển thị
  const detail = [];
  r.rows.forEach(row => {
    if (row.type === 'sale') {
      const it = catalog[row.code];
      if (row.qty > 0) detail.push({ type: 'Hàng bán', code: it.code, desc: it.desc, scheme: '', qty: row.qty, price: it.price });
    } else {
      const pool = r.pools[row.poolKey];
      pool.gifts.forEach(g => {
        if (g.qty > 0) {
          detail.push({ type: 'Hàng tặng', code: g.code, desc: catalog[g.code].desc,
                        scheme: 'Scheme ' + pool.scheme.idx + ': ' + pool.scheme.text, qty: g.qty, price: 0 });
        }
      });
    }
  });
  r.pmf.forEach(x => detail.push({ type: 'Quà PMF', code: x.code, desc: 'Quà tặng kèm (Scheme 0)', scheme: 'Scheme 0', qty: x.qty, price: 0 }));

  const values = detail.map((d, i) => [
    orderId, now, u.username, u.name, group, custCode, custName, deliveryStr, note,
    i + 1, d.type, d.code, d.desc, d.scheme, d.qty, d.price, d.qty * d.price,
    i === 0 ? r.amount : '', i === 0 ? vat : '', i === 0 ? total : ''
  ]);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SHEET_TET);
    if (!sh) { setup(); sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SHEET_TET); }
    sh.getRange(sh.getLastRow() + 1, 1, values.length, TET_HEADERS.length).setValues(values);
  } finally {
    lock.releaseLock();
  }

  let emailOk = true, emailErr = '';
  try {
    sendTetEmail_(u, { orderId, group, custCode, custName, deliveryStr, note, detail, r, vat, total, now });
  } catch (e) {
    emailOk = false; emailErr = String(e.message || e);
  }
  return { orderId: orderId, total: total, emailOk: emailOk, emailErr: emailErr };
}

function sendTetEmail_(u, o) {
  const f = n => Number(n || 0).toLocaleString('vi-VN');
  const e = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const td = 'padding:6px 8px;border:1px solid #d6dbe4;font-size:13px;';
  let rows = '';
  o.detail.forEach((d, i) => {
    const bg = d.type === 'Hàng bán' ? '#ffffff' : (d.type === 'Hàng tặng' ? '#e8f5e9' : '#fff8e1');
    rows += `<tr style="background:${bg}">
      <td style="${td}text-align:center">${i + 1}</td>
      <td style="${td}font-weight:bold">${e(d.code)}</td><td style="${td}">${e(d.desc)}</td>
      <td style="${td}text-align:right">${f(d.qty)}</td>
      <td style="${td}text-align:right">${f(d.price)}</td><td style="${td}text-align:right">${f(d.qty * d.price)}</td>
      <td style="${td}">${e(d.type)}</td><td style="${td}">${e(d.scheme)}</td></tr>`;
  });
  const html = `<div style="font-family:Arial,sans-serif;color:#1b2430">
    <h2 style="color:#b71c1c;margin:0 0 6px">ĐƠN HÀNG TẾT – ${e(o.orderId)}</h2>
    <table style="font-size:14px;margin-bottom:12px">
      <tr><td><b>Nhân viên:</b></td><td>${e(u.name)} (${e(u.username)})</td></tr>
      <tr><td><b>Nhóm KH:</b></td><td>${e(o.group)}</td></tr>
      <tr><td><b>Khách hàng:</b></td><td>${e(o.custCode)} – ${e(o.custName)}</td></tr>
      <tr><td><b>Ngày yêu cầu giao:</b></td><td>${e(o.deliveryStr)}</td></tr>
      <tr><td><b>Ghi chú:</b></td><td>${e(o.note || '-')}</td></tr>
      <tr><td><b>Thời gian gửi:</b></td><td>${Utilities.formatDate(o.now, 'GMT+7', 'HH:mm dd/MM/yyyy')}</td></tr>
    </table>
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#0b5cab;color:#fff">
        <th style="${td}">STT</th><th style="${td}">Mã hàng</th><th style="${td}">Mô tả</th>
        <th style="${td}">SL</th><th style="${td}">Đơn giá</th><th style="${td}">Thành tiền</th>
        <th style="${td}">Loại</th><th style="${td}">Chương trình</th></tr>
      ${rows}
    </table>
    <table style="margin-top:12px;font-size:14px">
      <tr><td>Tổng SL bán / tặng / PMF:</td><td style="text-align:right"><b>${f(o.r.soldQty)} / ${f(o.r.giftQty)} / ${f(o.r.pmfQty)}</b></td></tr>
      <tr><td>Tiền hàng (chưa VAT):</td><td style="text-align:right"><b>${f(o.r.amount)} đ</b></td></tr>
      <tr><td>VAT 8%:</td><td style="text-align:right"><b>${f(o.vat)} đ</b></td></tr>
      <tr><td>Tổng thanh toán:</td><td style="text-align:right;color:#b71c1c;font-size:16px"><b>${f(o.total)} đ</b></td></tr>
    </table></div>`;

  const mail = {
    to: CS_EMAIL,
    subject: `[ĐƠN TẾT] ${o.orderId} - ${o.custName} - ${u.name}`,
    htmlBody: html,
    name: 'Ân Nam Nha Trang App'
  };
  if (u.email) { mail.cc = u.email; mail.replyTo = u.email; }
  MailApp.sendEmail(mail);
}

function getTetOrders(token) {
  const u = requireUser_(token);
  if (!can_(u, 'tetList')) throw new Error('Bạn không có quyền xem đơn Tết.');
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SHEET_TET);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, TET_HEADERS.length).getValues();
  const viewAll = can_(u, 'tetViewAll');
  const map = {}, order = [];
  v.forEach(r => {
    const id = String(r[0]);
    if (!id) return;
    if (!viewAll && String(r[2]).toLowerCase() !== u.username.toLowerCase()) return;
    let o = map[id];
    if (!o) {
      o = map[id] = {
        id: id, time: fmtDateTime_(r[1], 'HH:mm dd/MM/yyyy'), username: String(r[2]), saleName: String(r[3]),
        group: String(r[4]), custCode: String(r[5]), custName: String(r[6]), deliveryDate: String(r[7]),
        note: String(r[8]), amount: 0, vat: 0, total: 0, lines: []
      };
      order.push(id);
    }
    if (r[17] !== '') { o.amount = Number(r[17]) || 0; o.vat = Number(r[18]) || 0; o.total = Number(r[19]) || 0; }
    o.lines.push({ stt: r[9], type: String(r[10]), code: String(r[11]), desc: String(r[12]),
                   scheme: String(r[13]), qty: Number(r[14]) || 0, price: Number(r[15]) || 0, amount: Number(r[16]) || 0 });
  });
  return order.reverse().slice(0, 200).map(id => map[id]);
}

/* ======================================================================
 * KHO: KIỂM KÊ • BC HỦY HÀNG • SOẠN HÀNG (dành cho Store keeper / Admin)
 * ====================================================================== */
const OPS_BARCODE_SS   = cfg_('OPS_BARCODE_SS');  // file TRỢ LÝ CS – sheet Barcode
const STOCK_FOLDER_ID  = cfg_('STOCK_FOLDER_ID');           // thư mục lưu file tồn kho admin import
const WRITE_OFF_SS     = cfg_('WRITE_OFF_SS');  // file chứa sheet Write-off (BC hủy hàng)
const SH_STOCK_KK = 'Stock Kiem ke';   // tồn kho kiểm kê (phần kho được kiểm) – căn cứ đối chiếu
const SH_STOCK = 'Stock', SH_KK_DETAIL = 'Chi tiet Kiem ke', SH_KK_REPORT = 'BC Kiem ke';
const SH_TFO = 'TFO', SH_ORDER = 'Order', SH_PICK_LOG = 'Lich su soan hang';
const KK_DETAIL_HEADERS = ['Mã đợt', 'Thời gian', 'Username', 'Nhân viên', 'Vị trí', 'Lần đếm', 'Barcode', 'Mã hàng', 'Tên hàng', 'Batch number', 'Số lượng'];
const ORDER_HEADERS = ['Khách hàng', 'Item number', 'Product name', 'Batch number', 'SL đặt', 'Đã soạn', 'Còn lại'];
const PICK_LOG_HEADERS = ['Thời gian', 'Username', 'Nhân viên', 'Hành động', 'Mã hàng', 'Batch number', 'Khách hàng', 'Số lượng'];
const SURPLUS_NAME = 'HÀNG DƯ';

/* ---------- tiện ích ---------- */
/** Định dạng ô là phần phụ: sheet đã chuyển thành "Bảng" (Table, cột có kiểu dữ liệu) không cho định dạng → bỏ qua, vẫn ghi dữ liệu */
/**
 * Tạo sheet mới an toàn: insertSheet(name) mặc định chèn ngay sau sheet đang mở (thường là sheet User dạng Bảng)
 * và Google báo lỗi "không được phép ở các ô trong các cột đã nhập". Vì vậy chèn vào CUỐI file, sau một sheet thường.
 */
function newSheet_(ss, name) {
  const sheets = ss.getSheets();
  const plain = sheets.slice().reverse().find(s => { try { return !(s.getTables && s.getTables().length); } catch (e) { return true; } });
  try { if (plain) ss.setActiveSheet(plain); } catch (e) {}
  try { return ss.insertSheet(name, sheets.length); }
  catch (e1) {
    try { const sh = ss.insertSheet(sheets.length); sh.setName(name); return sh; }
    catch (e2) {
      if (plain) { const sh = plain.copyTo(ss); sh.clear(); sh.setName(name); return sh; }   // phương án cuối: nhân bản 1 sheet thường rồi xóa trắng
      throw e2;
    }
  }
}

function safe_(fn) { try { fn(); } catch (e) { console.log('Bỏ qua định dạng: ' + e.message); } }

function requireFeature_(token, f) {
  const u = requireUser_(token);
  if (!hasFeature_(u, f)) throw new Error('Bạn không có quyền dùng chức năng này.');
  return u;
}
function appSheet_(name, headers) {
  const ss = SpreadsheetApp.openById(APP_SS_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = newSheet_(ss, name);
    if (headers) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      safe_(() => sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#24573c').setFontColor('#ffffff'));
    }
    safe_(() => sh.setFrozenRows(1));
  }
  return sh;
}
const num_ = v => typeof v === 'number' ? v : (Number(String(v == null ? '' : v).replace(/,/g, '').trim()) || 0);
const key_ = v => String(v == null ? '' : v).trim().toUpperCase();
function headerIndex_(row, names) {
  const h = row.map(x => String(x).trim().toLowerCase());
  for (let i = 0; i < names.length; i++) { const k = h.indexOf(names[i]); if (k !== -1) return k; }
  return -1;
}
function onceRequest_(id) {   // chống bấm Lưu 2 lần
  if (!id) return;
  const c = CacheService.getScriptCache(), k = 'req_' + id;
  if (c.get(k)) throw new Error('Dữ liệu này đã được gửi, đừng bấm lại!');
  c.put(k, '1', 300);
}
/** Chống ghi trùng khi app tự gửi lại (mất mạng): chỉ đánh dấu SAU KHI đã ghi thành công → gửi lại sau lỗi vẫn được ghi */
const reqSeen_ = id => !!(id && CacheService.getScriptCache().get('done_' + id));
const reqMark_ = id => { if (id) CacheService.getScriptCache().put('done_' + id, '1', 21600); };
const nowStr_ = () => Utilities.formatDate(new Date(), 'GMT+7', 'dd/MM/yyyy HH:mm:ss');

/* ---------- Danh mục hàng (Barcode) + batch tồn kho: tải 1 lần về điện thoại để tìm tức thì ---------- */
function getOpsMaster(token) {
  const u = requireUser_(token);
  if (!['kiemke', 'huyhang', 'soanhang', 'pallet'].some(f => hasFeature_(u, f))) throw new Error('Bạn không có quyền dùng chức năng kho.');
  const sh = SpreadsheetApp.openById(OPS_BARCODE_SS).getSheetByName('Barcode');
  if (!sh) throw new Error('Không tìm thấy sheet Barcode.');
  const v = sh.getDataRange().getDisplayValues();
  let hr = -1, cItem = -1, cBar = -1, cName = -1;
  for (let r = 0; r < Math.min(6, v.length) && hr === -1; r++) {
    cItem = headerIndex_(v[r], ['item number', 'item code']);
    cBar = headerIndex_(v[r], ['bar code', 'barcode']);
    if (cItem !== -1 && cBar !== -1) { hr = r; cName = headerIndex_(v[r], ['description', 'product name', 'item name']); }
  }
  if (hr === -1) throw new Error('Sheet Barcode thiếu cột Item number / Bar code.');
  const map = {}, order = [];
  for (let r = hr + 1; r < v.length; r++) {
    const it = String(v[r][cItem]).trim();
    if (!it || it.length < 3) continue;
    let o = map[it];
    if (!o) { o = map[it] = { i: it, n: cName !== -1 ? String(v[r][cName]).trim() : '', b: [] }; order.push(it); }
    const bc = String(v[r][cBar]).trim();
    if (bc && o.b.indexOf(bc) === -1) o.b.push(bc);
    if (!o.n && cName !== -1) o.n = String(v[r][cName]).trim();
  }
  // Batch dùng để tra cứu: tồn kho (mục 1) + tồn kho kiểm kê (mục 2)
  const batches = {};
  [readStock_(SH_STOCK), readStock_(SH_STOCK_KK)].forEach(st => Object.keys(st.items).forEach(k => {
    const s = st.items[k];
    if (!map[s.item]) { map[s.item] = { i: s.item, n: s.name, b: [] }; order.push(s.item); }   // mã chưa có trong Barcode vẫn tìm được
    const list = batches[s.item] || (batches[s.item] = []);
    Object.keys(s.batches).forEach(b => { if (list.indexOf(s.batches[b].label) === -1) list.push(s.batches[b].label); });
  }));
  return { items: order.map(k => map[k]), batches: batches, stock: stockMeta_('stock'), at: nowStr_() };
}

/* ---------- Tồn kho hệ thống (sheet Stock do admin import) ---------- */
// kind 'stock' = tồn kho tra cứu batch (sheet Stock) • 'kk' = tồn kho kiểm kê dùng để đối chiếu (sheet Stock Kiem ke)
function stockMeta_(kind) {
  const raw = PropertiesService.getScriptProperties().getProperty(kind === 'kk' ? 'STOCK_KK_META' : 'STOCK_META');
  return raw ? JSON.parse(raw) : null;
}
function readStock_(sheetName, cid) {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(sheetName || SH_STOCK);
  const out = { items: {}, rows: 0 };
  if (!sh || sh.getLastRow() < 2) return out;
  const v = sh.getDataRange().getValues();
  const cI = headerIndex_(v[0], ['item number', 'mã hàng']), cB = headerIndex_(v[0], ['batch number', 'batch']);
  const cQ = headerIndex_(v[0], ['physical inventory', 'số lượng', 'quantity']), cN = headerIndex_(v[0], ['product name', 'tên hàng', 'description']);
  if (cI === -1 || cB === -1 || cQ === -1) throw new Error('Sheet ' + (sheetName || SH_STOCK) + ' thiếu cột Item number / Batch number / Physical inventory.');
  const cC = cid ? headerIndex_(v[0], ['mã đợt']) : -1;          // sheet tồn kho kiểm kê chung: lọc đúng đợt
  for (let r = 1; r < v.length; r++) {
    if (cC !== -1 && String(v[r][cC]).trim() !== cid) continue;
    const item = String(v[r][cI]).trim(); if (!item) continue;
    const batch = String(v[r][cB]).trim();
    const k = key_(item);
    const o = out.items[k] || (out.items[k] = { item: item, name: cN !== -1 ? String(v[r][cN]).trim() : '', sys: 0, batches: {} });
    const bk = key_(batch);
    const b = o.batches[bk] || (o.batches[bk] = { label: batch, sys: 0 });
    const q = num_(v[r][cQ]);
    b.sys += q; o.sys += q; out.rows++;
  }
  return out;
}

/** Đọc bảng tồn kho (Item number, Batch number, Physical inventory), lưu file gốc lên Drive, ghi vào sheet */
function parseStockFile_(u, f, prefix) {
  if (!f || !Array.isArray(f.rows) || f.rows.length < 2) throw new Error('Chưa chọn file tồn kho hoặc file không có dữ liệu.');
  const head = f.rows[0];
  ['item number', 'batch number', 'physical inventory'].forEach(n => {
    if (headerIndex_(head, [n]) === -1) throw new Error('File thiếu cột "' + n + '". Hãy xuất đúng file tồn kho (Item number, Batch number, Physical inventory).');
  });
  const width = head.length;
  const rows = f.rows.map(r => { const a = r.slice(0, width); while (a.length < width) a.push(''); return a.map(x => x == null ? '' : x); })
                     .filter((r, i) => i === 0 || r.some(x => String(x).trim() !== ''));
  let fileUrl = '', fileName = String(f.name || 'Stock.xlsx');
  if (f.base64) {
    const stamp = Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd_HHmm');
    const blob = Utilities.newBlob(Utilities.base64Decode(f.base64), f.mime || 'application/octet-stream', prefix + stamp + '_' + fileName);
    fileUrl = DriveApp.getFolderById(STOCK_FOLDER_ID).createFile(blob).getUrl();
  }
  const items = {}; rows.slice(1).forEach(r => { const k = key_(r[headerIndex_(head, ['item number'])]); if (k) items[k] = 1; });
  return { rows: rows, width: width, head: head,
           meta: { fileName: fileName, fileUrl: fileUrl, rows: rows.length - 1, items: Object.keys(items).length, at: nowStr_(), by: u.name } };
}
function importStockFile_(u, f, sheetName, prefix) {
  const p = parseStockFile_(u, f, prefix);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = appSheet_(sheetName);
    sh.clearContents();
    safe_(() => sh.getRange(1, 1, p.rows.length, p.width).setNumberFormat('@'));
    sh.getRange(1, 1, p.rows.length, p.width).setValues(p.rows.map(r => r.map(String)));
    safe_(() => sh.getRange(1, 1, 1, p.width).setFontWeight('bold'));
  } finally { lock.releaseLock(); }
  return p.meta;
}
/* Tồn kho kiểm kê của TẤT CẢ các đợt nằm chung 1 sheet, phân biệt bằng cột "Mã đợt" */
const SH_KK_STOCK_ALL = 'Ton kho Kiem ke';
const KK_STOCK_HEADERS = ['Mã đợt', 'Item number', 'Product name', 'Batch number', 'Physical inventory'];
function kkAppendStock_(cid, head, rows) {      // rows: dòng dữ liệu theo cột của file gốc
  const cI = headerIndex_(head, ['item number']), cB = headerIndex_(head, ['batch number']), cQ = headerIndex_(head, ['physical inventory']),
        cN = headerIndex_(head, ['product name', 'tên hàng', 'description', 'search name']);
  const out = rows.filter(r => String(r[cI] || '').trim()).map(r => [cid, String(r[cI]).trim(), cN !== -1 ? String(r[cN] || '') : '', String(r[cB] || '').trim(), String(r[cQ] || '')]);
  if (!out.length) return 0;
  const sh = appSheet_(SH_KK_STOCK_ALL, KK_STOCK_HEADERS);
  const st = sh.getLastRow() + 1;
  safe_(() => sh.getRange(st, 1, out.length, 5).setNumberFormat('@'));
  sh.getRange(st, 1, out.length, 5).setValues(out);
  return out.length;
}
/** Admin import file tồn kho chung (dùng tra cứu batch khi tìm hàng) */
function adminImportStock(token, f) {
  const u = requireAdmin_(token);
  const meta = importStockFile_(u, f, SH_STOCK, 'TonKho_');
  PropertiesService.getScriptProperties().setProperty('STOCK_META', JSON.stringify(meta));
  return meta;
}

/* ---------- Đợt kiểm kê (nhiều đợt cùng lúc) ----------
 *  Mỗi đợt có file tồn kho kiểm kê riêng (sheet "Ton KK <mã đợt>") và báo cáo riêng (sheet "BC KK <mã đợt>").
 *  Danh sách đợt lưu ở Script Properties "KK_CAMPAIGNS". Đợt cũ (bản 1 đợt) được chuyển sang tự động.
 *  Kết quả tổng hợp gần nhất của mỗi đợt được lưu ở sheet "KK Cache" → mở màn hình không phải chạy lại báo cáo. */
const SH_KK_CACHE = 'KK Cache';
const KK_CLAIM_MIN = 15;          // giữ mã đang đếm lại tối đa 15 phút
function kkCampaign_() {          // (bản cũ – chỉ dùng để chuyển dữ liệu)
  const raw = PropertiesService.getScriptProperties().getProperty('KK_CAMPAIGN');
  return raw ? JSON.parse(raw) : null;
}
function kkCampaigns_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('KK_CAMPAIGNS');
  if (raw) return JSON.parse(raw);
  const old = kkCampaign_(), list = [];
  if (old) { old.stockSheet = SH_STOCK_KK; old.reportSheet = SH_KK_REPORT; list.push(old); }
  props.setProperty('KK_CAMPAIGNS', JSON.stringify(list));
  return list;
}
function kkSaveCampaigns_(list) { PropertiesService.getScriptProperties().setProperty('KK_CAMPAIGNS', JSON.stringify(list.slice(-40))); }
function kkGet_(id) {
  const c = kkCampaigns_().find(x => x.id === id);
  if (!c) throw new Error('Không tìm thấy đợt kiểm kê. Hãy chọn lại đợt.');
  return c;
}
function kkPut_(c) { const l = kkCampaigns_(); const i = l.findIndex(x => x.id === c.id); if (i === -1) l.push(c); else l[i] = c; kkSaveCampaigns_(l); }
function kkCanUse_(u) { if (!hasFeature_(u, 'kiemke') && u.role !== 'admin') throw new Error('Bạn không có quyền dùng chức năng kiểm kê.'); }

/** Bản trước tạo sheet riêng "Ton KK <mã>" / "BC KK <mã>" cho từng đợt → gộp vào sheet chung rồi xóa sheet riêng */
function kkMigrate_() {
  const list = kkCampaigns_(), todo = list.filter(c => /^Ton KK /.test(c.stockSheet || '') || /^BC KK /.test(c.reportSheet || ''));
  if (!todo.length) return;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(APP_SS_ID);
    todo.forEach(c => {
      const old = ss.getSheetByName(c.stockSheet);
      if (old && old.getLastRow() >= 2) { const v = old.getDataRange().getValues(); kkAppendStock_(c.id, v[0], v.slice(1)); }
      [c.stockSheet, c.reportSheet].forEach(n => { const s = /^(Ton|BC) KK /.test(n || '') && ss.getSheetByName(n); if (s) safe_(() => ss.deleteSheet(s)); });
      c.stockSheet = SH_KK_STOCK_ALL; c.reportSheet = SH_KK_REPORT;
    });
    kkSaveCampaigns_(list);
  } finally { lock.releaseLock(); }
}
function kkGetState(token) {
  const u = requireUser_(token); kkCanUse_(u);
  kkMigrate_();
  const list = kkCampaigns_().slice().sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || String(b.id).localeCompare(String(a.id)));
  return { campaigns: list, stock: stockMeta_('stock'), isAdmin: u.role === 'admin' };
}

/** Admin tạo đợt kiểm kê mới kèm file tồn kho kiểm kê riêng của đợt */
function adminCreateCampaign(token, name, f) {
  const u = requireAdmin_(token);
  name = String(name || '').trim();
  if (!name) throw new Error('Vui lòng đặt tên đợt kiểm kê (VD: Khu A – Thủy).');
  if (kkCampaigns_().some(c => c.status === 'open' && normName_(c.name) === normName_(name))) throw new Error('Đã có đợt đang mở cùng tên "' + name + '".');
  const base = 'KK' + Utilities.formatDate(new Date(), 'GMT+7', 'yyMMddHHmmss'), all = kkCampaigns_();
  let id = base, n = 1;
  while (all.some(x => x.id === id)) id = base + '-' + (++n);
  const p = parseStockFile_(u, f, 'TonKhoKiemKe_' + id + '_'), meta = p.meta;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { kkAppendStock_(id, p.head, p.rows.slice(1)); } finally { lock.releaseLock(); }
  const c = { id: id, name: name, status: 'open', startedAt: nowStr_(), startedBy: u.name, stockSheet: SH_KK_STOCK_ALL, reportSheet: SH_KK_REPORT,
              stockFile: meta.fileName, stockUrl: meta.fileUrl, stockAt: meta.at, stockItems: meta.items, stockRows: meta.rows };
  appSheet_(SH_KK_DETAIL, KK_DETAIL_HEADERS);
  kkPut_(c);
  return c;
}
function adminReopenCampaign(token, id) {
  const u = requireAdmin_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const c = kkGet_(id);
    if (c.status === 'open') return c;
    c.status = 'open'; c.reopenedAt = nowStr_(); c.reopenedBy = u.name; delete c.doneAt; delete c.doneBy;
    kkPut_(c);
    return c;
  } finally { lock.releaseLock(); }
}

function kkSave(token, p) {
  const u = requireFeature_(token, 'kiemke');
  p = p || {};
  const c = kkGet_(p.campaignId);
  if (c.status !== 'open') throw new Error('Đợt "' + c.name + '" đã hoàn tất – không nhập thêm được.');
  const loc = String(p.location || '').trim();
  if (!loc && Number(p.round) !== 2) throw new Error('Vui lòng nhập Vị trí (Location).');
  const round = Number(p.round) === 2 ? 2 : 1;
  const ts = p.ts ? scanTime_(p.ts) : new Date(), rows = [];
  (p.data || []).forEach(it => (it.entries || []).forEach(e => {
    const q = num_(e.qty);
    if ((q > 0 || (round === 2 && q === 0)) && String(e.batchNumber || '').trim()) {
      // Quét liên tục gửi giờ quét riêng của từng lượt (entries[].ts) → mỗi dòng đúng thời điểm quét
      rows.push([c.id, e.ts ? scanTime_(e.ts) : ts, u.username, u.name, loc || 'Đếm lại lần 2', round, String(it.barcode || ''), String(it.itemNumber || '').trim(),
                 String(it.productName || ''), String(e.batchNumber).trim(), q]);
    }
  }));
  if (!rows.length) throw new Error('Chưa nhập số lượng.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (reqSeen_(p.requestId)) return { saved: rows.length, dup: true, time: Utilities.formatDate(ts, 'GMT+7', 'HH:mm:ss') };   // đã ghi ở lần gửi trước
    const sh = appSheet_(SH_KK_DETAIL, KK_DETAIL_HEADERS);
    if (round === 2) {
      const keys = {}; rows.forEach(r => keys[key_(r[7])] = 1);
      const cl = kkClaims_(c.id);
      Object.keys(keys).forEach(k => { if (cl[k] && key_(cl[k].u) !== key_(u.username)) throw new Error('Mã ' + rows[0][7] + ' đang được ' + cl[k].name + ' đếm lại.'); });
      const last = sh.getLastRow();
      if (last >= 2) {
        const v = sh.getRange(2, 1, last - 1, 8).getValues();
        for (let i = 0; i < v.length; i++) {
          if (String(v[i][0]) === c.id && Number(v[i][5]) === 2 && keys[key_(v[i][7])])
            throw new Error('Mã ' + v[i][7] + ' đã được đếm lại lần 2 – mỗi mã chỉ đếm lại 1 lần.');
        }
      }
    }
    const start = sh.getLastRow() + 1;
    safe_(() => { sh.getRange(start, 7, rows.length, 4).setNumberFormat('@'); });
    safe_(() => { sh.getRange(start, 2, rows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss'); });
    sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
    SpreadsheetApp.flush();
    reqMark_(p.requestId);
    if (round === 1) PropertiesService.getScriptProperties().setProperty('KKLC_' + c.id, String(Date.now()));   // có số đếm mới sau lần tổng hợp
    if (round === 2) {               // cập nhật nhanh kết quả đã lưu: bỏ mã vừa đếm khỏi danh sách chờ, nhả quyền giữ mã
      const k = key_(rows[0][7]);
      const cache = kkCacheGet_(c.id);
      if (cache) {
        const before = cache.mismatches.length;
        cache.mismatches = cache.mismatches.filter(m => key_(m.item) !== k);
        if (cache.mismatches.length !== before) cache.totals.recounted = (cache.totals.recounted || 0) + 1;
        cache.totals.pending = cache.mismatches.length;
        kkCacheSet_(c.id, cache);
      }
      const cl = kkClaims_(c.id); delete cl[k]; kkSetClaims_(c.id, cl);
    }
  } finally { lock.releaseLock(); }
  return { saved: rows.length, time: Utilities.formatDate(ts, 'GMT+7', 'HH:mm:ss') };
}

/* --- Kết quả tổng hợp đã lưu --- */
function kkCacheGet_(id) {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_KK_CACHE);
  if (!sh || sh.getLastRow() < 1) return null;
  const ids = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  const i = ids.findIndex(x => String(x[0]) === id); if (i === -1) return null;
  const r = sh.getRange(i + 1, 1, 1, Math.max(3, sh.getLastColumn())).getValues()[0];
  try { return JSON.parse(r.slice(2).join('')); } catch (e) { return null; }
}
function kkCacheSet_(id, obj) {
  const sh = appSheet_(SH_KK_CACHE);
  const s = JSON.stringify(obj), parts = [];
  for (let i = 0; i < s.length; i += 45000) parts.push(s.slice(i, i + 45000));
  const row = [id, new Date()].concat(parts);
  const v = sh.getLastRow() >= 1 ? sh.getRange(1, 1, sh.getLastRow(), 1).getValues() : [];
  let i = v.findIndex(x => String(x[0]) === id);
  const r = i === -1 ? sh.getLastRow() + 1 : i + 1;
  if (i !== -1) sh.getRange(r, 1, 1, Math.max(sh.getLastColumn(), row.length)).clearContent();
  sh.getRange(r, 1, 1, row.length).setValues([row]);
}
/* --- Giữ mã khi có người đang đếm lại (để người khác không đếm trùng) --- */
function kkClaims_(id) {
  const raw = CacheService.getScriptCache().get('kkcl_' + id);
  const m = raw ? JSON.parse(raw) : {}, now = Date.now();
  Object.keys(m).forEach(k => { if (now - m[k].t > KK_CLAIM_MIN * 60000) delete m[k]; });
  return m;
}
function kkSetClaims_(id, m) { CacheService.getScriptCache().put('kkcl_' + id, JSON.stringify(m), 21600); }
function kkClaim(token, id, item) {
  const u = requireFeature_(token, 'kiemke');
  const c = kkGet_(id);
  if (c.status !== 'open') throw new Error('Đợt kiểm kê đã hoàn tất.');
  const k = key_(item);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const cache = kkCacheGet_(id);
    if (cache && !cache.mismatches.some(m => key_(m.item) === k)) throw new Error('Mã ' + item + ' đã được đếm lại hoặc không còn trong danh sách. Hãy tải lại danh sách.');
    const cl = kkClaims_(id);
    if (cl[k] && key_(cl[k].u) !== key_(u.username)) throw new Error('Mã ' + item + ' đang được ' + cl[k].name + ' đếm lại.');
    cl[k] = { u: u.username, name: u.name, t: Date.now() };
    kkSetClaims_(id, cl);
  } finally { lock.releaseLock(); }
  return { ok: true };
}
function kkRelease(token, id, item) {
  const u = requireFeature_(token, 'kiemke');
  const cl = kkClaims_(id), k = key_(item);
  if (cl[k] && key_(cl[k].u) === key_(u.username)) { delete cl[k]; kkSetClaims_(id, cl); }
  return { ok: true };
}

/**
 * Kết quả kiểm kê của 1 đợt. Mặc định trả kết quả đã tổng hợp gần nhất (nhanh);
 * force = true (nút "Tổng hợp kết quả mới nhất") mới chạy lại báo cáo.
 * Danh sách đếm lại: chỉ mã LỆCH SỐ LƯỢNG, chưa đếm lại, không do người khác đang đếm.
 */
function kkSummary(token, id, force) {
  const u = requireUser_(token); kkCanUse_(u);
  const c = kkGet_(id);
  let res = force ? null : kkCacheGet_(c.id);
  if (!res) {
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try { res = kkBuildReport_(c); kkCacheSet_(c.id, res); kkWriteReport_(); } finally { lock.releaseLock(); }
  }
  delete res.rows;
  res.campaign = c;
  res.newCounts = Number(PropertiesService.getScriptProperties().getProperty('KKLC_' + c.id) || 0) > (res.builtTs || 0);
  const cl = kkClaims_(c.id), me = key_(u.username);
  const busy = res.mismatches.filter(m => cl[key_(m.item)] && key_(cl[key_(m.item)].u) !== me);
  res.mismatches = res.mismatches.filter(m => busy.indexOf(m) === -1);
  res.busy = busy.map(m => ({ item: m.item, by: cl[key_(m.item)].name }));
  return res;
}

function kkBuildReport_(c) {
  const st = c.stockSheet === SH_KK_STOCK_ALL ? readStock_(SH_KK_STOCK_ALL, c.id) : readStock_(c.stockSheet || SH_STOCK_KK);   // tồn kho kiểm kê của đúng đợt
  const items = {};
  Object.keys(st.items).forEach(k => {
    const s = st.items[k];
    const o = items[k] = { item: s.item, name: s.name, batches: {}, has2: false };
    Object.keys(s.batches).forEach(bk => o.batches[bk] = { label: s.batches[bk].label, sys: s.batches[bk].sys, a1: 0, a2: 0 });
  });
  const sh = appSheet_(SH_KK_DETAIL, KK_DETAIL_HEADERS);
  let counted = 0;
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 11).getValues().forEach(r => {
      if (String(r[0]) !== c.id) return;
      const k = key_(r[7]); if (!k) return;
      const o = items[k] || (items[k] = { item: String(r[7]).trim(), name: String(r[8]), batches: {}, has2: false });
      if (!o.name) o.name = String(r[8]);
      const bk = key_(r[9]);
      const b = o.batches[bk] || (o.batches[bk] = { label: String(r[9]).trim(), sys: 0, a1: 0, a2: 0 });
      if (Number(r[5]) === 2) { b.a2 += num_(r[10]); o.has2 = true; } else b.a1 += num_(r[10]);
      counted++;
    });
  }
  const g1 = [], g2 = [], g3 = [], mism = [];
  let recounted = 0;
  Object.keys(items).sort().forEach(k => {
    const o = items[k], round = o.has2 ? 2 : 1;
    let sys = 0, act = 0, batchDiff = false;
    const bl = Object.keys(o.batches).sort().map(bk => {
      const b = o.batches[bk], a = round === 2 ? b.a2 : b.a1;
      sys += b.sys; act += a; if (a !== b.sys) batchDiff = true;
      return { b: b.label, sys: b.sys, act: a, a1: b.a1, a2: b.a2 };
    });
    const rows = bl.map(b => [o.item, o.name, b.b, b.act, b.sys, b.act - b.sys, 'Lần ' + round]);
    const grp = sys !== act ? 1 : (batchDiff ? 2 : 3);
    (grp === 1 ? g1 : grp === 2 ? g2 : g3).push(...rows);
    // Đếm lại lần 2: chỉ mã LỆCH SỐ LƯỢNG (nhóm 1) và chưa đếm lại. Lệch batch/date nhưng đủ số lượng → không cần đếm lại.
    if (grp === 1 && round === 1) mism.push({ item: o.item, name: o.name, sys: sys, act: act, round: round, group: grp, batches: bl });
    if (round === 2) recounted++;
  });

  const n = rows => new Set(rows.map(r => r[0])).size;
  return { counted: counted, totals: { items: Object.keys(items).length, g1: n(g1), g2: n(g2), g3: n(g3), recounted: recounted, pending: mism.length },
           mismatches: mism.sort((a, b) => a.item.localeCompare(b.item)), at: nowStr_(), builtTs: Date.now(), report: SH_KK_REPORT, rows: { g1: g1, g2: g2, g3: g3 } };
}
/** Ghi sheet "BC Kiem ke" chung: mỗi đợt 1 khối riêng (đợt mới nhất ở trên), không cộng gộp giữa các đợt */
function kkWriteReport_() {
  const list = kkCampaigns_().slice().sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 15);
  const W = 7, out = [], fmt = [];
  out.push(['BÁO CÁO KIỂM KÊ – TỔNG HỢP CÁC ĐỢT', '', '', '', '', '', '']); fmt.push('title');
  out.push(['Cập nhật lúc ' + nowStr_() + ' · mỗi đợt là 1 khối riêng, số liệu không cộng chung giữa các đợt', '', '', '', '', '', '']); fmt.push('');
  out.push(['', '', '', '', '', '', '']); fmt.push('');
  const sub = ['Mã hàng', 'Tên hàng', 'Batch Number', 'Số lượng thực tế', 'Số lượng hệ thống', 'Chênh lệch', 'Lần đếm'];
  list.forEach(c => {
    const r = kkCacheGet_(c.id);
    out.push(['■ ĐỢT: ' + c.name + '  (' + c.id + ')', '', '', '', '', '', '']); fmt.push('camp');
    out.push(['Bắt đầu ' + c.startedAt + ' (' + c.startedBy + ') · Tồn kho: ' + (c.stockFile || '') + ' · ' +
              (c.status === 'done' ? 'ĐÃ HOÀN TẤT ' + (c.doneAt || '') + ' bởi ' + (c.doneBy || '') : 'Đang kiểm kê') + (r ? ' · Tổng hợp lúc ' + r.at : ' · Chưa tổng hợp'), '', '', '', '', '', '']); fmt.push('');
    if (r && r.rows) {
      out.push(['Tổng mã: ' + r.totals.items + ' · Khớp: ' + r.totals.g3 + ' · Lệch số lượng: ' + r.totals.g1 + ' · Lệch batch: ' + r.totals.g2 + ' · Đã đếm lại: ' + (r.totals.recounted || 0), '', '', '', '', '', '']); fmt.push('');
      [['--- NHÓM 1: LỆCH SỐ LƯỢNG TỔNG MÃ HÀNG ---', r.rows.g1], ['--- NHÓM 2: KHỚP TỔNG MÃ - LỆCH CHI TIẾT BATCH NUMBER ---', r.rows.g2],
       ['--- NHÓM 3: HÀNG KHỚP HOÀN TOÀN (HỆ THỐNG = THỰC TẾ) ---', r.rows.g3]].forEach(([t, rows]) => {
        if (!rows.length) return;
        out.push([t, '', '', '', '', '', '']); fmt.push('grp');
        out.push(sub); fmt.push('head');
        rows.forEach(x => { out.push(x); fmt.push(''); });
      });
    }
    out.push(['', '', '', '', '', '', '']); fmt.push('');
  });
  const rep = appSheet_(SH_KK_REPORT);
  safe_(() => rep.getDataRange().breakApart());
  try { rep.clear(); } catch (e) { rep.clearContents(); }
  rep.getRange(1, 1, out.length, W).setValues(out);
  safe_(() => {
    rep.getRange(1, 1).setFontSize(14).setFontWeight('bold').setFontColor('#182e22');
    fmt.forEach((f, i) => {
      if (f === 'camp') rep.getRange(i + 1, 1, 1, W).merge().setFontWeight('bold').setFontSize(12).setBackground('#24573c').setFontColor('#ffffff');
      else if (f === 'grp') rep.getRange(i + 1, 1, 1, W).merge().setFontWeight('bold').setBackground('#e0e0e0');
      else if (f === 'head') rep.getRange(i + 1, 1, 1, W).setFontWeight('bold').setBackground('#f5f5f5');
    });
  });
  SpreadsheetApp.flush();
}

/** Hoàn tất 1 đợt: chốt số liệu, khóa đợt, chạy báo cáo cuối. Admin có thể mở lại. */
function kkFinish(token, id) {
  const u = requireUser_(token); kkCanUse_(u);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const c = kkGet_(id);
    if (c.status !== 'open') throw new Error('Đợt này đã hoàn tất.');
    c.status = 'done'; c.doneAt = nowStr_(); c.doneBy = u.name;
    kkPut_(c);
    const res = kkBuildReport_(c); kkCacheSet_(c.id, res); kkWriteReport_(); delete res.rows; res.campaign = c; res.busy = [];
    return res;
  } finally { lock.releaseLock(); }
}

/* ---------- BC HỦY HÀNG → sheet Write-off ---------- */
function whSaveWriteOff(token, p) {
  const u = requireFeature_(token, 'huyhang');
  p = p || {};
  const reason = String(p.reason || '').trim();
  if (!reason) throw new Error('Vui lòng chọn lý do hủy hàng.');
  onceRequest_(p.requestId);
  const ts = nowStr_(), rows = [];
  (p.data || []).forEach(it => (it.entries || []).forEach(e => {
    const q = num_(e.qty);
    if (q > 0 && String(e.batchNumber || '').trim())
      rows.push([ts, u.name, String(it.barcode || ''), String(it.itemNumber || ''), String(it.productName || ''), String(e.batchNumber).trim(), q, reason, String(p.note || '').trim()]);
  }));
  if (!rows.length) throw new Error('Chưa nhập số lượng hủy.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(WRITE_OFF_SS);
    const sh = ss.getSheetByName('Write-off') || newSheet_(ss, 'Write-off');
    if (sh.getLastRow() === 0) sh.appendRow(['Thời gian', 'Người thực hiện', 'Barcode', 'Mã hàng', 'Tên hàng', 'Batch Number', 'Số lượng', 'Lý do hủy', 'Ghi chú']);
    const start = sh.getLastRow() + 1;
    safe_(() => { sh.getRange(start, 3, rows.length, 1).setNumberFormat('@'); });
    sh.getRange(start, 1, rows.length, 9).setValues(rows);
  } finally { lock.releaseLock(); }
  return { saved: rows.length, time: ts };
}

/* ---------- SOẠN HÀNG: TFO (nhận hàng) + Order dạng bảng dọc ---------- */
function readTfo_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_TFO);
  if (!sh || sh.getLastRow() < 2) throw new Error('Sheet TFO chưa có dữ liệu. Admin cần dán dữ liệu TFO vào file.');
  const v = sh.getDataRange().getValues();
  const c = { item: headerIndex_(v[0], ['item number']), batch: headerIndex_(v[0], ['batch number']),
              ship: headerIndex_(v[0], ['shipped quantity']), spec: headerIndex_(v[0], ['spec']), name: headerIndex_(v[0], ['product name']) };
  if (c.item === -1 || c.batch === -1 || c.ship === -1) throw new Error('Sheet TFO thiếu cột Item number / Batch number / Shipped quantity.');
  return { sh: sh, v: v, c: c };
}
function readOrder_() {
  const sh = appSheet_(SH_ORDER, ORDER_HEADERS);
  const v = sh.getDataRange().getValues();
  const h = v[0] || [];
  const c = { cust: headerIndex_(h, ['khách hàng', 'đơn hàng', 'customer']), item: headerIndex_(h, ['item number', 'mã hàng']),
              name: headerIndex_(h, ['product name', 'tên hàng']), batch: headerIndex_(h, ['batch number', 'batch']),
              qty: headerIndex_(h, ['sl đặt', 'số lượng', 'quantity']), done: headerIndex_(h, ['đã soạn']), left: headerIndex_(h, ['còn lại']) };
  if (c.cust === -1 || c.item === -1 || c.batch === -1 || c.qty === -1) throw new Error('Sheet Order cần các cột: Khách hàng, Item number, Batch number, SL đặt.');
  if (c.done === -1 || c.left === -1) {   // tự thêm cột Đã soạn / Còn lại nếu admin chưa có
    let w = sh.getLastColumn();
    if (c.done === -1) sh.getRange(1, ++w).setValue('Đã soạn');
    if (c.left === -1) sh.getRange(1, ++w).setValue('Còn lại');
    return readOrder_();
  }
  const rows = [];
  for (let r = 1; r < v.length; r++) {
    const cust = String(v[r][c.cust]).trim(), item = String(v[r][c.item]).trim();
    if (!cust || !item) continue;
    const qty = num_(v[r][c.qty]), done = num_(v[r][c.done]);
    rows.push({ row: r + 1, cust: cust, item: item, name: c.name !== -1 ? String(v[r][c.name]).trim() : '', batch: String(v[r][c.batch]).trim(),
                qty: qty, done: done, left: Math.max(0, qty - done) });
  }
  return { sh: sh, c: c, rows: rows };
}
function pickLog_(u, rows) {
  if (!rows.length) return;
  const sh = appSheet_(SH_PICK_LOG, PICK_LOG_HEADERS);
  const start = sh.getLastRow() + 1;
  safe_(() => { sh.getRange(start, 5, rows.length, 3).setNumberFormat('@'); });
  sh.getRange(start, 1, rows.length, 8).setValues(rows.map(r => [new Date(), u.username, u.name].concat(r)));
}

function pickSearch(token, itemNumber) {
  requireFeature_(token, 'soanhang');
  const t = readTfo_(), k = key_(itemNumber), out = [];
  for (let r = 1; r < t.v.length; r++) {
    if (key_(t.v[r][t.c.item]) !== k) continue;
    out.push({ batch: String(t.v[r][t.c.batch]).trim(), avail: num_(t.v[r][t.c.ship]),
               spec: t.c.spec !== -1 ? num_(t.v[r][t.c.spec]) : 0, name: t.c.name !== -1 ? String(t.v[r][t.c.name]) : '' });
  }
  if (!out.length) throw new Error('Mã ' + itemNumber + ' không có trong TFO.');
  return out;
}

/** Xác nhận pick: trừ TFO, phân bổ cho khách có SL order bằng / gần bằng SL pick; dư thì ghi HÀNG DƯ */
function pickConfirm(token, itemNumber, allocs) {
  const u = requireFeature_(token, 'soanhang');
  allocs = (allocs || []).map(a => ({ batch: String(a.batch || '').trim(), qty: num_(a.qty) })).filter(a => a.batch && a.qty > 0);
  if (!allocs.length) throw new Error('Bạn chưa nhập số lượng pick cho batch nào.');
  const k = key_(itemNumber);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const t = readTfo_(), o = readOrder_();
    const tfoUpd = [], ordUpd = {}, result = [], log = [];
    allocs.forEach(a => {
      const bk = key_(a.batch);
      // 1) trừ TFO
      let need = a.qty;
      for (let r = 1; r < t.v.length && need > 0; r++) {
        if (key_(t.v[r][t.c.item]) !== k || key_(t.v[r][t.c.batch]) !== bk) continue;
        const have = num_(t.v[r][t.c.ship]); if (have <= 0) continue;
        const d = Math.min(have, need);
        t.v[r][t.c.ship] = have - d; tfoUpd.push([r + 1, have - d]); need -= d;
      }
      if (need > 0) throw new Error('Lô ' + a.batch + ' trong TFO không đủ: bạn pick ' + a.qty + ' nhưng TFO chỉ còn ' + (a.qty - need) + '.');
      // 2) phân bổ cho Order
      const lines = o.rows.filter(x => key_(x.item) === k && key_(x.batch) === bk);
      if (!lines.length) throw new Error('Không tìm thấy mã ' + itemNumber + ' batch ' + a.batch + ' trong danh sách đặt hàng (Order).');
      // Chia cho khách có số lượng order BẰNG hoặc GẦN BẰNG số đang pick:
      //  1) ưu tiên dòng có SL còn thiếu = SL pick, nếu không có thì dòng lớn nhất mà vẫn ≤ SL pick (gần bằng nhất);
      //  2) nếu mọi dòng đều lớn hơn SL pick → giao cho dòng có SL gần nhất (nhỏ nhất);
      //  lặp lại với phần còn lại; dư sau khi đủ hết các đơn → HÀNG DƯ. Bằng nhau thì ưu tiên dòng ở trên.
      let rem = a.qty;
      while (rem > 0) {
        const open = lines.filter(x => x.left > 0);
        if (!open.length) break;
        let x = open.filter(l => l.left <= rem).sort((p, q) => q.left - p.left || p.row - q.row)[0];
        if (!x) x = open.sort((p, q) => p.left - q.left || p.row - q.row)[0];
        const give = Math.min(x.left, rem);
        x.done += give; x.left -= give; rem -= give; ordUpd[x.row] = x;
        result.push({ batch: a.batch, cust: x.cust, qty: give });
        log.push(['Pick & phân bổ', itemNumber, a.batch, x.cust, give]);
      }
      if (rem > 0) { result.push({ batch: a.batch, cust: SURPLUS_NAME, qty: rem }); log.push(['Pick & phân bổ', itemNumber, a.batch, SURPLUS_NAME, rem]); }
    });
    tfoUpd.forEach(x => t.sh.getRange(x[0], t.c.ship + 1).setValue(x[1]));
    Object.keys(ordUpd).forEach(r => { const x = ordUpd[r]; o.sh.getRange(x.row, o.c.done + 1).setValue(x.done); o.sh.getRange(x.row, o.c.left + 1).setValue(x.left); });
    pickLog_(u, log);
    SpreadsheetApp.flush();
    return result;
  } finally { lock.releaseLock(); }
}

function pickOrders(token) {
  requireFeature_(token, 'soanhang');
  const o = readOrder_(), map = {}, order = [];
  o.rows.forEach(x => { if (!map[x.cust]) { map[x.cust] = []; order.push(x.cust); } map[x.cust].push(x); });
  const pending = [], done = [];
  order.forEach(cu => {
    const lines = map[cu], open = lines.filter(x => x.left > 0);
    if (open.length) pending.push({ cust: cu, lines: open.map(x => ({ row: x.row, item: x.item, name: x.name, batch: x.batch, left: x.left, qty: x.qty })) });
    else done.push({ cust: cu, count: lines.length, qty: lines.reduce((s, x) => s + x.qty, 0) });
  });
  return { pending: pending, done: done };
}

/** Soạn bổ sung cho 1 khách: cộng thêm vào cột Đã soạn của các dòng được chọn */
function pickComplete(token, cust, items) {
  const u = requireFeature_(token, 'soanhang');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const o = readOrder_(), log = [];
    (items || []).forEach(it => {
      const x = o.rows.find(r => r.row === Number(it.row));
      const q = num_(it.qty);
      if (!x || x.cust !== cust || q <= 0) return;
      const give = Math.min(q, x.left);
      if (give <= 0) return;
      x.done += give; x.left -= give;
      o.sh.getRange(x.row, o.c.done + 1).setValue(x.done);
      o.sh.getRange(x.row, o.c.left + 1).setValue(x.left);
      log.push(['Soạn bổ sung', x.item, x.batch, cust, give]);
    });
    if (!log.length) throw new Error('Không có dòng nào được cập nhật.');
    pickLog_(u, log);
    return log.length;
  } finally { lock.releaseLock(); }
}

function pickHistory(token, q) {
  requireFeature_(token, 'soanhang');
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_PICK_LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  const last = sh.getLastRow(), start = Math.max(2, last - 3000);
  const v = sh.getRange(start, 1, last - start + 1, 8).getValues();
  q = String(q || '').trim().toLowerCase();
  const out = [];
  for (let i = v.length - 1; i >= 0 && out.length < 200; i--) {
    const r = v[i];
    if (q && [r[4], r[5], r[6], r[3]].join(' ').toLowerCase().indexOf(q) === -1) continue;
    out.push({ time: r[0] instanceof Date ? Utilities.formatDate(r[0], 'GMT+7', 'dd/MM HH:mm') : String(r[0]), user: String(r[2] || r[1]),
               action: String(r[3]), item: String(r[4]), batch: String(r[5]), cust: String(r[6]), qty: num_(r[7]) });
  }
  return out;
}

/* =====================================================================
 *  BÀN GIAO CHỨNG TỪ  (sheet "Hand Over" trong file Ân Nam Nha Trang)
 *  - Mỗi mã quét = 1 dòng. "Yêu cầu hoàn lại" → trạng thái "Chờ hoàn lại" (hiện ở mục Chứng từ chờ hoàn trả của người nhận).
 *  - Khi người nhận bàn giao NGƯỢC lại đúng mã đó cho người gửi → dòng cũ chuyển "Đã hoàn lại".
 * ===================================================================== */
const SH_HANDOVER = 'Hand Over';
const HO_HEADERS = ['Thời gian', 'Người thao tác', 'Giao từ (username)', 'Giao từ', 'Giao cho (username)', 'Giao cho',
                    'Mã chứng từ', 'Yêu cầu hoàn lại', 'Trạng thái', 'Hoàn lại lúc', 'Ghi chú'];
const HO_PENDING = 'Chờ hoàn lại', HO_RETURNED = 'Đã hoàn lại', HO_NOREQ = 'Không yêu cầu';

/** Danh sách nhân viên đang hoạt động (để chọn Giao từ / Giao cho) */
function listStaff(token) {
  requireUser_(token);
  const v = getUserSheet_().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < v.length; i++) {
    const un = String(v[i][0]).trim();
    if (!un || !isActive_(v[i][6])) continue;
    out.push({ u: un, name: String(v[i][2]).trim() || un });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
function staffMap_() {
  const m = {};
  const v = getUserSheet_().getDataRange().getValues();
  for (let i = 1; i < v.length; i++) { const un = String(v[i][0]).trim(); if (un) m[un.toLowerCase()] = { u: un, name: String(v[i][2]).trim() || un }; }
  return m;
}

function writeHandOver_(u, list, results) {
  const sh = appSheet_(SH_HANDOVER, HO_HEADERS);
  const staff = staffMap_();
  const last = sh.getLastRow();
  const v = last >= 2 ? sh.getRange(2, 1, last - 1, HO_HEADERS.length).getValues() : [];
  const rows = [], updates = [];
  list.forEach(it => {
    const from = staff[String(it.from || u.username).toLowerCase()], to = staff[String(it.to).toLowerCase()];
    if (!from || !to) return results[it.id] = { id: it.id, result: 'Error', message: 'Chưa chọn đúng người giao / người nhận' };
    if (from.u.toLowerCase() === to.u.toLowerCase()) return results[it.id] = { id: it.id, result: 'Error', message: 'Người giao và người nhận trùng nhau' };
    const code = key_(it.code);
    // Trùng: cùng mã, cùng người giao → người nhận, vẫn đang chờ hoàn lại
    const dup = v.some(r => key_(r[6]) === code && String(r[8]) === HO_PENDING &&
                            key_(r[2]) === key_(from.u) && key_(r[4]) === key_(to.u));
    if (dup || rows.some(r => key_(r[6]) === code && key_(r[2]) === key_(from.u) && key_(r[4]) === key_(to.u)))
      return results[it.id] = { id: it.id, result: 'Duplicate', message: 'Chứng từ này đã bàn giao cho ' + to.name + ', đang chờ hoàn lại' };
    // Hoàn trả: người nhận trước đây (from) giao lại cho người gửi (to)
    let returned = false;
    v.forEach((r, i) => {
      if (key_(r[6]) === code && String(r[8]) === HO_PENDING && key_(r[4]) === key_(from.u) && key_(r[2]) === key_(to.u)) {
        r[8] = HO_RETURNED; r[9] = scanTime_(it.ts); updates.push(i); returned = true;
      }
    });
    rows.push([scanTime_(it.ts), u.name, from.u, from.name, to.u, to.name, String(it.code).trim(),
               it.ret ? 'Có' : 'Không', it.ret ? HO_PENDING : HO_NOREQ, '', (returned ? 'Hoàn trả chứng từ. ' : '') + (it.note || '')]);
    results[it.id] = { id: it.id, result: 'Success', message: returned ? 'Đã hoàn trả cho ' + to.name : '' };
  });
  updates.forEach(i => sh.getRange(i + 2, 9, 1, 2).setValues([[v[i][8], v[i][9]]]));
  if (!rows.length) return;
  const start = sh.getLastRow() + 1;
  safe_(() => sh.getRange(start, 7, rows.length, 1).setNumberFormat('@'));
  safe_(() => sh.getRange(start, 1, rows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss'));
  sh.getRange(start, 1, rows.length, HO_HEADERS.length).setValues(rows);
}

/** Chứng từ chờ hoàn trả: mine = tôi đang giữ (phải trả lại), waiting = tôi đã giao, đang chờ người khác trả */
function docsPending(token) {
  const u = requireUser_(token);
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_HANDOVER);
  const mine = [], waiting = [];
  if (sh && sh.getLastRow() >= 2) {
    const me = key_(u.username);
    sh.getRange(2, 1, sh.getLastRow() - 1, HO_HEADERS.length).getValues().forEach(r => {
      if (String(r[8]) !== HO_PENDING) return;
      const t = r[0] instanceof Date ? Utilities.formatDate(r[0], 'GMT+7', 'dd/MM/yyyy HH:mm') : String(r[0]);
      const days = r[0] instanceof Date ? Math.floor((Date.now() - r[0].getTime()) / 86400000) : 0;
      if (key_(r[4]) === me) mine.push({ code: String(r[6]), from: String(r[2]), fromName: String(r[3]), time: t, days: days, note: String(r[10] || '') });
      if (key_(r[2]) === me) waiting.push({ code: String(r[6]), to: String(r[4]), toName: String(r[5]), time: t, days: days, note: String(r[10] || '') });
    });
  }
  return { mine: mine.reverse(), waiting: waiting.reverse() };
}

/* =====================================================================
 *  CÔNG NỢ
 *  - "KH Cong no": danh sách khách hàng (admin import file Payment term: Customer Account | Customer Name |
 *     invoice account | Sales in charge | Payment term | Balance due).
 *  - "Cong no": mỗi đơn ĐÃ GIAO = 1 dòng (tự cập nhật từ BC Giao hang / BCGH Data).
 *  - "So tien thuc te": nguồn số tiền thực tế (Mã đơn | Số tiền) – nếu có thì luôn ưu tiên, không có mới lấy "Sales amount".
 *  - Hạn thu: COD/TBD thu ngay; N7/N15/N20 = ngày giao + 7/15/20 ngày, nhắc trước 2 ngày.
 * ===================================================================== */
const SH_DEBT_CUST = 'KH Cong no', SH_DEBT = 'Cong no', SH_DEBT_AMT = 'So tien thuc te';
const DEBT_HEADERS = ['Mã đơn', 'Mã KH', 'Tên KH', 'Sale phụ trách', 'Payment term', 'Ngày giao', 'Số tiền', 'Nguồn số tiền',
                      'Hạn thu', 'Ngày nhắc', 'Trạng thái', 'Cập nhật bởi', 'Cập nhật lúc', 'Ghi chú', 'Đã thu'];
// Số tiền "chính xác" = kế toán nhập (Thực tế) hoặc lấy từ DS nợ phải thu do kế toán import. Sales amount chỉ để tham khảo.
const debtExact_ = r => r[7] === 'Thực tế' || r[7] === 'File nợ phải thu';
const debtPaid_ = r => String(r[10]) === 'Hoàn thành' ? num_(r[6]) : num_(r[14]);
const DEBT_GROUPS = ['COD', 'TBD', 'N7', 'N15', 'N20'];
const DEBT_DAYS = { COD: 0, TBD: 0, N7: 7, N15: 15, N20: 20 };
const DEBT_REMIND_BEFORE = 2;
const DEBT_START_DATE = '2026-11-01'; // chỉ tính các đơn giao từ ngày này trở đi (cố định)
const DEBT_SYNC_MIN = 10;            // tự cập nhật đơn mới tối đa 10 phút / lần
const DEBT_ST = { WAIT: 'Chờ thu', ASK: 'Yêu cầu thu nợ', DONE: 'Hoàn thành', DEL: 'Đã xóa khỏi danh sách' };
const DEBT_EDIT_ROLES = ['admin', 'accountant'];

/* ---------- Danh sách đơn nợ phải thu TRƯỚC 01/11/2026 (admin import) ----------
 * Đơn có trong danh sách này luôn được theo dõi/nhắc nợ như bình thường, dù giao trước 01/11/2026,
 * dù không tìm thấy trong BC Giao hang / BCGH Data (khi đó lấy thông tin từ chính file import). */
const SH_DEBT_OPEN = 'Don no phai thu';
const SRC_OPEN = 'File nợ phải thu';
function findCol_(head, names, used) {
  used = used || {};
  const h = head.map(x => normName_(x));
  for (const n of names) { const i = h.findIndex((x, j) => !used[j] && x === normName_(n)); if (i !== -1) return i; }
  for (const n of names) { const k = normName_(n); if (k.length < 4) continue; const i = h.findIndex((x, j) => !used[j] && x && x.indexOf(k) !== -1); if (i !== -1) return i; }
  return -1;
}
/** Số tiền kiểu VN "2.000.000" / "1.250.000,5" hoặc kiểu Anh "2,000,000.00" */
function numAny_(v) {
  if (typeof v === 'number') return v;
  let s = String(v == null ? '' : v).replace(/[^\d.,\-]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  return Number(s) || 0;
}
const OPEN_COLS = {
  so:   ['Sales order', 'Mã đơn', 'Mã đơn hàng', 'Số đơn hàng', 'Số đơn', 'SO', 'Order'],
  acc:  ['Customer account', 'Mã KH', 'Mã khách hàng', 'Customer', 'Account'],
  name: ['Customer name', 'Tên KH', 'Tên khách hàng', 'Khách hàng', 'Name'],
  sale: ['Sales in charge', 'Sales responsible', 'Sale phụ trách', 'Sale', 'Nhân viên'],
  date: ['Delivery date', 'Ngày giao', 'Ngày giao hàng', 'Invoice date', 'Ngày hóa đơn', 'Date', 'Ngày'],
  amt:  ['Balance due', 'Số tiền nợ', 'Số tiền còn lại', 'Còn lại', 'Remaining', 'Balance', 'Amount', 'Số tiền', 'Sales amount'],
  note: ['Ghi chú', 'Note', 'Comment']
};
function termOf_(cust, acc, inv) {
  const c = cust[key_(acc)] || (inv ? Object.keys(cust).map(k => cust[k]).find(x => key_(x.inv) === key_(inv) && x.term) : null);
  return c || null;
}
/* ---------- Ngày tháng cho công nợ: luôn tính theo NGÀY Việt Nam (GMT+7), không phụ thuộc múi giờ của script ----------
 * Đọc được: ô kiểu Ngày (Date) • số serial của Sheets • "dd/MM/yyyy" • "MM/dd/yyyy" (kiểu Mỹ) • "yyyy-MM-dd" • có/không kèm giờ.
 * Chuỗi mơ hồ (VD 02/11/2026): xét cả cột – cột có ngày >12 ở vị trí đầu là dd/MM, ở vị trí thứ 2 là MM/dd (dateOrder_).
 * Không xác định được thì mặc định dd/MM; chỉ đổi sang MM/dd nếu dd/MM rơi vào tương lai còn MM/dd thì không. */
function dateOrder_(values) {
  let dm = 0, md = 0;
  values.forEach(v => {
    if (v instanceof Date || typeof v === 'number') return;
    const m = String(v == null ? '' : v).trim().match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{2,4}/);
    if (!m) return;
    if (+m[1] > 12 && +m[2] <= 12) dm++; else if (+m[2] > 12 && +m[1] <= 12) md++;
  });
  return dm > md ? 'dm' : md > dm ? 'md' : '';
}
const VN_MS = 7 * 3600000, DAY_MS = 86400000;
function vnDate_(y, mo, d) {                      // 12h trưa giờ VN của ngày y-mo-d
  if (!(y > 1900 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const x = new Date(Date.UTC(y, mo - 1, d, 5));
  return x.getUTCMonth() === mo - 1 ? x : null;   // loại 31/02, 31/04...
}
function toDate_(v, order) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.round(v) * DAY_MS + 5 * 3600000) : null;
  const s = String(v == null ? '' : v).trim(); if (!s) return null;
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return vnDate_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const dm = vnDate_(y, b, a), md = vnDate_(y, a, b);      // dm = dd/MM, md = MM/dd
    if (dm && md) {
      if (order === 'md') return md;
      if (order === 'dm') return dm;
      const lim = Date.now() + 2 * DAY_MS; return dm.getTime() > lim && md.getTime() <= lim ? md : dm;
    }
    return dm || md;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return toDate_(Number(s));
  const d = new Date(s); return isNaN(d.getTime()) ? null : d;
}
const dayNo_ = d => Math.floor((d.getTime() + VN_MS) / DAY_MS);          // số thứ tự ngày theo giờ VN
const dayDate_ = n => new Date(n * DAY_MS + 5 * 3600000);                 // ngày (12h trưa VN) từ số thứ tự
const DEBT_START_NO = dayNo_(new Date(DEBT_START_DATE + 'T12:00:00+07:00'));
/** Đơn giao từ ngày DEBT_START_DATE trở đi? null = không đọc được ngày (không tự loại để tránh sót) */
function debtDayOk_(v) { const d = toDate_(v); return d ? dayNo_(d) >= DEBT_START_NO : null; }
function dueOf_(term, delivered) {
  if (!delivered) return { due: '', remind: '' };
  const n = DEBT_DAYS[term], d0 = dayNo_(delivered);
  if (n === undefined || !n) return { due: dayDate_(d0), remind: dayDate_(d0) };     // COD / TBD / chưa có điều khoản: thu ngay
  return { due: dayDate_(d0 + n), remind: dayDate_(d0 + n - DEBT_REMIND_BEFORE) };
}
const isDelivered_ = v => normName_(v) === 'da giao';      // so sánh không phân biệt dấu/khoảng trắng/kiểu gõ Unicode

/** Số tiền: ưu tiên sheet "So tien thuc te" (nguồn khác), sau đó "Sales amount" trong Orders / AFF / AKD / AGM */
function debtActualAmounts_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_DEBT_AMT);
  const m = {};
  if (!sh || sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    const k = key_(r[0]); if (k && String(r[1]).trim() !== '') m[k] = num_(r[1]);
  });
  return m;
}
/** Sales amount theo tiền tố mã đơn (file BAO CAO GIAO HANG): AFF… → sheet AFF · AGM… → sheet AGM · RWH… → sheet AKD.
 *  Không thấy ở sheet đúng tiền tố thì tìm thêm ở các sheet còn lại và Orders (phòng khi đơn bị chuyển sheet). */
const SALES_SHEET_BY_PREFIX = { AFF: 'AFF', AGM: 'AGM', RWH: 'AKD' };
const SALES_AMT_FACTOR = 1.08;   // Sales amount (chưa thuế) × 1.08 → số tiền nợ gần đúng
function debtSalesAmounts_(want) {
  const m = {}, cache = {};
  const ss = SpreadsheetApp.openById(DATA_SS_ID);
  const load = name => {
    if (cache[name] !== undefined) return cache[name];
    const sh = ss.getSheetByName(name), idx = {};
    if (sh && sh.getLastRow() >= 2) {
      const v = sh.getDataRange().getValues();
      // Chỉ lấy "Sales amount" (KHÔNG dùng "Total amount" vì số trong báo cáo không đúng)
      const cSo = headerIndex_(v[0], ['sales order']), cAmt = headerIndex_(v[0], ['sales amount']);
      if (cSo !== -1 && cAmt !== -1) for (let i = 1; i < v.length; i++) {
        const k = key_(v[i][cSo]); if (!k || idx[k]) continue;
        const a = numAny_(v[i][cAmt]);
        if (a) idx[k] = Math.round(a * SALES_AMT_FACTOR);
      }
    }
    return (cache[name] = idx);
  };
  const keys = Object.keys(want);
  keys.forEach(k => { const s = SALES_SHEET_BY_PREFIX[k.slice(0, 3)]; if (s && load(s)[k]) m[k] = load(s)[k]; });
  ['AFF', 'AGM', 'AKD', 'Orders'].forEach(name => {
    const miss = keys.filter(k => !(k in m)); if (!miss.length) return;
    const idx = load(name); miss.forEach(k => { if (idx[k]) m[k] = idx[k]; });
  });
  return m;
}
const cleanVal_ = v => { const s = String(v == null ? '' : v).trim(); return /^\*+$/.test(s) || /^#(N\/A|REF!|VALUE!)/.test(s) ? '' : s; };   // "***" = dữ liệu chưa tải xong

/* ---------- Đọc ngày theo ĐÚNG kiểu của từng cột (đã xác nhận) ----------
 *  • Delivery date (ngày giao)        : kiểu Việt  dd/mm/yyyy  (kể cả "dd/mm/yy - HH:mm")
 *  • Created date and time (ngày tạo) : kiểu Mỹ    mm/dd/yyyy
 *  Ô đã là kiểu Ngày của Google Sheets: ngày giao giữ nguyên; ngày tạo có thể đã bị Sheets (cài đặt Việt Nam) tự đổi sai
 *  khi dán dữ liệu kiểu Mỹ (VD "6/11/2026" = 11/6 bị thành 6/11) → ngày tạo chỉ dùng để LOẠI đơn khi mọi cách hiểu đều quá cũ. */
function parseFixed_(v, order) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v == null ? '' : v).trim();
  if (!s || /^\*+$/.test(s)) return null;
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(s)) return toDate_(v);
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return vnDate_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
  if (!m) return null;
  const a = +m[1], b = +m[2], y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
  return order === 'md' ? vnDate_(y, a, b) : vnDate_(y, b, a);
}
function createdCands_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const p = Utilities.formatDate(v, 'GMT+7', 'yyyy-M-d').split('-').map(Number);
    const sw = p[2] <= 12 ? vnDate_(p[0], p[2], p[1]) : null;          // có thể đã bị đảo ngày/tháng
    return sw && dayNo_(sw) !== dayNo_(v) ? [v, sw] : [v];
  }
  const d = parseFixed_(v, 'md');
  return d ? [d] : [];
}
/** Lượt quét "Đã giao" trong Log Detail (thời gian máy ghi, luôn chính xác): mã đơn → ngày quét đầu tiên */
function logGiaoDates_(since) {
  const m = {};
  try {
    readLogSince_(since).forEach(r => {
      if (String(r[4]).trim() !== SCAN_STATUS.GIAO) return;
      const k = key_(r[2]); if (!k) return;
      if (!m[k] || r[0].getTime() < m[k].getTime()) m[k] = r[0];
    });
  } catch (e) {}
  return m;
}

/**
 * Quyết định 1 dòng báo cáo giao hàng có thuộc diện công nợ không (đơn giao từ 01/11/2026).
 * KHÔNG SÓT ĐƠN: chỉ loại khi chắc chắn giao trước 01/11; chưa chắc thì vẫn đưa vào + ghi chú để kế toán kiểm tra.
 *  → { inc: bool, date: Date|'', note: '' }
 */
function debtDecide_(rawDel, rawCre, logD, today) {
  const S = DEBT_START_NO;
  const de = parseFixed_(rawDel, 'dm');                       // ngày giao: kiểu Việt
  if (de) {
    if (dayNo_(de) > today) return { inc: true, date: de, note: 'Ngày giao "' + String(rawDel).trim() + '" ở tương lai – kiểm tra lại' };
    return { inc: dayNo_(de) >= S, date: de, note: '' };
  }
  if (logD) return { inc: dayNo_(logD) >= S, date: logD, note: 'Ngày giao theo lượt quét "Đã giao"' };
  const cc = createdCands_(rawCre);                          // không có ngày giao → xem ngày tạo đơn (kiểu Mỹ)
  if (cc.length && cc.every(d => dayNo_(d) < S - 7)) return { inc: false, date: '', note: '' };
  return { inc: true, date: '', note: 'Không có ngày giao – cần kiểm tra' };
}

/** Đưa đơn đã giao mới vào sheet Cong no, làm mới thông tin/số tiền/ngày giao. Chạy tối đa DEBT_SYNC_MIN phút / lần. */
function debtSync_(force) {
  const props = PropertiesService.getScriptProperties();
  const lastAt = Number(props.getProperty('DEBT_SYNC_AT') || 0);
  if (!force && Date.now() - lastAt < DEBT_SYNC_MIN * 60000) return;
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = appSheet_(SH_DEBT, DEBT_HEADERS);
    sh.getRange(1, 1, 1, DEBT_HEADERS.length).setValues([DEBT_HEADERS]);      // thêm cột "Đã thu" cho sheet cũ
    const last = sh.getLastRow();
    let v = last >= 2 ? sh.getRange(2, 1, last - 1, DEBT_HEADERS.length).getValues() : [];
    const open = debtOpenList_();
    const cust = debtCustomers_();
    const today = dayNo_(new Date());
    const logG = logGiaoDates_(dayDate_(DEBT_START_NO - 45));
    const ss = SpreadsheetApp.openById(DATA_SS_ID);
    const bcInfo = {};      // mã đơn → thông tin từ báo cáo giao hàng (ưu tiên BC Giao hang) + quyết định ngày giao
    ['BC Giao hang', 'BCGH Data'].forEach(name => {
      const s = ss.getSheetByName(name); if (!s || s.getLastRow() < 2) return;
      const d = s.getDataRange().getValues();
      const c = {}; d[0].forEach((h, i) => c[String(h).trim()] = i);
      if (c['Sales order'] === undefined || c['Status'] === undefined) return;
      for (let i = 1; i < d.length; i++) {
        const r = d[i];
        const so = String(r[c['Sales order']] || '').trim(), k = key_(so);
        if (!k || bcInfo[k]) continue;
        const delivered = isDelivered_(r[c['Status']]);
        if (!delivered && !open[k]) { bcInfo[k] = { so: so, acc: cleanVal_(r[c['Customer account']]), name: cleanVal_(r[c['Customer name']]), sale: cleanVal_(r[c['Sales responsible']]), delivered: false }; continue; }
        const dec = debtDecide_(c['Delivery date'] !== undefined ? r[c['Delivery date']] : '', c['Created date and time'] !== undefined ? r[c['Created date and time']] : '',
                                logG[k] || null, today);
        bcInfo[k] = { so: so, acc: cleanVal_(r[c['Customer account']]), name: cleanVal_(r[c['Customer name']]), sale: cleanVal_(r[c['Sales responsible']]),
                      delivered: delivered, dec: dec };
      }
    });
    const actual = debtActualAmounts_();
    const isWait = r => String(r[10] || DEBT_ST.WAIT) === DEBT_ST.WAIT && !r[11];

    // 1) Làm mới các dòng đang theo dõi + loại các dòng CHẮC CHẮN giao trước 01/11 (chưa ai xử lý, không có trong DS nợ phải thu)
    const kept = [];
    v.forEach(r => {
      const k = key_(r[0]), op = open[k], bi = bcInfo[k];
      if (!op && bi && bi.dec && !bi.dec.inc && isWait(r)) return;                       // ngày giao đọc lại → trước 01/11
      if (!op && !bi && debtDayOk_(r[5]) === false && isWait(r)) return;                 // dòng cũ ghi nhầm
      kept.push(r);
    });
    const have = {}; kept.forEach(r => have[key_(r[0])] = 1);

    // 2) Đơn mới
    const fresh = {};
    Object.keys(bcInfo).forEach(k => {
      const bi = bcInfo[k], op = open[k];
      if (have[k] || (!op && !(bi.delivered && bi.dec && bi.dec.inc))) return;
      if (op) {
        const dd = op.date || (bi.dec && bi.dec.date) || '';
        fresh[k] = { so: bi.so, acc: bi.acc || op.acc, name: bi.name || op.name, sale: bi.sale || op.sale, date: dd, open: op,
                     note: 'Nợ trước 01/11 (DS nợ phải thu)' + (dd ? '' : ' – chưa có ngày giao') };
      } else fresh[k] = { so: bi.so, acc: bi.acc, name: bi.name, sale: bi.sale, date: bi.dec.date || '', note: bi.dec.note };
    });
    Object.keys(open).forEach(k => {           // đơn trong DS nợ phải thu nhưng không có trong báo cáo giao hàng
      if (have[k] || fresh[k]) return;
      const op = open[k];
      fresh[k] = { so: op.so, acc: op.acc, name: op.name, sale: op.sale, date: op.date || '', open: op,
                   note: 'Nợ trước 01/11 (DS nợ phải thu)' + (op.date ? '' : ' – chưa có ngày giao') };
    });
    const keys = Object.keys(fresh);
    const want = {}; keys.forEach(k => want[k] = 1);
    kept.forEach(r => { const k = key_(r[0]); if (k && debtOpenSt_(String(r[10] || '')) && !(k in actual) && !(open[k] && open[k].amt != null)) want[k] = 1; });
    const sales = Object.keys(want).length ? debtSalesAmounts_(want) : {};

    // 3) Cập nhật dòng cũ: số tiền, thông tin KH/Sale theo báo cáo giao hàng, ngày giao đọc lại, payment term
    kept.forEach(r => {
      if (!debtOpenSt_(String(r[10] || ''))) return;
      const k = key_(r[0]), op = open[k], bi = bcInfo[k];
      if (k in actual) { r[6] = actual[k]; r[7] = 'Thực tế'; }
      else if (op && op.amt != null) { r[6] = op.amt; r[7] = SRC_OPEN; }
      else if (sales[k]) { r[6] = sales[k]; r[7] = 'Sales amount'; }
      if (bi) [[1, 'acc'], [2, 'name'], [3, 'sale']].forEach(([ci2, f]) => { if (bi[f]) r[ci2] = bi[f]; });
      else [1, 2, 3].forEach(ci2 => { if (/^\*+$/.test(String(r[ci2]).trim())) r[ci2] = ''; });
      let dd = toDate_(r[5]);
      if (op && op.date) dd = op.date;
      else if (bi && bi.dec && bi.dec.date && (!dd || dayNo_(dd) !== dayNo_(bi.dec.date))) { dd = bi.dec.date; }
      if (bi && bi.dec && !op) {             // ghi chú về ngày giao luôn theo lần đọc mới nhất
        const n = String(r[13] || '').replace(/(Ngày giao "[^"]*" chưa rõ[^·]*|Không có ngày giao – cần kiểm tra|Chưa có ngày giao – tạm tính theo ngày tạo đơn|Ngày giao theo lượt quét "Đã giao")( · )?/g, '').trim();
        r[13] = [bi.dec.note, n].filter(Boolean).join(' · ');
      }
      r[5] = dd || '';
      const ci = termOf_(cust, r[1], ''), term = (ci && ci.term) || normTerm_(r[4]);
      const du = dd ? dueOf_(term, dd) : { due: '', remind: '' };
      r[4] = term; r[8] = du.due; r[9] = du.remind;
    });
    const rows = keys.map(k => {
      const o = fresh[k], ci = termOf_(cust, o.acc, '');
      const term = ci && ci.term ? ci.term : '';
      const du = o.date ? dueOf_(term, o.date) : { due: '', remind: '' };
      const oa = o.open && o.open.amt != null ? o.open.amt : null;
      const amt = k in actual ? actual[k] : oa != null ? oa : (sales[k] || 0);
      const src = k in actual ? 'Thực tế' : oa != null ? SRC_OPEN : (sales[k] ? 'Sales amount' : '');
      return [o.so, o.acc, o.name, o.sale, term, o.date, amt, src, du.due, du.remind, DEBT_ST.WAIT, '', '',
              [o.note, o.open && o.open.note].filter(Boolean).join(' · '), ''];
    });
    // 4) Ghi lại toàn bộ sheet 1 lần
    const all = kept.concat(rows);
    if (v.length) sh.getRange(2, 1, v.length, DEBT_HEADERS.length).clearContent();
    if (all.length) {
      safe_(() => { sh.getRange(2, 1, all.length, 2).setNumberFormat('@'); sh.getRange(2, 6, all.length, 1).setNumberFormat('dd/MM/yyyy');
                    sh.getRange(2, 9, all.length, 2).setNumberFormat('dd/MM/yyyy'); sh.getRange(2, 7, all.length, 1).setNumberFormat('#,##0'); });
      sh.getRange(2, 1, all.length, DEBT_HEADERS.length).setValues(all);
    }
    debtWriteBalances_(all);      // cột Balance due của danh sách KH = tổng các đơn còn nợ
    props.setProperty('DEBT_SYNC_AT', String(Date.now()));
  } finally { lock.releaseLock(); }
}

/* ---------- Quyền công nợ ----------
 *  admin, accountant : toàn quyền (nhập/sửa danh sách KH, đơn nợ, số tiền, trạng thái, xuất Excel)
 *  manager           : xem đơn "Yêu cầu thu nợ" + danh sách KH, chọn sale để lọc
 *  sale              : chỉ khách / đơn của mình, chỉ đơn "Yêu cầu thu nợ" */
const DEBT_TERMS = ['COD', 'TBD', 'N7', 'N15', 'N20', '000'];       // 000 = khách quản lý ở báo cáo khác → bỏ qua
const QLCN_FOLDER_ID = cfg_('QLCN_FOLDER_ID');          // thư mục "QL Cong no" (tệp đính kèm)
const SH_DEBT_TALK = 'Cong no trao doi';
const DEBT_TALK_HEADERS = ['Thời gian', 'Mã đơn', 'Loại', 'Username', 'Người', 'Nội dung', 'File ID', 'Tên file', 'Kiểu file'];
const CUST_HEADERS = ['Customer Account', 'Customer Name', 'Invoice account', 'Sales in charge', 'Payment term', 'Balance due (tự tính)', 'Cập nhật lúc', 'Cập nhật bởi'];
const OPEN_HEADERS2 = ['Mã đơn', 'Mã KH', 'Tên KH', 'Sale phụ trách', 'Ngày giao', 'Số tiền', 'Ghi chú', 'Thêm lúc', 'Thêm bởi'];
const AMT_HEADERS = ['Mã đơn', 'Số tiền thực tế', 'Cập nhật bởi', 'Cập nhật lúc'];

const debtCanEdit_ = u => DEBT_EDIT_ROLES.indexOf(u.role) !== -1;
function requireDebtEdit_(token) {
  const u = requireFeature_(token, 'congno');
  if (!debtCanEdit_(u)) throw new Error('Chỉ kế toán hoặc admin được thực hiện thao tác này.');
  return u;
}
function normTerm_(v) {
  let s = String(v == null ? '' : v).toUpperCase().replace(/\s+/g, '');
  if (/^0+$/.test(s) || s === '0') return '000';
  if (/^N0?\d+$/.test(s)) s = 'N' + Number(s.slice(1));
  return s;
}
function isMine_(u, sale) { return normName_(sale) === normName_(u.name) || sameMan_(u.name, sale); }

/* ===== DANH SÁCH KHÁCH HÀNG ===== */
function debtCustomers_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_DEBT_CUST);
  const m = {};
  if (!sh || sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().forEach((r, i) => {
    const o = { acc: String(r[0]).trim(), name: String(r[1]).trim(), inv: String(r[2]).trim(), sale: String(r[3]).trim(),
                term: normTerm_(r[4]), row: i + 2 };
    if (o.acc) m[key_(o.acc)] = o;
  });
  return m;
}
/** Dư nợ theo khách = tổng số tiền các đơn chưa Hoàn thành / chưa xóa trong sheet Cong no
 *  (gồm đơn nợ trước 01/11 trong DS nợ phải thu + đơn giao từ 01/11 hệ thống tự cộng dồn) */
function debtLedger_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_DEBT);
  return sh && sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, DEBT_HEADERS.length).getValues() : [];
}
const debtOpenSt_ = st => st !== DEBT_ST.DONE && st !== DEBT_ST.DEL;
function debtBalances_(ledger) {
  const b = {};
  ledger.forEach(r => {
    if (!debtOpenSt_(String(r[10] || DEBT_ST.WAIT))) return;
    const k = key_(r[1]); if (!k) return;
    const o = b[k] || (b[k] = { bal: 0, orders: 0 });
    o.bal += num_(r[6]) - num_(r[14]); o.orders++;          // dư nợ = số tiền − đã thu
  });
  return b;
}
function debtWriteBalances_(ledger) {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_DEBT_CUST);
  if (!sh || sh.getLastRow() < 2) return;
  const n = sh.getLastRow() - 1, b = debtBalances_(ledger);
  const acc = sh.getRange(2, 1, n, 1).getValues();
  sh.getRange(2, 6, n, 1).setValues(acc.map(r => [b[key_(r[0])] ? b[key_(r[0])].bal : 0]));
}

/** Danh sách khách hàng (kèm dư nợ tự tính). Sale: chỉ khách của mình. */
function debtCustList(token) {
  const u = requireFeature_(token, 'congno');
  const own = scopeOf_(u) === 'own';
  const cust = debtCustomers_(), led = debtLedger_(), b = debtBalances_(led);
  let rows = Object.keys(cust).map(k => cust[k]).filter(c => !own || isMine_(u, c.sale))
    .map(c => ({ acc: c.acc, name: c.name, inv: c.inv, sale: c.sale, term: c.term, bal: b[key_(c.acc)] ? b[key_(c.acc)].bal : 0,
                 orders: b[key_(c.acc)] ? b[key_(c.acc)].orders : 0 }));
  if (!debtCanEdit_(u)) rows = rows.filter(r => r.bal > 0);        // sale / manager: chỉ khách còn dư nợ
  const sales = [...new Set(rows.map(r => r.sale).filter(Boolean))].sort((a, b2) => a.localeCompare(b2, 'vi'));
  return { rows: rows, canEdit: debtCanEdit_(u), canPick: !own, sales: sales, terms: DEBT_TERMS };
}

/** Lưu danh sách KH (nhập tay / dán / import): thêm mới hoặc cập nhật theo Customer Account. Có lỗi → không lưu gì. */
function debtCustSave(token, rows) {
  const u = requireDebtEdit_(token);
  rows = Array.isArray(rows) ? rows : [];
  const errors = [], seen = {}, clean = [];
  rows.forEach((r, i) => {
    const n = r.line || i + 1;
    const acc = String(r.acc || '').trim(), term = normTerm_(r.term);
    if (!acc && !String(r.name || '').trim() && !String(r.term || '').trim()) return;     // dòng trống
    if (!acc) errors.push({ line: n, msg: 'Thiếu Customer Account' });
    else if (seen[key_(acc)]) errors.push({ line: n, msg: 'Trùng mã KH ' + acc + ' với dòng ' + seen[key_(acc)] });
    if (!term) errors.push({ line: n, msg: 'Thiếu Payment term' });
    else if (DEBT_TERMS.indexOf(term) === -1) errors.push({ line: n, msg: 'Payment term "' + r.term + '" không hợp lệ (chỉ nhận ' + DEBT_TERMS.join(', ') + ')' });
    if (acc) seen[key_(acc)] = n;
    clean.push([acc, String(r.name || '').trim(), String(r.inv || '').trim(), String(r.sale || '').trim(), term]);
  });
  if (errors.length) return { ok: false, errors: errors };
  if (!clean.length) throw new Error('Chưa có dữ liệu.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  let added = 0, updated = 0;
  try {
    const sh = appSheet_(SH_DEBT_CUST, CUST_HEADERS);
    sh.getRange(1, 1, 1, CUST_HEADERS.length).setValues([CUST_HEADERS]);
    const cust = debtCustomers_(), now = new Date(), app = [];
    clean.forEach(r => {
      const old = cust[key_(r[0])];
      if (old) {
        sh.getRange(old.row, 1, 1, 5).setValues([[r[0], r[1] || old.name, r[2] || old.inv, r[3] || old.sale, r[4]]]);
        sh.getRange(old.row, 7, 1, 2).setValues([[now, u.name]]); updated++;
      } else { app.push(r.concat([0, now, u.name])); added++; }
    });
    if (app.length) {
      const st = sh.getLastRow() + 1;
      safe_(() => sh.getRange(st, 1, app.length, 5).setNumberFormat('@'));
      sh.getRange(st, 1, app.length, CUST_HEADERS.length).setValues(app);
    }
    debtWriteBalances_(debtLedger_());
    PropertiesService.getScriptProperties().deleteProperty('DEBT_SYNC_AT');
  } finally { lock.releaseLock(); }
  return { ok: true, added: added, updated: updated };
}
function debtCustDelete(token, accs) {
  requireDebtEdit_(token);
  const want = {}; (accs || []).forEach(a => want[key_(a)] = 1);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  let n = 0;
  try {
    const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_DEBT_CUST);
    if (!sh || sh.getLastRow() < 2) return { deleted: 0 };
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, CUST_HEADERS.length).getValues();
    const keep = v.filter(r => { const d = want[key_(r[0])]; if (d) n++; return !d; });
    sh.getRange(2, 1, v.length, CUST_HEADERS.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, CUST_HEADERS.length).setValues(keep);
  } finally { lock.releaseLock(); }
  return { deleted: n };
}

/* ===== DANH SÁCH ĐƠN NỢ PHẢI THU (trước 01/11/2026) ===== */
/** Thêm đơn nợ (nhập tay / dán / import). Bắt buộc: Mã đơn, Mã KH, Tên KH, Số tiền, Sale.
 *  Có dòng lỗi → KHÔNG lưu, trả danh sách lỗi. Đơn đã có trong hệ thống → bỏ qua và báo trùng. */
function debtOpenSave(token, rows) {
  const u = requireDebtEdit_(token);
  rows = Array.isArray(rows) ? rows : [];
  const errors = [], seen = {}, clean = [];
  const ord = 'dm';    // bảng nhập liệu: ngày kiểu Việt Nam dd/mm/yyyy
  rows.forEach((r, i) => {
    const n = r.line || i + 1;
    const so = String(r.so || '').trim(), acc = String(r.acc || '').trim(), name = String(r.name || '').trim(),
          sale = String(r.sale || '').trim(), amtS = String(r.amt == null ? '' : r.amt).trim(), dS = String(r.date == null ? '' : r.date).trim();
    if (!so && !acc && !name && !amtS && !sale) return;      // dòng trống
    const e = [];
    if (!so) e.push('thiếu Mã đơn');
    if (!acc) e.push('thiếu Mã KH');
    if (!name) e.push('thiếu Tên KH');
    if (!sale) e.push('thiếu Sale phụ trách');
    const amt = numAny_(r.amt);
    if (!amtS) e.push('thiếu Số tiền'); else if (!/^-?[\d.,\s]+(đ|vnd)?$/i.test(amtS.replace(/[đ₫]/g, '')) && typeof r.amt !== 'number') e.push('Số tiền "' + amtS + '" không phải số');
    else if (!(amt > 0)) e.push('Số tiền phải > 0');
    let d = '';
    if (dS) { d = toDate_(r.date, ord); if (!d) e.push('Ngày giao "' + dS + '" không đọc được'); }
    if (so && seen[key_(so)]) e.push('trùng Mã đơn với dòng ' + seen[key_(so)]);
    if (so) seen[key_(so)] = n;
    if (e.length) errors.push({ line: n, so: so, msg: e.join('; ') });
    clean.push({ so: so, acc: acc, name: name, sale: sale, date: d, amt: amt, note: String(r.note || '').trim() });
  });
  if (errors.length) return { ok: false, errors: errors };
  if (!clean.length) throw new Error('Chưa có dữ liệu.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  const dups = [], add = [];
  try {
    const sh = appSheet_(SH_DEBT_OPEN, OPEN_HEADERS2);
    sh.getRange(1, 1, 1, OPEN_HEADERS2.length).setValues([OPEN_HEADERS2]);
    const open = debtOpenList_(), inLed = {};
    debtLedger_().forEach(r => inLed[key_(r[0])] = String(r[10] || ''));
    const now = new Date();
    clean.forEach(o => {
      const k = key_(o.so);
      if (open[k]) dups.push({ so: o.so, msg: 'đã có trong danh sách đơn nợ' });
      else if (k in inLed) dups.push({ so: o.so, msg: 'đã có trong theo dõi công nợ (' + (inLed[k] || DEBT_ST.WAIT) + ')' });
      else add.push([o.so, o.acc, o.name, o.sale, o.date, o.amt, o.note, now, u.name]);
    });
    if (add.length) {
      const st = sh.getLastRow() + 1;
      safe_(() => { sh.getRange(st, 1, add.length, 2).setNumberFormat('@'); sh.getRange(st, 5, add.length, 1).setNumberFormat('dd/MM/yyyy');
                    sh.getRange(st, 6, add.length, 1).setNumberFormat('#,##0'); });
      sh.getRange(st, 1, add.length, OPEN_HEADERS2.length).setValues(add);
    }
  } finally { lock.releaseLock(); }
  if (add.length) debtSync_(true);       // đưa ngay vào danh sách theo dõi + cộng dư nợ
  return { ok: true, added: add.length, dups: dups };
}
function debtOpenList_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_DEBT_OPEN);
  const m = {};
  if (!sh || sh.getLastRow() < 2) return m;
  sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().forEach(r => {
    const k = key_(r[0]); if (!k) return;
    m[k] = { so: String(r[0]).trim(), acc: String(r[1]).trim(), name: String(r[2]).trim(), sale: String(r[3]).trim(),
             date: toDate_(r[4]), amt: String(r[5]).trim() === '' ? null : num_(r[5]), note: String(r[6] || '').trim() };
  });
  return m;
}

/* ===== SỐ TIỀN THỰC TẾ (kế toán sửa trên màn hình nhắc nợ) ===== */
function debtSetAmount(token, so, amount) {
  const u = requireDebtEdit_(token);
  const k = key_(so); if (!k) throw new Error('Thiếu mã đơn.');
  const clear = amount === '' || amount == null;
  const amt = clear ? null : numAny_(amount);
  if (!clear && !(amt >= 0)) throw new Error('Số tiền không hợp lệ.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  let newAmt = amt, src = 'Thực tế';
  try {
    const sa = appSheet_(SH_DEBT_AMT, AMT_HEADERS);
    sa.getRange(1, 1, 1, AMT_HEADERS.length).setValues([AMT_HEADERS]);
    const v = sa.getLastRow() >= 2 ? sa.getRange(2, 1, sa.getLastRow() - 1, 1).getValues() : [];
    const i = v.findIndex(r => key_(r[0]) === k);
    if (clear) { if (i !== -1) sa.getRange(i + 2, 1, 1, AMT_HEADERS.length).clearContent(); }
    else if (i !== -1) sa.getRange(i + 2, 2, 1, 3).setValues([[amt, u.name, new Date()]]);
    else { const st = sa.getLastRow() + 1; safe_(() => sa.getRange(st, 1).setNumberFormat('@')); sa.getRange(st, 1, 1, 4).setValues([[String(so).trim(), amt, u.name, new Date()]]); }
    if (clear) {        // bỏ số thực tế → quay về số trong DS nợ phải thu / Sales amount
      const op = debtOpenList_()[k];
      if (op && op.amt != null) { newAmt = op.amt; src = SRC_OPEN; }
      else { const s = debtSalesAmounts_({ [k]: 1 }); newAmt = s[k] || 0; src = s[k] ? 'Sales amount' : ''; }
    }
    const sh = appSheet_(SH_DEBT, DEBT_HEADERS);
    const led = debtLedger_();
    const j = led.findIndex(r => key_(r[0]) === k);
    if (j !== -1) sh.getRange(j + 2, 7, 1, 2).setValues([[newAmt, src]]);
    led[j !== -1 ? j : 0] && j !== -1 && (led[j][6] = newAmt);
    debtWriteBalances_(led);
  } finally { lock.releaseLock(); }
  return { amount: newAmt, src: src };
}

/* ===== BÁO CÁO NHẮC NỢ ===== */
function debtView_(u, r, cust, open, today, all) {
  const st = String(r[10] || DEBT_ST.WAIT);
  if (!debtOpenSt_(st)) return null;
  if (!debtCanEdit_(u) && st !== DEBT_ST.ASK) return null;
  if (scopeOf_(u) === 'own' && !isMine_(u, r[3])) return null;
  if (debtDayOk_(r[5]) === false && !open[key_(r[0])]) return null;     // chỉ đơn từ 01/11/2026 hoặc trong DS nợ phải thu
  const ci = cust[key_(r[1])];
  const term = (ci && ci.term) || normTerm_(r[4]);
  if (term === '000') return null;                                         // khách quản lý ở báo cáo khác
  const dd = toDate_(r[5]);
  const du = dd ? dueOf_(term, dd) : { due: '', remind: '' };
  if (!all && du.remind && dayNo_(du.remind) > today) return null;         // chưa tới ngày nhắc (chế độ "Nợ đến hạn")
  const f = d => d ? Utilities.formatDate(d, 'GMT+7', 'dd/MM/yyyy') : '';
  return { so: String(r[0]), acc: String(r[1]), name: String(r[2]), sale: String(r[3]), term: term, dno: dd ? dayNo_(dd) : 1e9, row: r.__i || 0,
           date: f(dd), due: f(du.due), amount: num_(r[6]), src: String(r[7] || ''), status: st,
           by: String(r[11] || ''), at: r[12] instanceof Date ? Utilities.formatDate(r[12], 'GMT+7', 'dd/MM HH:mm') : String(r[12] || ''),
           overdue: du.due ? today - dayNo_(du.due) : 0, note: String(r[13] || ''),
           paid: debtPaid_(r), remain: num_(r[6]) - debtPaid_(r), exact: debtExact_(r) };
}
function debtReport(token, opt) {
  const u = requireFeature_(token, 'congno');
  opt = opt || {};
  const props = PropertiesService.getScriptProperties();
  const fresh = props.getProperty('DEBT_CODE_VER') !== CODE_VERSION;
  debtSync_(!!opt.force || fresh);
  if (fresh) props.setProperty('DEBT_CODE_VER', CODE_VERSION);
  const canEdit = debtCanEdit_(u), own = scopeOf_(u) === 'own';
  const cust = debtCustomers_(), open = debtOpenList_(), today = dayNo_(new Date());
  const led = debtLedger_(), bal = debtBalances_(led);
  const talk = canEdit || !opt.countOnly ? debtTalkStats_(u) : {};
  const groups = {}; DEBT_GROUPS.concat(['Khác']).forEach(g => groups[g] = []);
  const sales = {};
  led.forEach((r, i) => {
    r.__i = i;                                   // thứ tự dòng trong sheet (dòng sau = đơn ghi nhận sau)
    const x = debtView_(u, r, cust, open, today, opt.mode === 'all'); if (!x) return;
    if (x.sale) sales[x.sale] = 1;
    if (opt.sale && !own && normName_(x.sale) !== normName_(opt.sale)) return;
    const t = talk[key_(x.so)] || {};
    x.files = t.files || 0; x.msgs = t.msgs || 0; x.myNote = t.note || ''; x.lastMsg = t.last || '';
    x.balance = bal[key_(x.acc)] ? bal[key_(x.acc)].bal : 0;
    (groups[x.term] || groups['Khác']).push(x);
  });
  const out = Object.keys(groups).filter(g => g !== 'Khác' || groups[g].length).map(g => ({
    term: g, items: groups[g].sort((a, b) => b.dno - a.dno || b.row - a.row || b.so.localeCompare(a.so)),   // đơn mới phát sinh lên đầu
    total: groups[g].reduce((s, x) => s + x.amount, 0), remain: groups[g].reduce((s, x) => s + x.remain, 0)
  }));
  const count = out.reduce((s, g) => s + g.items.length, 0);
  if (opt.countOnly) return { count: count };
  return { mode: opt.mode === 'all' ? 'all' : 'due', canEdit: canEdit, canPick: !own, sales: Object.keys(sales).sort((a, b) => a.localeCompare(b, 'vi')), sale: opt.sale || '',
           groups: out, count: count, at: nowStr_(), start: DEBT_START_DATE, me: u.username };
}

/** Xuất Excel chi tiết nợ. p = { by: 'order'|'customer', status: 'open'|'all'|'done', from, to (yyyy-MM-dd), sale, q } */
function debtExport(token, p) {
  const u = requireFeature_(token, 'congno');
  p = p || {};
  debtSync_(false);
  const canEdit = debtCanEdit_(u), own = scopeOf_(u) === 'own';
  const cust = debtCustomers_(), open = debtOpenList_(), today = dayNo_(new Date());
  const from = p.from ? dayNo_(new Date(p.from + 'T12:00:00+07:00')) : null, to = p.to ? dayNo_(new Date(p.to + 'T12:00:00+07:00')) : null;
  const q = normName_(p.q || '');
  const f = d => d ? Utilities.formatDate(d, 'GMT+7', 'dd/MM/yyyy') : '';
  const list = [];
  debtLedger_().forEach(r => {
    const st = String(r[10] || DEBT_ST.WAIT);
    if (!canEdit && st !== DEBT_ST.ASK) return;
    if (own && !isMine_(u, r[3])) return;
    if (p.status === 'open' && !debtOpenSt_(st)) return;
    if (p.status === 'done' && st !== DEBT_ST.DONE) return;
    if (debtDayOk_(r[5]) === false && !open[key_(r[0])]) return;
    if (p.sale && normName_(r[3]) !== normName_(p.sale)) return;
    if (q && normName_(r[0] + ' ' + r[1] + ' ' + r[2]).indexOf(q) === -1) return;
    const dd = toDate_(r[5]);
    if ((from !== null || to !== null) && (!dd || (from !== null && dayNo_(dd) < from) || (to !== null && dayNo_(dd) > to))) return;
    const ci = cust[key_(r[1])], term = (ci && ci.term) || normTerm_(r[4]);
    const du = dd ? dueOf_(term, dd) : { due: '' };
    list.push({ so: String(r[0]), acc: String(r[1]), name: String(r[2]), sale: String(r[3]), term: term, date: f(dd), due: f(du.due),
                od: du.due && debtOpenSt_(st) ? Math.max(0, today - dayNo_(du.due)) : 0, amt: num_(r[6]), src: String(r[7] || ''), st: st, note: String(r[13] || '') });
  });
  if (p.by === 'customer') {
    const m = {};
    list.forEach(x => {
      const k = key_(x.acc) || x.name;
      const o = m[k] || (m[k] = { acc: x.acc, name: x.name, sale: x.sale, term: x.term, n: 0, amt: 0, odAmt: 0, odMax: 0 });
      o.n++; o.amt += x.amt; if (x.od > 0) { o.odAmt += x.amt; o.odMax = Math.max(o.odMax, x.od); }
    });
    return { head: ['Mã KH', 'Tên KH', 'Sale phụ trách', 'Payment term', 'Số đơn', 'Tổng nợ', 'Nợ quá hạn', 'Quá hạn lâu nhất (ngày)'],
             rows: Object.keys(m).map(k => m[k]).sort((a, b) => b.amt - a.amt).map(o => [o.acc, o.name, o.sale, o.term, o.n, o.amt, o.odAmt, o.odMax]) };
  }
  return { head: ['Mã đơn', 'Mã KH', 'Tên KH', 'Sale phụ trách', 'Payment term', 'Ngày giao', 'Hạn thu', 'Quá hạn (ngày)', 'Số tiền', 'Nguồn số tiền', 'Trạng thái', 'Ghi chú'],
           rows: list.map(x => [x.so, x.acc, x.name, x.sale, x.term, x.date, x.due, x.od, x.amt, x.src, x.st, x.note]) };
}

/* ===== ĐÍNH KÈM · LỜI NHẮN · GHI CHÚ RIÊNG (theo từng đơn) ===== */
function debtTalkRows_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_DEBT_TALK);
  return sh && sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, DEBT_TALK_HEADERS.length).getValues() : [];
}
function debtTalkStats_(u) {
  const m = {}, me = key_(u.username);
  debtTalkRows_().forEach(r => {
    const k = key_(r[1]); if (!k) return;
    const o = m[k] || (m[k] = { files: 0, msgs: 0, note: '', last: '' });
    if (r[2] === 'file') o.files++;
    else if (r[2] === 'msg') { o.msgs++; o.last = String(r[4]) + ': ' + String(r[5]).slice(0, 60); }
    else if (r[2] === 'note' && key_(r[3]) === me) o.note = String(r[5]);
  });
  return m;
}
/** Người dùng có được xem đơn này không (kế toán/admin: mọi đơn; manager: đơn Yêu cầu thu nợ; sale: đơn của mình) */
function debtAccess_(token, so) {
  const u = requireFeature_(token, 'congno');
  const k = key_(so);
  const r = debtLedger_().find(x => key_(x[0]) === k);
  if (!r) throw new Error('Không tìm thấy đơn ' + so + ' trong danh sách công nợ.');
  if (!debtCanEdit_(u)) {
    if (String(r[10]) !== DEBT_ST.ASK) throw new Error('Đơn này chưa được yêu cầu thu nợ.');
    if (scopeOf_(u) === 'own' && !isMine_(u, r[3])) throw new Error('Đơn này không thuộc khách của bạn.');
  }
  return { u: u, so: String(r[0]).trim(), sale: String(r[3] || '') };
}
function debtTalkAdd_(row) {
  const sh = appSheet_(SH_DEBT_TALK, DEBT_TALK_HEADERS);
  const st = sh.getLastRow() + 1;
  safe_(() => { sh.getRange(st, 2).setNumberFormat('@'); sh.getRange(st, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss'); });
  sh.getRange(st, 1, 1, DEBT_TALK_HEADERS.length).setValues([row]);
}
function debtThread(token, so) {
  const a = debtAccess_(token, so), k = key_(a.so), me = key_(a.u.username);
  const files = [], msgs = []; let note = '';
  const t = d => d instanceof Date ? Utilities.formatDate(d, 'GMT+7', 'dd/MM/yyyy HH:mm') : String(d);
  debtTalkRows_().forEach(r => {
    if (key_(r[1]) !== k) return;
    if (r[2] === 'file') files.push({ id: String(r[6]), name: String(r[7]), mime: String(r[8]), by: String(r[4]), time: t(r[0]) });
    else if (r[2] === 'msg') msgs.push({ by: String(r[4]), text: String(r[5]), time: t(r[0]), mine: key_(r[3]) === me });
    else if (r[2] === 'note' && key_(r[3]) === me) note = String(r[5]);   // ghi chú riêng: chỉ chính người viết thấy
  });
  return { so: a.so, files: files, msgs: msgs, note: note };
}
function debtPostMsg(token, so, text) {
  const a = debtAccess_(token, so);
  text = String(text || '').trim();
  if (!text) throw new Error('Chưa nhập lời nhắn.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { debtTalkAdd_([new Date(), a.so, 'msg', a.u.username, a.u.name, text.slice(0, 2000), '', '', '']); } finally { lock.releaseLock(); }
  notifyMsg_(a.u, a.so, a.sale, text);
  return debtThread(token, so);
}
function debtSaveNote(token, so, text) {
  const a = debtAccess_(token, so), k = key_(a.so), me = key_(a.u.username);
  text = String(text || '').trim().slice(0, 2000);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = appSheet_(SH_DEBT_TALK, DEBT_TALK_HEADERS);
    const v = debtTalkRows_();
    const i = v.findIndex(r => key_(r[1]) === k && r[2] === 'note' && key_(r[3]) === me);
    if (i !== -1) sh.getRange(i + 2, 1, 1, 6).setValues([[new Date(), a.so, 'note', a.u.username, a.u.name, text]]);
    else if (text) debtTalkAdd_([new Date(), a.so, 'note', a.u.username, a.u.name, text, '', '', '']);
  } finally { lock.releaseLock(); }
  return { note: text };
}
function debtUpload(token, so, f) {
  const a = debtAccess_(token, so);
  if (!f || !f.base64) throw new Error('Tệp rỗng.');
  const root = DriveApp.getFolderById(QLCN_FOLDER_ID);
  const mon = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM');
  const it = root.getFoldersByName(mon), folder = it.hasNext() ? it.next() : root.createFolder(mon);
  const name = a.so.replace(/[\\/:*?"<>|]/g, '_') + '_' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd_HHmmss') + '_' + String(f.name || 'file').replace(/[\\/:*?"<>|]/g, '_');
  const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(f.base64), f.mime || 'application/octet-stream', name));
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { debtTalkAdd_([new Date(), a.so, 'file', a.u.username, a.u.name, '', file.getId(), String(f.name || name), f.mime || '']); } finally { lock.releaseLock(); }
  return debtThread(token, so);
}
function debtFile(token, so, id) {
  const a = debtAccess_(token, so);
  const rec = debtTalkRows_().find(r => r[2] === 'file' && String(r[6]) === String(id) && key_(r[1]) === key_(a.so));
  if (!rec) throw new Error('Không tìm thấy tệp.');
  let file;
  try { file = DriveApp.getFileById(String(id)); } catch (e) { throw new Error('Tệp đã bị xóa khỏi Drive.'); }
  if (file.isTrashed()) throw new Error('Tệp đã bị xóa khỏi Drive.');
  const b = file.getBlob();
  if (b.getBytes().length > 15 * 1024 * 1024) return { name: rec[7], url: file.getUrl() };
  return { name: String(rec[7]), mime: b.getContentType(), data: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
}

/** Kế toán / admin: action 'done' (Hoàn thành – không nhắc nữa) | 'ask' (Yêu cầu thu nợ) | 'remove' (Xóa khỏi danh sách) | 'wait' (bỏ yêu cầu) */
function debtSetStatus(token, sos, action) {
  const u = requireDebtEdit_(token);
  const st = action === 'done' ? DEBT_ST.DONE : action === 'ask' ? DEBT_ST.ASK : action === 'remove' ? DEBT_ST.DEL : DEBT_ST.WAIT;
  const want = {}; (sos || []).forEach(s => { const k = key_(s); if (k) want[k] = 1; });
  if (!Object.keys(want).length) throw new Error('Chưa chọn đơn nào.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  let n = 0;
  try {
    const sh = appSheet_(SH_DEBT, DEBT_HEADERS);
    sh.getRange(1, 1, 1, DEBT_HEADERS.length).setValues([DEBT_HEADERS]);
    const v = debtLedger_();
    if (st === DEBT_ST.DONE) {        // Hoàn thành = đã thu 100% → bắt buộc có số tiền chính xác
      const bad = v.filter(r => want[key_(r[0])] && !debtExact_(r)).map(r => String(r[0]));
      if (bad.length) throw new Error('Chưa có số tiền chính xác (đang là số tham khảo) – hãy nhập Số tiền rồi bấm Lưu thay đổi trước khi Hoàn thành:\n' + bad.slice(0, 15).join(', ') + (bad.length > 15 ? '…' : ''));
    }
    const now = new Date();
    v.forEach((r, i) => {
      if (!want[key_(r[0])]) return;
      sh.getRange(i + 2, 11, 1, 3).setValues([[st, u.name, now]]);
      if (st === DEBT_ST.DONE) sh.getRange(i + 2, 15).setValue(num_(r[6]));
      n++;
    });
    debtWriteBalances_(debtLedger_());
  } finally { lock.releaseLock(); }
  if (st === DEBT_ST.ASK) notifyAsk_(u, debtLedger_().filter(r => want[key_(r[0])]));
  return { updated: n, status: st };
}

/** Lưu thay đổi trên bảng: [{ so, amount?, paid? }]. Số tiền nhập = số chính xác. "Đã thu" chỉ nhập được khi đơn có số tiền chính xác.
 *  Đã thu = Số tiền → tự chuyển Hoàn thành. Có lỗi → không lưu gì. */
function debtSaveRows(token, list) {
  const u = requireDebtEdit_(token);
  list = (Array.isArray(list) ? list : []).filter(x => x && x.so);
  if (!list.length) throw new Error('Không có thay đổi nào.');
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = appSheet_(SH_DEBT, DEBT_HEADERS);
    sh.getRange(1, 1, 1, DEBT_HEADERS.length).setValues([DEBT_HEADERS]);
    const v = debtLedger_(), idx = {}; v.forEach((r, i) => idx[key_(r[0])] = i);
    const errors = [], plan = [];
    list.forEach(x => {
      const i = idx[key_(x.so)];
      if (i === undefined) { errors.push(x.so + ': không có trong danh sách công nợ'); return; }
      const r = v[i];
      const hasAmt = x.amount !== undefined && x.amount !== null && String(x.amount).trim() !== '';
      const hasPaid = x.paid !== undefined && x.paid !== null && String(x.paid).trim() !== '';
      const amt = hasAmt ? numAny_(x.amount) : num_(r[6]), paid = hasPaid ? numAny_(x.paid) : null;
      if (hasAmt && !(amt > 0)) { errors.push(x.so + ': Số tiền phải > 0'); return; }
      if (hasPaid) {
        if (!hasAmt && !debtExact_(r)) { errors.push(x.so + ': chưa có số tiền chính xác – nhập Số tiền trước khi nhập Đã thu'); return; }
        if (paid < 0) { errors.push(x.so + ': Đã thu không hợp lệ'); return; }
        if (paid > amt) { errors.push(x.so + ': Đã thu (' + paid.toLocaleString('vi-VN') + ') lớn hơn Số tiền (' + amt.toLocaleString('vi-VN') + ')'); return; }
      }
      plan.push({ i: i, so: String(r[0]).trim(), amt: hasAmt ? amt : null, paid: paid });
    });
    if (errors.length) return { ok: false, errors: errors };
    const sa = appSheet_(SH_DEBT_AMT, AMT_HEADERS);
    const av = sa.getLastRow() >= 2 ? sa.getRange(2, 1, sa.getLastRow() - 1, 1).getValues() : [];
    const now = new Date();
    let done = 0;
    plan.forEach(p => {
      const r = v[p.i];
      if (p.amt !== null) {
        const j = av.findIndex(a => key_(a[0]) === key_(p.so));
        if (j !== -1) sa.getRange(j + 2, 2, 1, 3).setValues([[p.amt, u.name, now]]);
        else { const st = sa.getLastRow() + 1; safe_(() => sa.getRange(st, 1).setNumberFormat('@')); sa.getRange(st, 1, 1, 4).setValues([[p.so, p.amt, u.name, now]]); av.push([p.so]); }
        r[6] = p.amt; r[7] = 'Thực tế';
      }
      if (p.paid !== null) r[14] = p.paid;
      if (p.paid !== null && p.paid >= num_(r[6]) && num_(r[6]) > 0 && String(r[10]) !== DEBT_ST.DONE) { r[10] = DEBT_ST.DONE; done++; }
      r[11] = u.name; r[12] = now;
      sh.getRange(p.i + 2, 1, 1, DEBT_HEADERS.length).setValues([r]);
    });
    debtWriteBalances_(v);
    return { ok: true, saved: plan.length, done: done };
  } finally { lock.releaseLock(); }
}

/** Tab "Đơn hàng": mọi đơn đang quản lý công nợ (chưa thu + đã hoàn thành). p = { from, to, sale, q, status: 'all'|'open'|'done' } */
function debtOrders(token, p) {
  const u = requireDebtEdit_(token);
  p = p || {};
  debtSync_(false);
  const cust = debtCustomers_(), open = debtOpenList_();
  const from = p.from ? dayNo_(new Date(p.from + 'T12:00:00+07:00')) : null, to = p.to ? dayNo_(new Date(p.to + 'T12:00:00+07:00')) : null;
  const f = d => d ? Utilities.formatDate(d, 'GMT+7', 'dd/MM/yyyy') : '';
  const rx = debtSearchRx_(p.q);
  const rows = [], sales = {};
  debtLedger_().forEach((r, i) => {
    const st = String(r[10] || DEBT_ST.WAIT);
    if (st === DEBT_ST.DEL) return;
    if (debtDayOk_(r[5]) === false && !open[key_(r[0])]) return;
    const ci = cust[key_(r[1])], term = (ci && ci.term) || normTerm_(r[4]);
    if (term === '000') return;
    if (r[3]) sales[r[3]] = 1;
    if (p.status === 'open' && st === DEBT_ST.DONE) return;
    if (p.status === 'done' && st !== DEBT_ST.DONE) return;
    if (p.sale && normName_(r[3]) !== normName_(p.sale)) return;
    if (rx && !rx(r[0], r[2], r[1])) return;
    const dd = toDate_(r[5]);
    if ((from !== null || to !== null) && (!dd || (from !== null && dayNo_(dd) < from) || (to !== null && dayNo_(dd) > to))) return;
    const total = num_(r[6]), paid = debtPaid_(r);
    rows.push({ acc: String(r[1]), name: String(r[2]), date: f(dd), dno: dd ? dayNo_(dd) : 1e9, so: String(r[0]), total: total, paid: paid, remain: total - paid,
                status: st, exact: debtExact_(r), sale: String(r[3]), term: term, i: i });
  });
  rows.sort((a, b) => b.dno - a.dno || b.i - a.i);
  const sum = rows.reduce((s, x) => ({ total: s.total + x.total, paid: s.paid + x.paid, remain: s.remain + x.remain }), { total: 0, paid: 0, remain: 0 });
  return { rows: rows, sum: sum, sales: Object.keys(sales).sort((a, b) => a.localeCompare(b, 'vi')) };
}
/** Tìm theo tên KH (dấu * thay cho chuỗi ký tự bất kỳ, không phân biệt dấu) hoặc mã đơn / mã KH */
function debtSearchRx_(q) {
  q = String(q || '').trim(); if (!q) return null;
  const n = normName_(q);
  const re = new RegExp(n.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*'));
  return (so, name, acc) => re.test(normName_(name)) || normName_(so).indexOf(n.replace(/\*/g, '')) !== -1 || normName_(acc) === n;
}

/* =====================================================================
 *  BÁO CÁO SOẠN HÀNG  (sheet "BC Soan hang"; ảnh lưu Drive, mỗi tháng 1 thư mục con)
 * ===================================================================== */
const BCS_FOLDER_ID = cfg_('BCS_FOLDER_ID');
const SH_BCS = 'BC Soan hang';
const BCS_HEADERS = ['Thời gian', 'Username', 'Nhân viên', 'Mã đơn', 'Hình thức', 'Số ảnh', 'ID ảnh', 'Link ảnh', 'Vị trí CCTV', 'Ghi chú'];
const BCS_RECORD_ROLES = ['admin', 'storekeeper'];

function bcsCanRecord_(u) { return BCS_RECORD_ROLES.indexOf(u.role) !== -1 || hasFeature_(u, 'soanhang'); }
function bcsMonthFolder_() {
  const root = DriveApp.getFolderById(BCS_FOLDER_ID);
  const name = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM');
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

/** Tải 1 ảnh lên Drive (gọi lần lượt từng ảnh để không quá thời gian) → trả id */
function bcsUpload(token, code, photo) {
  const u = requireFeature_(token, 'bcsoan');
  if (!bcsCanRecord_(u)) throw new Error('Bạn chỉ có quyền tra cứu báo cáo soạn hàng.');
  code = String(code || '').trim();
  if (!code) throw new Error('Chưa có mã đơn.');
  if (!photo || !photo.base64) throw new Error('Ảnh rỗng.');
  const stamp = Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd_HHmmss');
  const name = code.replace(/[\\/:*?"<>|]/g, '_') + '_' + stamp + '_' + (Number(photo.n) || 1) + '.jpg';
  const file = bcsMonthFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(photo.base64), photo.mime || 'image/jpeg', name));
  return { id: file.getId() };
}

/** Lưu 1 dòng báo cáo soạn hàng. p = { code, type: 'photo' | 'cctv', ids: [...], cctv, note, requestId } */
function bcsSave(token, p) {
  const u = requireFeature_(token, 'bcsoan');
  if (!bcsCanRecord_(u)) throw new Error('Bạn chỉ có quyền tra cứu báo cáo soạn hàng.');
  p = p || {};
  const code = String(p.code || '').trim();
  if (!code) throw new Error('Chưa có mã đơn.');
  const photo = p.type !== 'cctv';
  const ids = (p.ids || []).map(String).filter(Boolean);
  if (photo && !ids.length) throw new Error('Chưa có ảnh nào được tải lên.');
  onceRequest_(p.requestId);
  const ts = scanTime_(p.ts);      // thời điểm quét trên máy (gửi muộn khi mất mạng vẫn đúng giờ)
  const row = [ts, u.username, u.name, code, photo ? 'Chụp ảnh' : 'Ghi hình CCTV', ids.length, ids.join(','),
               ids.map(id => 'https://drive.google.com/file/d/' + id + '/view').join('\n'), cctvLabel_(p.cctv), String(p.note || '')];
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const sh = appSheet_(SH_BCS, BCS_HEADERS);
    const st = sh.getLastRow() + 1;
    safe_(() => { sh.getRange(st, 4).setNumberFormat('@'); sh.getRange(st, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss'); });
    sh.getRange(st, 1, 1, BCS_HEADERS.length).setValues([row]);
  } finally { lock.releaseLock(); }
  return { saved: true, time: Utilities.formatDate(ts, 'GMT+7', 'HH:mm:ss dd/MM/yyyy') };
}

function cctvLabel_(code) {
  code = String(code || '').trim(); if (!code) return '';
  const c = cctvRead_().find(x => key_(x.code) === key_(code));
  return c ? c.code + ' – ' + c.name : code;
}
/** Tra cứu theo mã đơn (để trống = 30 báo cáo mới nhất) */
function bcsSearch(token, q) {
  const u = requireFeature_(token, 'bcsoan');
  q = key_(q);
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_BCS);
  const out = [];
  if (sh && sh.getLastRow() >= 2) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, BCS_HEADERS.length).getValues();
    for (let i = v.length - 1; i >= 0 && out.length < (q ? 100 : 30); i--) {
      const r = v[i];
      if (q && key_(r[3]).indexOf(q) === -1) continue;
      out.push({ time: r[0] instanceof Date ? Utilities.formatDate(r[0], 'GMT+7', 'dd/MM/yyyy HH:mm') : String(r[0]),
                 user: String(r[2]), code: String(r[3]), type: String(r[4]), ids: String(r[6] || '').split(',').filter(Boolean),
                 cctv: String(r[8] || ''), note: String(r[9] || '') });
    }
  }
  return { rows: out, canRecord: bcsCanRecord_(u) };
}

/** Trả ảnh về app (base64) – ảnh không cần chia sẻ công khai. Chỉ đọc ảnh nằm trong thư mục BC soạn hàng. */
function bcsPhoto(token, id) {
  requireFeature_(token, 'bcsoan');
  let f;
  try { f = DriveApp.getFileById(String(id)); } catch (e) { throw new Error('DELETED'); }
  if (f.isTrashed()) throw new Error('DELETED');      // ảnh đã xóa (nằm trong Thùng rác Drive) → không hiển thị
  const ps = f.getParents();
  let ok = false;
  while (ps.hasNext() && !ok) {
    const p = ps.next();
    if (p.getId() === BCS_FOLDER_ID) ok = true;
    else { const gp = p.getParents(); while (gp.hasNext()) if (gp.next().getId() === BCS_FOLDER_ID) ok = true; }
  }
  if (!ok) throw new Error('Ảnh không thuộc thư mục báo cáo soạn hàng.');
  const b = f.getBlob();
  return 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
}

/* =====================================================================
 *  THÔNG BÁO TRONG APP (chuông 🔔)
 *  Sheet "Thong bao": Thời gian | Người nhận (username) | Loại | Mã đơn | Nội dung | Người gửi | Đã đọc | Đọc lúc
 *   • Kế toán bấm "Gửi YC thu nợ"  → sale phụ trách đơn + các manager
 *   • Lời nhắn mới trong 1 đơn      → sale phụ trách + kế toán + những ai đã nhắn trong đơn (trừ người gửi)
 * ===================================================================== */
const SH_NOTIF = 'Thong bao';
const NOTIF_HEADERS = ['Thời gian', 'Người nhận', 'Loại', 'Mã đơn', 'Nội dung', 'Người gửi', 'Đã đọc', 'Đọc lúc'];
function activeUsers_() {
  const v = getUserSheet_().getDataRange().getValues(), out = [];
  for (let i = 1; i < v.length; i++) {
    const un = String(v[i][0]).trim();
    if (un && isActive_(v[i][6])) out.push({ u: un, role: normRole_(v[i][1]), name: String(v[i][2]).trim() || un });
  }
  return out;
}
/** Username của nhân viên có tên khớp với cột Sale phụ trách */
function usersByName_(users, name) {
  if (!String(name || '').trim()) return [];
  return users.filter(x => normName_(x.name) === normName_(name) || sameMan_(x.name, name)).map(x => x.u);
}
function notifyAdd_(list) {      // list: [{ to, type, so, text, from }]
  if (!list.length) return;
  const sh = appSheet_(SH_NOTIF, NOTIF_HEADERS);
  const now = new Date();
  const rows = list.map(n => [now, n.to, n.type, n.so, String(n.text).slice(0, 500), n.from, '', '']);
  const st = sh.getLastRow() + 1;
  safe_(() => { sh.getRange(st, 1, rows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss'); sh.getRange(st, 4, rows.length, 1).setNumberFormat('@'); });
  sh.getRange(st, 1, rows.length, NOTIF_HEADERS.length).setValues(rows);
}
function notifyAsk_(u, rows) {          // rows: dòng sheet Cong no vừa chuyển "Yêu cầu thu nợ"
  try {
    const users = activeUsers_(), managers = users.filter(x => x.role === 'manager').map(x => x.u);
    const by = {};
    rows.forEach(r => {
      usersByName_(users, r[3]).concat(managers).forEach(to => {
        if (key_(to) === key_(u.username)) return;
        (by[to] = by[to] || []).push(String(r[0]));
      });
    });
    notifyAdd_(Object.keys(by).map(to => {
      const sos = [...new Set(by[to])];
      return { to: to, type: 'ask', so: sos.join(','), from: u.name,
               text: u.name + ' gửi yêu cầu thu nợ ' + (sos.length === 1 ? 'đơn ' + sos[0] : sos.length + ' đơn: ' + sos.slice(0, 5).join(', ') + (sos.length > 5 ? '…' : '')) };
    }));
  } catch (e) {}
}
function notifyMsg_(u, so, sale, text) {
  try {
    const users = activeUsers_();
    const to = new Set(usersByName_(users, sale).concat(users.filter(x => x.role === 'accountant').map(x => x.u)));
    debtTalkRows_().forEach(r => { if (r[2] === 'msg' && key_(r[1]) === key_(so)) to.add(String(r[3]).trim()); });
    notifyAdd_([...to].filter(x => x && key_(x) !== key_(u.username))
      .map(x => ({ to: x, type: 'msg', so: so, from: u.name, text: u.name + ' nhắn về đơn ' + so + ': ' + text })));
  } catch (e) {}
}
/** 50 thông báo gần nhất của tôi + số chưa đọc */
function notifList(token) {
  const u = requireUser_(token);
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_NOTIF);
  const items = []; let unread = 0;
  if (sh && sh.getLastRow() >= 2) {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, NOTIF_HEADERS.length).getValues(), me = key_(u.username);
    for (let i = v.length - 1; i >= 0; i--) {
      const r = v[i];
      if (key_(r[1]) !== me) continue;
      const rd = !!String(r[6]).trim();
      if (!rd) unread++;
      if (items.length < 50) items.push({ id: i + 2, t: r[0] instanceof Date ? r[0].getTime() : 0,
        time: r[0] instanceof Date ? Utilities.formatDate(r[0], 'GMT+7', 'dd/MM HH:mm') : String(r[0]),
        type: String(r[2]), so: String(r[3]), text: String(r[4]), from: String(r[5]), read: rd });
    }
  }
  return { unread: unread, items: items };
}
/** Đánh dấu đã đọc: ids = [số dòng] hoặc 'all' */
function notifRead(token, ids) {
  const u = requireUser_(token);
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_NOTIF);
  if (!sh || sh.getLastRow() < 2) return { ok: true };
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const v = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues(), me = key_(u.username), now = new Date();
    const want = ids === 'all' ? null : new Set((ids || []).map(Number));
    v.forEach((r, i) => {
      if (key_(r[1]) !== me || String(r[6]).trim()) return;
      if (want && !want.has(i + 2)) return;
      sh.getRange(i + 2, 7, 1, 2).setValues([['x', now]]);
    });
  } finally { lock.releaseLock(); }
  return notifList(token);
}

/* =====================================================================
 *  SINH NHẬT
 *  • Sheet "Ngay sinh": Username | Ngày sinh (dd/MM) – admin nhập trong Quản trị, hoặc mỗi người tự nhập ở Cài đặt (chỉ ngày/tháng).
 *  • Mỗi người mỗi năm 1 "bài đăng" sinh nhật (mã BD-<username>-<năm>), mọi người gửi lời chúc (kèm ảnh) vào bài đó.
 *  • Sheet "Loi chuc": Thời gian | Mã bài | Username | Người gửi | Nội dung | ID ảnh
 *  • Ảnh lưu thư mục Drive "Ân Nam – Sinh nhật" (tự tạo), xem qua app (không chia sẻ công khai).
 * ===================================================================== */
const SH_DOB = 'Ngay sinh', SH_WISH = 'Loi chuc';
const WISH_HEADERS = ['Thời gian', 'Mã bài', 'Username', 'Người gửi', 'Nội dung', 'ID ảnh'];
function normDob_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'GMT+7', 'dd/MM');
  const m = String(v || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})/);
  if (!m) return '';
  const d = +m[1], mo = +m[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return '';
  return ('0' + d).slice(-2) + '/' + ('0' + mo).slice(-2);
}
/** Ngày sinh lưu ngay trong sheet User, cột tiêu đề "Ngày sinh" (dd/MM). Tìm theo tiêu đề nên đặt cột ở đâu cũng được. */
function dobCol_(sh, create) {
  const lc = Math.max(sh.getLastColumn(), USER_HEADERS.length);
  const h = sh.getRange(1, 1, 1, lc).getValues()[0];
  const i = h.findIndex(x => String(x).trim().toLowerCase().indexOf('ngày sinh') === 0);
  if (i !== -1) return i + 1;
  if (!create) return 0;
  // Cột mới đặt ngay sau cột cuối cùng có tiêu đề (sheet User đang là "Bảng" A:J → cột K)
  let col = h.length; while (col > 0 && !String(h[col - 1]).trim()) col--; col++;
  try { sh.getRange(1, col).setValue('Ngày sinh'); }
  catch (e) { throw new Error('Sheet User đang là "Bảng" nên không tự thêm được cột. Hãy thêm cột "Ngày sinh" vào cuối Bảng trong sheet User.'); }
  safe_(() => { sh.getRange(1, col).setFontWeight('bold').setBackground('#0b5cab').setFontColor('#ffffff'); sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@'); });
  // Chuyển dữ liệu từ sheet "Ngay sinh" cũ (nếu đã tạo ở bản trước) rồi xóa sheet đó
  const ss = SpreadsheetApp.openById(APP_SS_ID), old = ss.getSheetByName(SH_DOB);
  if (old) {
    const m = {};
    if (old.getLastRow() >= 2) old.getRange(2, 1, old.getLastRow() - 1, 2).getValues().forEach(r => { const d = normDob_(r[1]); if (r[0] && d) m[key_(r[0])] = d; });
    const n = sh.getLastRow();
    if (n >= 2) {
      const us = sh.getRange(2, 1, n - 1, 1).getValues();
      sh.getRange(2, col, n - 1, 1).setValues(us.map(r => [m[key_(r[0])] || '']));
    }
    safe_(() => ss.deleteSheet(old));
  }
  return col;
}
function dobMap_() {
  const sh = getUserSheet_(), col = dobCol_(sh, false), m = {};
  if (!col || sh.getLastRow() < 2) return m;
  const n = sh.getLastRow() - 1, us = sh.getRange(2, 1, n, 1).getValues(), ds = sh.getRange(2, col, n, 1).getValues();
  us.forEach((r, i) => { const k = key_(r[0]), d = normDob_(ds[i][0]); if (k && d) m[k] = d; });
  return m;
}
function setDob_(username, dob) {
  const d = String(dob || '').trim() ? normDob_(dob) : '';
  if (String(dob || '').trim() && !d) throw new Error('Ngày sinh không hợp lệ – nhập dạng ngày/tháng, VD 25/12.');
  const sh = getUserSheet_(), col = dobCol_(sh, true);
  const v = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
  const i = v.findIndex(r => key_(r[0]) === key_(username));
  if (i === -1) throw new Error('Không tìm thấy người dùng ' + username + '.');
  safe_(() => sh.getRange(i + 2, col).setNumberFormat('@'));
  sh.getRange(i + 2, col).setValue(d);
  return d;
}
/** Mỗi người tự cập nhật ngày sinh của mình (Cài đặt) */
function setMyDob(token, dob) {
  const u = requireUser_(token);
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try { return { dob: setDob_(u.username, dob) }; } finally { lock.releaseLock(); }
}
function getMyDob(token) { const u = requireUser_(token); return { dob: dobMap_()[key_(u.username)] || '' }; }

function bdFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('BD_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('Ân Nam – Sinh nhật (ảnh lời chúc)');
  props.setProperty('BD_FOLDER_ID', f.getId());
  return f;
}
const bdPostId_ = (un, y) => 'BD-' + String(un).trim().toLowerCase() + '-' + y;
function bdWishRows_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_WISH);
  return sh && sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, WISH_HEADERS.length).getValues() : [];
}
/** Sinh nhật hôm nay + bảng tin các bài sinh nhật gần đây */
function bdHome(token) {
  const u = requireUser_(token);
  const users = activeUsers_(), dob = dobMap_(), now = new Date();
  const y = +Utilities.formatDate(now, 'GMT+7', 'yyyy');
  const dd = d => Utilities.formatDate(d, 'GMT+7', 'dd/MM');
  const wishes = bdWishRows_(), stat = {};
  wishes.forEach(r => { const k = String(r[1]); const o = stat[k] || (stat[k] = { n: 0, imgs: 0, mine: false, last: null }); o.n++; if (r[5]) o.imgs++;
    if (key_(r[2]) === key_(u.username)) o.mine = true; o.last = { by: String(r[3]), text: String(r[4]).slice(0, 80) }; });
  const post = (x, yr) => { const id = bdPostId_(x.u, yr), s = stat[id] || { n: 0, imgs: 0, mine: false, last: null };
    return { id: id, u: x.u, name: x.name, dob: dob[key_(x.u)], wishes: s.n, imgs: s.imgs, iWished: s.mine, last: s.last, me: key_(x.u) === key_(u.username) }; };
  const today = users.filter(x => dob[key_(x.u)] === dd(now)).map(x => post(x, y));
  // Bảng tin: các bài có lời chúc (60 ngày gần nhất), mới nhất trước
  const ids = {}; wishes.forEach(r => { const t = r[0] instanceof Date ? r[0].getTime() : 0; if (Date.now() - t < 60 * 86400000) ids[String(r[1])] = Math.max(ids[String(r[1])] || 0, t); });
  const feed = Object.keys(ids).sort((a, b) => ids[b] - ids[a]).map(id => {
    const m = id.match(/^BD-(.+)-(\d{4})$/); if (!m) return null;
    const x = users.find(v => key_(v.u) === key_(m[1])) || { u: m[1], name: m[1] };
    return Object.assign(post(x, +m[2]), { year: +m[2], at: ids[id] });
  }).filter(Boolean).slice(0, 20);
  let msgs = null; try { msgs = msgInbox_(u); } catch (e) {}
  return { today: today, feed: feed, myDob: dob[key_(u.username)] || '', msgs: msgs };
}
function bdPost(token, id) {
  const u = requireUser_(token);
  const m = String(id || '').match(/^BD-(.+)-(\d{4})$/); if (!m) throw new Error('Không tìm thấy bài sinh nhật.');
  const x = activeUsers_().find(v => key_(v.u) === key_(m[1])) || { u: m[1], name: m[1] };
  const list = bdWishRows_().filter(r => String(r[1]) === id).map((r, i) => ({
    time: r[0] instanceof Date ? Utilities.formatDate(r[0], 'GMT+7', 'dd/MM HH:mm') : String(r[0]), by: String(r[3]), u: String(r[2]),
    text: String(r[4]), img: String(r[5] || ''), mine: key_(r[2]) === key_(u.username) }));
  return { id: id, u: x.u, name: x.name, year: +m[2], dob: dobMap_()[key_(x.u)] || '', me: key_(x.u) === key_(u.username), wishes: list.reverse() };
}
function bdWish(token, id, text, img) {
  const u = requireUser_(token);
  const m = String(id || '').match(/^BD-(.+)-(\d{4})$/); if (!m) throw new Error('Không tìm thấy bài sinh nhật.');
  text = String(text || '').trim().slice(0, 1000);
  if (!text && !(img && img.base64)) throw new Error('Hãy viết lời chúc hoặc chọn ảnh.');
  let fid = '';
  if (img && img.base64) {
    const f = bdFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(img.base64), img.mime || 'image/jpeg',
      id + '_' + u.username + '_' + Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd_HHmmss') + '.jpg'));
    fid = f.getId();
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = appSheet_(SH_WISH, WISH_HEADERS);
    const st = sh.getLastRow() + 1;
    safe_(() => sh.getRange(st, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss'));
    sh.getRange(st, 1, 1, WISH_HEADERS.length).setValues([[new Date(), id, u.username, u.name, text, fid]]);
  } finally { lock.releaseLock(); }
  if (key_(m[1]) !== key_(u.username)) notifyAdd_([{ to: m[1], type: 'bd', so: id, from: u.name, text: '🎂 ' + u.name + ' gửi lời chúc sinh nhật bạn' + (text ? ': ' + text : ' (kèm ảnh)') }]);
  return bdPost(token, id);
}
function bdImage(token, id, fid) {
  requireUser_(token);
  if (!bdWishRows_().some(r => String(r[1]) === String(id) && String(r[5]) === String(fid))) throw new Error('Không tìm thấy ảnh.');
  let f; try { f = DriveApp.getFileById(String(fid)); } catch (e) { throw new Error('Ảnh đã bị xóa.'); }
  if (f.isTrashed()) throw new Error('Ảnh đã bị xóa.');
  const b = f.getBlob();
  return 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
}

/* =====================================================================
 *  LỜI NHẮN & THÔNG BÁO
 *  Sheet "Loi nhan":   Thời gian | Mã | Loại | Người gửi | Tên người gửi | Người nhận | Tên người nhận | Nội dung
 *     • Loại "Thông báo": chỉ Quản trị viên, gửi toàn bộ người dùng (Người nhận = *)
 *     • Loại "Lời nhắn":  thành viên gửi cho 1 hoặc nhiều người (username, cách nhau dấu phẩy)
 *  Sheet "Loi nhan da xem": Mã | Username | Thời gian  → đã xem thì không hiện popup nữa
 * ===================================================================== */
const SH_MSG = 'Loi nhan', SH_MSG_READ = 'Loi nhan da xem';
const MSG_HEADERS = ['Thời gian', 'Mã', 'Loại', 'Người gửi', 'Tên người gửi', 'Người nhận', 'Tên người nhận', 'Nội dung'];
const MSG_READ_HEADERS = ['Mã', 'Username', 'Thời gian'];
const MSG_DAYS = 120;
function msgRows_() {
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_MSG);
  if (!sh || sh.getLastRow() < 2) return [];
  const lim = Date.now() - MSG_DAYS * 86400000;
  return sh.getRange(2, 1, sh.getLastRow() - 1, MSG_HEADERS.length).getValues()
    .filter(r => r[1] && (!(r[0] instanceof Date) || r[0].getTime() >= lim))
    .map(r => ({ t: r[0] instanceof Date ? r[0].getTime() : 0, time: r[0] instanceof Date ? Utilities.formatDate(r[0], 'GMT+7', 'dd/MM/yyyy HH:mm') : String(r[0]),
      id: String(r[1]), type: String(r[2]) === 'Thông báo' ? 'tb' : 'ln', from: String(r[3]), fromName: String(r[4]) || String(r[3]),
      to: String(r[5]).trim() === '*' ? '*' : String(r[5]).split(',').map(s => s.trim()).filter(Boolean), toNames: String(r[6]), text: String(r[7]) }));
}
function msgReads_() {               // { mã: { username: true } }
  const sh = SpreadsheetApp.openById(APP_SS_ID).getSheetByName(SH_MSG_READ), m = {};
  if (sh && sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .forEach(r => { const k = String(r[0]); (m[k] = m[k] || {})[key_(r[1])] = true; });
  return m;
}
const msgForMe_ = (m, un) => key_(m.from) !== key_(un) && (m.to === '*' || m.to.some(x => key_(x) === key_(un)));
function msgInbox_(u) {
  const rows = msgRows_(), reads = msgReads_(), me = key_(u.username);
  const inbox = rows.filter(m => msgForMe_(m, u.username)).map(m => ({ id: m.id, time: m.time, t: m.t, type: m.type, from: m.from, fromName: m.fromName,
    toNames: m.to === '*' ? 'Tất cả mọi người' : m.toNames, text: m.text, read: !!(reads[m.id] && reads[m.id][me]) }));
  const total = activeUsers_().length;
  const sent = rows.filter(m => key_(m.from) === me).map(m => {
    const r = reads[m.id] || {}, n = m.to === '*' ? total - 1 : m.to.length;
    const readBy = m.to === '*' ? Object.keys(r).length : m.to.filter(x => r[key_(x)]).length;
    return { id: m.id, time: m.time, t: m.t, type: m.type, toNames: m.to === '*' ? 'Tất cả mọi người' : m.toNames, text: m.text, readBy: Math.min(readBy, n), total: n };
  });
  const byNew = (a, b) => b.t - a.t;
  return { inbox: inbox.sort(byNew).slice(0, 100), sent: sent.sort(byNew).slice(0, 100), unread: inbox.filter(x => !x.read).length, isAdmin: u.role === 'admin' };
}
function msgInbox(token) { return msgInbox_(requireUser_(token)); }
/** to: mảng username; all = true → thông báo đến toàn bộ người dùng (chỉ Quản trị viên) */
function msgSend(token, to, text, all, rid) {
  const u = requireUser_(token);
  text = String(text || '').trim().slice(0, 2000);
  if (!text) throw new Error('Hãy nhập nội dung.');
  if (all && u.role !== 'admin') throw new Error('Chỉ Quản trị viên được gửi thông báo đến toàn bộ người dùng.');
  let toU = [], toN = [];
  if (!all) {
    const users = activeUsers_(), seen = {};
    (Array.isArray(to) ? to : [to]).forEach(x => {
      const f = users.find(v => key_(v.u) === key_(x));
      if (f && !seen[key_(f.u)] && key_(f.u) !== key_(u.username)) { seen[key_(f.u)] = 1; toU.push(f.u); toN.push(f.name); }
    });
    if (!toU.length) throw new Error('Hãy chọn người nhận.');
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (!reqSeen_(rid)) {
      const sh = appSheet_(SH_MSG, MSG_HEADERS), st = sh.getLastRow() + 1;
      const id = 'MSG-' + Utilities.formatDate(new Date(), 'GMT+7', 'yyMMddHHmmss') + '-' + Math.floor(Math.random() * 1000);
      safe_(() => { sh.getRange(st, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss'); sh.getRange(st, 2, 1, 7).setNumberFormat('@'); });
      sh.getRange(st, 1, 1, MSG_HEADERS.length).setValues([[new Date(), id, all ? 'Thông báo' : 'Lời nhắn', u.username, u.name || u.username,
        all ? '*' : toU.join(', '), all ? 'Tất cả mọi người' : toN.join(', '), text]]);
      reqMark_(rid);
    }
  } finally { lock.releaseLock(); }
  return msgInbox_(u);
}
/** Đánh dấu đã xem (các lần sau không hiện popup nữa) */
function msgRead(token, ids) {
  const u = requireUser_(token);
  const reads = msgReads_(), me = key_(u.username);
  const mine = {}; msgRows_().filter(m => msgForMe_(m, u.username)).forEach(m => mine[m.id] = 1);
  const add = [...new Set((ids || []).map(String))].filter(id => mine[id] && !(reads[id] && reads[id][me]));
  if (add.length) {
    const sh = appSheet_(SH_MSG_READ, MSG_READ_HEADERS), now = new Date();
    sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add.map(id => [id, u.username, now]));
  }
  return { ok: true, marked: add.length };
}
/* ================== IN TEM (hàng chờ lệnh in → máy trạm in cạnh máy in tem) ==================
 * Người dùng (tính năng "intem") gửi lệnh → sheet "Lenh in" (Chờ in).
 * Máy trạm (tính năng "tramin") hỏi printNext mỗi 5 giây, in, rồi báo printDone.
 * Lệnh chờ quá 5 phút mà chưa in → "Đã hủy", không dồn lại.
 * Loại tem:  thaw = Rã đông 35×22 mm, 3 tem/hàng · pal = Tem pallet 50×50, 2 tem/hàng · cus = Tùy chỉnh 50×50, 2 tem/hàng
 */
const SH_PRINT = 'Lenh in';
const PRINT_HEADERS = ['Mã lệnh', 'Gửi lúc', 'Username', 'Người gửi', 'Loại tem', 'Khổ', 'Số tem', 'Nội dung',
                       'Hạn in', 'Trạng thái', 'Trạm in', 'Nhận lúc', 'In lúc', 'Ghi chú'];
const SH_TEM = 'Tem pallet';
const TEM_HEADERS = ['Mã tem', 'Lệnh in', 'Ngày tạo', 'Trạng thái', 'Dùng lúc', 'Đóng lúc'];
const PRINT_TYPES = {
  thaw: { name: 'Rã đông',   size: '35×22', cols: 3 },
  pal:  { name: 'Pallet',    size: '50×50', cols: 2 },
  cus:  { name: 'Tùy chỉnh', size: '50×50', cols: 2 }
};
const PRINT_LIFE_MS = 5 * 60000;        // lệnh chỉ được in trong 5 phút kể từ lúc gửi
const PRINT_STUCK_MS = 3 * 60000;       // "Đang in" quá 3 phút mà trạm không báo lại → "Lỗi"
const PRINT_SCAN_ROWS = 400;            // chỉ đọc 400 dòng cuối của sheet Lenh in
const TEM_ALPHA = 'ACDEFGHJKLMNPQRTUVWXY234679';   // bỏ ký tự dễ nhầm: 0/O, 1/I, 5/S, 8/B
const PS_ = { WAIT: 'Chờ in', PRINTING: 'Đang in', DONE: 'Đã in', CANCEL: 'Đã hủy', ERR: 'Lỗi' };

function printSheet_() {
  const sh = appSheet_(SH_PRINT, PRINT_HEADERS);
  safe_(() => { sh.getRange('A:A').setNumberFormat('@'); sh.getRange('H:H').setNumberFormat('@'); });
  return sh;
}
function printCanUse_(u) { if (!hasFeature_(u, 'intem') && u.role !== 'admin') throw new Error('Bạn không có quyền dùng chức năng In tem.'); }
function printIsStation_(u) { if (!hasFeature_(u, 'tramin') && u.role !== 'admin') throw new Error('Tài khoản này chưa được cấp quyền Trạm in tem.'); }
const printTime_ = v => v instanceof Date ? v.getTime() : 0;

/** Đọc các dòng cuối của sheet Lenh in: { sh, start, rows } (start = số dòng của rows[0]) */
function printRows_() {
  const sh = printSheet_(), last = sh.getLastRow();
  if (last < 2) return { sh, start: 2, rows: [] };
  const start = Math.max(2, last - PRINT_SCAN_ROWS + 1);
  return { sh, start, rows: sh.getRange(start, 1, last - start + 1, PRINT_HEADERS.length).getValues() };
}
/** Hủy lệnh quá 5 phút, đánh dấu lỗi lệnh "Đang in" bị treo. Ghi lại các ô đã đổi. */
function printExpire_(d) {
  const now = Date.now();
  d.rows.forEach((r, i) => {
    let st = null, note = '';
    if (r[9] === PS_.WAIT && now - printTime_(r[1]) > PRINT_LIFE_MS) { st = PS_.CANCEL; note = 'Quá 5 phút chưa in, tự hủy'; }
    else if (r[9] === PS_.PRINTING && now - printTime_(r[11]) > PRINT_STUCK_MS) { st = PS_.ERR; note = 'Trạm in không báo kết quả, kiểm tra tem đã ra chưa'; }
    if (!st) return;
    r[9] = st; r[13] = note;
    d.sh.getRange(d.start + i, 10).setValue(st);
    d.sh.getRange(d.start + i, 14).setValue(note);
    if (st === PS_.CANCEL) printVoidCodes_(r);
  });
}
/** Lệnh tem pallet bị hủy (chưa in) → mã tem của lệnh đó chuyển "Đã hủy" để không bị dùng nhầm */
function printVoidCodes_(r) {
  if (String(r[4]) !== PRINT_TYPES.pal.name) return;
  const sh = appSheet_(SH_TEM, TEM_HEADERS), n = sh.getLastRow() - 1;
  if (n < 1) return;
  const v = sh.getRange(2, 2, n, 3).getValues(), id = String(r[0]);
  v.forEach((x, i) => { if (String(x[0]) === id && x[2] === 'Chưa dùng') sh.getRange(i + 2, 4).setValue('Đã hủy (không in)'); });
}
function printJobOut_(r) {
  let content = {};
  try { content = JSON.parse(String(r[7] || '{}')); } catch (e) {}
  const fmt = v => v instanceof Date ? Utilities.formatDate(v, 'GMT+7', 'HH:mm:ss dd/MM') : '';
  return { id: String(r[0]), t: printTime_(r[1]), time: fmt(r[1]), user: String(r[2]), by: String(r[3]),
           type: String(r[4]), size: String(r[5]), qty: Number(r[6]) || 0, content: content,
           expire: printTime_(r[8]), status: String(r[9]), station: String(r[10]), printedAt: fmt(r[12]), note: String(r[13] || '') };
}
function printStation_() {
  try { return JSON.parse(CacheService.getScriptCache().get('print_station') || 'null'); } catch (e) { return null; }
}
function printNewCodes_(n) {
  const sh = appSheet_(SH_TEM, TEM_HEADERS), used = {};
  if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(r => { used[String(r[0])] = 1; });
  const out = [];
  while (out.length < n) {
    let c = 'P-';
    for (let k = 0; k < 6; k++) c += TEM_ALPHA.charAt(Math.floor(Math.random() * TEM_ALPHA.length));
    if (!used[c]) { used[c] = 1; out.push(c); }
  }
  return out;
}
/** iso yyyy-mm-dd hoặc dd/mm/yyyy → dd/mm/yyyy */
function printDate_(v, label) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2) + '/' + m[3];
  throw new Error('Chưa nhập ' + label + '.');
}

/** Gửi lệnh in. req = { type, qty, d1, d2, c1, c2, c3, reqId } */
function printRequest(token, req) {
  const u = requireUser_(token); printCanUse_(u);
  req = req || {};
  const T = PRINT_TYPES[req.type];
  if (!T) throw new Error('Loại tem không hợp lệ.');
  if (reqSeen_(req.reqId)) return { dup: true };
  let qty = Math.floor(Number(req.qty) || 0);
  if (qty < 1) throw new Error('Nhập số tem cần in.');
  if (qty > 200) throw new Error('Mỗi lệnh in tối đa 200 tem.');
  qty = Math.ceil(qty / T.cols) * T.cols;            // in đủ hàng (2 hoặc 3 tem/hàng)
  let content;
  if (req.type === 'thaw') content = { d1: printDate_(req.d1, 'Ngày rã đông'), d2: printDate_(req.d2, 'HSD sau rã đông') };
  else if (req.type === 'cus') {
    content = { c1: String(req.c1 || '').slice(0, 200), c2: String(req.c2 || '').slice(0, 120), c3: String(req.c3 || '').replace(/[\r\n]+/g, ' ').slice(0, 60) };
    if (!(content.c1 + content.c2 + content.c3).trim()) throw new Error('Nhập nội dung tem.');
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (reqSeen_(req.reqId)) return { dup: true };
    const now = new Date();
    const id = 'IN-' + Utilities.formatDate(now, 'GMT+7', 'yyMMddHHmmss') + '-' + ('00' + Math.floor(Math.random() * 1000)).slice(-3);
    if (req.type === 'pal') {
      const codes = printNewCodes_(qty);
      content = { codes: codes };
      const sh = appSheet_(SH_TEM, TEM_HEADERS), st = sh.getLastRow() + 1;
      safe_(() => sh.getRange(st, 1, codes.length, 2).setNumberFormat('@'));
      sh.getRange(st, 1, codes.length, 4).setValues(codes.map(c => [c, id, now, 'Chưa dùng']));
    }
    const sh = printSheet_(), row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, PRINT_HEADERS.length).setValues([[id, now, u.username, u.name, T.name, T.size, qty, JSON.stringify(content),
      new Date(now.getTime() + PRINT_LIFE_MS), PS_.WAIT, '', '', '', '']]);
    safe_(() => sh.getRange(row, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss'));
    safe_(() => sh.getRange(row, 9).setNumberFormat('dd/MM/yyyy HH:mm:ss'));
    CacheService.getScriptCache().put('print_pending', '1', 900);
    reqMark_(req.reqId);
    return { id: id, qty: qty, station: printStation_() };
  } finally { lock.releaseLock(); }
}

/** Lệnh in của tôi trong 24 giờ (admin: all = true để xem của mọi người) + trạng thái trạm in */
function printList(token, all) {
  const u = requireUser_(token); printCanUse_(u);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  let d;
  try { d = printRows_(); printExpire_(d); } finally { lock.releaseLock(); }
  const me = key_(u.username), since = Date.now() - 24 * 3600000, items = [];
  for (let i = d.rows.length - 1; i >= 0 && items.length < 50; i--) {
    const r = d.rows[i];
    if (printTime_(r[1]) < since) break;
    if (!(all && u.role === 'admin') && key_(r[2]) !== me) continue;
    const j = printJobOut_(r);
    if (j.type === 'Pallet') j.content = { codes: (j.content.codes || []).slice(0, 4), more: Math.max(0, (j.content.codes || []).length - 4) };
    items.push(j);
  }
  return { now: Date.now(), station: printStation_(), items: items };
}

function printCancel(token, id) {
  const u = requireUser_(token); printCanUse_(u);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const d = printRows_(); printExpire_(d);
    const i = d.rows.findIndex(r => String(r[0]) === String(id));
    if (i === -1) throw new Error('Không tìm thấy lệnh in ' + id + '.');
    const r = d.rows[i];
    if (key_(r[2]) !== key_(u.username) && u.role !== 'admin') throw new Error('Bạn chỉ hủy được lệnh của mình.');
    if (r[9] !== PS_.WAIT) throw new Error('Lệnh đang ở trạng thái "' + r[9] + '", không hủy được.');
    d.sh.getRange(d.start + i, 10).setValue(PS_.CANCEL);
    d.sh.getRange(d.start + i, 14).setValue('Người gửi hủy');
    printVoidCodes_(r);
    return true;
  } finally { lock.releaseLock(); }
}

/** Máy trạm: báo đang chạy + nhận lệnh cũ nhất còn hạn (null nếu không có). Lệnh đọc cả sheet tối đa mỗi 60 giây khi không có lệnh mới. */
function printNext(token, stationName) {
  const u = requireUser_(token); printIsStation_(u);
  const cache = CacheService.getScriptCache();
  const name = String(stationName || u.name || u.username).slice(0, 40);
  cache.put('print_station', JSON.stringify({ at: Date.now(), name: name }), 600);
  if (!cache.get('print_pending') && cache.get('print_scan')) return null;
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const d = printRows_(); printExpire_(d);
    cache.put('print_scan', '1', 60);
    const now = Date.now();
    const i = d.rows.findIndex(r => r[9] === PS_.WAIT && now - printTime_(r[1]) <= PRINT_LIFE_MS);
    if (i === -1) { cache.remove('print_pending'); return null; }
    const r = d.rows[i];
    r[9] = PS_.PRINTING; r[10] = name; r[11] = new Date();
    d.sh.getRange(d.start + i, 10, 1, 3).setValues([[r[9], r[10], r[11]]]);
    safe_(() => d.sh.getRange(d.start + i, 12).setNumberFormat('dd/MM/yyyy HH:mm:ss'));
    const job = printJobOut_(r);
    job.kind = Object.keys(PRINT_TYPES).find(k => PRINT_TYPES[k].name === job.type) || '';
    return job;
  } finally { lock.releaseLock(); }
}

/** Máy trạm báo kết quả: ok = true → Đã in; false → Lỗi (kèm lý do) */
function printDone(token, id, ok, err) {
  const u = requireUser_(token); printIsStation_(u);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const d = printRows_();
    const i = d.rows.findIndex(r => String(r[0]) === String(id));
    if (i === -1) return false;
    const row = d.start + i;
    if (ok) { d.sh.getRange(row, 10).setValue(PS_.DONE); d.sh.getRange(row, 13).setValue(new Date()); safe_(() => d.sh.getRange(row, 13).setNumberFormat('dd/MM/yyyy HH:mm:ss')); }
    else { d.sh.getRange(row, 10).setValue(PS_.ERR); d.sh.getRange(row, 14).setValue(String(err || 'Lỗi khi in').slice(0, 300)); }
    return true;
  } finally { lock.releaseLock(); }
}

/* ================== QUẢN LÝ PALLET (tem QR dán 1 lần) ==================
 * Vị trí: kệ R1–R4 × 8 cột × 4 tầng → "R2-05-T3" (tem trên kệ chỉ có "R2-05", nhân viên chọn tầng).
 *         R0 = khu để hàng dưới sàn, 8 dãy → "R0-03" (không có tầng, 1 dãy chứa nhiều pallet).
 * Mã tem pallet lấy từ sheet "Tem pallet" (do tính năng In tem tạo): Chưa dùng → Đang dùng → Đã đóng.
 * Mỗi ô kệ (kệ-cột-tầng) chứa 1 pallet.
 */
const PL_RACKS = ['R1', 'R2', 'R3', 'R4'], PL_COLS = 8, PL_LEVELS = 4, PL_FLOOR = 'R0', PL_LANES = 8;
const SH_PL = 'Pallet', SH_PL_LOG = 'Pallet Log';
const PL_HEADERS = ['Mã tem', 'Mã hàng', 'Tên hàng', 'Batch', 'HSD', 'SL cất', 'SL còn', 'Kệ', 'Cột', 'Tầng', 'Vị trí',
                    'Trạng thái', 'Cất lúc', 'Cất bởi', 'Cập nhật lúc', 'Đóng lúc', 'Ghi chú'];
const PL_LOG_HEADERS = ['Thời gian', 'Username', 'Nhân viên', 'Thao tác', 'Mã tem', 'Mã hàng', 'Từ vị trí', 'Đến vị trí', 'SL thay đổi', 'SL còn', 'reqId'];
const PL_ON = 'Trên kệ', PL_DONE = 'Đã lấy hết';

function plSheet_() {
  const sh = appSheet_(SH_PL, PL_HEADERS);
  safe_(() => { sh.getRange('A:E').setNumberFormat('@'); sh.getRange('H:K').setNumberFormat('@'); });
  return sh;
}
function plCanUse_(u) { if (!hasFeature_(u, 'pallet') && u.role !== 'admin') throw new Error('Bạn không có quyền dùng chức năng Quản lý pallet.'); }
/** Chuẩn hóa vị trí: { rack, col, lv } → { code, rack, col, lv } hoặc báo lỗi */
function plLoc_(rack, col, lv) {
  rack = String(rack || '').trim().toUpperCase();
  const c = parseInt(col, 10), l = parseInt(lv, 10);
  if (rack === PL_FLOOR) {
    if (!(c >= 1 && c <= PL_LANES)) throw new Error('Dãy R0 không hợp lệ (1–' + PL_LANES + ').');
    return { code: PL_FLOOR + '-' + ('0' + c).slice(-2), rack: rack, col: c, lv: '' };
  }
  if (PL_RACKS.indexOf(rack) === -1) throw new Error('Kệ không hợp lệ: ' + rack + '.');
  if (!(c >= 1 && c <= PL_COLS)) throw new Error('Cột không hợp lệ (1–' + PL_COLS + ').');
  if (!(l >= 1 && l <= PL_LEVELS)) throw new Error('Chọn tầng (1–' + PL_LEVELS + ').');
  return { code: rack + '-' + ('0' + c).slice(-2) + '-T' + l, rack: rack, col: c, lv: l };
}
function plRows_() {
  const sh = plSheet_(), n = sh.getLastRow() - 1;
  return { sh: sh, rows: n > 0 ? sh.getRange(2, 1, n, PL_HEADERS.length).getValues() : [] };
}
function plOut_(r) {
  const t = v => v instanceof Date ? v.getTime() : 0;
  return { tem: String(r[0]), item: String(r[1]), name: String(r[2]), batch: String(r[3]), exp: String(r[4]),
           qty0: Number(r[5]) || 0, qty: Number(r[6]) || 0, rack: String(r[7]), col: Number(r[8]) || 0, lv: Number(r[9]) || 0,
           loc: String(r[10]), status: String(r[11]), at: t(r[12]), by: String(r[13]), upd: t(r[14]) };
}
function plLog_(u, op, tem, item, from, to, dq, left, rid) {
  const sh = appSheet_(SH_PL_LOG, PL_LOG_HEADERS), row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, PL_LOG_HEADERS.length).setValues([[new Date(), u.username, u.name, op, tem, item, from, to, dq, left, rid || '']]);
  safe_(() => sh.getRange(row, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss'));
}
function plTemRow_(code) {
  const sh = appSheet_(SH_TEM, TEM_HEADERS), n = sh.getLastRow() - 1;
  if (n < 1) return null;
  const v = sh.getRange(2, 1, n, 4).getValues();
  for (let i = 0; i < v.length; i++) if (String(v[i][0]).trim().toUpperCase() === code) return { sh: sh, row: i + 2, status: String(v[i][3]) };
  return null;
}
function plFindOpen_(d, tem) {
  const i = d.rows.findIndex(r => String(r[0]).toUpperCase() === tem && r[11] === PL_ON);
  if (i === -1) throw new Error('Tem ' + tem + ' không có pallet nào đang trên kệ.');
  return i;
}
function plCheckFree_(d, loc, selfTem) {
  if (loc.rack === PL_FLOOR) return;
  const r = d.rows.find(x => x[11] === PL_ON && String(x[10]) === loc.code && String(x[0]).toUpperCase() !== selfTem);
  if (r) throw new Error('Ô ' + loc.code + ' đang có pallet ' + r[0] + ' (' + r[1] + '). Chọn ô khác.');
}
const plTem_ = v => String(v || '').trim().toUpperCase();

/** Sơ đồ kệ: bố cục + các pallet đang trên kệ */
function plMap(token) {
  const u = requireUser_(token); plCanUse_(u);
  const d = plRows_();
  return { racks: PL_RACKS, cols: PL_COLS, levels: PL_LEVELS, floor: PL_FLOOR, lanes: PL_LANES, now: Date.now(),
           items: d.rows.filter(r => r[11] === PL_ON).map(plOut_) };
}
/** Chi tiết 1 tem: pallet + lịch sử + trạng thái tem */
function plInfo(token, tem) {
  const u = requireUser_(token); plCanUse_(u);
  tem = plTem_(tem);
  const d = plRows_();
  const rows = d.rows.filter(r => String(r[0]).toUpperCase() === tem);
  const t = plTemRow_(tem);
  const lg = appSheet_(SH_PL_LOG, PL_LOG_HEADERS), n = lg.getLastRow() - 1, hist = [];
  if (n > 0) lg.getRange(2, 1, n, PL_LOG_HEADERS.length).getValues().forEach(r => {
    if (String(r[4]).toUpperCase() !== tem) return;
    hist.push({ time: r[0] instanceof Date ? Utilities.formatDate(r[0], 'GMT+7', 'dd/MM/yyyy HH:mm') : String(r[0]), by: String(r[2]),
                op: String(r[3]), from: String(r[6]), to: String(r[7]), dq: r[8], left: r[9] });
  });
  return { tem: tem, temStatus: t ? t.status : '', pallet: rows.length ? plOut_(rows[rows.length - 1]) : null, hist: hist.reverse() };
}
/** Cất hàng: dùng tem mới, ghi hàng, đặt vào vị trí. p = { tem, item, name, batch, exp, qty, rack, col, lv, reqId } */
function plPutaway(token, p) {
  const u = requireUser_(token); plCanUse_(u);
  p = p || {};
  if (reqSeen_(p.reqId)) return { dup: true };
  const tem = plTem_(p.tem);
  if (!/^P-[A-Z0-9]{6}$/.test(tem)) throw new Error('Mã tem pallet không hợp lệ (dạng P-XXXXXX).');
  const item = String(p.item || '').trim();
  if (!item) throw new Error('Chưa chọn mặt hàng.');
  const qty = Number(p.qty);
  if (!(qty > 0)) throw new Error('Nhập số thùng trên pallet.');
  const exp = p.exp ? printDate_(p.exp, 'HSD') : '';
  const loc = plLoc_(p.rack, p.col, p.lv);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (reqSeen_(p.reqId)) return { dup: true };
    const t = plTemRow_(tem);
    if (!t) throw new Error('Tem ' + tem + ' không có trong danh sách tem đã in.');
    if (t.status !== 'Chưa dùng') throw new Error('Tem ' + tem + ' đang ở trạng thái "' + t.status + '", không dùng cho pallet mới được. Dán tem mới.');
    const d = plRows_();
    plCheckFree_(d, loc, tem);
    const now = new Date(), row = d.sh.getLastRow() + 1;
    d.sh.getRange(row, 1, 1, PL_HEADERS.length).setValues([[tem, item, String(p.name || '').slice(0, 200), String(p.batch || '').trim(), exp,
      qty, qty, loc.rack, loc.col, loc.lv, loc.code, PL_ON, now, u.name, now, '', '']]);
    safe_(() => d.sh.getRange(row, 13, 1, 3).setNumberFormat('dd/MM/yyyy HH:mm:ss'));
    t.sh.getRange(t.row, 4, 1, 2).setValues([['Đang dùng', now]]);
    safe_(() => t.sh.getRange(t.row, 5).setNumberFormat('dd/MM/yyyy HH:mm:ss'));
    plLog_(u, 'CAT', tem, item, '', loc.code, qty, qty, p.reqId);
    reqMark_(p.reqId);
    return { tem: tem, loc: loc.code };
  } finally { lock.releaseLock(); }
}
/** Chuyển vị trí. p = { tem, rack, col, lv, reqId } */
function plMove(token, p) {
  const u = requireUser_(token); plCanUse_(u);
  p = p || {};
  if (reqSeen_(p.reqId)) return { dup: true };
  const tem = plTem_(p.tem), loc = plLoc_(p.rack, p.col, p.lv);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (reqSeen_(p.reqId)) return { dup: true };
    const d = plRows_(), i = plFindOpen_(d, tem), r = d.rows[i];
    if (String(r[10]) === loc.code) throw new Error('Pallet đang ở ' + loc.code + ' rồi.');
    plCheckFree_(d, loc, tem);
    const from = String(r[10]);
    d.sh.getRange(i + 2, 8, 1, 4).setValues([[loc.rack, loc.col, loc.lv, loc.code]]);
    d.sh.getRange(i + 2, 15).setValue(new Date());
    plLog_(u, 'CHUYEN', tem, String(r[1]), from, loc.code, '', Number(r[6]) || 0, p.reqId);
    reqMark_(p.reqId);
    return { tem: tem, from: from, loc: loc.code };
  } finally { lock.releaseLock(); }
}
/** Lấy ra. p = { tem, qty, reqId }. Lấy hết → pallet "Đã lấy hết", tem "Đã đóng". */
function plPick(token, p) {
  const u = requireUser_(token); plCanUse_(u);
  p = p || {};
  if (reqSeen_(p.reqId)) return { dup: true };
  const tem = plTem_(p.tem), q = Number(p.qty);
  if (!(q > 0)) throw new Error('Nhập số thùng lấy ra.');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (reqSeen_(p.reqId)) return { dup: true };
    const d = plRows_(), i = plFindOpen_(d, tem), r = d.rows[i];
    const have = Number(r[6]) || 0;
    if (q > have) throw new Error('Pallet chỉ còn ' + have + ' thùng.');
    const left = have - q, now = new Date();
    d.sh.getRange(i + 2, 7).setValue(left);
    d.sh.getRange(i + 2, 15).setValue(now);
    if (left <= 0) {
      d.sh.getRange(i + 2, 12).setValue(PL_DONE);
      d.sh.getRange(i + 2, 16).setValue(now);
      safe_(() => d.sh.getRange(i + 2, 16).setNumberFormat('dd/MM/yyyy HH:mm:ss'));
      const t = plTemRow_(tem);
      if (t) { t.sh.getRange(t.row, 4).setValue('Đã đóng'); t.sh.getRange(t.row, 6).setValue(now); safe_(() => t.sh.getRange(t.row, 6).setNumberFormat('dd/MM/yyyy HH:mm:ss')); }
    }
    plLog_(u, left <= 0 ? 'LAY_HET' : 'LAY', tem, String(r[1]), String(r[10]), '', -q, left, p.reqId);
    reqMark_(p.reqId);
    return { tem: tem, left: left, loc: String(r[10]), closed: left <= 0 };
  } finally { lock.releaseLock(); }
}
