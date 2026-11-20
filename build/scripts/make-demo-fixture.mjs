// Generates demo.parquet: a plausible analytics-shaped dataset for screenshots and for handing
// the editor something realistic to show. 2,000 events across eight common parquet types.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parquetWriteBuffer } from 'hyparquet-writer'

export const FIXTURES_DIR = process.env.PARQUET_FIXTURES ?? '/tmp/opencode/parquet-fixtures'

const COUNTRIES = ['Argentina', 'Brazil', 'Chile', 'Colombia', 'Mexico', 'Peru', 'Uruguay', 'Spain', 'United States']
const USERS = ['sofia_m', 'lio.dev', 'maria_g', 'juan_c', 'ana.k', 'pedro_r', 'lucy', 'carlos_v', 'emi', 'dani_p']
const EVENTS = ['page_view', 'search', 'add_to_cart', 'checkout', 'purchase', 'refund']

export function makeDemoFixture() {
  const rows = 2_000
  const start = Date.parse('2026-11-01T08:00:00Z')
  const eventTime = new Array(rows)
  const userId = new Array(rows)
  const userName = new Array(rows)
  const country = new Array(rows)
  const event = new Array(rows)
  const revenue = new Array(rows)
  const sessionMs = new Array(rows)
  const isNewUser = new Array(rows)
  let seed = 42
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

  for (let i = 0; i < rows; i++) {
    eventTime[i] = new Date(start + i * 37_000 + Math.floor(random() * 9_000))
    userId[i] = BigInt(1000 + Math.floor(random() * 180))
    userName[i] = USERS[Math.floor(random() * USERS.length)]
    country[i] = COUNTRIES[Math.floor(random() * COUNTRIES.length)]
    event[i] = EVENTS[Math.floor(random() * EVENTS.length)]
    revenue[i] = event[i] === 'purchase' ? Math.round(random() * 49_900) / 100 : null
    sessionMs[i] = 12_000 + Math.floor(random() * 3_400_000)
    isNewUser[i] = random() < 0.18
  }

  const buffer = parquetWriteBuffer({
    columnData: [
      { name: 'event_time', data: eventTime, type: 'TIMESTAMP' },
      { name: 'user_id', data: userId, type: 'INT64' },
      { name: 'user_name', data: userName, type: 'STRING' },
      { name: 'country', data: country, type: 'STRING' },
      { name: 'event', data: event, type: 'STRING' },
      { name: 'revenue', data: revenue, type: 'DOUBLE' },
      { name: 'session_ms', data: sessionMs, type: 'INT32' },
      { name: 'is_new_user', data: isNewUser, type: 'BOOLEAN' }
    ]
  })
  const file = path.join(FIXTURES_DIR, 'demo.parquet')
  mkdirSync(FIXTURES_DIR, { recursive: true })
  writeFileSync(file, Buffer.from(buffer))
  return file
}

if (import.meta.main) {
  console.log(makeDemoFixture())
}
