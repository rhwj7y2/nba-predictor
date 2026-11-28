// 主題：邏輯獨立放在這支（不放在 app.js），這樣就算手機還留著舊的 app.js，主題按鈕也一定點得動
// 在畫面出來之前先套上主題，才不會先閃一下別的顏色：之前選過的用選過的，沒選過（第一次打開）預設是藏青（代號 winter）
var DEFAULT_THEME = "winter";
(function () {
  var t = null;
  try { t = localStorage.getItem("nba-theme"); } catch (e) { /* 瀏覽器不讓讀就用預設 */ }
  document.documentElement.setAttribute("data-theme", /^(white|khaki|pink|teal|blue|dark|black|winter)$/.test(t) ? t : DEFAULT_THEME);
})();

// 下雪背景（所有主題都有）：這裡只負責放三個空圖層；雪花、顏色和飄落全部寫在 style.css 的 #snow（只移動圖層、不逐格重畫，手機才不會卡）
function addSnow() {
  if (!document.body || document.getElementById("snow")) return;
  var el = document.createElement("div");
  el.id = "snow";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = "<i></i><i></i><i></i>";  // 遠、中、近三層
  document.body.insertBefore(el, document.body.firstChild);
}

// 背景特效開關：每個主題各自記開 / 關（localStorage 的 nba-fx-off = 關掉特效的主題清單）。白色主題本來就沒有特效，按鈕不能按
var fxOff = [];
function readFx() {
  try { fxOff = (localStorage.getItem("nba-fx-off") || "").split(",").filter(Boolean); } catch (e) { /* 讀不到就沿用手上的清單（一開始是全部開著） */ }
}
readFx();
function applyFx() {
  var root = document.documentElement, theme = root.getAttribute("data-theme"), off = fxOff.indexOf(theme) >= 0;
  if (off) root.setAttribute("data-fx-off", ""); else root.removeAttribute("data-fx-off");
  var b = document.getElementById("fx-btn");
  if (!b) return;
  var none = theme === "white";
  b.disabled = none;
  b.setAttribute("aria-pressed", !none && !off ? "true" : "false");
  b.setAttribute("aria-label", "背景特效開關");
  b.textContent = none ? "無特效" : off ? "特效 關" : "特效 開";
}
applyFx();  // 畫面出來之前先套用，關掉特效的人不會先閃一下

document.addEventListener("click", function (e) {
  var b = e.target.closest ? e.target.closest("#fx-btn") : null;
  if (!b || b.disabled) return;
  readFx();
  var theme = document.documentElement.getAttribute("data-theme"), i = fxOff.indexOf(theme);
  if (i >= 0) fxOff.splice(i, 1); else fxOff.push(theme);
  try { localStorage.setItem("nba-fx-off", fxOff.join(",")); } catch (err) { /* 瀏覽器不讓存就只有這次有效 */ }
  applyFx();
});

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
  applyFx();
  window.dispatchEvent(new Event("nba-theme"));  // app.js 聽到會重畫（隊色要跟著主題重算）
});
document.addEventListener("DOMContentLoaded", function () { window.nbaMarkTheme(); addSnow(); applyFx(); });
