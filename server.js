// OfferScope 本地服务器：托管静态站 + 安全代理 DeepSeek（key 只在服务器端）。
// 运行：  node --env-file=.env server.js   （Node 18+）
const http = require("http");
const fs = require("fs");
const path = require("path");
const ai = require("./lib/ai");
const pay = require("./lib/pay");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

function sendJSON(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function parseQuery(reqUrl) {
  const q = {}; const i = reqUrl.indexOf("?"); if (i < 0) return q;
  reqUrl.slice(i + 1).split("&").forEach(kv => { const [k, v] = kv.split("="); if (k) q[decodeURIComponent(k)] = decodeURIComponent((v || "").replace(/\+/g, " ")); });
  return q;
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  // 健康检查
  if (url === "/api/health") {
    return sendJSON(res, 200, {
      ok: true,
      hasKey: !!process.env.DEEPSEEK_API_KEY,
      modelFast: ai.MODEL_FAST, modelPro: ai.MODEL_PRO, base: ai.BASE,
      payConfigured: pay.configured(),
    });
  }

  // ===== 支付：ZPay 异步回调（GET 或 POST，需返回纯文本 success）=====
  if (url === "/api/pay/notify") {
    const finish = (params) => {
      const r = pay.handleNotify(params);
      console.log(r.ok ? ("✓ 支付到账 " + params.out_trade_no) : ("✗ 回调校验失败：" + r.reason));
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(r.ok ? "success" : "fail");
    };
    if (req.method === "POST") { let b = ""; req.on("data", c => b += c); req.on("end", () => finish(parseQuery("?" + b))); }
    else finish(parseQuery(req.url));
    return;
  }
  // 支付状态轮询
  if (url === "/api/pay/status") return sendJSON(res, 200, pay.getStatus(parseQuery(req.url).outTradeNo));
  // 同步返回页（用户付完跳回）
  if (url === "/api/pay/return") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>支付完成，请返回原页面查看报告</h2><p>可以关闭此页。</p><script>try{window.close()}catch(e){}</script></body>`);
  }
  // 本地测试用：手动标记订单已付（仅在公网回调不可用时）
  if (url === "/api/pay/mock-paid") { const ok = pay.devMarkPaid(parseQuery(req.url).outTradeNo); return sendJSON(res, 200, { ok }); }

  // 支付：创建订单（POST）→ 返回收银台 payUrl + 订单号
  if (req.method === "POST" && url === "/api/pay/create") {
    let body = ""; req.on("data", c => body += c);
    req.on("end", () => {
      let p = {}; try { p = JSON.parse(body || "{}"); } catch (e) {}
      try { const r = pay.createOrder(p); console.log("· 创建订单 " + r.outTradeNo + " (" + (p.productType||"") + "/" + (p.channel||"") + ")"); sendJSON(res, 200, { ok: true, ...r }); }
      catch (e) { sendJSON(res, 200, { ok: false, error: String((e && e.message) || e) }); }
    });
    return;
  }

  // AI 接口（POST）
  if (req.method === "POST" && url.startsWith("/api/")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let payload = {};
      try { payload = JSON.parse(body || "{}"); } catch (e) {}
      try {
        let data;
        if (url === "/api/follow-up") data = await ai.followUp(payload);
        else if (url === "/api/free-result") data = await ai.freeResult(payload);
        else if (url === "/api/full-report") data = await ai.fullReport(payload);
        else return sendJSON(res, 404, { ok: false, error: "unknown endpoint" });
        console.log("✓ [" + url + "] AI 调用成功");
        sendJSON(res, 200, { ok: true, data });
      } catch (e) {
        // 永远不抛 500——返回 ok:false，前端会回退到规则引擎。把错误打到终端方便排查。
        console.error("✗ [" + url + "] AI 调用失败：", String((e && e.message) || e));
        sendJSON(res, 200, { ok: false, error: String((e && e.message) || e) });
      }
    });
    return;
  }

  // 静态文件
  let p = url === "/" ? "/index.html" : url;
  const fp = path.join(ROOT, decodeURIComponent(p));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(fp, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(fp).toLowerCase();
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
      ".md": "text/markdown", ".json": "application/json", ".svg": "image/svg+xml" }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime + "; charset=utf-8" });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log("OfferScope 已启动 → http://localhost:" + PORT);
  console.log("DeepSeek key：" + (process.env.DEEPSEEK_API_KEY ? "已配置 ✓" : "未配置（将回退到规则引擎）"));
  console.log("ZPay 支付：" + (pay.configured() ? ("已配置 ✓ · 回调 " + pay.SITE + "/api/pay/notify") : "未配置（结算页用本地模拟）"));
});
