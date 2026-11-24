/* 브라우저의 Supabase Auth와 회원 전용 저장을 기존 저장 인터페이스에 연결합니다. */
(() => {
  if (typeof document === 'undefined' || accountServerEnabled || !FP.cloudConfig || location.protocol === 'file:') return;

  const sdkUrl = new URL('vendor/supabase.js', document.currentScript.src);
  const priorRequest = FP.accountRequest;
  const restoreDemo = FP.restoreAccount;
  const legacyPanel = FP.accountPanel;
  let client;
  let initialization;
  FP.memberMode = true;
  FP.memberAuthenticated = false;
  FP.communitySort = 'latest';
  FP.communityPosts = [];
  FP.communityError = '';

  async function getClient() {
    if (!initialization) initialization = (async () => {
      if (!globalThis.supabase?.createClient) await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = sdkUrl.href;
        script.onload = resolve;
        script.onerror = () => reject(new Error('회원 서비스에 연결하지 못했어요.'));
        document.head.append(script);
      });
      const {url,publishableKey}=FP.cloudConfig;
      client=globalThis.supabase.createClient(url,publishableKey,{
        auth:{storageKey:'fanplay-member-session-v1',detectSessionInUrl:true}
      });
      return client;
    })().catch(error=>{initialization=null;throw error;});
    return initialization;
  }

  function unwrap({data,error}) {
    if (error) {
      const known = {
        invalid_credentials:'이메일 또는 비밀번호를 확인해 주세요.',
        email_not_confirmed:'가입 확인 메일의 링크를 누른 뒤 로그인해 주세요.',
        email_address_not_authorized:'현재 가입 확인 메일을 보낼 수 없어요. 운영자에게 문의해 주세요.',
        over_email_send_rate_limit:'메일 발송 한도에 도달했어요. 잠시 후 다시 시도해 주세요.',
        PGRST202:'회원 서비스 설정이 아직 완료되지 않았어요.'
      };
      throw Object.assign(new Error(known[error.code] || error.message || '요청을 처리하지 못했어요.'),{status:error.status || 400});
    }
    return data;
  }

  FP.memberRpc = async (name,args) => unwrap(await (await getClient()).rpc(name,args));

  FP.restoreAccount = async () => {
    FP.account.checking=true;
    try {
      const api=await getClient();
      const {session}=unwrap(await api.auth.getSession());
      FP.account.available=true;
      if(session) {
        FP.useAccount(await FP.memberRpc('fanplay_member_open'));
        FP.memberAuthenticated=true;
        FP.cloudMode=false;
      } else if(FP.activeDemoId()) return await restoreDemo();
      return true;
    } catch(error) {
      FP.memberError=error.message;
      return false;
    } finally { FP.account.checking=false; }
  };

  FP.accountRequest = async (route,method,body) => {
    if(route==='demo-login'){
      const result=await priorRequest('login',method,body);
      FP.cloudMode=true;
      return result;
    }
    if(!FP.memberAuthenticated && (route==='state'||route==='logout'))return priorRequest(route,method,body);
    const api=await getClient();
    if(route==='login'){
      unwrap(await api.auth.signInWithPassword({email:body.email,password:body.password}));
      const member=await FP.memberRpc('fanplay_member_open');
      FP.memberAuthenticated=true;
      FP.cloudMode=false;
      FP.memberError='';
      return member;
    }
    if(route==='register'){
      const data=unwrap(await api.auth.signUp({
        email:body.email,password:body.password,
        options:{data:{nickname:body.nickname,team:body.team}}
      }));
      if(!data.session)return {confirmEmail:true};
      const member=await FP.memberRpc('fanplay_member_open');
      FP.memberAuthenticated=true;
      FP.cloudMode=false;
      return member;
    }
    if(route==='state')return FP.memberRpc('fanplay_member_save',{p_revision:body.revision,p_state:body.state});
    if(route==='logout'){
      unwrap(await api.auth.signOut({scope:'local'}));
      FP.memberAuthenticated=false;
      return {username:null};
    }
    return priorRequest(route,method,body);
  };

  FP.demoImportId = FP.lastDemoId;
  FP.demoImported = () => {
    try {return localStorage.getItem('fanplay-demo-imported-'+FP.account.username)==='1';} catch {return false;}
  };
  FP.importDemoRecord = async name => {
    if(!FP.account.username || FP.account.busy)return false;
    const memberId=FP.account.username;
    const id=name.trim().toLowerCase();
    if(!/^[a-z0-9_]{3,24}$/.test(id))throw new Error('시연용 아이디를 확인해 주세요.');
    const old=await FP.memberRpc('fanplay_member_demo_copy',{p_player_id:id});
    if(FP.account.username!==memberId || FP.account.busy)return false;
    if(!old||!Object.keys(old).length)throw new Error('가져올 시연 기록이 없어요.');
    const merged=FP.mergeGuestRecords(FP.data,FP.normalize(old),'account');
    if(!await FP.saveAccountState(merged))return false;
    try {localStorage.setItem('fanplay-demo-imported-'+FP.account.username,'1');} catch {}
    return true;
  };
  FP.connectCommunity = async callback => {
    if(!client)await getClient();
    const channel=client.channel('fanplay-ticket-updates')
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'fanplay_feed_updates'},callback)
      .subscribe();
    return () => {void client.removeChannel(channel);};
  };

  FP.memberPanel = () => {
    const {username,checking}=FP.account;
    if(checking)return '<section class="panel account-panel"><p role="status">회원 정보를 확인하고 있어요.</p></section>';
    if(username) {
      if(!FP.memberAuthenticated)return legacyPanel().replace('온라인 시연 기록','기존 게임 기록');
      const oldId=FP.demoImportId();
      return `<section class="panel account-panel">
        <h2>회원 계정</h2>
        <p class="storage-mode">내 계정에 온라인 저장</p>
        <p class="save-status" data-save-status data-save-state="${FP.accountSaveState||'idle'}" role="status">${FP.esc(FP.accountSaveStatus)}</p>
        ${FP.guestImportPanel()}
        ${FP.demoImported()?'':`<details><summary>이전 시연 기록 가져오기</summary>
          <p>기존에 사용하던 시연용 아이디의 기록을 내 계정에 복사해요.</p>
          <form id="demo-import-form"><label>기존 시연용 아이디<input name="demoId" value="${FP.esc(oldId)}" maxlength="24" pattern="[a-zA-Z0-9_]{3,24}" required></label>
            <button type="submit" class="btn secondary">이전 기록 가져오기</button></form></details>`}
        <form data-account-action="logout"><button type="submit" class="btn secondary">로그아웃</button></form>
      </section>`;
    }
    const fields=joining=>`<label>이메일<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
      <label>비밀번호<input name="password" type="password" autocomplete="${joining?'new-password':'current-password'}" ${joining?'minlength="8"':''} maxlength="72" required></label>`;
    return `<section class="panel account-panel" id="member-panel"><h2>로그인</h2>
      ${FP.memberError?`<p role="status">${FP.esc(FP.memberError)}</p>`:''}
      <p>로그인하면 기기를 바꿔도 기록을 이어가고 커뮤니티에 참여할 수 있어요.</p>
      <form data-account-action="login">${fields(false)}
        <button type="submit" class="btn">로그인</button>
      </form>
      <details class="member-signup"><summary>회원가입</summary>
        <form data-account-action="register">${fields(true)}
          <label>닉네임<input name="nickname" maxlength="24" required></label>
          <label>응원팀 테마<select name="team">${FP.teams.map(([key,name])=>`<option value="${FP.esc(key)}">${FP.esc(name)}</option>`).join('')}</select></label>
          <p class="muted">커뮤니티에 참여하면 닉네임과 게시한 내용이 공개돼요.</p>
          <button type="submit" class="btn">회원가입</button>
        </form>
      </details>
      <details><summary>기존 공유 아이디로 게임 이어하기</summary>
        <form data-account-action="demo-login">
          <label>기존 아이디<input name="username" value="${FP.esc(FP.demoImportId())}" pattern="[a-zA-Z0-9_]{3,24}" maxlength="24" required></label>
          <button type="submit" class="btn secondary">기존 기록 열기</button>
        </form>
        <p class="muted">공유 아이디는 게임 기록 저장에 사용해요. 공개 글을 쓰려면 회원 계정으로 로그인해 주세요.</p>
      </details>
    </section>`;
  };
})();
