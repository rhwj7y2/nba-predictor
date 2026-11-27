// 主題：邏輯獨立放在這支（不放在 app.js），這樣就算手機還留著舊的 app.js，主題按鈕也一定點得動
// 在畫面出來之前先套上主題，才不會先閃一下別的顏色：之前選過的用選過的，沒選過（第一次打開）預設是冬天
var DEFAULT_THEME = "winter";
(function () {
  var t = null;
  try { t = localStorage.getItem("nba-theme"); } catch (e) { /* 瀏覽器不讓讀就用預設 */ }
  document.documentElement.setAttribute("data-theme", /^(white|khaki|pink|teal|blue|dark|black|winter)$/.test(t) ? t : DEFAULT_THEME);
})();

// 冬天主題的下雪背景：只有「冬天」主題時才放，切到別的主題就整個拿掉。
// 這裡只負責放三個空圖層；雪花和飄落全部寫在 style.css 的 #snow（只移動圖層、不逐格重畫，手機才不會卡）
window.nbaSnow = {
  sync: function () {
    var on = document.documentElement.getAttribute("data-theme") === "winter", el = document.getElementById("snow");
    if (on && !el && document.body) {
      el = document.createElement("div");
      el.id = "snow";
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = "<i></i><i></i><i></i>";  // 遠、中、近三層
      document.body.insertBefore(el, document.body.firstChild);
    } else if (!on && el) {
      el.parentNode.removeChild(el);
    }
  }
};

// 讓目前生效主題的按鈕亮起來
window.nbaMarkTheme = function () {
  var cur = document.documentElement.getAttribute("data-theme") || DEFAULT_THEME;
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
