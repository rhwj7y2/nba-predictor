// 主題：邏輯獨立放在這支（不放在 app.js），這樣就算手機還留著舊的 app.js，主題按鈕也一定點得動
// 之前選過的主題：在畫面出來之前先套上，才不會先閃一下預設顏色
try { var t = localStorage.getItem("nba-theme"); if (/^(white|khaki|pink|teal|blue|dark|black|winter)$/.test(t)) document.documentElement.setAttribute("data-theme", t); } catch (e) {}

// 冬天主題的下雪背景：只有選「冬天」時才畫，畫在內容後面（樣式見 style.css 的 #snow），切到別的主題就整個拿掉。
// 手機或電腦開了「減少動態效果」時只畫靜止的雪，不會飄
window.nbaSnow = (function () {
  var canvas = null, ctx = null, flakes = [], frame = 0, last = 0, w = 0, h = 0;
  var still = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function flake(y) {  // 大片的雪離得近：掉得快一點、亮一點
    var r = rand(0.8, 3.2);
    return { x: rand(0, w), y: y, r: r, vy: 14 + r * 14 + rand(-5, 5), sway: rand(6, 26), phase: rand(0, 6.28), alpha: 0.35 + r / 6 };
  }
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2), count;
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    count = Math.min(170, Math.round(w * h / 7000));  // 雪花數量跟著畫面大小，手機少一點
    while (flakes.length < count) flakes.push(flake(rand(0, h)));
    flakes.length = count;
    draw(0);
  }
  function draw(dt) {  // dt = 和上一格差幾秒
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    for (var i = 0; i < flakes.length; i++) {
      var f = flakes[i];
      f.y += f.vy * dt;
      f.phase += dt;
      if (f.y > h + f.r) { flakes[i] = f = flake(-f.r); }
      var x = (f.x + Math.sin(f.phase) * f.sway + w) % w;
      ctx.globalAlpha = Math.min(0.9, f.alpha);
      ctx.beginPath();
      ctx.arc(x, f.y, f.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function tick(now) {
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;  // 分頁切回來時不要一次跳一大段
    last = now;
    draw(dt);
    frame = window.requestAnimationFrame(tick);
  }
  function start() {
    if (canvas || !document.body) return;
    canvas = document.createElement("canvas");
    canvas.id = "snow";
    canvas.setAttribute("aria-hidden", "true");
    ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) { canvas = null; return; }
    document.body.insertBefore(canvas, document.body.firstChild);
    window.addEventListener("resize", resize);
    resize();
    if (!(still && still.matches)) { last = 0; frame = window.requestAnimationFrame(tick); }
  }
  function stop() {
    if (!canvas) return;
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    canvas.parentNode.removeChild(canvas);
    canvas = ctx = null;
    flakes = [];
  }
  function sync() {  // 依目前的主題開始或停止下雪
    if (document.documentElement.getAttribute("data-theme") === "winter") start(); else stop();
  }
  if (still && still.addEventListener) still.addEventListener("change", function () { stop(); sync(); });
  return { sync: sync };
})();

// 目前生效的主題：選過的，沒選過就跟系統（淺色 = 卡其、深色 = 黑色）；按鈕的亮起也在這裡處理
window.nbaMarkTheme = function () {
  var cur = document.documentElement.getAttribute("data-theme") ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "black" : "khaki");
  var bs = document.querySelectorAll("#theme-pick .tp-btn");
  for (var i = 0; i < bs.length; i++) bs[i].setAttribute("aria-pressed", bs[i].getAttribute("data-t") === cur ? "true" : "false");
};
document.addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("#theme-pick .tp-btn") : null;
  if (!b) return;
  var t = b.getAttribute("data-t");
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("nba-theme", t); } catch (err) { /* 瀏覽器不讓存就只有這次有效 */ }
  window.nbaMarkTheme();
  window.nbaSnow.sync();
  window.dispatchEvent(new Event("nba-theme"));  // app.js 聽到會重畫（隊色要跟著主題重算）
});
document.addEventListener("DOMContentLoaded", function () { window.nbaMarkTheme(); window.nbaSnow.sync(); });
