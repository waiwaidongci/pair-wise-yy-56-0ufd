import { createReducer, on } from '@ngrx/store'
import type {
  AuditEvent,
  InspectionPlan,
  LockedSnapshot,
  ReviewItem,
  Weld,
} from '../types'
import * as A from './weld.actions'
import type { RequestLogKind } from './weld.actions'
import {
  registerDefect,
  registerRepair,
  registerReinspection,
  tryAdvanceProcess,
  uid,
  nowTime,
} from './chain'

type DefectPayload = Parameters<typeof registerDefect>[1]
type RepairPayload = Parameters<typeof registerRepair>[1]
type ReinspectionPayload = Parameters<typeof registerReinspection>[1]

export type RequestStatus = '已提交' | '失败待恢复' | '已恢复'

export interface RequestLog {
  requestId: string
  kind: RequestLogKind
  status: RequestStatus
  summary: string
  time: string
  /** 留存原始请求，恢复时按请求编号原样重放，靠编号去重 */
  payload: Record<string, unknown>
}

export interface WeldState {
  welds: Weld[]
  plans: InspectionPlan[]
  reviews: ReviewItem[]
  requests: RequestLog[]
  selectedId: string
  statusFilter: string
  locked: boolean
  snapshot: LockedSnapshot | null
  version: number
  audit: AuditEvent[]
}

const audit: AuditEvent[] = [
  { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字' },
  { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级' },
  { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划' },
]

export const initialState: WeldState = {
  welds: [],
  plans: [],
  reviews: [],
  requests: [],
  selectedId: '',
  statusFilter: '全部',
  locked: false,
  snapshot: null,
  version: 12,
  audit,
}

function base(state: WeldState): Parameters<typeof registerDefect>[0] {
  return { welds: state.welds, plans: state.plans, reviews: state.reviews, audit: state.audit }
}

function commit(state: WeldState, result: ReturnType<typeof registerRepair>): WeldState {
  return {
    ...state,
    welds: result.welds,
    plans: result.plans,
    reviews: result.reviews,
    audit: result.audit,
    version: state.version + 1,
  }
}

/** 已成功提交过的请求编号直接短路，保证恢复/重放不重复追加返修次数与计划条目 */
function seen(state: WeldState, requestId: string): boolean {
  return state.requests.some((r) => r.requestId === requestId && r.status !== '失败待恢复')
}

export const weldReducer = createReducer(
  initialState,
  on(A.loadWeldsSuccess, (state, { welds, plans, reviews }) => ({
    ...state, welds, plans, reviews, selectedId: state.selectedId || welds[0]?.id || '',
  })),
  on(A.selectWeld, (state, { id }) => ({ ...state, selectedId: id })),
  on(A.filterStatus, (state, { status }) => ({ ...state, statusFilter: status })),

  on(A.advanceWeld, (state, { id, status }) => {
    const result = tryAdvanceProcess(base(state), { weldId: id, actor: '当前审核人', nextProcess: `流转为「${status}」` })
    if (result.blocked) return commit(state, result)
    return {
      ...state, version: state.version + 1,
      welds: state.welds.map((weld): Weld => weld.id === id ? { ...weld, status } : weld),
      audit: [{ id: uid('AE'), time: nowTime(), actor: '当前审核人', action: '状态流转', target: id, detail: `状态变更为 ${status}` }, ...state.audit],
    }
  }),

  on(A.defectSubmitted, (state, p) => {
    if (seen(state, p.requestId)) return state
    const payload: DefectPayload = {
      requestId: p.requestId, weldId: p.weldId, inspector: p.inspector, position: p.position,
      type: p.defectType, level: p.level, length: p.length, method: p.method, report: p.report,
    }
    const result = registerDefect(base(state), payload)
    const log: RequestLog = {
      requestId: p.requestId, kind: '缺陷登记', status: '已提交', time: nowTime(),
      summary: `${p.weldId} · 位置 ${p.position}% · ${p.defectType}（${result.accepted ? '已放行' : '冲突留存'}）`,
      payload: payload as unknown as Record<string, unknown>,
    }
    return { ...commit(state, result), requests: [log, ...state.requests] }
  }),

  on(A.repairSubmitted, (state, p) => {
    if (seen(state, p.requestId)) return state
    const weld = state.welds.find((w) => w.id === p.weldId)
    const payload: RepairPayload = {
      requestId: p.requestId, weldId: p.weldId, defectId: p.defectId,
      position: p.position, method: p.method, result: p.result, operator: p.operator,
      welder: weld?.welder,
      qualificationValid: p.qualificationInvalid ? false : weld?.qualificationValid,
    }
    const result = registerRepair(base(state), payload)
    const log: RequestLog = {
      requestId: p.requestId, kind: '返修登记', status: '已提交', time: nowTime(),
      summary: `${p.weldId} · ${p.method} · ${p.result}`,
      payload: { ...p } as Record<string, unknown>,
    }
    return { ...commit(state, result), requests: [log, ...state.requests] }
  }),

  on(A.reinspectionSubmitted, (state, p) => {
    if (seen(state, p.requestId)) return state
    const result = registerReinspection(base(state), p)
    const log: RequestLog = {
      requestId: p.requestId, kind: '复检登记', status: '已提交', time: nowTime(),
      summary: `${p.weldId} · ${p.method} · ${p.passed ? '合格' : '不合格'}`,
      payload: { ...p } as Record<string, unknown>,
    }
    return { ...commit(state, result), requests: [log, ...state.requests] }
  }),

  on(A.processAdvanceRequested, (state, { weldId, actor, nextProcess }) =>
    commit(state, tryAdvanceProcess(base(state), { weldId, actor, nextProcess }))),

  on(A.reviewResolved, (state, { id, decision, actor }) => ({
    ...state,
    reviews: state.reviews.map((r): ReviewItem => r.id === id ? { ...r, state: decision === '确认' ? '已确认' : '退回方案' } : r),
    audit: [{ id: uid('AE'), time: nowTime(), actor, action: decision === '确认' ? '复核确认' : '退回复核', target: state.reviews.find((r) => r.id === id)?.target ?? id, detail: `待复核结论 ${id} 处理为「${decision}」` }, ...state.audit],
  })),

  on(A.createPlan, (state, { plan }) => ({ ...state, plans: [plan, ...state.plans], version: state.version + 1 })),

  // 写入确认失败：本地请求留痕不丢，标记后可按请求编号恢复
  on(A.writeFailed, (state, { requestId, kind, summary, payload }) => {
    if (state.requests.some((r) => r.requestId === requestId)) {
      return {
        ...state,
        requests: state.requests.map((r): RequestLog => r.requestId === requestId ? { ...r, status: '失败待恢复' } : r),
      }
    }
    // 未落库即失败：只登记编号与原始请求，不碰焊缝/返修/计划，等待恢复时重放
    const log: RequestLog = {
      requestId, kind, status: '失败待恢复', time: nowTime(), summary, payload: payload ?? {},
    }
    return { ...state, requests: [log, ...state.requests] }
  }),

  // 按请求编号恢复：用留存的原始请求重放，链上函数按编号去重——
  // 返修次数、复检结论、计划重算条目都不会重复追加
  on(A.writeRecovered, (state, { requestId }) => {
    const log = state.requests.find((r) => r.requestId === requestId)
    if (!log || log.status !== '失败待恢复') return state
    let next = state
    if (log.kind === '缺陷登记') {
      const p = log.payload as unknown as DefectPayload
      next = commit(state, registerDefect(base(state), p))
    } else if (log.kind === '返修登记') {
      const p = log.payload as unknown as RepairPayload & { qualificationInvalid?: boolean }
      const weld = state.welds.find((w) => w.id === p.weldId)
      next = commit(state, registerRepair(base(state), {
        ...p,
        welder: weld?.welder,
        qualificationValid: p.qualificationInvalid ? false : weld?.qualificationValid,
      }))
    } else {
      const p = log.payload as unknown as ReinspectionPayload
      next = commit(state, registerReinspection(base(state), p))
    }
    const recovered: AuditEvent = {
      id: uid('AE'), time: nowTime(), actor: '系统', action: '写入恢复', target: requestId,
      detail: '按请求编号恢复，幂等校验通过，未重复追加返修次数或计划条目', requestId,
    }
    return {
      ...next,
      requests: next.requests.map((r): RequestLog => r.requestId === requestId ? { ...r, status: '已恢复' } : r),
      audit: [recovered, ...next.audit],
    }
  }),

  // 签字锁定：冻结当前批次快照；之后处置链继续演进也不改动快照
  on(A.lockBaseline, (state, { actor }) => {
    if (state.locked) return state
    const snapshot: LockedSnapshot = {
      version: state.version,
      lockedAt: nowTime(),
      lockedBy: actor,
      welds: structuredClone(state.welds),
      plans: structuredClone(state.plans),
      reviews: structuredClone(state.reviews),
    }
    return {
      ...state, locked: true, snapshot,
      audit: [{ id: uid('AE'), time: nowTime(), actor, action: '签字锁定', target: '检测批次', detail: `批次快照 v${state.version} 已冻结，后续处置链变化不影响快照` }, ...state.audit],
    }
  }),
)
