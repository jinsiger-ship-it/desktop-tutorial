begin;

create table if not exists fanplay_private.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 5242880)
);
create table if not exists fanplay_private.ticket_posts (
  id uuid primary key default gen_random_uuid(),
  author uuid references auth.users(id) on delete cascade,
  legacy_player_id text,
  legacy_post_id text,
  nickname text not null,
  ticket jsonb not null check (jsonb_typeof(ticket) = 'object' and octet_length(ticket::text) <= 1048576),
  message text not null check (char_length(message) <= 300),
  created_at timestamptz default now(),
  unique (legacy_player_id,legacy_post_id)
);
create table if not exists fanplay_private.ticket_likes (
  post_id uuid references fanplay_private.ticket_posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  primary key (post_id, user_id)
);
create table if not exists fanplay_private.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references fanplay_private.ticket_posts(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  message text not null check (char_length(message) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists fanplay_ticket_comments_post on fanplay_private.ticket_comments(post_id, created_at desc, id);
create index if not exists fanplay_ticket_posts_recent on fanplay_private.ticket_posts(created_at desc, id);
alter table fanplay_private.members enable row level security;
alter table fanplay_private.ticket_posts enable row level security;
alter table fanplay_private.ticket_likes enable row level security;
alter table fanplay_private.ticket_comments enable row level security;
revoke all on fanplay_private.members, fanplay_private.ticket_posts, fanplay_private.ticket_likes,
  fanplay_private.ticket_comments from public, anon, authenticated;

-- Realtime subscribers receive a counter only. Ticket payloads stay behind the feed function.
create table if not exists public.fanplay_feed_updates (
  id integer primary key check (id=1),
  version bigint not null default 0
);
insert into public.fanplay_feed_updates(id) values(1) on conflict do nothing;
alter table public.fanplay_feed_updates enable row level security;
revoke all on public.fanplay_feed_updates from public, anon, authenticated;
grant select on public.fanplay_feed_updates to anon, authenticated;
drop policy if exists fanplay_feed_updates_read on public.fanplay_feed_updates;
create policy fanplay_feed_updates_read on public.fanplay_feed_updates for select to anon, authenticated using (id=1);
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename='fanplay_feed_updates') then
    alter publication supabase_realtime add table public.fanplay_feed_updates;
  end if;
end;
$$;

create or replace function public.fanplay_member_open()
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare member fanplay_private.members%rowtype;
        uid uuid := auth.uid();
        settings jsonb := auth.jwt()->'user_metadata';
begin
  if uid is null then raise sqlstate 'PT401' using message = '로그인이 필요해요.'; end if;
  insert into fanplay_private.members(user_id,state)
  values (uid,jsonb_build_object('profile',jsonb_build_object(
    'nickname',coalesce(nullif(left(btrim(settings->>'nickname'),24),''),'야구팬'),
    'team',coalesce(settings->>'team','neutral'))))
  on conflict (user_id) do nothing;
  select * into strict member from fanplay_private.members where user_id=uid;
  return jsonb_build_object('username',uid,'state',member.state,'revision',member.revision);
end;
$$;

create or replace function public.fanplay_member_save(p_revision integer, p_state jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare member fanplay_private.members%rowtype;
        uid uuid := auth.uid();
begin
  if uid is null then raise sqlstate 'PT401' using message = '로그인이 필요해요.'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text)>5242880 then
    raise sqlstate 'PT413' using message = '기록은 5MB 이하로 저장해 주세요.';
  end if;
  update fanplay_private.members set state=jsonb_set(p_state,'{posts}',coalesce(state->'posts','[]'::jsonb)), revision=revision+1
  where user_id=uid and revision=p_revision returning * into member;
  if not found then raise sqlstate 'PT409' using message = '다른 기기에서 기록이 바뀌었어요. 새로고침 후 다시 시도해 주세요.'; end if;
  return jsonb_build_object('username',uid,'state',member.state,'revision',member.revision);
end;
$$;

create or replace function public.fanplay_member_demo_copy(p_player_id text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare previous_state jsonb;
begin
  if auth.uid() is null then raise sqlstate 'PT401' using message = '로그인이 필요해요.'; end if;
  if p_player_id is null or p_player_id !~ '^[a-z0-9_]{3,24}$' then
    raise sqlstate 'PT400' using message = '시연용 아이디를 확인해 주세요.';
  end if;
  select state into previous_state from fanplay_private.demo_records where player_id=p_player_id;
  return previous_state;
end;
$$;

create or replace function public.fanplay_ticket_feed(p_sort text default 'latest', p_page integer default 0)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with like_totals as (
    select post_id,count(*) as total,bool_or(user_id=auth.uid()) as liked
    from fanplay_private.ticket_likes group by post_id
  ), comment_totals as (
    select post_id,count(*) as total from fanplay_private.ticket_comments group by post_id
  ), candidates as (
    select p.*, coalesce(l.total,0) as likes, coalesce(c.total,0) as replies, coalesce(l.liked,false) as liked,
      case p_sort when 'likes' then coalesce(l.total,0) when 'comments' then coalesce(c.total,0) else 0 end as score
    from fanplay_private.ticket_posts p left join like_totals l on l.post_id=p.id
    left join comment_totals c on c.post_id=p.id
    where p_sort='latest' or (p_sort='likes' and l.total>0) or (p_sort='comments' and c.total>0)
    order by score desc,p.created_at desc nulls last,p.id
    limit (case when p_sort='latest' then 21 else 10 end)
    offset (case when p_sort='latest' then greatest(0,least(p_page,100000))*20 else 0 end)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'nickname',p.nickname,'text',p.message,'ticket',p.ticket,'likes',p.likes,'createdAt',p.created_at,
    'replyCount',p.replies,'liked',p.liked,'mine',coalesce(p.author=auth.uid(),false),
    'comments',coalesce((
      select jsonb_agg(jsonb_build_object('id',c.id,'nickname',c.nickname,'text',c.message,
        'mine',coalesce(c.author=auth.uid(),false)) order by c.created_at,c.id)
      from (select id,author,nickname,message,created_at from fanplay_private.ticket_comments
        where post_id=p.id order by created_at desc,id limit 15) c
    ),'[]'::jsonb)
  ) order by p.score desc,p.created_at desc nulls last,p.id),'[]'::jsonb) from candidates p;
$$;

create or replace function public.fanplay_ticket_write(
  p_action text, p_post_id uuid default null, p_text text default '', p_ticket jsonb default null,
  p_liked boolean default null, p_comment_id uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare uid uuid := auth.uid();
        display_name text;
        shared_ticket jsonb;
begin
  if uid is null then raise sqlstate 'PT401' using message = '로그인이 필요해요.'; end if;
  select left(nullif(btrim(state->'profile'->>'nickname'),''),24) into display_name
    from fanplay_private.members where user_id=uid;
  display_name := coalesce(display_name,'야구팬');
  if p_action='post' then
    if p_ticket is null or jsonb_typeof(p_ticket)<>'object' or octet_length(p_ticket::text)>1048576
      or coalesce(p_ticket->>'id','')=''
      or coalesce(p_ticket->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(p_ticket->>'home','')='' or coalesce(p_ticket->>'away','')='' then
      raise sqlstate 'PT400' using message = '게시할 티켓을 확인해 주세요. 사진을 포함해 1MB까지 게시할 수 있어요.';
    end if;
    select jsonb_object_agg(key,value) into shared_ticket from jsonb_each(p_ticket)
    where key in ('id','date','home','away','hs','as','stadium','mode','theme','color','photo','note',
      'frameId','backgroundId','stickerIds','badgeId','tag');
    insert into fanplay_private.ticket_posts(author,nickname,ticket,message)
    values (uid,display_name,shared_ticket,coalesce(btrim(p_text),'')) returning id into p_post_id;
  elsif p_action='delete' then
    delete from fanplay_private.ticket_posts where id=p_post_id and author=uid;
    if not found then raise sqlstate 'PT403' using message = '내가 올린 글만 삭제할 수 있어요.'; end if;
  elsif p_action='edit' then
    update fanplay_private.ticket_posts set message=coalesce(btrim(p_text),'') where id=p_post_id and author=uid;
    if not found then raise sqlstate 'PT403' using message = '내가 올린 글만 수정할 수 있어요.'; end if;
  elsif p_action='like' and p_liked is not null then
    if p_liked then
      insert into fanplay_private.ticket_likes values(p_post_id,uid) on conflict do nothing;
    else
      delete from fanplay_private.ticket_likes where post_id=p_post_id and user_id=uid;
    end if;
  elsif p_action='comment' and nullif(btrim(p_text),'') is not null then
    insert into fanplay_private.ticket_comments(post_id,author,nickname,message)
    values(p_post_id,uid,display_name,btrim(p_text));
  elsif p_action='remove-comment' then
    delete from fanplay_private.ticket_comments where id=p_comment_id and post_id=p_post_id and author=uid;
    if not found then raise sqlstate 'PT403' using message = '내 댓글만 삭제할 수 있어요.'; end if;
  else
    raise sqlstate 'PT400' using message = '요청 내용을 확인해 주세요.';
  end if;
  -- Mirror only the owner's posts. Reactions and other users' feed never enter member state.
  if p_action in ('post','edit','delete') then
    update fanplay_private.members m set state=jsonb_set(m.state,'{posts}',
      coalesce((
        select jsonb_agg(entry) from jsonb_array_elements(
          case when jsonb_typeof(m.state->'posts')='array' then m.state->'posts' else '[]'::jsonb end
        ) entry where entry->>'id' is distinct from p_post_id::text
      ),'[]'::jsonb) || coalesce((
        select jsonb_build_array(jsonb_build_object('id',p.id,'nickname',p.nickname,'text',p.message,
          'ticket',p.ticket,'createdAt',p.created_at))
        from fanplay_private.ticket_posts p where p.id=p_post_id and p.author=uid
      ),'[]'::jsonb)),revision=revision+1 where user_id=uid;
  end if;
  update public.fanplay_feed_updates set version=version+1 where id=1;
  return p_post_id;
end;
$$;

revoke all on function public.fanplay_member_open(), public.fanplay_member_save(integer,jsonb),
  public.fanplay_member_demo_copy(text), public.fanplay_ticket_feed(text,integer), public.fanplay_ticket_write(text,uuid,text,jsonb,boolean,uuid)
  from public, anon, authenticated;
grant execute on function public.fanplay_member_open(), public.fanplay_member_save(integer,jsonb),
  public.fanplay_member_demo_copy(text), public.fanplay_ticket_write(text,uuid,text,jsonb,boolean,uuid) to authenticated;
grant execute on function public.fanplay_ticket_feed(text,integer) to anon, authenticated;
grant usage on schema public to authenticated;
notify pgrst, 'reload schema';
commit;
