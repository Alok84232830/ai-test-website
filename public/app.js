const $ = s => document.querySelector(s);
const screens = ['setupScreen','loadingScreen','adScreen','testScreen','resultScreen'];
let currentTest = null;
let answers = {};
let currentIndex = 0;
let timerInterval = null;
let secondsLeft = 0;
let submitting = false;
let serviceStatus = {};

function showScreen(id){
  screens.forEach(s => $(`#${s}`).classList.toggle('active', s === id));
  window.scrollTo({top:0,behavior:'instant'});
}
function toast(msg){
  const el=$('#toast'); el.textContent=msg; el.classList.add('show');
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),2800);
}
function esc(str){return String(str).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

async function status(){
  try{
    const r=await fetch('/api/status'); const d=await r.json();
    serviceStatus=d;
    const badge=$('#aiBadge');
    badge.textContent=d.aiConfigured ? `AI • ${d.model}` : 'Demo mode • add API key';
    badge.classList.toggle('demo',!d.aiConfigured);
  }catch{}
}

function getShareUrl(){
  if(!currentTest?.testId)return location.origin;
  return `${location.origin}/?test=${encodeURIComponent(currentTest.testId)}`;
}

async function shareCurrentTest(){
  if(!currentTest)return toast('Generate or open a test first.');
  const url=getShareUrl();
  const title=currentTest.title || 'AI Generated Test';
  const text=`Take this ${currentTest.settings.count}-question test: ${title}`;
  try{
    if(navigator.share){
      await navigator.share({title,text,url});
    }else if(navigator.clipboard){
      await navigator.clipboard.writeText(url);
      toast('Test link copied. Share it with students.');
    }else{
      prompt('Copy this test link:',url);
    }
  }catch(err){
    if(err?.name!=='AbortError')toast('Could not share. Please copy the link manually.');
  }
}

function renderPretestAd(){
  const host=$('#pretestAdSlot');
  const placeholder=$('.ad-placeholder');
  if(!serviceStatus.adsenseClient || !serviceStatus.pretestAdSlot){
    if(host)host.hidden=true;
    if(placeholder)placeholder.classList.remove('has-live-ad');
    return;
  }
  if(host && !host.dataset.loaded){
    host.hidden=false;
    host.dataset.loaded='1';
    host.innerHTML=`<ins class="adsbygoogle" style="display:block" data-ad-client="${esc(serviceStatus.adsenseClient)}" data-ad-slot="${esc(serviceStatus.pretestAdSlot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    try{(window.adsbygoogle=window.adsbygoogle||[]).push({});}catch{}
    $('#adStatusText').textContent='Advertisement';
    placeholder.classList.add('has-live-ad');
  }
}

async function loadSharedTestFromUrl(){
  const id=new URLSearchParams(location.search).get('test');
  if(!id)return;
  showScreen('loadingScreen');
  $('#loadingNote').textContent='Loading the shared test…';
  try{
    const r=await fetch(`/api/test/${encodeURIComponent(id)}`);
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Could not load shared test.');
    currentTest=d; answers={}; currentIndex=0;
    $('#readyTitle').textContent=`${d.settings.count} questions • ${d.settings.minutes} min • ${d.settings.topic}`;
    showReadyScreen();
  }catch(err){
    history.replaceState({},'',location.pathname);
    showScreen('setupScreen'); toast(err.message);
  }
}

async function init(){
  await status();
  await loadSharedTestFromUrl();
}
init();

$('.presets').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  $('#marks').value=b.dataset.marks; $('#negative').value=b.dataset.negative;
});

$('#generatorForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const count=Math.max(5,Math.min(50,Number($('#count').value)||20));
  $('#count').value=count;
  const payload={
    topic:$('#topic').value.trim(), exam:$('#exam').value.trim(), count,
    minutes:Number($('#minutes').value), difficulty:$('#difficulty').value,
    language:$('#language').value, marks:Number($('#marks').value), negative:Number($('#negative').value)
  };
  if(!payload.topic)return toast('Please enter a topic.');
  showScreen('loadingScreen');
  $('#loadingNote').textContent='Checking concepts, distractors and answer positions.';
  try{
    const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Generation failed');
    currentTest=d; answers={}; currentIndex=0;
    history.replaceState({},'',`/?test=${encodeURIComponent(d.testId)}`);
    $('#readyTitle').textContent=`${d.settings.count} questions • ${d.settings.minutes} min • ${d.settings.topic}`;
    showReadyScreen();
    if(!d.persistent)toast('Test works now. Add Supabase before launch for permanent share links.');
  }catch(err){
    showScreen('setupScreen'); toast(err.message);
  }
});

function showReadyScreen(){
  showScreen('adScreen');
  $('#startTestBtn').disabled=false;
  $('#startTestBtn').textContent='Start Test →';
  renderPretestAd();
}

$('#shareReadyBtn').addEventListener('click',shareCurrentTest);
$('#shareResultBtn').addEventListener('click',shareCurrentTest);

$('#startTestBtn').addEventListener('click',()=>{
  if(!currentTest)return;
  showScreen('testScreen');
  $('#testTitle').textContent=currentTest.title;
  $('#testTopicLabel').textContent=currentTest.settings.exam || 'AI GENERATED TEST';
  secondsLeft=currentTest.settings.minutes*60;
  renderPalette(); renderQuestion(); startTimer();
});

function startTimer(){
  clearInterval(timerInterval); updateTimer();
  timerInterval=setInterval(()=>{
    secondsLeft--; updateTimer();
    if(secondsLeft<=0){clearInterval(timerInterval);toast('Time is over. Submitting test…');submitTest(true);}
  },1000);
}
function updateTimer(){
  const m=Math.floor(Math.max(0,secondsLeft)/60),s=Math.max(0,secondsLeft)%60;
  $('#timer').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  $('#timer').style.background=secondsLeft<=60?'#b42318':'#111827';
}

function renderPalette(){
  const p=$('#palette'); p.innerHTML='';
  currentTest.questions.forEach((q,i)=>{
    const b=document.createElement('button'); b.textContent=i+1;
    if(i===currentIndex)b.classList.add('current');
    if(Number.isInteger(answers[i]))b.classList.add('answered');
    b.onclick=()=>{currentIndex=i;renderQuestion();renderPalette();}; p.appendChild(b);
  });
  const answered=Object.keys(answers).filter(k=>Number.isInteger(answers[k])).length;
  $('#answeredCount').textContent=answered;
  $('#remainingCount').textContent=currentTest.questions.length-answered;
}
function renderQuestion(){
  const q=currentTest.questions[currentIndex], total=currentTest.questions.length;
  $('#questionNo').textContent=`Question ${currentIndex+1} of ${total}`;
  $('#questionText').textContent=q.question;
  $('#progressBar').style.width=`${((currentIndex+1)/total)*100}%`;
  const o=$('#options');o.innerHTML='';
  q.options.forEach((text,i)=>{
    const b=document.createElement('button');b.className='option'+(answers[currentIndex]===i?' selected':'');
    b.innerHTML=`<span class="option-key">${String.fromCharCode(65+i)}</span><span class="option-text">${esc(text)}</span>`;
    b.onclick=()=>{answers[currentIndex]=i;renderQuestion();renderPalette();};o.appendChild(b);
  });
  $('#prevBtn').disabled=currentIndex===0;
  $('#nextBtn').textContent=currentIndex===total-1?'Review →':'Next →';
}
$('#prevBtn').onclick=()=>{if(currentIndex>0){currentIndex--;renderQuestion();renderPalette();}};
$('#nextBtn').onclick=()=>{if(currentIndex<currentTest.questions.length-1){currentIndex++;renderQuestion();renderPalette();}else toast('You are on the last question. Submit when ready.');};
$('#clearAnswer').onclick=()=>{delete answers[currentIndex];renderQuestion();renderPalette();};
$('#submitBtn').onclick=()=>{
  const rem=currentTest.questions.length-Object.keys(answers).length;
  if(confirm(rem?`${rem} question(s) are unattempted. Submit test?`:'Submit your test now?'))submitTest(false);
};

async function submitTest(auto=false){
  if(submitting||!currentTest)return; submitting=true; clearInterval(timerInterval);
  try{
    const normalized={}; Object.entries(answers).forEach(([k,v])=>normalized[k]=v);
    const r=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({testId:currentTest.testId,answers:normalized})});
    const d=await r.json(); if(!r.ok)throw new Error(d.error||'Submission failed');
    renderResults(d); showScreen('resultScreen');
  }catch(err){ toast(err.message); if(!auto)startTimer(); }
  finally{submitting=false;}
}

function renderResults(d){
  $('#scorePercent').textContent=`${d.percentage}%`;
  $('#scoreValue').textContent=d.score;
  $('#maxScore').textContent=`/ ${d.maxScore} marks`;
  $('.score-ring').style.background=`conic-gradient(var(--accent) ${Math.max(0,Math.min(100,d.percentage))*3.6}deg,#eee 0deg)`;
  $('#metrics').innerHTML=`
    <div class="metric"><span>Correct</span><strong>${d.correct}</strong></div>
    <div class="metric"><span>Wrong</span><strong>${d.wrong}</strong></div>
    <div class="metric"><span>Unattempted</span><strong>${d.unattempted}</strong></div>
    <div class="metric"><span>Negative Marks</span><strong>${(d.wrong*d.settings.negative).toFixed(2)}</strong></div>`;
  $('#reviewList').innerHTML=d.review.map((r,i)=>{
    const cls=r.isUnattempted?'skip':r.isCorrect?'good':'bad';
    const selected=r.selectedIndex===null?'Not attempted':`${String.fromCharCode(65+r.selectedIndex)}. ${esc(r.options[r.selectedIndex])}`;
    const correct=`${String.fromCharCode(65+r.correctIndex)}. ${esc(r.options[r.correctIndex])}`;
    return `<article class="review-item ${cls}">
      <div class="review-q">Q${i+1}. ${esc(r.question)}</div>
      <div class="review-lines"><span><b>Your answer:</b> ${selected}</span><span><b>Correct answer:</b> ${correct}</span></div>
      <div class="explanation"><b>Explanation:</b> ${esc(r.explanation)}</div>
    </article>`;
  }).join('');
}

function reset(){
  clearInterval(timerInterval);currentTest=null;answers={};currentIndex=0;
  history.replaceState({},'',location.pathname);
  showScreen('setupScreen');
}
$('#newTestBtn').onclick=reset;$('#newTestTop').onclick=reset;
