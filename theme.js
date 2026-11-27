// 主題：邏輯獨立放在這支（不放在 app.js），這樣就算手機還留著舊的 app.js，主題按鈕也一定點得動
// 之前選過的主題：在畫面出來之前先套上，才不會先閃一下預設顏色
try { var t = localStorage.getItem("nba-theme"); if (/^(white|khaki|pink|teal|blue|dark|black)$/.test(t)) document.documentElement.setAttribute("data-theme", t); } catch (e) {}
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
  window.dispatchEvent(new Event("nba-theme"));  // app.js 聽到會重畫（隊色要跟著主題重算）
});
document.addEventListener("DOMContentLoaded", window.nbaMarkTheme);
