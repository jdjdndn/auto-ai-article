// ============================================================
// local-gateway — 本地 AI 网关客户端 + 探测 + 自愈 + 跨站互斥锁
// 从 executor.ts 抽出，惰性加载：纯云端站不 require 此模块，零开销
// ============================================================

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withRetry } from './pipeline.js'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 执行自愈命令（shell 模式，最多等 30s；命令自身不应阻塞，如内部用 Start-Process） */
export async function runCommand(command: string, log: (...args: unknown[]) => void): Promise<void> {
  return new Promise((resolve) => {
    log(`执行自愈命令: ${command}`)
    let child: ReturnType<typeof spawn> | null = null
    try {
      child = spawn(command, { shell: true, windowsHide: true, stdio: 'ignore' })
    } catch (e: any) {
      log(`自愈命令启动失败: ${e.message}`)
      resolve()
      return
    }
    const timer = setTimeout(() => {
      try { child?.kill() } catch { /* noop */ }
      resolve()
    }, 30_000)
    child.on('exit', () => { clearTimeout(timer); resolve() })
    child.on('error', () => { clearTimeout(timer); resolve() })
  })
}

// —— 本地 AI 网关客户端（复用公共 withRetry：慢启动重试 + 可配超时 + 模型轮换）——

export function createLocalGatewayClient(config: {
  gateway: string
  models: string[]
  timeoutMs: number
  logger?: (...args: unknown[]) => void
}) {
  const log = config.logger || ((...args: unknown[]) => console.log(new Date().toISOString(), '[executor]', ...args))
  const models = config.models.length ? config.models : ['deepseek-chat']
  return async (messages: Array<{ role: string; content: string }>): Promise<string> => {
    return withRetry(
      async (attempt) => {
        // 每轮尝试换下一个模型：单模型时行为不变（同模型 3 次重试），多模型时 A→B→C 轮换
        const model = models[attempt % models.length]
        try {
          const res = await fetch(`${config.gateway}/chat/completions`, {
            method: 'POST',
            signal: AbortSignal.timeout(config.timeoutMs),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages,
              stream: false,
            }),
          })
          if (!res.ok) throw new Error(`AI 网关 HTTP ${res.status}`)
          const data: any = await res.json()
          const content = data?.choices?.[0]?.message?.content ?? ''
          if (!content.trim()) throw new Error('AI 网关没有返回内容')
          return content
        } catch (e: any) {
          log(`网关第 ${attempt + 1} 次失败（模型 ${model}）: ${e.message}`)
          throw e
        }
      },
      2,
      '网关',
      undefined,
      [15_000, 30_000],
    )
  }
}

// —— 跨进程/跨站互斥锁（原子 mkdir；带 owner.json 过期检测）——
// 多站同机共用本地网关时，配置同一 localLockFile 即可全局串行化本地发文。

export async function acquireLock(file: string, waitMs: number, staleMs: number, log: (...args: unknown[]) => void): Promise<boolean> {
  const deadline = Date.now() + waitMs
  for (;;) {
    try {
      mkdirSync(file)
    } catch {
      // 锁已存在：检查是否过期（owner.ts 超时则强占，即使 waitMs=0）
      let owner: { pid?: number; ts?: number } | null = null
      try {
        const raw = readFileSync(join(file, 'owner.json'), 'utf-8').replace(/^\uFEFF/, '') // 容忍 BOM
        owner = JSON.parse(raw)
      } catch { /* owner.json 缺失/损坏：不接管 */ }
      if (owner && typeof owner.ts === 'number' && Date.now() - owner.ts > staleMs) {
        log(`互斥锁已过期（${Math.round((Date.now() - owner.ts) / 1000)}s），强制接管`)
        rmSync(file, { recursive: true, force: true })
        continue // 回到循环顶部重新 mkdir（for 循环的 continue 不跳过条件检查）
      }
      if (Date.now() >= deadline) return false
      log(`本地网关正被其他站点占用，等待互斥锁（剩 ${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s）`)
      await sleep(5_000)
      continue
    }
    try {
      writeFileSync(join(file, 'owner.json'), JSON.stringify({ pid: process.pid, ts: Date.now() }))
    } catch { /* noop */ }
    return true
  }
}

export function releaseLock(file: string): void {
  try { rmSync(file, { recursive: true, force: true }) } catch { /* noop */ }
}

// —— 本地网关探测 ——

export interface LocalGatewayProbe {
  /** 网关可用（可发 AI 请求） */
  online: boolean
  /** token-free-gateway degraded（status:"degraded"，browser disconnected） */
  degraded: boolean
  /** 会话过期（status:"session_expired"）或 /v1/models 返回空列表（未授权） */
  sessionExpired: boolean
  /** 可用模型列表（可能为空） */
  models: string[]
}

async function fetchJson(url: string, timeoutMs: number): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function listLocalModels(gateway: string, timeoutMs: number): Promise<string[]> {
  const data = await fetchJson(`${gateway}/models`, timeoutMs)
  const arr = Array.isArray(data?.data) ? data.data : null
  if (!arr) return []
  return arr
    .map((m: any) => String(m?.id || '').trim())
    .filter(Boolean)
}

/**
 * 探测本地网关。
 * TFG 语义（src/server.ts /health）：status 'ok'|'degraded'|'session_expired'，browser 'connected'|'disconnected'。
 * - ok + connected → 在线
 * - degraded（browser disconnected）→ 不可发请求，需拉起 Chrome
 * - session_expired → 需重新 webauth
 * 非 TFG 网关没有 /health → 回退老逻辑 /v1/models（200 且有模型即在线）
 */
export async function probeLocalGateway(gateway: string, timeoutMs = 10_000): Promise<LocalGatewayProbe> {
  const health = await fetchJson(`${gateway}/health`, timeoutMs)
  if (health && typeof health === 'object') {
    const status = String(health?.status || '')
    const models = await listLocalModels(gateway, timeoutMs)
    if (status === 'ok') {
      const browser = String(health?.browser || '')
      if (browser === 'connected') {
        return { online: true, degraded: false, sessionExpired: false, models }
      }
      // status ok 但浏览器未连接：浏览器会话不可用，按 degraded 处理
      return { online: false, degraded: true, sessionExpired: false, models }
    }
    if (status === 'degraded') {
      return { online: false, degraded: true, sessionExpired: false, models }
    }
    if (status === 'session_expired') {
      return { online: false, degraded: false, sessionExpired: true, models }
    }
    // 其它 status：以 /models 为准
  }
  const models = await listLocalModels(gateway, timeoutMs)
  return { online: models.length > 0, degraded: false, sessionExpired: models.length === 0, models }
}
