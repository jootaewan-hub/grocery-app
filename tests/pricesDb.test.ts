// 가격 확인 표, item_prices(), 고른 상품명까지 더한 식약처 대조(item_alerts, item_safety)를 PGlite에서 검증한다.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const MIGRATIONS = [
  '../supabase/migrations/20261017000000_grocery_items.sql',
  '../supabase/migrations/20261019000000_grocery_food_alerts.sql',
  '../supabase/migrations/20261019010000_grocery_sync_lock.sql',
  '../supabase/migrations/20261019020000_grocery_alerts_skip_farm_lots.sql',
  '../supabase/migrations/20261019030000_grocery_alerts_unknown_producer.sql',
  '../supabase/migrations/20261020000000_grocery_products.sql',
  '../supabase/migrations/20261020010000_grocery_prices.sql',
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

async function item(household: string, user: string, name: string, qty: number | null = 1, prod: string | null = product) {
  return scalar<string>(
    `insert into grocery.items (household_id, name, category, added_by, product_id, product_qty) values ($1, $2, '냉동', $3, $4, $5) returning id`,
    [household, name, user, prod, prod ? qty : null],
  )
}

/** 확인 하나와 그 줄들. at은 SQL 식(예: now(), 한국 자정 직전). */
async function check(at: string, lines: { qty: number; seller: string | null; price: number; delivery?: number | null }[], ok = true) {
  const id = await scalar<string>(
    `insert into grocery.price_checks (product_id, source, checked_at, ok, page_qty) values ($1, 'danawa', ${at}, $2, 3) returning id`,
    [product, ok],
  )
  for (const l of lines) {
    await db.query(
      `insert into grocery.price_quotes (check_id, product_id, qty, seller, price, delivery) values ($1, $2, $3, $4, $5, $6)`,
      [id, product, l.qty, l.seller, l.price, l.delivery ?? null],
    )
  }
  return id
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(read('./fixtures/shared-schema.sql'))
  await db.query(`insert into auth.users (id, email) values ($1,'a@x'),($2,'c@x')`, [A, C])
  hhA = (await db.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
  hhC = (await db.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
  await db.query(
    `insert into public.members (household_id, user_id, display_name, role, spouse_role) values
     ($1,$3,'A','owner','husband'), ($2,$4,'C','owner','husband')`,
    [hhA, hhC, A, C],
  )
  for (const m of MIGRATIONS) await db.exec(read(m))
})

beforeEach(async () => {
  await db.exec('reset role')
  await db.exec(`delete from grocery.items; delete from grocery.price_checks; delete from grocery.products; delete from grocery.food_alerts;`)
  product = await scalar<string>(
    `insert into grocery.products (source, source_id, name) values ('danawa', '5643303', 'CJ제일제당 비비고 왕교자 1.05kg') returning id`,
  )
})

const KST_MIDNIGHT = `(date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`

describe('item_prices', () => {
  it('오늘 확인한 같은 수량 줄 중 최저가', async () => {
    const id = await item(hhA, A, '비비고 왕교자', 3)
    await check('now()', [
      { qty: 3, seller: '롯데ON', price: 27650, delivery: 3000 },
      { qty: 3, seller: 'G마켓', price: 27710 },
      { qty: 1, seller: null, price: 10380 },
    ])
    expect(await as(A, `select item_id, price, seller, source, qty, delivery from grocery.item_prices()`)).toEqual([
      { item_id: id, price: 27650, seller: '롯데ON', source: 'danawa', qty: 3, delivery: 3000 },
    ])
  })

  it('수량이 다른 줄은 고르지 않는다', async () => {
    await item(hhA, A, '비비고 왕교자', 2)
    await check('now()', [{ qty: 3, seller: '롯데ON', price: 27650 }, { qty: 1, seller: null, price: 10380 }])
    expect(await as(A, `select * from grocery.item_prices()`)).toEqual([])
  })

  it('같은 값이면 판매처가 있는 줄을 먼저 고른다', async () => {
    await item(hhA, A, '비비고 왕교자', 1)
    await check('now()', [{ qty: 1, seller: null, price: 10380 }, { qty: 1, seller: '11번가', price: 10380 }])
    expect(await scalar(`select seller from grocery.item_prices()`)).toBe('11번가')
  })

  it('한국 시간 어제 확인은 고르지 않는다(자정 1분 전)', async () => {
    await item(hhA, A, '비비고 왕교자', 1)
    await check(`${KST_MIDNIGHT} - interval '1 minute'`, [{ qty: 1, seller: null, price: 10380 }])
    expect(await as(A, `select * from grocery.item_prices()`)).toEqual([])
    await check(`${KST_MIDNIGHT} + interval '1 minute'`, [{ qty: 1, seller: null, price: 10500 }])
    expect(await scalar(`select price from grocery.item_prices()`)).toBe(10500)
  })

  it('실패한 확인의 줄은 쓰지 않는다', async () => {
    await item(hhA, A, '비비고 왕교자', 1)
    await check('now()', [{ qty: 1, seller: null, price: 10380 }], false)
    expect(await as(A, `select * from grocery.item_prices()`)).toEqual([])
  })

  it('산 품목과 다른 가구 품목은 나오지 않는다', async () => {
    const mine = await item(hhA, A, '비비고 왕교자', 1)
    await db.query(`update grocery.items set bought_by = $2, bought_at = now() where id = $1`, [mine, A])
    await item(hhC, C, '비비고 왕교자', 1)
    await check('now()', [{ qty: 1, seller: null, price: 10380 }])
    expect(await as(A, `select * from grocery.item_prices()`)).toEqual([])
    expect((await as(C, `select * from grocery.item_prices()`)).length).toBe(1)
  })

  it('0원 줄은 넣을 수 없고, authenticated는 가격 표를 읽기만 한다', async () => {
    const c = await check('now()', [])
    expect(await errorOf(db.query(`insert into grocery.price_quotes (check_id, product_id, qty, price) values ($1, $2, 1, 0)`, [c, product]))).toMatch(/check/)
    expect((await as(A, `select id from grocery.price_checks`)).length).toBe(1)
    expect(await errorOf(as(A, `insert into grocery.price_checks (product_id, source, ok) values ($1, 'danawa', true)`, [product]))).toMatch(/permission denied/)
    expect(await errorOf(as(null, `select * from grocery.price_quotes`))).toMatch(/permission denied/)
  })
})

async function alert(a: { source?: string; id: string; product: string; maker?: string | null }) {
  await db.query(
    `insert into grocery.food_alerts (source, source_id, product_name, maker, registered_on, raw) values ($1, $2, $3, $4, current_date - 10, '{}')`,
    [a.source ?? 'I0490', a.id, a.product, a.maker ?? null],
  )
}

describe('안전 대조: 품목 이름 ∪ 고른 상품명', () => {
  it('item_alerts는 품목 이름이나 고른 상품명 중 하나로 맞으면 한 번만 낸다', async () => {
    await alert({ id: '1', product: '비비고 왕교자 1.05kg', maker: 'CJ제일제당' })
    await alert({ id: '2', product: '만두피', maker: '태산식품' })
    const id = await item(hhA, A, '만두', 1) // 품목 이름 "만두"는 '만두피'와, 고른 상품명은 '비비고 왕교자'와 맞는다
    const rows = await as<{ item_id: string; source_id: string }>(A, `select item_id, source_id from grocery.item_alerts()`)
    expect(rows.map((r) => r.source_id).sort()).toEqual(['1', '2'])
    expect(rows.every((r) => r.item_id === id)).toBe(true)
  })

  it('상품을 고르지 않은 품목은 지금처럼 품목 이름으로만', async () => {
    await alert({ id: '1', product: '비비고 왕교자 1.05kg', maker: 'CJ제일제당' })
    await item(hhA, A, '만두', null, null)
    expect(await as(A, `select * from grocery.item_alerts()`)).toEqual([])
  })

  it('item_alerts는 농가 기록을 내지 않고 item_safety는 farm=true로 낸다', async () => {
    await alert({ source: 'I2620', id: 'f', product: '왕교자', maker: '이*옥' })
    const id = await item(hhA, A, '왕교자', 1, null)
    expect(await as(A, `select * from grocery.item_alerts()`)).toEqual([])
    expect(await as(A, `select source_id, via, farm from grocery.item_safety($1)`, [id])).toEqual([{ source_id: 'f', via: 'item_name', farm: true }])
  })

  it('item_safety의 via: 고른 상품명으로 맞으면 product_name(둘 다면 product_name)', async () => {
    await alert({ id: '1', product: '비비고 왕교자 1.05kg', maker: 'CJ제일제당' })
    const byProduct = await item(hhA, A, '만두', 1)
    expect(await as(A, `select source_id, via, farm from grocery.item_safety($1)`, [byProduct])).toEqual([{ source_id: '1', via: 'product_name', farm: false }])
    const both = await item(hhA, A, '비비고 왕교자', 1)
    expect(await as(A, `select via from grocery.item_safety($1)`, [both])).toEqual([{ via: 'product_name' }])
  })

  it('item_safety: 다른 가구 품목은 빈 결과', async () => {
    await alert({ id: '1', product: '비비고 왕교자 1.05kg', maker: 'CJ제일제당' })
    const theirs = await item(hhC, C, '비비고 왕교자', 1)
    expect(await as(A, `select * from grocery.item_safety($1)`, [theirs])).toEqual([])
  })
})
