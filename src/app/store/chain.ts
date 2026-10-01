import type {
  AuditEvent,
  Defect,
  DefectConflict,
  DefectLevel,
  InspectionPlan,
  ReviewItem,
  Weld,
} from '../types'

export interface ChainInput {
  welds: Weld[]
  plans: InspectionPlan[]
  reviews: ReviewItem[]
  audit: AuditEvent[]
}

export interface ChainResult extends ChainInput {
  /** 本次处置新产生、需要进入统一待复核队列的条目 */
  newReviews: ReviewItem[]
}

let seq = 0
export function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
export function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}`
}

function auditOf(actor: string, action: string, target: string, detail: string, requestId?: string): AuditEvent {
  return { id: uid('AE'), time: nowTime(), actor, action, target, detail, requestId }
}

/**
 * 检测计划重算：复检不合格或焊工资质失效时，相关计划立即剔除问题焊缝、
 * 升修订号并退回复核；已完成计划同样退回，不得继续作为放行依据。
 */
export function recalcPlans(
  plans: InspectionPlan[],
  affectedWeldIds: string[],
  reason: string,
): { plans: InspectionPlan[]; touched: InspectionPlan[] } {
  const touched: InspectionPlan[] = []
  const next = plans.map((plan) => {
    const removed = plan.weldIds.filter((id) => affectedWeldIds.includes(id))
    if (removed.length === 0) return plan
    const updated: InspectionPlan = {
      ...plan,
      weldIds: plan.weldIds.filter((id) => !affectedWeldIds.includes(id)),
      removedWeldIds: [...(plan.removedWeldIds ?? []), ...removed].filter((v, i, arr) => arr.indexOf(v) === i),
      state: '待复核',
      revision: plan.revision + 1,
      recalcReason: reason,
    }
    touched.push(updated)
    return updated
  })
  return { plans: next, touched }
}

function pushReview(list: ReviewItem[], item: ReviewItem): ReviewItem[] {
  // 同一请求 / 同一缺陷同一类型的待复核结论只保留一份，各页面看到同一份结论
  const duplicated = list.some(
    (r) => r.state === '待复核' && ((item.requestId && r.requestId === item.requestId) ||
      (item.relatedDefectId && r.relatedDefectId === item.relatedDefectId && r.kind === item.kind)),
  )
  return duplicated ? list : [item, ...list]
}

/** 登记缺陷：先到先得；同一焊缝同一位置已有缺陷时，后到内容留作冲突 */
export function registerDefect(
  input: ChainInput,
  payload: {
    requestId: string
    weldId: string
    inspector: string
    position: number
    type: string
    level: DefectLevel
    length: number
    method: string
    report: string
  },
): ChainResult & { accepted: boolean; conflict?: DefectConflict } {
  const conflict: DefectConflict = {
    requestId: payload.requestId,
    inspector: payload.inspector,
    time: nowTime(),
    payload: { type: payload.type, level: payload.level, length: payload.length, method: payload.method, report: payload.report },
  }
  let accepted = true
  const newReviews: ReviewItem[] = []
  let auditEvents = input.audit
  const welds: Weld[] = input.welds.map((weld): Weld => {
    if (weld.id !== payload.weldId) return weld
    const existing = weld.defects.find((d) => d.position === payload.position)
    if (existing) {
      accepted = false
      auditEvents = [auditOf(payload.inspector, '录入冲突', weld.id,
        `位置 ${payload.position}% 缺陷已由在先请求登记（${existing.id}），本笔留作冲突`, payload.requestId), ...auditEvents]
      return {
        ...weld,
        defects: weld.defects.map((d) => d.id === existing.id ? { ...d, conflicts: [...d.conflicts, conflict] } : d),
      }
    }
    const defect: Defect = {
      id: uid('D'),
      position: payload.position,
      type: payload.type,
      length: payload.length,
      level: payload.level,
      method: payload.method,
      report: payload.report,
      gate: '待返修',
      repairs: [],
      reinspections: [],
      conflicts: [],
    }
    auditEvents = [auditOf(payload.inspector, '录入缺陷', weld.id,
      `位置 ${payload.position}% · ${payload.type} · ${payload.level} · ${payload.length}mm`, payload.requestId), ...auditEvents]
    return { ...weld, status: '返修中', defects: [...weld.defects, defect] }
  })

  if (!accepted) {
    const review: ReviewItem = {
      id: uid('RV'), kind: '录入冲突', target: payload.weldId, state: '待复核', time: nowTime(),
      summary: `位置 ${payload.position}% 并发录入冲突`,
      detail: `${payload.inspector} 的请求 ${payload.requestId} 后到，内容已留存待裁决，在先记录保持不变。`,
      relatedPlanIds: [], requestId: payload.requestId,
    }
    newReviews.push(review)
  }

  return {
    welds,
    plans: input.plans,
    reviews: accepted ? input.reviews : pushReview(input.reviews, newReviews[0]),
    audit: auditEvents,
    newReviews: accepted ? [] : newReviews,
    accepted,
    conflict: accepted ? undefined : conflict,
  }
}

/** 登记一次返修：保留位置、方法和结果；焊工资质失效立即触发计划重算与退回 */
export function registerRepair(
  input: ChainInput,
  payload: {
    requestId: string
    weldId: string
    defectId: string
    position: number
    method: string
    result: '合格' | '不合格' | '待复检'
    operator: string
    welder?: string
    qualificationValid?: boolean
  },
): ChainResult {
  const newReviews: ReviewItem[] = []
  let auditEvents = input.audit
  let plans = input.plans
  let reviews = input.reviews
  const welds: Weld[] = input.welds.map((weld): Weld => {
    if (weld.id !== payload.weldId) return weld
    return {
      ...weld,
      status: payload.result === '待复检' ? '待复检' : weld.status,
      defects: weld.defects.map((defect): Defect => {
        if (defect.id !== payload.defectId) return defect
        // 幂等：同一请求编号重放只恢复，不重复追加返修次数
        if (defect.repairs.some((r) => r.requestId === payload.requestId)) return defect
        const attempt = {
          id: uid('RP'), seq: defect.repairs.length + 1,
          position: payload.position, method: payload.method, result: payload.result,
          operator: payload.operator, time: nowTime(), requestId: payload.requestId,
        }
        auditEvents = [auditOf(payload.operator, '返修登记', weld.id,
          `第 ${attempt.seq} 次返修 · 位置 ${payload.position}% · ${payload.method} · ${payload.result}`, payload.requestId), ...auditEvents]
        return {
          ...defect,
          repairs: [...defect.repairs, attempt],
          gate: payload.result === '待复检' ? '待复检' : payload.result === '不合格' ? '待返修' : defect.gate,
        }
      }),
    }
  })

  if (payload.qualificationValid === false && payload.welder) {
    const affectedWeldIds = input.welds.filter((w) => w.welder === payload.welder).map((w) => w.id)
    const recalc = recalcPlans(plans, affectedWeldIds, `焊工 ${payload.welder} 资质失效`)
    plans = recalc.plans
    const review: ReviewItem = {
      id: uid('RV'), kind: '资质失效', target: payload.weldId, state: '待复核', time: nowTime(),
      summary: `焊工 ${payload.welder} 资质失效，相关计划已重算退回`,
      detail: `返修登记时确认焊工资质已失效，关联计划 ${recalc.touched.map((p) => p.id).join('、') || '（无在档计划）'} 已升修订并退回复核。`,
      relatedPlanIds: recalc.touched.map((p) => p.id), relatedDefectId: payload.defectId, requestId: payload.requestId,
    }
    newReviews.push(review)
    reviews = pushReview(reviews, review)
    auditEvents = [auditOf('系统', '计划重算', payload.welder, review.detail, payload.requestId), ...auditEvents]
  }

  return { welds, plans, reviews, audit: auditEvents, newReviews }
}

/** 登记复检结论：合格才闭合缺陷并放行；不合格立即重算计划、退回复核 */
export function registerReinspection(
  input: ChainInput,
  payload: {
    requestId: string
    weldId: string
    defectId: string
    method: string
    passed: boolean
    inspector: string
    report: string
  },
): ChainResult {
  const newReviews: ReviewItem[] = []
  let auditEvents = input.audit
  let plans = input.plans
  let reviews = input.reviews

  const rawWelds: Weld[] = input.welds.map((weld): Weld => {
    if (weld.id !== payload.weldId) return weld
    return {
      ...weld,
      defects: weld.defects.map((defect): Defect => {
        if (defect.id !== payload.defectId) return defect
        if (defect.reinspections.some((r) => r.requestId === payload.requestId)) return defect
        const record = {
          id: uid('RI'), method: payload.method,
          result: (payload.passed ? '合格' : '不合格') as '合格' | '不合格',
          inspector: payload.inspector, time: nowTime(), report: payload.report, requestId: payload.requestId,
        }
        auditEvents = [auditOf(payload.inspector, payload.passed ? '复检合格' : '复检不合格', weld.id,
          `${payload.method} · ${payload.report}`, payload.requestId), ...auditEvents]
        return { ...defect, reinspections: [...defect.reinspections, record], gate: payload.passed ? '已闭合' : '待返修' }
      }),
    }
  })
  const welds: Weld[] = rawWelds.map((weld): Weld => weld.id !== payload.weldId ? weld : {
    ...weld,
    status: weld.defects.every((d) => d.gate === '已闭合') ? '合格' : '返修中',
  })

  if (!payload.passed) {
    const recalc = recalcPlans(plans, [payload.weldId], `${payload.weldId} 复检不合格`)
    plans = recalc.plans
    const review: ReviewItem = {
      id: uid('RV'), kind: '复检不合格', target: payload.weldId, state: '待复核', time: nowTime(),
      summary: `${payload.weldId} 复检不合格，计划已重算退回`,
      detail: `缺陷 ${payload.defectId} 复检不合格，焊缝退回返修；关联计划 ${recalc.touched.map((p) => p.id).join('、') || '（无在档计划）'} 剔除该焊缝并退回复核。`,
      relatedPlanIds: recalc.touched.map((p) => p.id), relatedDefectId: payload.defectId, requestId: payload.requestId,
    }
    newReviews.push(review)
    reviews = pushReview(reviews, review)
    auditEvents = [auditOf('系统', '计划重算', payload.weldId, review.detail, payload.requestId), ...auditEvents]
  }

  return { welds, plans, reviews, audit: auditEvents, newReviews }
}

/** 工序放行校验：同一处复检合格前（存在未闭合缺陷）不开下一道工序 */
export function tryAdvanceProcess(
  input: ChainInput,
  payload: { weldId: string; actor: string; nextProcess: string },
): ChainResult & { blocked: boolean } {
  const weld = input.welds.find((w) => w.id === payload.weldId)
  const blocking = weld?.defects.filter((d) => d.gate !== '已闭合') ?? []
  if (!weld || blocking.length === 0) {
    return { ...input, newReviews: [], blocked: false }
  }
  const review: ReviewItem = {
    id: uid('RV'), kind: '工序拦截', target: payload.weldId, state: '待复核', time: nowTime(),
    summary: `${payload.weldId} 下道工序（${payload.nextProcess}）被拦截`,
    detail: `缺陷 ${blocking.map((d) => d.id).join('、')} 尚未复检合格，同一处闭合前不得开工。`,
    relatedPlanIds: [], relatedDefectId: blocking[0]?.id,
  }
  const reviews = pushReview(input.reviews, review)
  const auditEvents = [auditOf('系统', '工序拦截', payload.weldId, review.detail), ...input.audit]
  return { welds: input.welds, plans: input.plans, reviews, audit: auditEvents, newReviews: [review], blocked: true }
}
