-- 식약처 동기화 잠금(한 행). Edge Function이 서비스 롤로만 쓴다. grocery 스키마만 바꾼다(D-003).
-- update grocery.sync_lock set locked_at = now where id = 1 and locked_at < now - 30분 returning id
-- 한 문장이라 동시에 불러도 행 잠금 때문에 하나만 1행을 돌려받는다(나머지는 다시 읽은 값으로 조건이 거짓).

create table grocery.sync_lock (
  id int primary key check (id = 1),
  locked_at timestamptz not null
);
insert into grocery.sync_lock (id, locked_at) values (1, '-infinity');

alter table grocery.sync_lock enable row level security; -- 정책 없음: 로그인한 사용자는 못 본다
revoke all on grocery.sync_lock from public, anon, authenticated;
grant select, update on grocery.sync_lock to service_role;
