/* 공개 과제용 공유 아이디. 로컬 계정 서버를 이용할 때는 기존 비밀번호 로그인을 유지합니다. */
(() => {
 if(typeof accountServerEnabled!=='undefined' && accountServerEnabled)return;
 const config=FP.cloudConfig;
 if(!config?.url||!config?.publishableKey)return;
 FP.cloudMode=true;
 FP.cloudError='';
 const activeKey='fanplay-demo-active-id-v1';
 const previousKey='fanplay-demo-last-id-v1';
 FP.activeDemoId=()=>{try{return localStorage.getItem(activeKey)||'';}catch{return '';}};
 FP.lastDemoId=()=>{try{return FP.activeDemoId()||localStorage.getItem(previousKey)||'';}catch{return '';}};
 FP.communityIdentity=(create=false)=>{
  const id=FP.account.username;
  if(!id)return {};
  const storageKey='fanplay-community-browser-v1:'+id;
  let previous;
  try {previous=localStorage.getItem(storageKey);} catch(error){if(create)throw error;}
  if(/^[\da-f]{64}$/.test(previous||''))return {p_player_id:id,p_browser_key:previous};
  if(!create)return {};
  const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
  localStorage.setItem(storageKey,secret);
  return {p_player_id:id,p_browser_key:localStorage.getItem(storageKey)};
 };
 const validId=id=>typeof id==='string'&&/^[a-z0-9_]{3,24}$/.test(id);
 const normalizeId=value=>{
  const id=String(value||'').trim().toLowerCase();
  if(!validId(id))throw Object.assign(new Error('아이디는 영문·숫자·밑줄 3~24자로 입력해 주세요.'),{status:400});
  return id;
 };
 const rememberAccount=result=>{
  try{localStorage.setItem(activeKey,result.username);localStorage.setItem(previousKey,result.username);}catch{}
  return result;
 };
 FP.cloudRpc = async (name,body={}) => {
  let response;
  try {
   response=await fetch(config.url+'/rest/v1/rpc/'+name,{
    method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(15000),credentials:'omit'
   });
  }catch{throw new Error('온라인 저장소에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');}
  const result=await response.json().catch(()=>null);
  if(!response.ok){
   const setup=result?.code==='PGRST202'||result?.code==='42883';
   throw Object.assign(new Error(setup?'온라인 저장소 설정이 아직 완료되지 않았어요. 지금은 이 브라우저에 저장할 수 있어요.':result?.message||'온라인 기록을 처리하지 못했어요.'),{status:response.status,code:result?.code});
  }
  return result;
 };
 const validateResult=result=>{
  if(!result||!validId(result.username)||!Number.isInteger(result.revision)||result.revision<0||!result.state||typeof result.state!=='object'||Array.isArray(result.state))throw new Error('온라인 기록의 형식이 올바르지 않아요. 기존 기록을 유지해요.');
  return result;
 };
 FP.accountRequest = async (route,method='GET',body={}) => {
  if(route==='logout'){
   try{localStorage.removeItem(activeKey);}catch{}
   return {username:null};
  }
  if(route==='resume'){
   const id=normalizeId(body.username);
   try{
    const result=await FP.cloudRpc('fanplay_demo_resume',{p_player_id:id});
    FP.cloudResumeUnavailable=false;
    return result===null?null:rememberAccount(validateResult(result));
   }catch(error){
    if(!['PGRST202','42883'].includes(error.code))throw error;
    FP.cloudResumeUnavailable=true;
    return null;
   }
  }
  if(route==='login'){
   const id=normalizeId(body.username);
   const team=FP.communityMode ? FP.teams.find(([key])=>key===body.team)?.[0] : null;
   const result=validateResult(team
    ? await FP.cloudRpc('fanplay_demo_join',{p_player_id:id,p_team:team})
    : await FP.cloudRpc('fanplay_demo_open',{p_player_id:id}));
   return rememberAccount(result);
  }
  if(route==='state'){
   const result=validateResult(await FP.cloudRpc('fanplay_demo_save',{p_player_id:body.username,p_revision:body.revision,p_state:body.state}));
   if(result.username!==body.username||result.revision!==body.revision+1)throw new Error('저장 응답을 확인하지 못했어요. 새로고침해 주세요.');
   return result;
  }
  throw new Error('지원하지 않는 요청이에요.');
 };
 FP.restoreAccount = async () => {
  if(!['http:','https:'].includes(location.protocol))return false;
  FP.account.checking=true;
  try{
   const status=await FP.cloudRpc('fanplay_demo_status');
   if(status?.ready!==true||status.version!==1)throw new Error('온라인 저장소 버전을 확인해 주세요.');
   FP.account.available=true;FP.cloudError='';
   let id;try{id=localStorage.getItem(activeKey);}catch{}
   if(validId(id))FP.useAccount(validateResult(await FP.cloudRpc('fanplay_demo_open',{p_player_id:id})));
   return true;
  }catch(error){FP.cloudError=error.message;return false;}
  finally{FP.account.checking=false;}
 };
 FP.cloudAccountTools = () => `<section class="panel account-panel" aria-label="온라인 저장"><div class="storage-mode"><strong>온라인 저장</strong><span>아이디 <b>${FP.esc(FP.account.username)}</b></span></div><p class="save-status" data-save-status data-save-state="${FP.accountSaveState || 'idle'}" role="status">${FP.esc(FP.accountSaveStatus)}</p>
   ${FP.guestImportPanel()}<details class="cloud-tools"><summary>저장 도구</summary><div class="cloud-tools-actions"><button class="btn secondary" data-action="cloud-download">현재 기록 내려받기</button><button class="btn secondary" data-action="cloud-refresh">온라인 기록 다시 불러오기</button>
   <button type="button" class="text-link" data-action="guest-review">이 기기 기록 가져오기 다시 확인</button><button type="button" class="text-link" data-action="import-backup">가져오기 전 사본 내려받기</button></div></details>
   <form data-account-action="logout"><button class="btn secondary" type="submit">로그아웃</button></form>
   <details><summary>기록과 게시물 이용 안내</summary><p>같은 아이디를 아는 사람과 저장 기록을 공유해요. 게시글과 댓글은 처음 작성한 브라우저에서 관리할 수 있어요.</p></details></section>`;
 FP.downloadDemoState=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(FP.data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='fanplay-'+(FP.account.username||'guest')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
})();
