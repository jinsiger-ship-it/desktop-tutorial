const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');

(async()=>{
  const db=new PGlite();
  const userA='11111111-1111-4111-8111-111111111111';
  const userB='22222222-2222-4222-8222-222222222222';
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable
        as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
      create publication supabase_realtime;
    `);
    await db.query('insert into auth.users values ($1),($2)',[userA,userB]);
    const runMigration=name=>db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8'));
    await runMigration('2026111801_demo_records.sql');
    await runMigration('2026112401_members_community.sql');
    await runMigration('2026112401_members_community.sql');
    async function as(user,sql,args=[],metadata={}){
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user||'',JSON.stringify({user_metadata:metadata})]);
      await db.exec(user?'set role authenticated':'set role anon');
      try{return (await db.query(sql,args)).rows[0]?.result;}finally{await db.exec('reset role');}
    }
    const feed=(user,sort,page=0)=>as(user,'select public.fanplay_ticket_feed($1,$2) result',[sort,page]);
    const write=(user,action,id=null,message='',ticket=null,liked=null,comment=null)=>as(user,
      'select public.fanplay_ticket_write($1,$2,$3,$4,$5,$6) result',[action,id,message,ticket&&JSON.stringify(ticket),liked,comment]);
    await assert.rejects(()=>as(null,'select public.fanplay_member_open() result'),{code:'42501'});
    await assert.rejects(()=>as(userA,'select * from fanplay_private.members'),{code:'42501'});
    const first=await as(userA,'select public.fanplay_member_open() result',[],{nickname:'타자팬',team:'LG'});
    assert.deepEqual(first.state.profile,{nickname:'타자팬',team:'LG'});
    const second=await as(userB,'select public.fanplay_member_open() result',[],{nickname:'투수팬',team:'KIA'});
    const saved=await as(userA,'select public.fanplay_member_save($1,$2) result',[0,JSON.stringify({profile:{nickname:'새닉네임',team:'NC'}})]);
    assert.equal(saved.revision,1);
    await assert.rejects(()=>as(userA,'select public.fanplay_member_save($1,$2) result',[0,'{}']),{code:'PT409'});
    assert.equal((await as(userB,'select public.fanplay_member_open() result')).username,second.username);
    assert.equal(await as(userA,'select public.fanplay_member_demo_copy($1) result',['missing_id']),null);
    await as(null,'select public.fanplay_demo_open($1) result',['demo_user']);
    await as(null,'select public.fanplay_demo_save($1,$2,$3) result',['demo_user',0,'{"tickets":[{"id":"sample"}]}']);
    assert.equal((await as(userA,'select public.fanplay_member_demo_copy($1) result',['demo_user'])).tickets[0].id,'sample');
    const ids=[];
    for(let i=0;i<22;i++){
      const ticket={id:'t'+i,date:'2026-11-24',home:'홈',away:'원정'};
      const id=await write(userA,'post',null,'경기 '+i,ticket);
      ids.push(id);
      await write(userB,'like',id,'',null,true);
      await write(userB,'comment',id,'댓글');
    }
    await write(userB,'like',ids[0],'',null,true);
    await write(userA,'like',ids[0],'',null,true);
    await write(userB,'comment',ids[1],'한 번 더');
    for(const sort of ['likes','comments'])assert.equal((await feed(null,sort)).length,10);
    const likes=await feed(null,'likes'), comments=await feed(userB,'comments');
    assert.equal(likes[0].id,ids[0]);assert.equal(likes[0].likes,2);assert.equal(likes[0].liked,false);
    assert.equal(comments[0].id,ids[1]);assert.equal(comments[0].replyCount,2);assert.equal(comments[0].liked,true);
    assert.equal(likes[0].nickname,'새닉네임');assert(!JSON.stringify(likes).includes(userA));
    assert.equal((await feed(userB,'latest')).length,21);
    assert.equal((await feed(userB,'latest',1)).length,2);
    const firstComment=comments[0].comments.find(row=>row.text==='한 번 더');
    await assert.rejects(()=>write(userA,'remove-comment',ids[1],'',null,null,firstComment.id),{code:'PT403'});
    await write(userB,'remove-comment',ids[1],'',null,null,firstComment.id);
    await write(userB,'like',ids[0],'',null,false);
    assert.equal((await feed(userA,'likes')).find(row=>row.id===ids[0])?.likes??1,1);
    const bPost=await write(userB,'post',null,'B 커리어',{id:'b',date:'2026-11-24',home:'팀 B',away:'팀 A',mode:'커리어',inventory:{secret:true}});
    const otherPost=(await feed(userA,'latest')).find(row=>row.id===bPost);
    assert.equal(otherPost.ticket.mode,'커리어');assert.equal(otherPost.mine,false);assert(otherPost.createdAt);
    assert.equal(otherPost.ticket.inventory,undefined);
    assert((await feed(userB,'likes')).some(row=>!row.mine));
    const beforeEdit=otherPost.createdAt;
    await assert.rejects(()=>write(userA,'edit',bPost,'다른 사람'),{code:'PT403'});
    await write(userB,'edit',bPost,'내가 바꾼 글');
    const changed=(await feed(userA,'latest')).find(row=>row.id===bPost);
    assert.equal(changed.text,'내가 바꾼 글');assert.equal(changed.createdAt,beforeEdit);
    const aState=(await as(userA,'select public.fanplay_member_open() result')).state;
    const bState=(await as(userB,'select public.fanplay_member_open() result')).state;
    assert(aState.posts.every(post=>post.id!==bPost));
    assert.deepEqual(bState.posts.map(post=>post.id),[bPost]);
    assert.equal(bState.posts[0].comments,undefined);
    await assert.rejects(()=>write(userB,'delete',ids[0]),{code:'PT403'});
    await assert.rejects(()=>write(null,'comment',ids[0],'비회원'),{code:'42501'});
    await write(userA,'delete',ids[0]);
    assert(!(await feed(null,'latest')).some(row=>row.id===ids[0]));
    assert((await as(null,'select version result from public.fanplay_feed_updates'))>0);
    const legacy=fs.readFileSync(path.join(__dirname,'../supabase/admin/20261124_publish_reviewed_legacy_posts.sql'),'utf8');
    await db.exec(legacy);
    assert.equal((await db.query('select count(*) count from fanplay_private.ticket_posts where created_at is null')).rows[0].count,0);
    console.log('PASS PostgreSQL: member state, revision conflict, legacy copy, permission boundaries, rankings, idempotent likes, Realtime counter');
  } finally {await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
