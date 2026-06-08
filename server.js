// OfferScope 本地服务器：托管静态站 + 安全代理 DeepSeek（key 只在服务器端）。
// 运行：  node --env-file=.env server.js   （Node 18+）
const http = require("http");
const fs = require("fs");
const path = require("path");
const ai = require("./lib/ai");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

function sendJSON(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  // 健康检查
  if (url === "/api/health") {
    return sendJSON(res, 200, {
      ok: true,
      hasKey: !!process.env.DEEPSEEK_API_KEY,
      modelFast: ai.MODEL_FAST, modelPro: ai.MODEL_PRO, base: ai.BASE,
    });
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
});
