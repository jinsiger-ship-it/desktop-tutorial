# FANPLAY v0.9.0 회원·커뮤니티 설정

앱은 Supabase 이메일·비밀번호 인증을 사용한다. 가입 시 받은 닉네임과 응원팀은 첫 로그인에서 개인 저장 데이터로 복사된다. 기존 공유 아이디는 게임 저장에 계속 사용할 수 있다. 회원 계정은 사용자가 입력한 공유 아이디에서 게임·티켓 기록을 복사할 수 있다. 티켓은 수집함에서 직접 게시한다.

## 공개 전 Supabase 설정

1. 기존 프로젝트의 SQL Editor에서 `supabase/migrations/2026112401_members_community.sql`을 실행한다. 기존 `2026111801_demo_records.sql`이 적용된 프로젝트를 대상으로 한다.
2. Authentication의 URL Configuration에서 Site URL을 `https://jinsiger-ship-it.github.io/desktop-tutorial/`로 설정한다.
3. Authentication에서 Email 가입과 이메일 확인을 활성화한다. 일반 사용자에게 확인 메일을 보내려면 [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)에 따라 프로젝트에서 SMTP를 구성한다. 기본 발송은 프로젝트 팀에 속한 주소로 제한된다. SMTP 비밀번호와 관리자 키는 저장소에 넣지 않는다.
4. 공개를 원하는 예전 게시물이 있다면 `supabase/admin/20261124_publish_reviewed_legacy_posts.sql`의 조회문으로 내용을 확인한다. 공개에 동의한 글의 아이디 쌍만 입력해 INSERT 문을 실행한다. 예전 글은 작성 시각을 비워 두며 원래 회원 소유권을 알 수 없으므로 사용자 버튼으로 수정하거나 삭제할 수 없다. 예전 사진·티켓 메모와 로컬 반응은 옮기지 않는다.
5. 두 테스트 계정으로 가입 확인, 로그인, 티켓 게시와 두 랭킹을 확인한 뒤 main에 배포한다.

공개 피드는 티켓·닉네임·게시 시각·좋아요·댓글을 보여 준다. 기존 관리자용 `fanplay_community_feed`는 권한을 바꾸지 않는다. 앱의 공개 조회는 반환 필드를 제한한 새 `fanplay_ticket_feed`를 사용한다. 티켓을 공유하면 사진과 티켓 메모도 공개되며 게시 데이터는 최대 1MB다. 최신 목록은 한 페이지에 20개, 좋아요순·댓글순은 각각 상위 10개를 표시한다. Realtime 신호로 목록을 갱신하고 연결이 끊기면 커뮤니티 화면이 열린 동안 12초마다 확인한다.

회원 저장의 `state.posts`에는 본인 게시글만 서버가 기록한다. 좋아요와 댓글은 공유 테이블에서 집계한다. 공유 아이디만으로는 다른 사람이 같은 게임 기록을 열 수 있어 게시물 수정 권한으로 사용할 수 없다. 공개 쓰기·수정·삭제는 Supabase Auth 계정 ID로 검증하고, 기존 `fanplay_private.demo_records`나 RLS를 초기화하지 않는다.

## 적용 확인

운영 SQL 실행 후 `select public.fanplay_ticket_feed('latest', 0);`으로 피드를 확인한다. 공개 환경의 가입 메일 발송과 두 회원의 실시간 수신은 운영 설정이 필요하다. 로컬 PostgreSQL 검사는 `PGLITE_MODULE`을 지정한 뒤 `node tests/members-community.cjs`로 실행한다.
