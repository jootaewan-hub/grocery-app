// 상품·후보·검색 상태·가구 기억·요청 간격 표와 고르기 RPC를 PGlite에서 검증한다.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const MIGRATIONS = [
  './fixtures/shared-schema.sql',
  '../supabase/migrations/20261017000000_grocery_items.sql',
  '../supabase/migrations/20261019000000_grocery_food_alerts.sql',
  '../supabase/migrations/20261019010000_grocery_sync_lock.sql',
  '../supabase/migrations/20261019020000_grocery_alerts_skip_farm_lots.sql',
  '../supabase/migrations/20261019030000_grocery_alerts_unknown_producer.sql',
  '../supabase/migrations/20261020000000_grocery_products.sql',
]

const A = '00000000-0000-4000-8000-00000000000a'
const C = '00000000-0000-4000-8000-00000000000c'

let db: PGlite
let hhA: string
let hhC: string
let product: string

async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
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

const scalar = async <T>(sql: string, params: unknown[] = []): Promise<T> =>
  Object.values((await db.query<Record<string, T>>(sql, params)).rows[0])[0]

async function item(household: string, user: string, name: string, spec: string | null = null): Promise<string> {
  return scalar<string>(
    `insert into grocery.items (household_id, name, spec, category, added_by) values ($1, $2, $3, '냉동', $4) returning id`,
    [household, name, spec, user],
  )
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(read(MIGRATIONS[0]))
  await db.query(`insert into auth.users (id, email) values ($1,'a@x'),($2,'c@x')`, [A, C])
  hhA = (await db.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
  hhC = (await db.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
  await db.query(
    `insert into public.members (household_id, user_id, display_name, role, spouse_role) values
     ($1,$3,'A','owner','husband'), ($2,$4,'C','owner','husband')`,
    [hhA, hhC, A, C],
  )
  for (const m of MIGRATIONS.slice(1)) await db.exec(read(m))
})

beforeEach(async () => {
  await db.exec('reset role')
  await db.exec(`delete from grocery.product_choices; delete from grocery.items; delete from grocery.products;
    update grocery.fetch_gate set next_at = '-infinity';`)
  product = await scalar<string>(
    `insert into grocery.products (source, source_id, name) values ('danawa', '5643303', 'CJ제일제당 비비고 왕교자 1.05kg') returning id`,
  )
})

describe('name_key', () => {
  it('대소문자·공백·문장부호를 무시하고 규격을 붙인다', async () => {
    expect(await scalar(`select grocery.name_key(' 비비고  왕교자 ', '1.05KG')`)).toBe(
      await scalar(`select grocery.name_key('비비고왕교자', '1.05kg')`),
    )
    expect(await scalar(`select grocery.name_key('우유', null)`)).not.toBe(await scalar(`select grocery.name_key('우유', '2.3L')`))
  })
})

describe('고르기', () => {
  it('choose_product: 내 가구 품목에 상품을 연결하고 가구 기억을 남긴다', async () => {
    const id = await item(hhA, A, '비비고 왕교자', '1.05kg')
    await as(A, `select grocery.choose_product($1, $2, 1)`, [id, product])
    const row = (await db.query<{ product_id: string; product_qty: number }>(`select product_id, product_qty from grocery.items where id = $1`, [id])).rows[0]
    expect(row).toEqual({ product_id: product, product_qty: 1 })
    const choice = (await db.query(`select household_id, name_key, product_id, qty, chosen_by from grocery.product_choices`)).rows
    expect(choice).toEqual([{ household_id: hhA, name_key: await scalar(`select grocery.name_key('비비고 왕교자', '1.05kg')`), product_id: product, qty: 1, chosen_by: A }])
  })

  it('choose_product: 같은 이름을 다시 고르면 기억을 바꾼다', async () => {
    const id = await item(hhA, A, '비비고 왕교자', '1.05kg')
    await as(A, `select grocery.choose_product($1, $2, 1)`, [id, product])
    await as(A, `select grocery.choose_product($1, $2, 3)`, [id, product])
    expect(await scalar(`select qty from grocery.product_choices`)).toBe(3)
  })

  it('choose_product: 다른 가구 품목은 바꾸지 못하고 기억도 남지 않는다', async () => {
    const id = await item(hhC, C, '비비고 왕교자')
    await errorOf(as(A, `select grocery.choose_product($1, $2, 1)`, [id, product]))
    expect(await scalar(`select product_id from grocery.items where id = $1`, [id])).toBeNull()
    expect(await scalar(`select count(*)::int from grocery.product_choices`)).toBe(0)
  })

  it('choose_product: 수량은 1~99', async () => {
    const id = await item(hhA, A, '우유')
    expect(await errorOf(as(A, `select grocery.choose_product($1, $2, 0)`, [id, product]))).not.toBe('NO_ERROR')
  })

  it('product_choices: 다른 가구 기억은 보이지 않는다', async () => {
    const id = await item(hhC, C, '우유')
    await as(C, `select grocery.choose_product($1, $2, 1)`, [id, product])
    expect(await as(A, `select * from grocery.product_choices`)).toEqual([])
    expect(await as(C, `select qty from grocery.product_choices`)).toEqual([{ qty: 1 }])
  })
})

describe('후보·검색 상태', () => {
  it('내 가구 품목 것만 보이고 authenticated는 쓰지 못한다', async () => {
    const mine = await item(hhA, A, '비비고 왕교자')
    const theirs = await item(hhC, C, '비비고 왕교자')
    for (const id of [mine, theirs]) {
      await db.query(`insert into grocery.item_searches (item_id, status, query, candidate_count, updated_at) values ($1, 'done', 'q', 1, now())`, [id])
      await db.query(`insert into grocery.item_candidates (item_id, product_id, qty, price, rank, found_at) values ($1, $2, 1, 10380, 1, now())`, [id, product])
    }
    expect((await as<{ item_id: string }>(A, `select item_id from grocery.item_searches`)).map((r) => r.item_id)).toEqual([mine])
    expect((await as<{ item_id: string }>(A, `select item_id from grocery.item_candidates`)).map((r) => r.item_id)).toEqual([mine])
    expect(await errorOf(as(A, `insert into grocery.item_searches (item_id, status) values ($1, 'done')`, [mine]))).toMatch(/permission denied/)
    expect(await errorOf(as(A, `insert into grocery.item_candidates (item_id, product_id, qty, price) values ($1, $2, 2, 1)`, [mine, product]))).toMatch(/permission denied/)
    expect(await errorOf(as(null, `select * from grocery.item_candidates`))).toMatch(/permission denied/)
  })

  it('후보 가격은 0보다 커야 한다', async () => {
    const id = await item(hhA, A, '우유')
    expect(await errorOf(db.query(`insert into grocery.item_candidates (item_id, product_id, qty, price) values ($1, $2, 1, 0)`, [id, product]))).toMatch(/check/)
  })

  it('품목을 지우면 후보·검색 상태도 지워진다', async () => {
    const id = await item(hhA, A, '우유')
    await db.query(`insert into grocery.item_searches (item_id, status) values ($1, 'done')`, [id])
    await db.query(`insert into grocery.item_candidates (item_id, product_id, qty, price) values ($1, $2, 1, 100)`, [id, product])
    await db.query(`delete from grocery.items where id = $1`, [id])
    expect(await scalar(`select count(*)::int from grocery.item_candidates`)).toBe(0)
    expect(await scalar(`select count(*)::int from grocery.item_searches`)).toBe(0)
  })
})

describe('product-search가 쓰는 함수', () => {
  it('claim_search: 처음·끝난 뒤·2분 지난 찾는 중이면 잡고, 2분 안 찾는 중이면 못 잡는다', async () => {
    const id = await item(hhA, A, '우유')
    const claim = (at: string) => scalar<boolean>(`select grocery.claim_search($1, '우유', $2::timestamptz)`, [id, at])
    expect(await claim('2026-10-20T01:00:00Z')).toBe(true)
    expect(await claim('2026-10-20T01:01:00Z')).toBe(false)
    expect(await claim('2026-10-20T01:02:01Z')).toBe(true)
    await db.query(`update grocery.item_searches set status = 'done' where item_id = $1`, [id])
    expect(await claim('2026-10-20T01:02:30Z')).toBe(true)
    expect(await scalar(`select status from grocery.item_searches where item_id = $1`, [id])).toBe('searching')
  })

  it('claim_search: authenticated는 부르지 못한다', async () => {
    const id = await item(hhA, A, '우유')
    expect(await errorOf(as(A, `select grocery.claim_search($1, 'q', now())`, [id]))).toMatch(/permission denied/)
  })

  it('remembered_product: 같은 이름·규격으로 고른 기억을 돌려주고, 남의 품목이면 빈 결과', async () => {
    const first = await item(hhA, A, '비비고 왕교자', '1.05kg')
    await as(A, `select grocery.choose_product($1, $2, 2)`, [first, product])
    const again = await item(hhA, A, '비비고  왕교자', '1.05KG')
    expect(await as(A, `select * from grocery.remembered_product($1)`, [again])).toEqual([{ product_id: product, qty: 2 }])
    const theirs = await item(hhC, C, '비비고 왕교자', '1.05kg')
    expect(await as(A, `select * from grocery.remembered_product($1)`, [theirs])).toEqual([])
    expect(await as(C, `select * from grocery.remembered_product($1)`, [theirs])).toEqual([])
  })
})

describe('products', () => {
  it('authenticated는 읽기만, 로그인 안 하면 못 읽는다', async () => {
    expect((await as(A, `select name from grocery.products`)).length).toBe(1)
    expect(await errorOf(as(A, `insert into grocery.products (source, source_id, name) values ('danawa', '1', 'x')`))).toMatch(/permission denied/)
    expect(await errorOf(as(null, `select * from grocery.products`))).toMatch(/permission denied/)
  })
})

describe('요청 간격', () => {
  it('reserve_fetch: 처음 0, 바로 다시 약 10000, 그다음 약 20000', async () => {
    const w: number[] = []
    for (let i = 0; i < 3; i++) w.push(await scalar<number>(`select grocery.reserve_fetch('danawa-search', 10000)`))
    expect(w[0]).toBe(0)
    expect(w[1]).toBeGreaterThan(9000)
    expect(w[1]).toBeLessThanOrEqual(10000)
    expect(w[2]).toBeGreaterThan(19000)
  })

  it('reserve_fetch·fetch_gate: authenticated는 부르거나 읽지 못한다', async () => {
    expect(await errorOf(as(A, `select grocery.reserve_fetch('danawa-search', 1)`))).toMatch(/permission denied/)
    expect(await errorOf(as(A, `select * from grocery.fetch_gate`))).toMatch(/permission denied/)
  })
})
