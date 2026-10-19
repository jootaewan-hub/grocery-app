// 식약처 경고 테이블과 품목 대조 함수(grocery.item_alerts)를 PGlite에서 검증한다.
// db.test.ts의 끝부분은 구성원·가구를 지우므로, 여기서는 따로 DB를 만든다.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const SHARED = read('./fixtures/shared-schema.sql')
const GROCERY = read('../supabase/migrations/20261017000000_grocery_items.sql')
const ALERTS = read('../supabase/migrations/20261019000000_grocery_food_alerts.sql')
const LOCK = read('../supabase/migrations/20261019010000_grocery_sync_lock.sql')
const FARM = read('../supabase/migrations/20261019020000_grocery_alerts_skip_farm_lots.sql')
const FARM2 = read('../supabase/migrations/20261019030000_grocery_alerts_unknown_producer.sql')
const PRODUCTS = read('../supabase/migrations/20261020000000_grocery_products.sql')
const PRICES = read('../supabase/migrations/20261020010000_grocery_prices.sql')

const A = '00000000-0000-4000-8000-00000000000a'
const C = '00000000-0000-4000-8000-00000000000c'

let db: PGlite
let hhA: string
let hhC: string

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

/** 슈퍼유저로 경고 한 행을 넣는다. 날짜는 오늘 기준 일수(음수는 과거). */
async function alert(a: {
  source?: 'I0490' | 'I2620' | 'I2715'
  id: string
  product: string
  maker?: string | null
  daysAgo?: number
  endsInDays?: number | null
}) {
  await db.query(
    `insert into grocery.food_alerts (source, source_id, product_name, maker, registered_on, ends_on, raw)
     values ($1, $2, $3, $4, current_date - $5::int, case when $6::int is null then null else current_date + $6::int end, '{}'::jsonb)`,
    [a.source ?? 'I0490', a.id, a.product, a.maker ?? null, a.daysAgo ?? 10, a.endsInDays ?? null],
  )
}

async function item(household: string, user: string, name: string, bought = false) {
  await db.query(
    `insert into grocery.items (household_id, name, category, added_by, bought_by, bought_at)
     values ($1, $2, '기타', $3, $4, $5)`,
    [household, name, user, bought ? user : null, bought ? new Date().toISOString() : null],
  )
}

const alertsFor = (uid: string) => as<{ product_name: string; level: string }>(uid, 'select * from grocery.item_alerts()')

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SHARED)
  await db.query(`insert into auth.users (id, email) values ($1,'a@x'),($2,'c@x')`, [A, C])
  hhA = (await db.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
  hhC = (await db.query<{ id: string }>(`insert into public.households default values returning id`)).rows[0].id
  await db.query(
    `insert into public.members (household_id, user_id, display_name, role, spouse_role) values
     ($1,$3,'A','owner','husband'), ($2,$4,'C','owner','husband')`,
    [hhA, hhC, A, C],
  )
  await db.exec(GROCERY)
  await db.exec(ALERTS)
  await db.exec(LOCK)
  await db.exec(FARM)
  await db.exec(FARM2)
  await db.exec(PRODUCTS)
  await db.exec(PRICES) // item_alerts를 _alert_hits 위로 다시 만든다: 아래 시험은 그대로 통과해야 한다
})

describe('동기화 잠금', () => {
  const take = (cutoff: string, at: string) =>
    db.query<{ id: number }>(`update grocery.sync_lock set locked_at = $2 where id = 1 and locked_at < $1 returning id`, [cutoff, at])

  it('처음에는 얻고, 30분 안에 다시 걸면 못 얻고, 30분이 지나면 다시 얻는다', async () => {
    await db.exec(`update grocery.sync_lock set locked_at = '-infinity'`)
    expect((await take('2026-10-19T09:30:00Z', '2026-10-19T10:00:00Z')).rows).toHaveLength(1)
    expect((await take('2026-10-19T09:40:00Z', '2026-10-19T10:10:00Z')).rows).toHaveLength(0)
    expect((await take('2026-10-19T10:01:00Z', '2026-10-19T10:31:00Z')).rows).toHaveLength(1)
  })

  it('잠금 행은 하나뿐이다', async () => {
    expect(await errorOf(db.query(`insert into grocery.sync_lock (id, locked_at) values (2, now())`))).toMatch(/check/)
  })

  it('로그인한 사용자도 로그인 안 한 사용자도 잠금을 읽거나 바꾸지 못한다', async () => {
    expect(await errorOf(as(A, 'select * from grocery.sync_lock'))).toMatch(/permission denied/)
    expect(await errorOf(as(A, `update grocery.sync_lock set locked_at = now()`))).toMatch(/permission denied/)
    expect(await errorOf(as(null, 'select * from grocery.sync_lock'))).toMatch(/permission denied/)
  })
})

beforeEach(async () => {
  await db.exec('reset role')
  await db.exec('delete from grocery.items; delete from grocery.food_alerts; delete from grocery.sync_runs;')
})

describe('식약처 대조', () => {
  it('제품명에 품목 단어가 모두 있으면 비슷한 기록', async () => {
    await alert({ id: '1', product: '비비고 왕교자 1.05kg', maker: 'CJ제일제당' })
    await item(hhA, A, '비비고 왕교자')
    const rows = await alertsFor(A)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ product_name: '비비고 왕교자 1.05kg', level: 'similar' })
  })

  it('브랜드는 업체명으로 맞춰도 된다', async () => {
    await alert({ id: '1', product: '국산콩 두부', maker: '풀무원식품' })
    await item(hhA, A, '풀무원 두부')
    expect(await alertsFor(A)).toHaveLength(1)
  })

  it('한 글자 품목은 대조하지 않는다', async () => {
    await alert({ id: '1', product: '배즙' })
    await item(hhA, A, '배')
    expect(await alertsFor(A)).toHaveLength(0)
  })

  it('브랜드만 적은 품목은 대조하지 않는다', async () => {
    await alert({ id: '1', product: '국산콩 두부', maker: '풀무원식품' })
    await item(hhA, A, '풀무원')
    expect(await alertsFor(A)).toHaveLength(0)
  })

  it('1년 지난 회수는 빼고, 해외직구는 차단 종료 전이면 넣는다', async () => {
    await alert({ id: 'old', product: '냉동만두', daysAgo: 400 })
    await alert({ source: 'I2715', id: 'live', product: '냉동만두 세트', daysAgo: 800, endsInDays: 1 })
    await alert({ source: 'I2715', id: 'ended', product: '냉동만두 특가', daysAgo: 30, endsInDays: -1 })
    await item(hhA, A, '냉동만두')
    const rows = await alertsFor(A)
    expect(rows.map((r) => r.product_name)).toEqual(['냉동만두 세트'])
  })

  it('등록일을 읽지 못한 회수도 대조한다', async () => {
    await db.query(`insert into grocery.food_alerts (source, source_id, product_name, registered_on, raw) values ('I0490','n','비비고 왕교자', null, '{}')`)
    await item(hhA, A, '비비고 왕교자')
    expect(await alertsFor(A)).toHaveLength(1)
  })

  it('쇼핑몰 상품명을 붙여 넣어도 수량·광고 단어를 빼고 맞춘다', async () => {
    await alert({ id: '1', product: '비비고 왕교자 1.05kg', maker: 'CJ제일제당' })
    await item(hhA, A, '[CJ] 비비고 왕교자 1.05kg x 2봉 무료배송')
    expect(await alertsFor(A)).toHaveLength(1)
  })

  it('단어 과반이 맞고 하나는 제품명에 있으면 비슷한 기록', async () => {
    await alert({ id: '1', product: '비비고 왕교자 1.05kg', maker: 'CJ제일제당' })
    await item(hhA, A, 'CJ 왕교자 만두') // cj(업체)·왕교자(제품명) 2/3
    expect(await alertsFor(A)).toHaveLength(1)
  })

  it('제품명과 업체명 경계를 넘는 글자 조각은 맞추지 않는다', async () => {
    await alert({ id: '1', product: '국산 고추', maker: '장수식품' })
    await item(hhA, A, '고추 추장') // '추장'은 '고추'+'장수식품'을 이어 붙여야만 생기는 조각
    expect(await alertsFor(A)).toHaveLength(0)
  })

  it('농가 단위 농산물 부적합(생산자 이름 일부 가림·생산자 미상)은 목록 대조에서 뺀다', async () => {
    await alert({ source: 'I2620', id: '1', product: '고수', maker: '이*옥' })
    await alert({ source: 'I2620', id: '2', product: '고수', maker: '생산자 특정불가' })
    await alert({ source: 'I2620', id: '3', product: '고수(잎)', maker: '생산자 미상' })
    await alert({ source: 'I2620', id: '4', product: '고수', maker: '파악불가' })
    await alert({ source: 'I2620', id: '5', product: '고수', maker: '확인불가' })
    await alert({ source: 'I2620', id: '6', product: '고수', maker: '생산자 정보 파악 불가' })
    await item(hhA, A, '고수')
    expect(await alertsFor(A)).toHaveLength(0)
  })

  it('업체 이름이 있는 검사부적합과 회수·판매중지는 생산자 이름이 가려져도 그대로 대조한다', async () => {
    await alert({ source: 'I2620', id: '1', product: '고수 샐러드', maker: '○○식품' })
    await alert({ source: 'I0490', id: '2', product: '고수 무침', maker: '강**' })
    await alert({ source: 'I2620', id: '3', product: '고수 페스토', maker: null })
    await item(hhA, A, '고수')
    expect((await alertsFor(A)).map((r) => r.product_name).sort()).toEqual(['고수 무침', '고수 샐러드', '고수 페스토'])
  })

  it('산 품목은 뺀다', async () => {
    await alert({ id: '1', product: '비비고 왕교자' })
    await item(hhA, A, '비비고 왕교자', true)
    expect(await alertsFor(A)).toHaveLength(0)
  })

  it('다른 가구 품목 경고는 보이지 않는다', async () => {
    await alert({ id: '1', product: '비비고 왕교자' })
    await item(hhA, A, '비비고 왕교자')
    expect(await alertsFor(C)).toHaveLength(0)
  })

  it('authenticated는 경고를 읽기만 하고, 로그인 안 하면 못 읽는다', async () => {
    await alert({ id: '1', product: '비비고 왕교자' })
    expect(await as(A, 'select count(*)::int as n from grocery.food_alerts')).toEqual([{ n: 1 }])
    expect(await errorOf(as(A, `insert into grocery.food_alerts (source, source_id, product_name, raw) values ('I0490','x','y','{}')`))).toMatch(/permission denied/)
    expect(await errorOf(as(A, `insert into grocery.sync_runs (source, ok) values ('I0490', true)`))).toMatch(/permission denied/)
    expect(await errorOf(as(null, 'select * from grocery.food_alerts'))).toMatch(/permission denied/)
  })

  it('원본 응답(raw)은 로그인한 사용자도 못 읽고, 대조 함수는 그대로 쓴다', async () => {
    await alert({ id: '1', product: '비비고 왕교자' })
    await item(hhA, A, '비비고 왕교자')
    expect(await errorOf(as(A, 'select raw from grocery.food_alerts'))).toMatch(/permission denied/)
    expect(await as(A, 'select product_name from grocery.food_alerts')).toEqual([{ product_name: '비비고 왕교자' }])
    expect(await alertsFor(A)).toHaveLength(1)
  })
})
