import { createReducer, on } from '@ngrx/store'
import type { AuditEvent, BatchSnapshot, ConflictRecord, Defect, InspectionPlan, PendingWrite, RecheckRecord, RepairRecord, Weld } from '../types'
import * as A from './weld.actions'

export interface WeldState {
  welds: Weld[]
  plans: InspectionPlan[]
  selectedId: string
  statusFilter: string
  locked: boolean
  version: number
  audit: AuditEvent[]
  conflicts: ConflictRecord[]
  pendingWrites: PendingWrite[]
  snapshots: BatchSnapshot[]
  appliedRequestIds: string[]
}

const audit: AuditEvent[] = [
  { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字' },
  { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级' },
  { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划' },
]

export const initialState: WeldState = { welds: [], plans: [], selectedId: '', statusFilter: '全部', locked: false, version: 12, audit, conflicts: [], pendingWrites: [], snapshots: [], appliedRequestIds: [] }

/* ---------- 基础工具 ---------- */

function nowTime() { return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) }

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** 首次写入按请求编号模拟随机失败；同一请求编号重试时不再失败 */
function shouldFail(requestId: string, attempts: number): boolean {
  return attempts === 1 && hashCode(requestId) % 4 === 0
}

function pushAudit(state: WeldState, actor: string, action: string, target: string, detail: string): WeldState {
  const event: AuditEvent = { id: `AE-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, time: nowTime(), actor, action, target, detail }
  return { ...state, audit: [event, ...state.audit] }
}

function totalRepairs(weld: Weld): number {
  return weld.defects.reduce((sum, d) => sum + d.repairs.length, 0)
}

/** 未关闭的返修工序：结果为返修中或待复检（复检合格前不得开下一道工序） */
function openRepair(defect: Defect): RepairRecord | undefined {
  return [...defect.repairs].reverse().find((r) => r.result === '返修中' || r.result === '待复检')
}

function findDefect(state: WeldState, weldId: string, defectId?: string): { weld: Weld; defect: Defect } | undefined {
  const weld = state.welds.find((w) => w.id === weldId)
  if (!weld) return undefined
  const defect = defectId ? weld.defects.find((d) => d.id === defectId) : weld.defects[weld.defects.length - 1]
  return defect ? { weld, defect } : undefined
}

/** 资质失效或复检不合格后：相关计划立即重算并退回复核 */
function recalcPlansForWeld(state: WeldState, weldId: string, reason: string): WeldState {
  let next = state
  const affected = state.plans.filter((p) => p.weldIds.includes(weldId))
  for (const plan of affected) {
    next = pushAudit(next, '系统', '计划重算', plan.id, `${reason}：焊缝 ${weldId} 已从计划中移除，计划退回复核`)
  }
  if (!affected.length) {
    next = pushAudit(next, '系统', '计划重算', weldId, `${reason}：暂无包含该焊缝的待执行计划`)
  }
  return {
    ...next,
    plans: state.plans.map((p) => affected.includes(p) ? { ...p, weldIds: p.weldIds.filter((id) => id !== weldId), state: '待复核' as const } : p),
  }
}

/* ---------- 数据迁移：把历史返修次数展开为处置链记录 ---------- */

function migrate(welds: Weld[], plans: InspectionPlan[]): { welds: Weld[]; plans: InspectionPlan[] } {
  const migratedWelds = welds.map((weld) => {
    let defects = weld.defects
    if (!defects.length && weld.repairs > 0) {
      defects = [{
        id: `D-${weld.id}-H`, weldId: weld.id, position: 50, type: '历史缺陷', length: 0, level: 'Ⅱ级',
        method: weld.method, report: '历史记录', version: 1, repairs: [],
      } as Defect]
    }
    defects = defects.map((defect) => {
      const existing = defect.repairs ?? []
      if (existing.length || weld.repairs <= 0) return { ...defect, weldId: weld.id, repairs: existing }
      const repairs: RepairRecord[] = []
      for (let i = 0; i < weld.repairs; i++) {
        const isLast = i === weld.repairs - 1
        const result: RepairRecord['result'] = !isLast ? '复检合格' : weld.status === '待复检' ? '待复检' : weld.status === '返修中' ? '返修中' : '复检合格'
        const repair: RepairRecord = {
          id: `R-${weld.id}-${i + 1}`, defectId: defect.id, weldId: weld.id, round: i + 1,
          position: defect.position, method: defect.method, result,
          requestId: `MIG-${weld.id}-${i + 1}`, createdAt: '历史', actor: '系统迁移',
        }
        if (result === '复检合格') {
          repair.recheck = { id: `RC-${weld.id}-${i + 1}`, repairId: repair.id, defectId: defect.id, weldId: weld.id, conclusion: '合格', inspector: '系统迁移', time: '历史', note: '历史复检合格', requestId: `MIG-RC-${weld.id}-${i + 1}` }
        }
        repairs.push(repair)
      }
      return { ...defect, weldId: weld.id, version: defect.version ?? 1, repairs }
    })
    return { ...weld, defects, repairs: totalRepairs({ ...weld, defects }) }
  })
  let migratedPlans = plans.map((p) => ({ ...p, state: p.state ?? '待执行' }))
  for (const weld of migratedWelds) {
    if (!weld.qualificationValid) {
      migratedPlans = migratedPlans.map((p) => p.weldIds.includes(weld.id) ? { ...p, weldIds: p.weldIds.filter((id) => id !== weld.id), state: '待复核' as const } : p)
    }
  }
  return { welds: migratedWelds, plans: migratedPlans }
}

/* ---------- 各写入动作的实际执行（幂等 + 失败注入） ---------- */

function applyDefectEntry(state: WeldState, p: {
  weldId: string; defectId?: string; position: number; defectType: string; length: number
  level: Defect['level']; method: string; report: string; requestId: string; baseVersion: number
}): WeldState {
  if (state.appliedRequestIds.includes(p.requestId)) return state
  if (shouldFail(p.requestId, 1)) {
    return {
      ...state,
      pendingWrites: [{ requestId: p.requestId, kind: 'defect', payload: p, status: 'failed', attempts: 1, error: '写入超时，未收到确认', time: nowTime() }, ...state.pendingWrites],
      audit: [{ id: `AE-${Date.now()}`, time: nowTime(), actor: '系统', action: '写入失败', target: p.weldId, detail: `缺陷录入请求 ${p.requestId} 写入失败，可按请求编号恢复` }, ...state.audit],
    }
  }
  const located = findDefect(state, p.weldId, p.defectId)
  // 并发冲突：后到内容留作冲突，只放行先到的一笔
  if (located && located.defect.version > p.baseVersion) {
    const conflict: ConflictRecord = {
      id: `CF-${Date.now()}`, defectId: located.defect.id, weldId: p.weldId, time: nowTime(),
      reason: '两名质检员同时录入同一缺陷，先到内容已放行', winnerRequestId: located.defect.lastRequestId ?? '',
      loserRequestId: p.requestId,
      incoming: { position: p.position, type: p.defectType, length: p.length, level: p.level, method: p.method, report: p.report },
      resolved: false,
    }
    return {
      ...state, conflicts: [conflict, ...state.conflicts],
      audit: [{ id: `AE-${Date.now()}`, time: nowTime(), actor: '系统', action: '并发冲突', target: located.defect.id, detail: `请求 ${p.requestId} 后到，内容已留作冲突（先到 ${located.defect.lastRequestId}）` }, ...state.audit],
    }
  }
  let welds: Weld[]
  if (located) {
    welds = state.welds.map((w) => w.id === p.weldId ? {
      ...w,
      defects: w.defects.map((d) => d.id === located.defect.id ? { ...d, position: p.position, type: p.defectType, length: p.length, level: p.level, method: p.method, report: p.report, version: d.version + 1, lastRequestId: p.requestId } : d),
    } : w)
  } else {
    const newDefect: Defect = {
      id: `D-${p.weldId}-${Date.now().toString().slice(-5)}`, weldId: p.weldId, position: p.position, type: p.defectType,
      length: p.length, level: p.level, method: p.method, report: p.report, version: 1, lastRequestId: p.requestId, repairs: [],
    }
    welds = state.welds.map((w) => w.id === p.weldId ? { ...w, status: '返修中' as const, defects: [...w.defects, newDefect] } : w)
  }
  return {
    ...state, welds, version: state.version + 1,
    appliedRequestIds: [...state.appliedRequestIds, p.requestId],
    audit: [{ id: `AE-${Date.now()}`, time: nowTime(), actor: '当前审核人', action: '录入缺陷', target: p.weldId, detail: `${p.defectType}，位置 ${p.position}%，请求 ${p.requestId}` }, ...state.audit],
  }
}

function applyRepair(state: WeldState, p: { weldId: string; defectId: string; position: number; method: string; requestId: string }): WeldState {
  if (state.appliedRequestIds.includes(p.requestId)) return state
  const located = findDefect(state, p.weldId, p.defectId)
  if (!located) return pushAudit(state, '系统', '工序闭锁', p.weldId, '未找到缺陷记录，无法登记返修')
  // 同一处复检合格前不开下一道工序
  const open = openRepair(located.defect)
  if (open) {
    return pushAudit(state, '系统', '工序闭锁', located.defect.id, `第 ${open.round} 轮返修结果为「${open.result}」，复检合格前不得开下一道工序`)
  }
  if (shouldFail(p.requestId, 1)) {
    return {
      ...state,
      pendingWrites: [{ requestId: p.requestId, kind: 'repair', payload: p, status: 'failed', attempts: 1, error: '写入超时，未收到确认', time: nowTime() }, ...state.pendingWrites],
      audit: [{ id: `AE-${Date.now()}`, time: nowTime(), actor: '系统', action: '写入失败', target: located.defect.id, detail: `返修登记请求 ${p.requestId} 写入失败，返修次数未追加，可按请求编号恢复` }, ...state.audit],
    }
  }
  const round = located.defect.repairs.length + 1
  const repair: RepairRecord = {
    id: `R-${p.weldId}-${round}-${Date.now().toString().slice(-5)}`, defectId: located.defect.id, weldId: p.weldId,
    round, position: p.position, method: p.method, result: '返修中', requestId: p.requestId, createdAt: nowTime(), actor: '当前审核人',
  }
  const welds = state.welds.map((w) => w.id === p.weldId ? {
    ...w, status: '返修中' as const,
    repairs: totalRepairs({ ...w, defects: w.defects.map((d) => d.id === located.defect.id ? { ...d, repairs: [...d.repairs, repair] } : d) }),
    defects: w.defects.map((d) => d.id === located.defect.id ? { ...d, repairs: [...d.repairs, repair], lastRequestId: p.requestId } : d),
  } : w)
  return {
    ...state, welds, version: state.version + 1,
    appliedRequestIds: [...state.appliedRequestIds, p.requestId],
    audit: [{ id: `AE-${Date.now()}`, time: nowTime(), actor: '当前审核人', action: '登记返修', target: located.defect.id, detail: `第 ${round} 轮返修，位置 ${p.position}%，方法 ${p.method}，请求 ${p.requestId}` }, ...state.audit],
  }
}

function applyRecheck(state: WeldState, p: { weldId: string; defectId: string; conclusion: '合格' | '不合格'; note: string; requestId: string }): WeldState {
  if (state.appliedRequestIds.includes(p.requestId)) return state
  const located = findDefect(state, p.weldId, p.defectId)
  if (!located) return pushAudit(state, '系统', '复检退回', p.weldId, '未找到缺陷记录，无法提交复检结论')
  const open = openRepair(located.defect)
  if (!open) return pushAudit(state, '系统', '复检退回', located.defect.id, '没有待复检的返修工序，复检结论未登记')
  if (shouldFail(p.requestId, 1)) {
    return {
      ...state,
      pendingWrites: [{ requestId: p.requestId, kind: 'recheck', payload: p, status: 'failed', attempts: 1, error: '写入超时，未收到确认', time: nowTime() }, ...state.pendingWrites],
      audit: [{ id: `AE-${Date.now()}`, time: nowTime(), actor: '系统', action: '写入失败', target: located.defect.id, detail: `复检结论请求 ${p.requestId} 写入失败，可按请求编号恢复` }, ...state.audit],
    }
  }
  const recheck: RecheckRecord = {
    id: `RC-${Date.now()}`, repairId: open.id, defectId: located.defect.id, weldId: p.weldId,
    conclusion: p.conclusion, inspector: '当前审核人', time: nowTime(), note: p.note, requestId: p.requestId,
  }
  const repairs = located.defect.repairs.map((r) => r.id === open.id ? { ...r, result: (p.conclusion === '合格' ? '复检合格' : '复检不合格') as RepairRecord['result'], recheck } : r)
  let welds = state.welds.map((w) => w.id === p.weldId ? {
    ...w,
    status: (p.conclusion === '合格' ? '待复检' : '返修中') as Weld['status'],
    defects: w.defects.map((d) => d.id === located.defect.id ? { ...d, repairs, lastRequestId: p.requestId } : d),
  } : w)
  let next: WeldState = { ...state, welds, version: state.version + 1, appliedRequestIds: [...state.appliedRequestIds, p.requestId] }
  next = pushAudit(next, '当前审核人', '提交复检', located.defect.id, `第 ${open.round} 轮复检结论：${p.conclusion}，请求 ${p.requestId}`)
  if (p.conclusion === '不合格') {
    next = recalcPlansForWeld(next, p.weldId, '复检不合格')
  }
  return next
}

function applyPlan(state: WeldState, plan: InspectionPlan, requestId?: string): WeldState {
  const reqId = requestId ?? plan.requestId ?? plan.id
  if (state.appliedRequestIds.includes(reqId)) return state
  if (shouldFail(reqId, 1)) {
    return {
      ...state,
      pendingWrites: [{ requestId: reqId, kind: 'plan', payload: { plan, requestId: reqId }, status: 'failed', attempts: 1, error: '写入超时，未收到确认', time: nowTime() }, ...state.pendingWrites],
      audit: [{ id: `AE-${Date.now()}`, time: nowTime(), actor: '系统', action: '写入失败', target: plan.id, detail: `检测计划 ${reqId} 写入失败，计划条目不重复追加，可按请求编号恢复` }, ...state.audit],
    }
  }
  return {
    ...state,
    plans: [{ ...plan, requestId: reqId }, ...state.plans],
    version: state.version + 1,
    appliedRequestIds: [...state.appliedRequestIds, reqId],
    audit: [{ id: `AE-${Date.now()}`, time: nowTime(), actor: '当前审核人', action: '创建计划', target: plan.id, detail: `${plan.method}，${plan.weldIds.length} 条焊缝，请求 ${reqId}` }, ...state.audit],
  }
}

/* ---------- Reducer ---------- */

export const weldReducer = createReducer(
  initialState,
  on(A.loadWeldsSuccess, (state, { welds, plans }) => {
    const migrated = migrate(welds, plans)
    return { ...state, welds: migrated.welds, plans: migrated.plans, selectedId: state.selectedId || migrated.welds[0]?.id || '' }
  }),
  on(A.selectWeld, (state, { id }) => ({ ...state, selectedId: id })),
  on(A.filterStatus, (state, { status }) => ({ ...state, statusFilter: status })),
  on(A.advanceWeld, (state, { id, status, note }) => ({
    ...state, version: state.version + 1,
    welds: state.welds.map((weld) => weld.id === id ? { ...weld, status } : weld),
    audit: [{ id: `AE-${Date.now()}`, time: nowTime(), actor: '当前审核人', action: '状态流转', target: id, detail: note ?? `状态变更为 ${status}` }, ...state.audit],
  })),
  on(A.createPlan, (state, { plan, requestId }) => applyPlan(state, plan, requestId)),
  on(A.recordDefectEntry, (state, p) => applyDefectEntry(state, p)),
  on(A.recordRepair, (state, p) => applyRepair(state, p)),
  on(A.submitRecheck, (state, p) => applyRecheck(state, p)),
  on(A.recoverWrite, (state, { requestId }) => {
    const pending = state.pendingWrites.find((w) => w.requestId === requestId)
    if (!pending || pending.status !== 'failed') return state
    const retried: PendingWrite = { ...pending, attempts: pending.attempts + 1, status: 'applied' }
    let next: WeldState = { ...state, pendingWrites: state.pendingWrites.map((w) => w.requestId === requestId ? retried : w) }
    const payload = pending.payload as any
    switch (pending.kind) {
      case 'defect': next = applyDefectEntry(next, payload); break
      case 'repair': next = applyRepair(next, payload); break
      case 'recheck': next = applyRecheck(next, payload); break
      case 'plan': next = applyPlan(next, payload.plan, payload.requestId); break
    }
    // 幂等保护：恢复后若请求编号已在已应用列表中，条目不重复追加
    next = pushAudit(next, '系统', '恢复写入', requestId, `按请求编号恢复，第 ${retried.attempts} 次尝试`)
    return next
  }),
  on(A.resolveConflict, (state, { conflictId, decision }) => {
    const conflict = state.conflicts.find((c) => c.id === conflictId)
    if (!conflict || conflict.resolved) return state
    let next: WeldState = { ...state, conflicts: state.conflicts.map((c) => c.id === conflictId ? { ...c, resolved: true } : c) }
    if (decision === 'apply-loser') {
      next = applyDefectEntry(next, {
        weldId: conflict.weldId, defectId: conflict.defectId,
        position: conflict.incoming.position, defectType: conflict.incoming.type, length: conflict.incoming.length,
        level: conflict.incoming.level, method: conflict.incoming.method, report: conflict.incoming.report,
        requestId: conflict.loserRequestId, baseVersion: Number.MAX_SAFE_INTEGER,
      })
    }
    next = pushAudit(next, '当前审核人', '冲突处理', conflict.defectId, decision === 'keep-winner' ? '保留先到内容，后到内容丢弃' : '采纳后到内容并写入')
    return next
  }),
  on(A.qualificationExpired, (state, { weldId }) => {
    let next: WeldState = {
      ...state, version: state.version + 1,
      welds: state.welds.map((w) => w.id === weldId ? { ...w, qualificationValid: false } : w),
    }
    next = pushAudit(next, '系统', '资质失效', weldId, '焊工资质已失效，不得列入后续检测计划')
    next = recalcPlansForWeld(next, weldId, '焊工资质失效')
    return next
  }),
  on(A.lockBaseline, (state) => {
    const snapshot: BatchSnapshot = {
      id: `BS-${Date.now()}`, lockedAt: nowTime(), version: state.version,
      welds: JSON.parse(JSON.stringify(state.welds)), plans: JSON.parse(JSON.stringify(state.plans)),
    }
    return {
      ...state, locked: true, snapshots: [snapshot, ...state.snapshots],
      audit: [{ id: `AE-${Date.now()}`, time: '刚刚', actor: '质量负责人', action: '签字锁定', target: '检测批次', detail: '焊工资质、检测比例与返修闭环已确认，原批次快照保留' }, ...state.audit],
    }
  }),
)

/** 待复核结论：各页面共用同一份 */
export interface PendingReview {
  weld: Weld
  defect: Defect
  repair: RepairRecord
  recheck?: RecheckRecord
  failed: boolean
}

export function selectPendingReviews(state: WeldState): PendingReview[] {
  const reviews: PendingReview[] = []
  for (const weld of state.welds) {
    for (const defect of weld.defects) {
      for (const repair of defect.repairs) {
        if (repair.result === '待复检') {
          reviews.push({ weld, defect, repair, failed: false })
        } else if (repair.result === '复检不合格') {
          reviews.push({ weld, defect, repair, recheck: repair.recheck, failed: true })
        }
      }
    }
  }
  return reviews
}
