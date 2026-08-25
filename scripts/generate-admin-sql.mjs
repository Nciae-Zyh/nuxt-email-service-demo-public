import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { createInterface } from 'node:readline/promises'

const iterations = 100_000
const outputPath = '.data/admin.sql'

let muted = false
const promptOutput = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stderr.write(chunk, encoding)
    callback()
  }
})
const prompt = createInterface({ input: process.stdin, output: promptOutput })

function escapeSql(value) {
  return value.replaceAll("'", "''")
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url')
}

async function askForCredentials() {
  const email = (process.env.ADMIN_EMAIL ?? await prompt.question('管理员邮箱：')).trim()

  let password = process.env.ADMIN_PASSWORD
  if (password === undefined) {
    process.stderr.write('管理员密码：')
    muted = true
    password = await prompt.question('')
    muted = false
    process.stderr.write('\n')
  }

  if (!email || !email.includes('@')) throw new Error('管理员邮箱格式无效')
  if (password.length < 12) throw new Error('管理员密码至少需要 12 个字符')

  return { email, password }
}

try {
  const { email, password } = await askForCredentials()
  const saltBytes = randomBytes(16)
  const passwordHash = pbkdf2Sync(password, saltBytes, iterations, 32, 'sha256')
  const emailSql = escapeSql(email)
  const hashSql = escapeSql(toBase64Url(passwordHash))
  const saltSql = escapeSql(toBase64Url(saltBytes))

  const sql = `INSERT INTO users (
  email,
  password_hash,
  password_salt,
  password_iterations,
  role,
  created_at,
  updated_at
) VALUES (
  '${emailSql}',
  '${hashSql}',
  '${saltSql}',
  ${iterations},
  'admin',
  unixepoch(),
  unixepoch()
) ON CONFLICT(email) DO UPDATE SET
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt,
  password_iterations = excluded.password_iterations,
  updated_at = unixepoch();
`

  await mkdir('.data', { recursive: true })
  await writeFile(outputPath, sql, { encoding: 'utf8', mode: 0o600 })
  process.stderr.write(`已生成 ${outputPath}，该文件已被 Git 忽略。\n`)
} finally {
  muted = false
  prompt.close()
}
