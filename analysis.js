// 我的賽前分析（手寫紀錄，從 Notion 複製；網站不會自動同步，Notion 改了要重新複製）。
// 比賽頁在「留言」上面多一張「📝 賽前分析」卡片（預設收起），只有這裡有寫到的場次才出現。
// days["台灣日期"] = { games: { "客隊@主隊"（網站用的縮寫）: 那一場 } }
// 每場：result = 結果（還沒開獎留空）、pick = 選擇、odds = 賠率（只留紀錄，網站不顯示）、reasons = [[粗體小標, 內文], ...]、counter = 反向
// en = 英文版的 pick / reasons / counter（網站切到 EN 時顯示；沒寫 en 的場次，英文版會顯示中文原文）
window.NBA_ANALYSIS = {
  days: {
    "2026-11-22": {
      games: {
        "MIL@PHI": {
          result: "❌",
          pick: "PHI 小 120.5",
          odds: "1.936",
          reasons: [
            ["缺陣", "JB 缺陣，模型預估 118.8。"],
            ["連續高分", "賭徒謬論，76人近期 123、131、135、121，賭他斷。"]
          ],
          counter: "",
          en: {
            pick: "PHI Under 120.5",
            reasons: [
              ["Absences", "JB is out; the model projects 118.8."],
              ["High-scoring streak", "Gambler's fallacy: the 76ers' recent scores are 123, 131, 135, 121, and I'm betting the streak ends."]
            ],
            counter: ""
          }
        },
        "POR@NYK": {
          result: "✅",
          pick: "NYK 不讓分",
          odds: "1.65",
          reasons: [
            ["交手", "對戰歷史尼克優勢。"],
            ["防守＋主場", "尼克防守近況好，加上主場優勢。"]
          ],
          counter: "",
          en: {
            pick: "NYK Moneyline",
            reasons: [
              ["Head-to-head", "The Knicks have the edge in past meetings."],
              ["Defense + home court", "The Knicks have been defending well lately, plus they have home-court advantage."]
            ],
            counter: ""
          }
        },
        "MEM@MIN": {
          result: "❌",
          pick: "MEM +6.5",
          odds: "1.915",
          reasons: [
            ["前提", "Ty Jerome 有打，灰熊客場強。"],
            ["低分比賽", "如果分數小，容易受讓方靠得近。"]
          ],
          counter: "",
          en: {
            pick: "MEM +6.5",
            reasons: [
              ["Condition", "Assumes Ty Jerome plays; the Grizzlies are strong on the road."],
              ["Low-scoring game", "If scoring is low, the side getting points tends to stay close."]
            ],
            counter: ""
          }
        },
        "LAC@DAL": {
          result: "✅",
          pick: "DAL −5.5",
          odds: "1.956",
          reasons: [
            ["快艇防守差", "快艇防守太爛（全聯盟第 25 名），近十場均失分 122.2。"],
            ["主客場", "小牛主場 6-2，快艇客場 0-6。"]
          ],
          counter: "",
          en: {
            pick: "DAL −5.5",
            reasons: [
              ["Clippers' weak defense", "The Clippers' defense is awful (25th in the league), allowing 122.2 points per game over the last 10."],
              ["Home/road", "Mavericks 6-2 at home, Clippers 0-6 on the road."]
            ],
            counter: ""
          }
        },
        "BOS@SAC": {
          result: "❌",
          pick: "BOS −13.5",
          odds: "1.915",
          reasons: [
            ["BOS 防守", "近期賽綠讓對手比分偏低。"],
            ["攻守對位", "進攻爛的國王遇到防守好的賽綠，看好守爛。"]
          ],
          counter: "",
          en: {
            pick: "BOS −13.5",
            reasons: [
              ["BOS defense", "The Celtics have been holding opponents to low scores lately."],
              ["Offense vs. defense matchup", "The Kings' poor offense meets the Celtics' strong defense; I expect the defense to shut it down."]
            ],
            counter: ""
          }
        }
      }
    },
    "2026-11-23": {
      games: {
        "OKC@MIA": {
          result: "✅",
          pick: "總分大 231.5",
          odds: "1.956",
          reasons: [
            ["MIA 進攻火熱", "進攻每百 117.6（第 6），近 10 場得 124.3、近 5 場得 130.0。近 5 場總分 267/238/254/254/224，4 場高於 231.5。"],
            ["MIA 防守差", "防守每百 116.9（第 23），近 10 場失 119.4、近 5 場失 117.4，OKC 有得分空間（OKC 近 10 場得 116.9）。"],
            ["節奏快", "MIA 本季 pace 101.8，OKC 99.0，近 10 場 100.7 / 99.8。"]
          ],
          counter: "",
          en: {
            pick: "Total Over 231.5",
            reasons: [
              ["MIA's hot offense", "117.6 points per 100 possessions (6th); 124.3 points over the last 10 and 130.0 over the last 5. Totals in the last 5: 267/238/254/254/224, 4 of them above 231.5."],
              ["MIA's weak defense", "116.9 allowed per 100 (23rd); allowed 119.4 over the last 10 and 117.4 over the last 5, so OKC has room to score (OKC scored 116.9 over the last 10)."],
              ["Fast pace", "Season pace: MIA 101.8, OKC 99.0; last 10: 100.7 / 99.8."]
            ],
            counter: ""
          }
        },
        "DAL@UTA": {
          result: "❌",
          pick: "總分小 224.5",
          odds: "1.905",
          reasons: [
            ["兩隊都慢", "本季 pace 都是 98.7，近 5 場 97.6 / 96.4。"],
            ["近 10 場總分低", "場均總分 DAL 223.6、UTA 222.7，都低於 224.5。"],
            ["DAL 得分下滑", "近 5 場只得 106.2 分（近 10 場 110.9）。"]
          ],
          counter: "",
          en: {
            pick: "Total Under 224.5",
            reasons: [
              ["Both teams are slow", "Both have a season pace of 98.7; last 5: 97.6 / 96.4."],
              ["Low totals in the last 10", "Average game total: DAL 223.6, UTA 222.7, both below 224.5."],
              ["DAL's scoring is dropping", "Only 106.2 points over the last 5 (110.9 over the last 10)."]
            ],
            counter: ""
          }
        },
        "DEN@CHI": {
          result: "✅",
          pick: "CHI +9.5",
          odds: "1.966",
          reasons: [
            ["DEN 贏得不多", "近 5 場 4 勝 1 敗，但場均只贏 2.8 分。五場分差 +9/+4/−12/+8/+5，沒有一場贏 10 分以上。DEN 近 10 場淨勝 +3.4。"],
            ["CHI 近況", "近 5 場 3 勝 2 敗，場均得 117.6、失 110.8（淨 +6.8），得分比 DEN 近 5 場（116.4）還高。"],
            ["DEN 防守弱", "防守每百 115.6（第 19），近 5 場失 113.6。"]
          ],
          counter: "",
          en: {
            pick: "CHI +9.5",
            reasons: [
              ["DEN doesn't win by much", "4-1 in the last 5, but winning by only 2.8 on average. Margins: +9/+4/−12/+8/+5, no win by 10 or more. DEN's net margin over the last 10 is +3.4."],
              ["CHI's form", "3-2 in the last 5, scoring 117.6 and allowing 110.8 (net +6.8); that's more scoring than DEN over its last 5 (116.4)."],
              ["DEN's soft defense", "115.6 allowed per 100 (19th); 113.6 allowed over the last 5."]
            ],
            counter: ""
          }
        },
        "IND@NYK": {
          result: "✅",
          pick: "NYK −6.5",
          odds: "1.94",
          reasons: [
            ["實力差距", "NYK 實力評分 +5.1，IND −4.2。近 10 場 NYK 8-2、IND 3-7，得失分差 NYK +9.4、IND −3.9。"],
            ["NYK 防守", "防守每百 108.7（第 4），場均只失 103.1，近 10 場失 100.3。"],
            ["主客場", "IND 客場 3-5，NYK 主場 5-3。"]
          ],
          counter: "",
          en: {
            pick: "NYK −6.5",
            reasons: [
              ["Talent gap", "Team rating: NYK +5.1, IND −4.2. Last 10: NYK 8-2, IND 3-7; point differential NYK +9.4, IND −3.9."],
              ["NYK's defense", "108.7 allowed per 100 (4th); only 103.1 allowed per game, 100.3 over the last 10."],
              ["Home/road", "IND 3-5 on the road, NYK 5-3 at home."]
            ],
            counter: ""
          }
        },
        "BOS@GSW": {
          result: "❌",
          pick: "BOS −8.5",
          odds: "1.915",
          reasons: [
            ["GSW 近況差", "近 5 場 0 勝 5 敗，場均得 95.8、失 119.0（淨負 23.2），輸 28/22/21/38/7 分。"],
            ["BOS 防守", "防守每百 107.3（第 3），場均只失 103.0，近 10 場失 99.3。"],
            ["交手", "去年對戰 BOS 2 戰全勝（121:110、120:99），三季 4 勝 2 敗，平均 124.0:105.3。"]
          ],
          counter: "",
          en: {
            pick: "BOS −8.5",
            reasons: [
              ["GSW's poor form", "0-5 in the last 5, scoring 95.8 and allowing 119.0 (net −23.2); lost by 28/22/21/38/7."],
              ["BOS's defense", "107.3 allowed per 100 (3rd); only 103.0 allowed per game, 99.3 over the last 10."],
              ["Head-to-head", "BOS won both meetings last year (121:110, 120:99); 4-2 over three seasons, averaging 124.0:105.3."]
            ],
            counter: ""
          }
        }
      }
    },
    "2026-11-24": {
      games: {
        "POR@PHI": {
          result: "✅",
          pick: "PHI 小 117.5",
          odds: "1.89",
          reasons: [
            ["POR 防守好", "防守每百回合 111.2（聯盟第 8）。本季場均失 110.3，近 10 場失 110.9，近 5 場失 106.0。"],
            ["POR 近 5 場對手得分低", "97、114、106、106、107，沒有一場超過 114，5 場全在 117.5 以下。"],
            ["PHI 節奏慢", "PHI 近 5 場 PACE 97.8，低於聯盟平均 98.6。"]
          ],
          counter: "PHI 近 5 場得分是 132、121、135、131、123，沒有一場低於 121，更不用說 117.5。近 10 場場均 120.3，也高出 117.5 近 3 分。",
          en: {
            pick: "PHI Under 117.5",
            reasons: [
              ["POR defends well", "111.2 allowed per 100 possessions (8th in the league). Allowed per game: 110.3 this season, 110.9 over the last 10, 106.0 over the last 5."],
              ["POR's last 5 opponents scored little", "97, 114, 106, 106, 107: none above 114, all 5 below 117.5."],
              ["PHI's slow pace", "PHI's PACE over the last 5 is 97.8, below the league average of 98.6."]
            ],
            counter: "PHI's last 5 scores are 132, 121, 135, 131, 123: none below 121, let alone 117.5. Its 120.3 average over the last 10 is also nearly 3 points above 117.5."
          }
        },
        "CLE@CHI": {
          result: "✅",
          pick: "CHI +8.5",
          odds: "1.93",
          reasons: [
            ["淨值差小於讓分", "每百回合淨值差約 10（CLE +2.4、CHI −7.6），扣掉 CLE 客場約 2.5 分，約 7.5 分，小於 8.5。"],
            ["CLE 客場差", "CLE 客場 2-5（28.6%），近 10 場 5-5（淨勝只有 +1.5）。"],
            ["CLE 防守弱、CHI 得分高", "CLE 防守每百 116.2（第 20），近 5 場失 121.6。CHI 近 5 場場均得 121.6（含昨天的 145 分）。"]
          ],
          counter: "本季兩隊唯一一次交手（11/17），CLE 126 比 115 贏 11 分，已經超過 8.5。",
          en: {
            pick: "CHI +8.5",
            reasons: [
              ["Net rating gap is smaller than the spread", "The per-100 net rating gap is about 10 (CLE +2.4, CHI −7.6); take off about 2.5 for CLE playing on the road and it's about 7.5, less than 8.5."],
              ["CLE struggles on the road", "CLE is 2-5 on the road (28.6%) and 5-5 over the last 10 (net margin only +1.5)."],
              ["CLE's weak defense, CHI's scoring", "CLE allows 116.2 per 100 (20th) and gave up 121.6 over the last 5. CHI averaged 121.6 over the last 5 (including yesterday's 145)."]
            ],
            counter: "In their only meeting this season (11/17), CLE won 126-115, by 11, already more than 8.5."
          }
        },
        "LAC@HOU": {
          result: "❌",
          pick: "總分大 223.5",
          odds: "1.905",
          reasons: [
            ["HOU 進攻第一", "HOU ORTG 122.0（第 1），近 10 場得 116.5、近 5 場得 125.0。"],
            ["LAC 防守差", "LAC DRTG 118.0（第 25），近 10 場失 120.5、場均失 117.6。"],
            ["近 10 場總分高", "近 10 場場均總分 LAC 234.5、HOU 228.7，平均 231.6，高於 223.5。"]
          ],
          counter: "HOU 節奏聯盟倒數第 5 : 本季 96.9、近 10 場 95.9。",
          en: {
            pick: "Total Over 223.5",
            reasons: [
              ["HOU's No. 1 offense", "HOU ORTG 122.0 (1st); 116.5 points over the last 10, 125.0 over the last 5."],
              ["LAC's weak defense", "LAC DRTG 118.0 (25th); 120.5 allowed over the last 10, 117.6 per game."],
              ["High totals in the last 10", "Average total over the last 10: LAC 234.5, HOU 228.7, a combined average of 231.6, above 223.5."]
            ],
            counter: "HOU's pace is 5th from the bottom of the league: 96.9 this season, 95.9 over the last 10."
          }
        },
        "SAS@SAC": {
          result: "❌",
          pick: "SAC 小 105.5",
          odds: "1.905",
          reasons: [
            ["SAS 防守第 2", "SAS DRTG 106.7（第 2），場均只失 105.4，近 10 場失 103.3。"],
            ["SAC 進攻倒數", "SAC ORTG 107.4（第 29），場均只得 106.8，近 10 場得 105.3。"],
            ["SAC 主場差", "SAC 主場 1-9，近 5 場 1-4，只得 103.6 分。"]
          ],
          counter: "Wembanyama 出賽成疑，他的 +/- 是 +17.8。他缺陣的話，SAS 的防守（聯盟第 2）會變弱，SAC 比較容易超過 105.5。",
          en: {
            pick: "SAC Under 105.5",
            reasons: [
              ["SAS's No. 2 defense", "SAS DRTG 106.7 (2nd); only 105.4 allowed per game, 103.3 over the last 10."],
              ["SAC's bottom-tier offense", "SAC ORTG 107.4 (29th); only 106.8 points per game, 105.3 over the last 10."],
              ["SAC is poor at home", "SAC is 1-9 at home and 1-4 in the last 5, scoring only 103.6."]
            ],
            counter: "Wembanyama is questionable, and his +/- is +17.8. If he sits, SAS's defense (2nd in the league) gets weaker and SAC is more likely to top 105.5."
          }
        },
        "UTA@LAL": {
          result: "❌",
          pick: "UTA +13.5",
          odds: "1.966",
          reasons: [
            ["LAL 贏得不多", "LAL 近 5 場 4-1，淨勝只有 +2.6（115.0:112.4），五場分差 +2/−12/+4/+8/+11，沒有一場贏超過 13 分。"],
            ["UTA 近況", "UTA 近 5 場淨勝 +3.4（111.6:108.2）。"],
            ["交手", "11/19 UTA 才贏過 LAL（109:97，UTA 贏 12 分）。"]
          ],
          counter: "UTA 昨天主場 114 比 116 輸 DAL，今天背靠背打客場。",
          en: {
            pick: "UTA +13.5",
            reasons: [
              ["LAL doesn't win by much", "LAL is 4-1 in the last 5 with a net margin of just +2.6 (115.0:112.4). Margins: +2/−12/+4/+8/+11, no win by more than 13."],
              ["UTA's form", "UTA's net margin over the last 5 is +3.4 (111.6:108.2)."],
              ["Head-to-head", "UTA just beat LAL on 11/19 (109:97, a 12-point win)."]
            ],
            counter: "UTA lost 114-116 to DAL at home yesterday and plays on the road today on a back-to-back."
          }
        }
      }
    },
    "2026-11-25": {
      games: {
        "DET@ORL": {
          result: "✅",
          pick: "DET 不讓分",
          odds: "1.75",
          reasons: [
            ["攻守都比較強", "每百回合 DET 得 115.4（第 13）、失 110.5（第 5）；ORL 得 111.4（第 24）、失 115.6（第 17）。"],
            ["客場打得比對方主場好", "DET 客場 7 勝 3 敗（70%），ORL 主場 1 勝 5 敗（16.7%）。"],
            ["近 10 場得失分", "DET 115.5 : 112.6（+2.9），ORL 109.4 : 110.6（−1.2）。"]
          ],
          counter: "DET 近 5 場 2 勝 3 敗，108.6 : 110.2，最近兩場都輸；Duncan Robinson（場均 17.4 分，+7.6）缺陣。",
          en: {
            pick: "DET Moneyline",
            reasons: [
              ["Better on both ends", "Per 100 possessions, DET scores 115.4 (13th) and allows 110.5 (5th); ORL scores 111.4 (24th) and allows 115.6 (17th)."],
              ["Better on the road than the opponent is at home", "DET is 7-3 on the road (70%); ORL is 1-5 at home (16.7%)."],
              ["Scoring over the last 10", "DET 115.5 : 112.6 (+2.9), ORL 109.4 : 110.6 (−1.2)."]
            ],
            counter: "DET is 2-3 in the last 5 (108.6 : 110.2) and lost the last two; Duncan Robinson (17.4 points per game, +7.6) is out."
          }
        },
        "BOS@WAS": {
          result: "❌",
          pick: "WAS +10.5",
          odds: "1.885",
          reasons: [
            ["BOS 最近很少贏超過 10.5 分", "近 5 場只有一場（131 : 94），另外 4 場連輸，輸 1、1、4、10 分。"],
            ["WAS 近況", "3 連勝（98 : 94、103 : 99、116 : 96），近 5 場有 3 場沒有輸到 11 分以上。"],
            ["場地", "BOS 主場 6 勝 1 敗，客場只有 5 勝 5 敗，這場在 WAS 主場打。"]
          ],
          counter: "實力差很多 : 近 10 場 BOS 108.6 : 97.2（+11.4），WAS 111.5 : 120.5（−9.0）。近三季交手 BOS 11 勝 0 敗，平均贏 20.4 分。",
          en: {
            pick: "WAS +10.5",
            reasons: [
              ["BOS rarely wins by more than 10.5 lately", "Only once in the last 5 (131 : 94); the other 4 were straight losses, by 1, 1, 4 and 10."],
              ["WAS's form", "3 straight wins (98 : 94, 103 : 99, 116 : 96); in 3 of the last 5 they didn't lose by 11 or more."],
              ["Venue", "BOS is 6-1 at home but only 5-5 on the road, and this game is at WAS."]
            ],
            counter: "Huge talent gap: over the last 10, BOS 108.6 : 97.2 (+11.4), WAS 111.5 : 120.5 (−9.0). BOS is 11-0 against them over the last three seasons, winning by 20.4 on average."
          }
        },
        "DAL@DEN": {
          result: "✅",
          pick: "總分小 233.5",
          odds: "1.925",
          reasons: [
            ["平均得失分推出來比較低", "用整季得失分平均，兩隊合計約 228.6；用近 10 場約 229.4，都比 233.5 低 4 分以上。"],
            ["DAL 近 5 場總分", "230、210、210、225、244，有 4 場低於 233.5，平均 223.8。"],
            ["DEN 節奏慢", "本季 PACE 97.3，近 10 場也是 97.3，低於聯盟平均 98.5。DAL 本季是 98.8，近 10 場 98.4。"]
          ],
          counter: "DEN 攻擊強、防守差 : 每百回合得 118.6（第 5）、失 116.8（第 22）。近 5 場場均 122.0 分，兩隊合計平均 241.0（有一場是 11/23 延長賽的 296）。近三季交手平均合計 237.9，比 233.5 高。",
          en: {
            pick: "Total Under 233.5",
            reasons: [
              ["Scoring averages point lower", "Season scoring averages put the combined total around 228.6; the last 10 put it around 229.4. Both are more than 4 points below 233.5."],
              ["DAL totals, last 5", "230, 210, 210, 225, 244: 4 below 233.5, average 223.8."],
              ["DEN's slow pace", "PACE is 97.3 this season and also 97.3 over the last 10, below the league average of 98.5. DAL is 98.8 this season, 98.4 over the last 10."]
            ],
            counter: "DEN has a strong offense and a weak defense: 118.6 scored (5th) and 116.8 allowed (22nd) per 100. It averages 122.0 points over the last 5, with an average combined total of 241.0 (including the 296 in the 11/23 overtime game). Head-to-head totals over the last three seasons average 237.9, above 233.5."
          }
        }
      }
    },
    "2026-11-26": {
      games: {
        "MIA@PHI": {
          result: "❌",
          pick: "MIA +1.5",
          odds: "1.915",
          reasons: [
            ["近況好很多", "MIA 7 連勝，近 10 場 8 勝 2 敗、122.1 : 118.2（+3.9）；PHI 近 10 場 118.8 : 120.1（−1.3）。"],
            ["近 10 場有 8 場能過 +1.5", "只輸給湖人和勇士兩場。"],
            ["整季實力很接近", "每百回合淨值 PHI +1.8、MIA +1.2，網站預測也只差 0.6 分。"]
          ],
          counter: "MIA 最近 5 連勝全在主場，這場是客場；PHI 主場 7 勝 3 敗。",
          en: {
            pick: "MIA +1.5",
            reasons: [
              ["Much better form", "MIA has won 7 straight and is 8-2 over the last 10, 122.1 : 118.2 (+3.9); PHI is 118.8 : 120.1 (−1.3) over its last 10."],
              ["Would have covered +1.5 in 8 of the last 10", "The only two losses were to the Lakers and Warriors."],
              ["Evenly matched over the season", "Net rating per 100: PHI +1.8, MIA +1.2; the site's prediction also has them only 0.6 points apart."]
            ],
            counter: "MIA's last 5 straight wins all came at home, and this one is on the road; PHI is 7-3 at home."
          }
        },
        "CLE@NYK": {
          result: "✅",
          pick: "CLE 小 108.5",
          odds: "1.875",
          reasons: [
            ["NYK 防守", "每百回合失分 108.4（第 4），近 10 場有 9 場對手沒超過 108 分。"],
            ["節奏最慢", "NYK PACE 94.7，跟 BOS 並列聯盟最慢。"],
            ["NYK 會把對手壓到平均以下", "11 月有紀錄的 11 場，每一場的對手都低於自己的本季場均，平均少 13.3 分（BKN −21、MIL −25、POR −21、MIN −17）。CLE 本季場均 118.2，少 13.3 分就是約 104.9，低於 108.5。"]
          ],
          counter: "CLE 11 月 6 場客場只有 1 場在 108 分以下，對 NYK 的客場那場拿了 115 分。",
          en: {
            pick: "CLE Under 108.5",
            reasons: [
              ["NYK's defense", "108.4 allowed per 100 possessions (4th); in 9 of the last 10, the opponent didn't score more than 108."],
              ["Slowest pace", "NYK's PACE is 94.7, tied with BOS for the slowest in the league."],
              ["NYK holds opponents below their average", "In all 11 recorded November games, the opponent scored below its own season average, by 13.3 points on average (BKN −21, MIL −25, POR −21, MIN −17). CLE averages 118.2 this season; 13.3 fewer is about 104.9, below 108.5."]
            ],
            counter: "Only 1 of CLE's 6 road games in November ended with 108 points or fewer, and they scored 115 in the road game against NYK."
          }
        },
        "MIN@OKC": {
          result: "✅",
          pick: "MIN +1.5",
          odds: "1.93",
          reasons: [
            ["防守第一", "MIN 每百回合失分 104.9，聯盟第 1；OKC 得分 114.6，第 14。"],
            ["近況", "MIN 近 10 場 8 勝 2 敗，114.3 : 104.3（+10.0）；OKC 4 勝 6 敗，近 5 場 2 勝 3 敗。"],
            ["整季淨值", "每百回合 MIN +10.6、OKC +3.2，網站預測 MIN 贏 3.2 分。"]
          ],
          counter: "MIN 近 10 場有 8 場在主場，而 OKC 主場 6 勝 1 敗。DK 的不讓分也是看好 OKC。",
          en: {
            pick: "MIN +1.5",
            reasons: [
              ["No. 1 defense", "MIN allows 104.9 per 100 possessions, 1st in the league; OKC's offense is at 114.6, 14th."],
              ["Form", "MIN is 8-2 over the last 10, 114.3 : 104.3 (+10.0); OKC is 4-6, and 2-3 in the last 5."],
              ["Season net rating", "Per 100: MIN +10.6, OKC +3.2; the site predicts MIN by 3.2."]
            ],
            counter: "8 of MIN's last 10 games were at home, while OKC is 6-1 at home. DK's moneyline also favors OKC."
          }
        },
        "PHX@HOU": {
          result: "❌",
          pick: "PHX +9.5",
          odds: "1.881",
          reasons: [
            ["PHX 很少大輸", "近 10 場只有一場輸 10 分以上，8 勝 2 敗、115.1 : 109.4（+5.7）。"],
            ["HOU 不常大勝", "近 10 場只有 4 場贏 10 分以上，6 勝 4 敗。"],
            ["交手", "本季碰過一次，PHX 102 : 99 贏；網站預測 HOU 只贏 8.3 分。"]
          ],
          counter: "HOU 主場 8 勝 1 敗，每百回合得分 121.9 是聯盟第 1。",
          en: {
            pick: "PHX +9.5",
            reasons: [
              ["PHX rarely loses big", "Only one loss by 10 or more in the last 10; 8-2, 115.1 : 109.4 (+5.7)."],
              ["HOU doesn't often win big", "Only 4 wins by 10 or more in the last 10; 6-4."],
              ["Head-to-head", "They've met once this season, and PHX won 102 : 99; the site predicts HOU by only 8.3."]
            ],
            counter: "HOU is 8-1 at home, and its 121.9 points per 100 possessions is 1st in the league."
          }
        },
        "SAS@POR": {
          result: "❌",
          pick: "SAS −2.5",
          odds: "1.915",
          reasons: [
            ["客場沒輸過", "SAS 客場 8 勝 0 敗。"],
            ["近 10 場", "SAS 9 勝 1 敗，118.2 : 102.9（+15.3），9 場贏球都超過 2.5 分；POR 5 勝 5 敗（+3.2）。"],
            ["攻守都在前段", "每百回合得分 119.5（第 4）、失分 107.1（第 2）；本季在 POR 主場贏過 125 : 103。"]
          ],
          counter: "Wembanyama、Fox 都是 questionable，上面的數字含他們有打的比賽；網站預測 SAS 只贏 1.0 分，過不了 2.5。",
          en: {
            pick: "SAS −2.5",
            reasons: [
              ["Unbeaten on the road", "SAS is 8-0 on the road."],
              ["Last 10", "SAS is 9-1, 118.2 : 102.9 (+15.3), and all 9 wins were by more than 2.5; POR is 5-5 (+3.2)."],
              ["Top tier on both ends", "119.5 scored (4th) and 107.1 allowed (2nd) per 100; already won 125 : 103 at POR this season."]
            ],
            counter: "Wembanyama and Fox are both questionable, and the numbers above include games they played; the site predicts SAS by only 1.0, which wouldn't cover 2.5."
          }
        }
      }
    },
    "2026-11-28": {
      games: {
        "MIA@NYK": {
          result: "✅",
          pick: "MIA 不讓分",
          odds: "2.379",
          reasons: [
            ["近況", "MIA 近 10 場 8-2，近 5 場 4-1，場均 125.8 分。"],
            ["進攻", "MIA 進攻效率 117.6，排第 7；場均得 119.7 分，比 NYK 的 109.6 多 10 分。"],
            ["盃賽形勢", "MIA 只要贏，就是組第一或外卡人選，這場一定全力拚。"]
          ],
          counter: "NYK 目前 6 連勝，近 5 場 5-0，主場 7-3。防守排第 4，近 5 場平均只失 101 分。",
          en: {
            pick: "MIA Moneyline",
            reasons: [
              ["Form", "MIA is 8-2 over the last 10 and 4-1 over the last 5, averaging 125.8 points."],
              ["Offense", "MIA's offensive rating is 117.6, 7th; it scores 119.7 per game, 10 more than NYK's 109.6."],
              ["NBA Cup stakes", "A win makes MIA the group winner or a wild-card candidate, so they'll go all out."]
            ],
            counter: "NYK has won 6 straight, is 5-0 over the last 5 and 7-3 at home. Its defense ranks 4th, allowing only 101 on average over the last 5."
          }
        },
        "PHI@IND": {
          result: "❌",
          pick: "總分大 229.5",
          odds: "1.886",
          reasons: [
            ["PHI 近 10 場總分高", "PHI 近 10 場平均得 118.7、失 119.9，總分 238.6，比盤口高 9 分。"],
            ["PHI 近 5 場總分", "258、237、261、239、215，有 4 場超過 229.5。"],
            ["IND 節奏快、失分多", "IND 節奏 100.5，排第 4；近 5 場平均失 122.2 分。"]
          ],
          counter: "看整季，PHI 場均總分 228.0（115.1 + 112.9），IND 是 228.1，兩隊都略低於 229.5。",
          en: {
            pick: "Total Over 229.5",
            reasons: [
              ["PHI's high totals over the last 10", "PHI averaged 118.7 scored and 119.9 allowed over the last 10, a total of 238.6, 9 points above the line."],
              ["PHI totals, last 5", "258, 237, 261, 239, 215: 4 above 229.5."],
              ["IND plays fast and gives up a lot", "IND's pace is 100.5, 4th; it allowed 122.2 on average over the last 5."]
            ],
            counter: "Over the full season, PHI's games average 228.0 total points (115.1 + 112.9) and IND's 228.1, both slightly below 229.5."
          }
        },
        "ATL@BOS": {
          result: "✅",
          pick: "ATL +8.5",
          odds: "1.93",
          reasons: [
            ["ATL 近況", "ATL 近 10 場 8-2，目前 4 連勝，客場 6-3。"],
            ["防守對比", "ATL 防守排第 6，近 5 場平均只失 107.4 分。BOS 近 5 場 1-4，只得 104 分。"],
            ["盃賽形勢", "ATL 贏就拿組第一、輸就出局，是生死戰。BOS 就算輸，也幾乎確定拿外卡。"]
          ],
          counter: "BOS 主場 6-1，防守排第 2，平均只失 102.9 分。",
          en: {
            pick: "ATL +8.5",
            reasons: [
              ["ATL's form", "ATL is 8-2 over the last 10, has won 4 straight, and is 6-3 on the road."],
              ["Defense comparison", "ATL's defense ranks 6th, allowing only 107.4 on average over the last 5. BOS is 1-4 over its last 5, scoring only 104."],
              ["NBA Cup stakes", "Do or die for ATL: win and take the group, lose and they're out. Even with a loss, BOS is all but certain to get the wild card."]
            ],
            counter: "BOS is 6-1 at home with the 2nd-ranked defense, allowing only 102.9 on average."
          }
        },
        "LAL@SAS": {
          result: "✅",
          pick: "總分小 226.5",
          odds: "1.895",
          reasons: [
            ["SAS 防守", "SAS 防守排第 3，近 10 場平均只失 103.6 分。"],
            ["SAS 比賽總分低", "SAS 近 10 場總分平均 220.5（116.9 + 103.6），整季 223.3，都低於 226.5。"],
            ["節奏慢", "兩隊近 10 場節奏 SAS 97.1、LAL 97.5。LAL 近 5 場有 3 場總分不到 211（206、210、203）。"]
          ],
          counter: "LAL 進攻排第 3，整季場均總分 232.1（119.4 + 112.7），比盤口高 5.6 分。",
          en: {
            pick: "Total Under 226.5",
            reasons: [
              ["SAS's defense", "SAS's defense ranks 3rd, allowing only 103.6 on average over the last 10."],
              ["Low totals in SAS games", "SAS's totals average 220.5 over the last 10 (116.9 + 103.6) and 223.3 for the season, both below 226.5."],
              ["Slow pace", "Pace over the last 10: SAS 97.1, LAL 97.5. 3 of LAL's last 5 had totals under 211 (206, 210, 203)."]
            ],
            counter: "LAL's offense ranks 3rd; its season average total is 232.1 (119.4 + 112.7), 5.6 above the line."
          }
        },
        "GSW@POR": {
          result: "✅",
          pick: "POR −9.5",
          odds: "1.915",
          reasons: [
            ["GSW 客場差", "GSW 客場 2-7。最近三個客場分別輸 21、22、28 分（94-115、94-116、98-126）。"],
            ["GSW 近況", "GSW 近 5 場平均得 100.6、失 110.8。"],
            ["POR 防守", "POR 防守排第 7，場均失 110.4。今天 Curry 確定缺陣。"]
          ],
          counter: "GSW 剛主場連贏兩場（88-87 贏 BOS、129-110 贏 SAC）；POR 主場只有 4-2，近 10 場 6-4。",
          en: {
            pick: "POR −9.5",
            reasons: [
              ["GSW struggles on the road", "GSW is 2-7 on the road, losing the last three road games by 21, 22 and 28 (94-115, 94-116, 98-126)."],
              ["GSW's form", "Over the last 5, GSW averaged 100.6 scored and 110.8 allowed."],
              ["POR's defense", "POR's defense ranks 7th, allowing 110.4 per game. Curry is ruled out today."]
            ],
            counter: "GSW just won two straight at home (88-87 over BOS, 129-110 over SAC); POR is only 4-2 at home and 6-4 over the last 10."
          }
        }
      }
    },
    "2026-11-29": {
      games: {
        "ORL@WAS": {
          result: "",
          pick: "WSH +3.5",
          odds: "1.977",
          reasons: [
            ["交手", "11/23 WSH 主場贏 ORL 116-96，贏了 20 分。"],
            ["ORL 進攻差", "ORL 整季場均只得 107.4 分，近 5 場更低，只有 105.2，進攻效率排第 26。這場 Banchero 確定缺陣。"],
            ["近 5 場淨勝分", "WSH 是 −0.6（110.6:111.2），ORL 是 −6.2（105.2:111.4）。"]
          ],
          counter: "ORL 客場 6-4；WSH 主場只有 3-6，近 10 場 3-7，場均失 119.7 分。",
          en: {
            pick: "WSH +3.5",
            reasons: [
              ["Head-to-head", "On 11/23, WSH beat ORL 116-96 at home, a 20-point win."],
              ["ORL's weak offense", "ORL averages only 107.4 points this season and even less over the last 5, just 105.2; its offensive rating ranks 26th. Banchero is ruled out for this game."],
              ["Net margin, last 5", "WSH is at −0.6 (110.6:111.2), ORL at −6.2 (105.2:111.4)."]
            ],
            counter: "ORL is 6-4 on the road; WSH is only 3-6 at home and 3-7 over the last 10, allowing 119.7 per game."
          }
        },
        "BKN@CHA": {
          result: "",
          pick: "總分大 212.5",
          odds: "1.945",
          reasons: [
            ["BKN 防守差", "BKN 防守排第 29，近 10 場場均失 124.2 分，近 5 場失 122.6 分。"],
            ["BKN 比賽總分高", "BKN 比賽整季場均總分 229.4，近 10 場 237.2，都比盤口高很多。"],
            ["近 5 場總分", "過 212.5 的場次 BKN 4 場（244、224、258、224），CHA 3 場（218、232、228）。"]
          ],
          counter: "CHA 節奏 94.6，全聯盟最慢，近 10 場更慢，只有 94.1。整季場均只得 100.9 分，進攻效率排第 30。",
          en: {
            pick: "Total Over 212.5",
            reasons: [
              ["BKN's weak defense", "BKN's defense ranks 29th; it allowed 124.2 per game over the last 10 and 122.6 over the last 5."],
              ["High totals in BKN games", "BKN's games average 229.4 total points this season and 237.2 over the last 10, both well above the line."],
              ["Totals, last 5", "Games over 212.5: 4 for BKN (244, 224, 258, 224), 3 for CHA (218, 232, 228)."]
            ],
            counter: "CHA's pace is 94.6, slowest in the league, and even slower over the last 10 at just 94.1. It scores only 100.9 per game, with the 30th-ranked offensive rating."
          }
        },
        "IND@CHI": {
          result: "",
          pick: "CHI 大 118.5",
          odds: "1.905",
          reasons: [
            ["節奏快", "CHI 排第 2（101.5），IND 排第 4（100.5）。"],
            ["CHI 近期得分", "CHI 近 10 場場均得 120.2 分，近 5 場 121 分。"],
            ["IND 失分多＋背靠背", "IND 近 5 場場均失 118.2 分，今天又是背靠背。三季回測裡，對手背靠背時大約多得 1.2 分。"]
          ],
          counter: "CHI 整季場均只有 116.4 分，而且 Powell、C. Wilson 確定缺陣。網站上的 CHI 數據還包含他們兩人有上場的比賽。",
          en: {
            pick: "CHI Over 118.5",
            reasons: [
              ["Fast pace", "CHI ranks 2nd (101.5), IND 4th (100.5)."],
              ["CHI's recent scoring", "CHI averaged 120.2 points over the last 10 and 121 over the last 5."],
              ["IND gives up points + back-to-back", "IND allowed 118.2 per game over the last 5 and is on a back-to-back today. In a three-season backtest, teams scored about 1.2 more points when the opponent was on a back-to-back."]
            ],
            counter: "CHI averages only 116.4 this season, and Powell and C. Wilson are ruled out. The site's CHI numbers still include games the two of them played."
          }
        },
        "OKC@MIL": {
          result: "",
          pick: "MIL +11.5",
          odds: "1.93",
          reasons: [
            ["OKC 近況差", "OKC 近 5 場 1-4，目前 3 連敗，客場 4-7。"],
            ["OKC 贏不多", "OKC 近 5 場只贏過一場，而且只贏 6 分，沒有一場贏超過 11.5。這場 Holmgren、Jalen Williams、Mara 都確定缺陣。"],
            ["MIL 輸得不多", "MIL 近 5 場分差是 −10、−3、+5、−7、−15，有 4 場在 11.5 分以內。"]
          ],
          counter: "MIL 2-18，主場 1-9，近 10 場 1-9，防守排第 28，場均失 119.8 分。",
          en: {
            pick: "MIL +11.5",
            reasons: [
              ["OKC's poor form", "OKC is 1-4 over the last 5, has lost 3 straight, and is 4-7 on the road."],
              ["OKC isn't winning by much", "OKC won only once in the last 5, by just 6, with no win by more than 11.5. Holmgren, Jalen Williams and Mara are all ruled out for this game."],
              ["MIL isn't losing by much", "MIL's last 5 margins are −10, −3, +5, −7, −15: 4 of them within 11.5."]
            ],
            counter: "MIL is 2-18, 1-9 at home and 1-9 over the last 10, with the 28th-ranked defense, allowing 119.8 per game."
          }
        },
        "PHI@HOU": {
          result: "",
          pick: "HOU 大 116.5",
          odds: "1.875",
          reasons: [
            ["HOU 進攻第一", "HOU 進攻效率 121.9，全聯盟第 1。整季場均 118 分、近 10 場 118.1、近 5 場 117，都高於 116.5。"],
            ["PHI 背靠背", "PHI 昨天才打完 IND，今天背靠背。"],
            ["PHI 缺三主力", "PHI 這場 Embiid、LeBron、Jaylen Brown 都確定缺陣，近 10 場場均已經失 116.7 分。"]
          ],
          counter: "HOU 節奏 96.8，排第 25，近 10 場更慢，只有 96.3。近 5 場只有 2 場超過 116.5，最近兩個主場都剛好 116 分。",
          en: {
            pick: "HOU Over 116.5",
            reasons: [
              ["HOU's No. 1 offense", "HOU's offensive rating is 121.9, 1st in the league. It averages 118 points this season, 118.1 over the last 10 and 117 over the last 5, all above 116.5."],
              ["PHI on a back-to-back", "PHI played IND just yesterday, so today is a back-to-back."],
              ["PHI missing three starters", "Embiid, LeBron and Jaylen Brown are all ruled out for PHI, which already allowed 116.7 per game over the last 10."]
            ],
            counter: "HOU's pace is 96.8, 25th, and slower over the last 10 at just 96.3. Only 2 of the last 5 went over 116.5, and it scored exactly 116 in each of the last two home games."
          }
        }
      }
    }
  }
};
