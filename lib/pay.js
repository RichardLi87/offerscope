// OfferScope · ZPay（易支付标准）支付服务封装 + 简单订单存储（CommonJS, 零第三方依赖）
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HOST = (process.env.ZPAY_HOST || "https://zpayz.cn").replace(/\/$/, "");
const PID  = process.env.ZPAY_PID || "";
const KEY  = process.env.ZPAY_KEY || "";
const SITE = (process.env.SITE_URL || "http://localhost:" + (process.env.PORT || 3000)).replace(/\/$/, "");

const PRODUCTS = {
  standard_report: { name: "OfferScope 申请诊断报告", price: 19 },
  premium_report:  { name: "OfferScope 完整申请规划报告", price: 0.1 }, // ←【临时测试价】测完改回 49
};

const ORDERS_FILE = path.join(__dirname, "..", "orders.json");
function loadOrders() { try { return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8")); } catch (e) { return {}; } }
function saveOrders(o) { try { fs.writeFileSync(ORDERS_FILE, JSON.stringify(o, null, 1)); } catch (e) {} }

function md5(s) { return crypto.createHash("md5").update(s, "utf8").digest("hex"); }
// 易支付签名：按参数名 ASCII 升序，排除 sign/sign_type/空值，拼成 a=b&c=d，末尾接 KEY，md5 小写
function sign(params) {
  const keys = Object.keys(params).filter(k => k !== "sign" && k !== "sign_type" && params[k] !== "" && params[k] != null).sort();
  const str = keys.map(k => `${k}=${params[k]}`).join("&");
  return md5(str + KEY);
}

function configured() { return !!(PID && KEY); }

// 创建订单：返回跳转到 ZPay 收银台的 payUrl（submit.php 页面跳转支付）
function createOrder({ assessmentId, productType, channel, email }) {
  const prod = PRODUCTS[productType] || PRODUCTS.standard_report;
  const type = channel === "alipay" ? "alipay" : "wxpay";
  const outTradeNo = "os" + Date.now() + Math.random().toString(36).slice(2, 6);
  const orders = loadOrders();
  orders[outTradeNo] = { outTradeNo, assessmentId: assessmentId || "", productType, channel: type,
    money: prod.price.toFixed(2), email: email || "", status: "pending", createdAt: Date.now() };
  saveOrders(orders);

  if (!configured()) return { outTradeNo, devMock: true, money: prod.price };

  const params = {
    pid: PID, type, out_trade_no: outTradeNo,
    notify_url: SITE + "/api/pay/notify", return_url: SITE + "/api/pay/return",
    name: prod.name, money: prod.price.toFixed(2), sign_type: "MD5",
  };
  params.sign = sign(params);
  const qs = Object.keys(params).map(k => `${k}=${encodeURIComponent(params[k])}`).join("&");
  return { outTradeNo, payUrl: HOST + "/submit.php?" + qs, money: prod.price };
}

// 验证 ZPay 异步通知，验签 + 金额校验，标记订单已付
function handleNotify(params) {
  if (!configured()) return { ok: false, reason: "not_configured" };
  const got = params.sign;
  if (!got || got !== sign(params)) return { ok: false, reason: "bad_sign" };
  if (params.trade_status && params.trade_status !== "TRADE_SUCCESS") return { ok: false, reason: "not_success" };
  const orders = loadOrders();
  const o = orders[params.out_trade_no];
  if (!o) return { ok: false, reason: "no_order" };
  if (Math.abs(parseFloat(params.money) - parseFloat(o.money)) > 0.001) return { ok: false, reason: "money_mismatch" };
  o.status = "paid"; o.paidAt = Date.now(); o.tradeNo = params.trade_no || "";
  saveOrders(orders);
  return { ok: true, order: o };
}

function getStatus(outTradeNo) {
  const o = loadOrders()[outTradeNo];
  return o ? { found: true, paid: o.status === "paid", productType: o.productType, assessmentId: o.assessmentId || "" } : { found: false };
}

// 本地测试用：在未部署/无法收到公网回调时，手动把订单标记为已付
function devMarkPaid(outTradeNo) {
  const orders = loadOrders(); const o = orders[outTradeNo];
  if (!o) return false; o.status = "paid"; o.paidAt = Date.now(); o.dev = true; saveOrders(orders); return true;
}

module.exports = { createOrder, handleNotify, getStatus, devMarkPaid, configured, HOST, SITE, PRODUCTS };
