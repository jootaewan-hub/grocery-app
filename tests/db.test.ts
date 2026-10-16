// grocery 마이그레이션을 PGlite에 적용해 가구 단위 RLS와 권한을 검증한다.
// 가계부 공유 객체는 tests/fixtures/shared-schema.sql 사본을 쓴다.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const SHARED = read('./fixtures/shared-schema.sql')
const GROCERY = read('../supabase/migrations/20261017000000_grocery_items.sql')

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const D = '00000000-0000-4000-8000-00000000000d'

let db: PGlite
let hhAB: string
let hhC: string

async function as<T = Record<string, unknown>>(
  uid: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ''])
  await db.exec(uid ? 'set role authenticated' : 'set role anon')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role')
  }
}

async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as Error).message
  }
  return 'NO_ERROR'
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SHARED)
  // 실제처럼 사용자와 가구가 먼저 있고 마이그레이션이 뒤에 온다(기본 역할로 직접 넣는다)
  await db.query(`insert into auth.users (id, email) values ($1,'a@x'),($2,'b@x'),($3,'c@x')`, [A, B, C])
  hhAB = (await db.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
  hhC = (await db.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
  await db.query(
    `insert into public.members (household_id, user_id, display_name, role, spouse_role) values
     ($1,$3,'A','owner','husband'), ($1,$4,'B','partner','wife'), ($2,$5,'C','owner','husband')`,
    [hhAB, hhC, A, B, C],
  )
  await db.exec(GROCERY)
})

beforeEach(async () => {
  await db.exec('reset role')
  await db.exec('delete from grocery.items')
  await db.query(
    `insert into grocery.items (household_id, name, category, added_by) values ($1, '대파', '채소', $2)`,
    [hhAB, A],
  )
})

describe('grocery.items 권한', () => {
  it('같은 가구 구성원은 담고 읽고 체크한다', async () => {
    expect(await as(B, `select name from grocery.items`)).toEqual([{ name: '대파' }])
    await as(B, `update grocery.items set bought_by = $1, bought_at = now()`, [B])
    expect((await as(A, `select bought_by from grocery.items`))[0].bought_by).toBe(B)
    await as(A, `insert into grocery.items (household_id, name, category) values ($1, '우유', '유제품')`, [hhAB])
    expect(await as(B, `select name from grocery.items order by name`)).toHaveLength(2)
  })
  it('다른 가구는 못 보고 못 넣는다', async () => {
    expect(await as(C, `select * from grocery.items`)).toEqual([])
    expect(await errorOf(as(C, `insert into grocery.items (household_id, name, category) values ($1, 'x', '기타')`, [hhAB]))).toMatch(/row-level security/)
  })
  it('다른 가구는 고치지도 지우지도 못한다', async () => {
    expect(await as(C, `update grocery.items set name = 'x' returning id`)).toEqual([])
    expect(await as(C, `delete from grocery.items returning id`)).toEqual([])
    expect(await as(A, `select name from grocery.items`)).toEqual([{ name: '대파' }])
  })
  it('로그인 안 하면 아무것도 못 한다', async () => {
    expect(await errorOf(as(null, `select * from grocery.items`))).toMatch(/permission denied/)
    expect(await errorOf(as(null, `insert into grocery.items (household_id, name, category) values ($1, 'x', '기타')`, [hhAB]))).toMatch(/permission denied/)
    expect(await errorOf(as(null, `update grocery.items set name = 'x'`))).toMatch(/permission denied/)
    expect(await errorOf(as(null, `delete from grocery.items`))).toMatch(/permission denied/)
  })
  it('added_by를 남의 아이디로 넣을 수 없다', async () => {
    expect(await errorOf(as(A, `insert into grocery.items (household_id, name, category, added_by) values ($1, 'x', '기타', $2)`, [hhAB, B]))).toMatch(/row-level security/)
  })
  it('household_id·added_by는 바꿀 수 없다', async () => {
    expect(await errorOf(as(A, `update grocery.items set household_id = $1`, [hhC]))).toMatch(/permission denied/)
    expect(await errorOf(as(A, `update grocery.items set added_by = $1`, [B]))).toMatch(/permission denied/)
  })
  it('bought_by만 있고 bought_at이 없으면 거부', async () => {
    expect(await errorOf(as(A, `update grocery.items set bought_by = $1, bought_at = null`, [A]))).toMatch(/check/)
  })
  it('paid는 bought_at이 있어야 하고 범위 안이어야 한다', async () => {
    expect(await errorOf(as(A, `update grocery.items set paid = 1000`))).toMatch(/check/)
    expect(await errorOf(as(A, `update grocery.items set bought_by = $1, bought_at = now(), paid = 0`, [A]))).toMatch(/check/)
    expect(await errorOf(as(A, `update grocery.items set bought_by = $1, bought_at = now(), paid = 10000000000`, [A]))).toMatch(/check/)
    await as(A, `update grocery.items set bought_by = $1, bought_at = now(), paid = 1000`, [A])
  })
  it('산 사람은 같은 가구 구성원이어야 한다', async () => {
    expect(await errorOf(as(A, `update grocery.items set bought_by = $1, bought_at = now()`, [C]))).toMatch(/foreign key/)
  })
  it('items가 실시간 publication에 들어 있다', async () => {
    const rows = await db.query(`select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='grocery' and tablename='items'`)
    expect(rows.rows).toHaveLength(1)
  })
})

describe('가계부 삭제를 막지 않는다', () => {
  async function seedB() {
    await db.query(
      `insert into grocery.items (household_id, name, category, added_by, bought_by, bought_at)
       values ($1, '우유', '유제품', $2, $2, now())`,
      [hhAB, B],
    )
  }
  const check = async () => {
    const r = (await db.query<{ added_by: string | null; bought_by: string | null; bought_at: string | null }>(
      `select added_by, bought_by, bought_at from grocery.items where name = '우유'`)).rows
    expect(r).toHaveLength(1)
    expect(r[0].added_by).toBeNull()
    expect(r[0].bought_by).toBeNull()
    expect(r[0].bought_at).not.toBeNull()
  }
  it('members 행을 지워도 B의 항목은 남고 이름만 빠진다', async () => {
    await seedB()
    await db.query(`delete from public.members where user_id = $1`, [B])
    await check()
  })
  it('auth 사용자를 지워도 같다', async () => {
    await db.query(`insert into auth.users (id, email) values ($1,'d@x')`, [D])
    await db.query(`insert into public.members (household_id, user_id, display_name, role) values ($1,$2,'D','partner')`, [hhC, D])
    await db.query(`insert into grocery.items (household_id, name, category, added_by, bought_by, bought_at) values ($1,'우유','유제품',$2,$2,now())`, [hhC, D])
    await db.query(`delete from auth.users where id = $1`, [D])
    const r = (await db.query<{ added_by: string | null; bought_by: string | null; bought_at: string | null }>(
      `select added_by, bought_by, bought_at from grocery.items where household_id = $1 and name = '우유'`, [hhC])).rows
    expect(r).toHaveLength(1)
    expect(r[0].added_by).toBeNull()
    expect(r[0].bought_by).toBeNull()
    expect(r[0].bought_at).not.toBeNull()
  })
  it('가구를 지우면 항목도 함께 지워진다', async () => {
    await db.query(`insert into grocery.items (household_id, name, category, added_by) values ($1,'x','기타',$2)`, [hhC, C])
    await db.query(`delete from public.households where id = $1`, [hhC])
    expect((await db.query(`select 1 from grocery.items where household_id = $1`, [hhC])).rows).toHaveLength(0)
  })
})
