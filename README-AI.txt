MIFASA: HUB + GOAL MENTOR + LEARNING LOOP (icyiciro cya 3, verisiyo 3)
======================================================================
NEW in v3: URUZIGA RWO KWIGA (part 295 + worker-learn/)
  Buri gisubizo AI yo hanze itanze kibikwa, kugira ngo MIFASA irusheho kwihagararaho:
    q_raw        ibyo umukoresha yanditse (ibibazo by'ibanga ntibibikwa)
    lang         ururimi (rw/en)
    q_norm       ikibazo cyoroheje (spelling fixed)
    q_en/key_en  ikibazo mu CYONGEREZA (pivot): kiva kuri AI yo hanze (q_en), cyangwa translator, cyangwa dictionary (rough)
    understood   uko AI yo hanze yacyumvise (understood_en) + isesengura rya MIFASA ubwayo
    answer       igisubizo + answer_lang (+ answer_alt: ubundi buryo mu rundi rurimi)
    status       candidate -> verified (👍) -> approved (nyiri MIFASA yemeje kuri seriveri) | rejected (👎)
  Mbere yo guhamagara AI yo hanze, MIFASA ibanza gushakira mu byabitswe (ururimi rumwe CYANGWA hakoreshejwe pivot y'Icyongereza):
  ikibazo cyabajijwe mu Kinyarwanda gisubizwa no iyo kibajijwe nyuma mu Cyongereza. Ibi bisigaho quota ya AI yo hanze.
  Ntibibikwa / ntibyongera gukoreshwa: amakuru y'ubu (news, ibiciro, ikirere, "uyu munsi"), ibibazo bikurikira ibindi,
  ibibazo by'ibanga (ijambo ry'ibanga, nimero, email...), ibya safety, gahunda y'umuntu ku giti cye (mentor).
  Ibisubizo bitaragenzurwa (candidate) bisubirwamo gusa iyo ikibazo gihuye hafi 100% kandi bitarengeje iminsi 180.
  👎 ihagarika igisubizo burundu.

  SEKIRIZA (zimya ku buryo budasanzwe): ibisubizo ntibyoherezwa kuri seriveri keretse window.MIFASA_LEARN_SYNC = true.
  Iyo bishyizwe, bijya "pending" kuri Worker yawe; ABANDI BANTU BABIBONA GUSA nyuma y'uko UWEMEJE (approve).
  Umushyitsi ntashobora gusimbuza igisubizo cyemejwe (byageragejwe).

  Uko ubishyiraho:
   1. wrangler d1 create mifasa-learn ; shyira binding "DB" muri wrangler.toml ; wrangler d1 execute mifasa-learn --file=worker-learn/schema.sql
   2. wrangler secret put OWNER_TOKEN        (ijambo ryawe ry'ibanga; ntirijya muri script.js)
   3. muri Worker yawe: import { handleLearn, splitMeta } from "./learn.js";  na mu ntangiriro ya fetch():
         const l = await handleLearn(request, env); if (l) return l;
   4. (UBUNTU, byiza cyane) ongera mu system prompt ya LLM yawe interuro iri hejuru ya splitMeta muri learn.js,
      hanyuma usubize { text, q_en, understood_en, ... } -> uko ni ko ubona UBUHINDUZI n'ISESENGURA mu ikoreshwa rimwe rya LLM, nta mafaranga yiyongera.
   5. window.MIFASA_LEARN_SYNC = true muri paji yawe (niba ushaka ko ibisubizo bijya kuri seriveri).
   6. Gusuzuma ibyabitswe: curl -H "Authorization: Bearer <OWNER_TOKEN>" https://<worker>/api/learn/pending
      Kwemeza: POST /api/learn/review {"id":"...","action":"approve","answer":"(wakosora)","answer_other":"(ubuhindurwa)"}
      Ibyemejwe bimanurwa na buri browser kuri /api/learned/export (buri masaha 6) bigahinduka ubumenyi bwa MIFASA.
  Ubuhindura (translator): /api/translate ni "slot" (isubiza 501 kugeza uyujuje). Cloudflare M2M100 ntabwo nashoboye kwemeza ko ishyigikira
  Kinyarwanda: gerageza interuro 10 mbere yo kuyiringira. Uburyo bwiza ni (4) hejuru, cyangwa LLM yawe isanzwe.

  Console:  MifasaAI.learn.stats()  .list()  .export()  .import(list)  .rate(id,true|false)  .clear()

IBYABANJE (v2): HUB (parts 280, 285): AI isoma inkuru zose + deep search mu nyandiko zuzuye; GOAL MENTOR (part 290); crawl.js inyandiko zuzuye 80/isaha.

KUBISHYIRAMO (mifasa-dev):
  1. Simbuza build.js (yongeyeho 285, 290, 295)
  2. Shyiramo hub-part/ (280, 285, 290, 295) na apply-hub-ai.js
  3. node apply-hub.js        (niba utarayikoze)
  4. node apply-hub-ai.js     (ishyira parts/, ikongeraho hooks 7, ikubaka script.js)
  5. Simbuza crawl.js muri repo ya GitHub, shyira script.js kuri mifasarw.neocities.org
Utakoresha parts/: script.js yo muri zip yamaze gukosorwa.
Ibizamini: node test-hub-ai.js ; node test-learn.js ; (worker-learn) node --no-warnings test-worker.mjs  (Node 22+)
