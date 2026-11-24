(() => {
  if (!FP.cloudMode || !['http:','https:'].includes(location.protocol)) return;
  const labels={latest:'최신',likes:'좋아요 TOP 10',comments:'댓글 TOP 10'};
  const E=FP.esc;
  const sdkUrl=new URL('vendor/supabase.js',document.currentScript.src);
  let realtimeClient;
  let interval, disconnect, active=false, epoch=0;
  let requested=0;
  FP.communityMode=true;
  FP.communityPage=0;
  FP.communitySort='latest';
  FP.communityPosts=[];
  FP.communityError='';

  async function connectRealtime(callback, subscription) {
    if(!realtimeClient) {
      if(!globalThis.supabase?.createClient)await new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src=sdkUrl.href;
        script.onload=resolve;
        script.onerror=reject;
        document.head.append(script);
      });
      const {url,publishableKey}=FP.cloudConfig;
      realtimeClient=globalThis.supabase.createClient(url,publishableKey,{
        auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
      });
    }
    const channel=realtimeClient.channel('fanplay-demo-ticket-updates-'+subscription)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'fanplay_demo_feed_updates'},callback)
      .subscribe();
    return ()=>{void realtimeClient.removeChannel(channel);};
  }

  FP.communityPanel = () => `<section class="panel community-toolbar">
    <div class="community-sorts" role="group" aria-label="티켓 정렬">${Object.entries(labels).map(([key,label])=>
      `<button class="btn secondary" type="button" data-action="community-sort" data-value="${key}" aria-pressed="${FP.communitySort===key}">${label}</button>`).join('')}</div>
    <div class="community-links">${FP.account.username?'<a class="text-link" href="#collection">내 수집함에서 티켓 올리기 →</a>':'<a class="text-link" href="#profile">시연용 아이디로 참여하기 →</a>'}
      <button type="button" class="btn secondary" data-action="community-refresh">새로고침</button></div>
  </section><div id="community-feed">${feed()}</div>`;

  function feed() {
    if(FP.communityError)return `<p class="panel" role="status">${E(FP.communityError)} <button type="button" class="btn secondary" data-action="community-refresh">다시 불러오기</button></p>`;
    if(!FP.communityLoaded)return '<p class="panel" role="status">티켓을 불러오는 중이에요.</p>';
    const paging=FP.communitySort==='latest'&&(FP.communityPage>0||FP.communityHasMore)
      ?`<div class="actions community-pages"><button type="button" class="btn secondary" data-action="community-page" data-value="-1" ${FP.communityPage===0?'disabled':''}>이전</button><span>${FP.communityPage+1} 페이지</span><button type="button" class="btn secondary" data-action="community-page" data-value="1" ${FP.communityHasMore?'':'disabled'}>다음</button></div>`:'';
    if(!FP.communityPosts.length)return '<p class="panel">아직 이 목록에 티켓이 없어요.</p>'+paging;
    return `<div class="collection-grid">${FP.communityPosts.map((post,index)=>{
      const ticket=FP.ticketData(post.ticket);
      if(!ticket)return '';
      const published=post.createdAt ? new Date(post.createdAt) : null;
      const date=published&&Number.isFinite(+published)
        ?`<time datetime="${E(post.createdAt)}">${E(published.toLocaleString('ko-KR',{dateStyle:'short',timeStyle:'short'}))}</time>`:'<span>이전 기록 · 작성 시각 없음</span>';
      return `<article class="post panel">
        <div class="section-title"><div>${FP.communitySort==='latest'?'':`<span class="badge">${index+1}위</span> `}<b>${E(post.nickname)}</b><div class="muted">${date}</div></div>
        ${post.mine?`<div class="community-owner-actions"><button type="button" class="btn secondary" data-action="edit-post" data-value="${E(post.id)}">수정</button><button type="button" class="btn quiet" data-action="delete-post" data-value="${E(post.id)}">삭제</button></div>`:''}</div>
        <p>${E(post.text)}</p>${FP.ticket(ticket)}
        <div class="actions">
          ${FP.account.username?`<button type="button" class="btn secondary" data-action="like" data-value="${E(post.id)}" aria-pressed="${post.liked===true}">${post.liked?'♥':'♡'} 좋아요 ${Number(post.likes)||0}</button>`:`<span>좋아요 ${Number(post.likes)||0}</span>`}
        </div>
        <details class="community-comments" data-thread="${E(post.id)}"><summary>댓글 ${Number(post.replyCount)||0}</summary>
          <div class="comments">${(post.comments||[]).map(c=>`<div class="community-comment"><p><b>${E(c.nickname)}</b> ${E(c.text)}</p>
          ${c.mine?`<button type="button" class="btn quiet" data-action="delete-comment" data-value="${E(c.id)}" data-post="${E(post.id)}" aria-label="내 댓글 삭제">삭제</button>`:''}</div>`).join('')}</div>
          ${post.replyCount>(post.comments||[]).length?'<p class="muted">최근 댓글 15개를 표시해요.</p>':''}
          ${FP.account.username?`<form class="comment-form" data-post="${E(post.id)}"><input name="comment" required maxlength="200" aria-label="댓글" placeholder="댓글 쓰기"><button class="btn" type="submit">등록</button></form>`:''}
        </details>
      </article>`;
    }).join('')}</div>${paging}`;
  }

  FP.refreshCommunity = async (force=false) => {
    const node=document.querySelector('#community-feed');
    if(!node || (!force && node.querySelector('input:focus, button:focus')))return;
    const serial=++requested;
    const sort=FP.communitySort;
    try {
      const posts=await FP.cloudRpc('fanplay_demo_ticket_feed',{p_sort:sort,p_page:FP.communityPage,...FP.communityIdentity()});
      if(serial!==requested || sort!==FP.communitySort)return;
      FP.communityHasMore=sort==='latest'&&Array.isArray(posts)&&posts.length>20;
      FP.communityPosts=Array.isArray(posts)?posts.slice(0,20):[];
      FP.communityError='';
      FP.communityLoaded=true;
    } catch(error) {
      if(serial!==requested)return;
      FP.communityError=error.message;
    }
    if(node.isConnected && (force || !node.querySelector('input:focus, button:focus'))){
      const drafts=new Map([...node.querySelectorAll('.comment-form')].map(form=>[form.dataset.post,form.elements.comment.value]));
      const openThreads=new Set([...node.querySelectorAll('details[open]')].map(thread=>thread.dataset.thread));
      node.innerHTML=feed();
      for(const thread of node.querySelectorAll('details')) thread.open=openThreads.has(thread.dataset.thread);
      for(const form of node.querySelectorAll('.comment-form')) form.elements.comment.value=drafts.get(form.dataset.post)||'';
    }
  };

  FP.watchCommunity = async viewing => {
    if(viewing===active)return;
    active=viewing;
    const version=++epoch;
    if(!viewing){requested++;clearInterval(interval);disconnect?.();disconnect=null;return;}
    void FP.refreshCommunity(true);
    interval=setInterval(()=>{if(!document.hidden)void FP.refreshCommunity();},12000);
    try {
      const stop=await connectRealtime(()=>{if(active&&!document.hidden)void FP.refreshCommunity();},version);
      if(version===epoch)disconnect=stop;else stop();
    } catch { /* The periodic refresh also works if Realtime cannot connect. */ }
  };

  FP.communityAction = async (action,args={}) => {
    if(!FP.account.username){location.hash='profile';FP.toast('시연용 아이디로 들어와서 참여해 주세요.');return false;}
    if(FP.account.busy)return false;
    FP.account.busy=true;
    try {
      await FP.cloudRpc('fanplay_demo_ticket_write',{p_action:action,...args,...FP.communityIdentity(true)});
      if(['post','edit','delete'].includes(action)) {
        try {FP.useAccount(await FP.accountRequest('login','POST',{username:FP.account.username}));}
        catch {FP.toast('게시글이 반영됐어요. 내 기록을 다시 불러오려면 새로고침해 주세요.');}
      }
      return true;
    } catch(error) {
      FP.toast(error.message);
      return false;
    } finally{FP.account.busy=false;}
  };
})();
