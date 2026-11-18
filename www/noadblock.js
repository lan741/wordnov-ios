/*!
 * WordNov iOS · 去广告 / 去推广 运行时补丁  v1.0.0
 * ------------------------------------------------------------------
 * 注入点：www/index.html 的 <head> 第一个 script（必须先于业务 bundle 执行）
 * 由 scripts/apply-adblock.mjs 自动注入，可重复执行（幂等）。
 *
 * 四层拦截：
 *   1) network   —— fetch / XHR / sendBeacon / 图片 / window.open 层拦截广告域名与广告路径
 *   2) dom       —— MutationObserver 清扫广告 DOM（iframe、ad-slot、interstitial 等）
 *   3) gates     —— 自动跳过「看广告解锁 / 观看激励视频」面板
 *   4) promo     —— 隐藏会员推广横幅（默认关闭，见下）
 *
 * 运行期改配置（无需重新打包）：
 *   localStorage.setItem('nov.ad.cfg', JSON.stringify({promo:true, verbose:true}))
 *   location.reload()
 *
 * 自检：
 *   window.__NOV_ADBLOCK_REPORT()
 */
(function () {
  "use strict";
  if (window.__NOV_ADBLOCK__) return;
  window.__NOV_ADBLOCK__ = "1.0.0";

  var CFG = {
    network: true,   // 拦截广告请求
    dom: true,       // 清扫广告节点
    gates: true,     // 自动跳过广告解锁面板
    promo: false,    // 隐藏「开通会员」推广横幅（默认不改动业务 UI，需要时置 true）
    analytics: false,// 顺带拦截第三方统计（umeng/cnzz 等），默认关闭
    verbose: false   // 控制台打印拦截日志
  };
  try {
    var saved = JSON.parse(localStorage.getItem("nov.ad.cfg") || "null");
    if (saved && typeof saved === "object") for (var k in saved) if (k in CFG) CFG[k] = saved[k];
  } catch (e) {}

  var stats = { network: 0, dom: 0, gates: 0, promo: 0, lastBlocked: [] };

  function log() {
    if (!CFG.verbose) return;
    try { console.log.apply(console, ["[noadblock]"].concat([].slice.call(arguments))); } catch (e) {}
  }
  function note(kind, what) {
    stats[kind]++;
    if (stats.lastBlocked.length > 50) stats.lastBlocked.shift();
    stats.lastBlocked.push(kind + " :: " + String(what).slice(0, 300));
    log(kind, what);
  }

  /* ---------------------------------------------------------------- 规则表 */

  // 广告 / 激励视频 / 广告联盟域名（含国内主流 SDK）
  var AD_HOSTS = [
    "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.",
    "applovin.com", "unityads.unity3d.com", "ironsrc.com", "mintegral.com", "pangle.io",
    "pangolin-sdk-toutiao.com", "gdt.qq.com", "pgdt.gtimg.cn", "e.qq.com", "sigmob.com",
    "vungle.com", "chartboost.com", "adcolony.com", "tapjoy.com", "mopub.com", "inmobi.com",
    "admaster.com.cn", "miaozhen.com", "allyes.com", "ipinyou.com", "tanx.com", "alimama.com",
    "adview.cn", "domob.cn", "mobads.baidu.com", "csjplatform.com", "bytedance.com",
    "kuaishou.com", "kwai.com", "adnxs.com", "rubiconproject.com", "pubmatic.com",
    "criteo.com", "smadex.com", "smartadserver.com", "adition.com", "adsrvr.org"
  ];
  // 可选：第三方统计（默认不拦，避免影响业务埋点）
  var TRACK_HOSTS = ["umeng.com", "cnzz.com", "growingio.com", "talkingdata.com", "sensorsdata.cn"];

  // 广告相关路径（只匹配明确的广告语义，避免误伤业务接口）
  var AD_PATH_RE = /\/(?:api\/)?(?:ads?|advert|adverts|advertising|adslot|banner-ad|promote|promotion|rewarded|reward-video|interstitial|splash-ad|feed-ad)(?:[/?#._-]|$)/i;

  function hostOf(url) {
    try { return new URL(url, location.href).hostname.toLowerCase(); } catch (e) { return ""; }
  }
  function isAdUrl(url) {
    if (!url) return false;
    var s = String(url);
    if (s.indexOf("data:") === 0 || s.indexOf("blob:") === 0) return false;
    var h = hostOf(s);
    if (h) {
      for (var i = 0; i < AD_HOSTS.length; i++) {
        var d = AD_HOSTS[i];
        if (h === d || h.slice(-(d.length + 1)) === "." + d || h.indexOf(d) === 0) return true;
      }
      if (CFG.analytics) {
        for (var j = 0; j < TRACK_HOSTS.length; j++) {
          var t = TRACK_HOSTS[j];
          if (h === t || h.slice(-(t.length + 1)) === "." + t) return true;
        }
      }
    }
    // 同源广告接口
    if (h === location.hostname && AD_PATH_RE.test(s)) return true;
    return false;
  }

  /* ------------------------------------------------------- 1. 网络层拦截 */

  if (CFG.network) {
    // fetch
    var origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        if (isAdUrl(url)) {
          note("network", "fetch " + url);
          try { return Promise.resolve(new Response("", { status: 204, statusText: "No Content" })); }
          catch (e) { return Promise.resolve({ ok: true, status: 204, text: function () { return Promise.resolve(""); }, json: function () { return Promise.resolve({}); } }); }
        }
        return origFetch.apply(this, arguments);
      };
    }

    // XMLHttpRequest
    var XO = XMLHttpRequest.prototype.open;
    var XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      if (isAdUrl(u)) { this.__novAd = String(u); }
      return XO.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this.__novAd) {
        var xhr = this;
        note("network", "xhr " + xhr.__novAd);
        setTimeout(function () {
          try { xhr.status = 204; } catch (e) {}
          try { xhr.readyState = 4; } catch (e) {}
          try { xhr.dispatchEvent(new Event("load")); } catch (e) {}
          try { xhr.dispatchEvent(new Event("loadend")); } catch (e) {}
        }, 0);
        return;
      }
      return XS.apply(this, arguments);
    };

    // sendBeacon
    if (navigator.sendBeacon) {
      var origBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (u, d) {
        if (isAdUrl(u)) { note("network", "beacon " + u); return true; }
        return origBeacon(u, d);
      };
    }

    // window.open 广告落地页
    var origOpen = window.open;
    window.open = function (u) {
      if (u && isAdUrl(u)) { note("network", "window.open " + u); return null; }
      return origOpen.apply(window, arguments);
    };

    // 动态 <script>/<img> 广告资源
    try {
      var srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
      if (srcDesc && srcDesc.set) {
        Object.defineProperty(HTMLScriptElement.prototype, "src", {
          configurable: true,
          get: srcDesc.get,
          set: function (v) {
            if (isAdUrl(v)) { note("network", "script " + v); return; }
            return srcDesc.set.call(this, v);
          }
        });
      }
    } catch (e) {}
  }

  /* ------------------------------------------------------- 2. DOM 清扫 */

  var AD_SELECTORS = [
    "ins.adsbygoogle",
    "iframe[src*='googleads']",
    "iframe[src*='doubleclick']",
    "iframe[src*='googlesyndication']",
    "[id^='ad_']",
    "[id^='ads_']",
    "[id^='div-gpt-ad']",
    "[class*='ad-slot']",
    "[class*='adslot']",
    "[class*='ad-banner']",
    "[class*='adsbygoogle']",
    "[class*='interstitial-ad']",
    "[class*='rewarded-video']",
    "[data-ad-slot]",
    "[data-ad-client]",
    "[data-adunit]"
  ].join(",");

  function sweepDom(root) {
    if (!CFG.dom) return;
    var scope = root && root.querySelectorAll ? root : document;
    var nodes;
    try { nodes = scope.querySelectorAll(AD_SELECTORS); } catch (e) { return; }
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.parentNode) continue;
      note("dom", (n.tagName || "") + "." + (n.className || n.id || "").toString().slice(0, 60));
      n.parentNode.removeChild(n);
    }
    // iframe 指向广告域名的
    var ifr;
    try { ifr = scope.querySelectorAll("iframe[src]"); } catch (e) { ifr = []; }
    for (var k = 0; k < ifr.length; k++) {
      if (isAdUrl(ifr[k].getAttribute("src"))) {
        note("dom", "iframe " + ifr[k].getAttribute("src"));
        if (ifr[k].parentNode) ifr[k].parentNode.removeChild(ifr[k]);
      }
    }
  }

  /* ------------------------------------------------ 3. 广告解锁面板自动跳过 */

  var GATE_TEXT = /(看|观看|观看一段|看完)\s*(个|一段|个短视频|视频|广告)|激励视频|广告解锁|看广告解锁/;
  var SKIP_TEXT = /^(跳过|跳过广告|关闭广告|关闭|跳过\s*[0-9]+\s*s?|skip(\s+ad)?)$/i;

  function inAdOverlay(el) {
    var box = el;
    for (var i = 0; i < 6 && box; i++) {
      if (box.nodeType === 1) {
        var st = null;
        try { st = getComputedStyle(box); } catch (e) {}
        if (st && st.position === "fixed" && (box.getBoundingClientRect().width * box.getBoundingClientRect().height > innerWidth * innerHeight * 0.4)) return box;
        var txt = (box.textContent || "").slice(0, 400);
        if (/(广告|激励视频|跳过)/.test(txt) && (box.className || "").toString().match(/mask|modal|dialog|popup|overlay|advert/i)) return box;
      }
      box = box.parentElement;
    }
    return null;
  }

  function sweepGates(root) {
    if (!CFG.gates) return;
    var scope = root && root.querySelectorAll ? root : document;
    var all;
    try { all = scope.querySelectorAll("button,a,div,span,p"); } catch (e) { return; }
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var t = (el.textContent || "").trim();
      if (!t || t.length > 24) continue;
      if (!SKIP_TEXT.test(t)) continue;
      var overlay = inAdOverlay(el);
      if (!overlay || !/(广告|激励视频)/.test(overlay.textContent || "")) continue;
      note("gates", "auto click 「" + t + "」");
      try { el.click(); } catch (e) {}
    }
    // 直接命中「看广告解锁」按钮 —— 若同面板内存在关闭/跳过入口，自动点掉
    for (var j = 0; j < all.length; j++) {
      var b = all[j];
      var bt = (b.textContent || "").trim();
      if (!bt || bt.length > 30 || !GATE_TEXT.test(bt)) continue;
      var ov = inAdOverlay(b);
      if (!ov) continue;
      var cands = ov.querySelectorAll("button,a,div,span");
      for (var q = 0; q < cands.length; q++) {
        var ct = (cands[q].textContent || "").trim();
        if (ct && ct.length < 12 && SKIP_TEXT.test(ct)) {
          note("gates", "dismiss ad gate via 「" + ct + "」");
          try { cands[q].click(); } catch (e) {}
          break;
        }
      }
    }
  }

  /* --------------------------------------------------- 4. 推广横幅（可选） */

  var PROMO_RE = /(开通|升级|续费)\s*(会员|VIP|SVIP)|会员专享|首月\s*\d|限时.{0,4}折/;
  var PROMO_SEL = "[class*='promo'],[class*='vip-card'],[class*='member-banner'],[data-nov-promo]";

  function sweepPromo(root) {
    if (!CFG.promo) return;
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = [];
    try { nodes = scope.querySelectorAll(PROMO_SEL); } catch (e) {}
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.parentNode) continue;
      note("promo", "hide " + (n.className || "").toString().slice(0, 60));
      n.style.display = "none";
    }
    void PROMO_RE;
  }

  /* --------------------------------------------------------- 生效与调度 */

  function runAll(root) {
    sweepDom(root);
    sweepGates(root);
    sweepPromo(root);
  }

  function boot() {
    runAll(document);
    if (!CFG.dom && !CFG.gates && !CFG.promo) return;
    var mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.addedNodes && m.addedNodes.length) {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.nodeType === 1) runAll(n);
          }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    // 定时兜底（有些框架会批量替换 innerHTML 绕过 observer）
    setInterval(function () { runAll(document); }, 2500);
  }

  window.__NOV_ADBLOCK_REPORT = function () {
    return { version: window.__NOV_ADBLOCK__, cfg: CFG, stats: stats };
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
  log("armed", CFG);
})();