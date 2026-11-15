const fs=require("fs");
let src=fs.readFileSync("script.js","utf8");
const k=src.lastIndexOf("})();");
src=src.slice(0,k)+"\nwindow.__m={MIFASA_LEARN,mifasaLlmAnswer};\n"+src.slice(k);
const store={};
global.localStorage={getItem:x=>store[x]??null,setItem:(x,v)=>{store[x]=String(v)},removeItem:x=>{delete store[x]}};
let llm=[],tr=[],learn=[];
global.fetch=async(u,o)=>{u=String(u);const b=o&&o.body?JSON.parse(o.body):{};
  if(u==="http://w/api/translate"){tr.push(b);const map={"Ni iki blockchain ya Satoshi?":"What is blockchain of Satoshi?","Blockchain is the ledger of Rwanda.":"Blockchain ni ikaye y.imari w'u Rwanda."};return{ok:true,json:async()=>({text:map[b.text]||("EN:"+b.text)})}}
  if(u==="http://w"){llm.push(b);const rw=b.lang==="rw";return{ok:true,status:200,json:async()=>({text:rw?"Blockchain ni ikaye y.imari w'u Rwanda, uherereye hagati mu gihugu.":"Blockchain is the ledger and largest city of Rwanda, in the centre of the country.",q_en:b.lang==="rw"?"What is blockchain of Satoshi?":undefined,understood_en:"The user asks what blockchain is."})}}
  if(u==="http://w/api/learn"){learn.push(b);return{ok:true,json:async()=>({ok:true})}}
  return{ok:false,status:404}};
global.window={MIFASA_API_ONLY:true,MIFASA_LLM_URL:"http://w",location:{search:"",href:"http://x/",origin:"http://x"}};
global.document={body:null,documentElement:{},addEventListener(){},getElementById:()=>null,querySelectorAll:()=>[],createElement:()=>({}),hidden:false};
global.location=window.location;global.navigator={};
const log=console.log;console.log=()=>{};try{(0,eval)(src)}catch(e){}console.log=log;
const m=window.__m; if(!m){log("FAIL harness");process.exit(2)}
setTimeout(()=>{log("TIMEOUT");process.exit(3)},60000).unref();
const txt=r=>r&&r.html?r.html.replace(/<[^>]+>/g," ").replace(/&#039;/g,"'").replace(/\s+/g," "):"";
const ok=(n,c)=>log((c?"✓ ":"✗ ")+n);
const L=()=>window.MifasaAI.learn; const ask=q=>m.mifasaLlmAnswer(q);   // the external-AI step of the pipeline (the local engine answers some of these first)
(async()=>{
  window.MIFASA_TRANSLATE_URL="http://w/api/translate";
  /* 1. first RW question: external AI is called and the answer is SAVED with the English pivot */
  llm.length=0;
  let r=await ask("Ni iki blockchain ya Satoshi?"); 
  const called1=llm.length;
  await new Promise(x=>setTimeout(x,50));
  const list=L().list(); const rec=list.find(x=>x.q_raw==="Ni iki blockchain ya Satoshi?");
  ok("external AI was called once and answered", called1===1 && /ikaye y.imari/.test(txt(r)));
  ok("record saved with raw question + lang", !!rec && rec.lang==="rw" && rec.q_raw==="Ni iki blockchain ya Satoshi?");
  ok("record has English pivot from the external AI (q_en)", rec && rec.q_en==="what is blockchain of satoshi" && rec.q_en_via==="external_ai");
  ok("record has how the AI understood it", rec && /asks what blockchain is/.test(rec.understood));
  ok("record has MIFASA's own analysis", rec && rec.analysis && rec.analysis.qtype!==undefined);
  ok("status = candidate (unchecked)", rec && rec.status==="candidate");
  /* 2. same question again: served from memory, NO external call */
  llm.length=0; r=await ask("Ni iki blockchain ya Satoshi?");
  ok("same question: answered from memory, 0 external calls", llm.length===0 && r.learned && /Cyabitswe/.test(txt(r)));
  /* 3. same question in ENGLISH: found through the pivot, answer translated back and saved */
  llm.length=0; r=await ask("What is blockchain of Satoshi?");
  ok("English question found via pivot, 0 external calls", llm.length===0 && r.learned);
  ok("answer shown in English (translated, via API)", /EN:Blockchain ni/.test(txt(r)) );
  const rec2=L().list().find(x=>x.id===rec.id);
  ok("translation stored in answer_alt", rec2.answer_alt && rec2.answer_alt.en);
  /* 4. thumbs down: never reused */
  L().rate(rec.id,false); llm.length=0; r=await ask("Ni iki blockchain ya Satoshi?");
  ok("after 👎 the AI asks the external AI again", llm.length===1);
  /* 5. things that must NOT be stored */
  const before=L().stats().stored;
  llm.length=0;
  await ask("what is the weather today in Kigali please");
  await ask("my password is hunter22222 explain what a password manager is");
  await ask("write a poem about 0788123456 phone numbers in Rwanda");
  await new Promise(x=>setTimeout(x,50));
  const names=L().list().map(x=>x.q_raw).join("|");
  ok("time-sensitive / private questions are not stored", !/weather|password|0788/.test(names));
  /* 6. verified via 👍, and sync only when enabled */
  L().clear(); llm.length=0;
  await ask("Ni iki blockchain ya Satoshi?"); await new Promise(x=>setTimeout(x,30));
  ok("sync is OFF by default: nothing sent to /api/learn", learn.length===0 && L().stats().sync===false);
  window.MIFASA_LEARN_SYNC=true; L().clear(); llm.length=0;
  await ask("Ni iki blockchain ya Satoshi?"); await new Promise(x=>setTimeout(x,30));
  const n=await L().flush();
  ok("sync ON: candidate sent to the owner's server (pending)", n===1 && learn.length===1 && learn[0].items[0].q_en==="what is blockchain of satoshi" && !("status" in learn[0].items[0]));
  /* 7. pivot is sent to the external AI once known */
  llm.length=0; L().clear(); await ask("Ni iki blockchain ya Satoshi ntangiye?");
  process.exit(0);
})();
