export type WeldStatus = '待检测' | '合格' | '返修中' | '待复检' | '已关闭'
export type DefectLevel = 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'

/** 处置链上缺陷所在环节：复检合格前始终占着道，下一道工序不得放行 */
export type DefectGate = '待返修' | '返修完成' | '待复检' | '已闭合'

export interface RepairAttempt {
  id: string
  seq: number
  position: number
  method: string
  result: '合格' | '不合格' | '待复检'
  operator: string
  time: string
  requestId: string
}

export interface Reinspection {
  id: string
  method: string
  result: '合格' | '不合格'
  inspector: string
  time: string
  report: string
  requestId: string
}

export interface Defect {
  id: string
  position: number
  type: string
  length: number
  level: DefectLevel
  method: string
  report: string
  gate: DefectGate
  /** 每一次返修都单独留痕：位置、方法、结果，不允许只加一个次数 */
  repairs: RepairAttempt[]
  /** 每次复检的结论，合格才闭合，不合格回到待返修 */
  reinspections: Reinspection[]
  /** 同一缺陷并发录入时，后到的一笔留在冲突区，不覆盖先到内容 */
  conflicts: DefectConflict[]
}

export interface DefectConflict {
  requestId: string
  inspector: string
  time: string
  payload: { type: string; level: DefectLevel; length: number; method: string; report: string }
}

export interface Weld {
  id: string
  drawing: string
  component: string
  joint: string
  method: string
  welder: string
  qualification: string
  qualificationValid: boolean
  inspectionRatio: number
  requiredRatio: number
  status: WeldStatus
  x: number
  y: number
  defects: Defect[]
}

export type PlanState = '待执行' | '执行中' | '待复核' | '已完成'

export interface InspectionPlan {
  id: string
  date: string
  method: string
  weldIds: string[]
  inspector: string
  state: PlanState
  revision: number
  /** 重算原因：复检不合格 / 资质失效 / 剔除未闭合缺陷焊缝时写入 */
  recalcReason?: string
  removedWeldIds?: string[]
}

export type ReviewKind = '复检不合格' | '资质失效' | '录入冲突' | '工序拦截'
export type ReviewState = '待复核' | '退回方案' | '已确认'

export interface ReviewItem {
  id: string
  kind: ReviewKind
  target: string
  summary: string
  detail: string
  state: ReviewState
  time: string
  relatedPlanIds: string[]
  relatedDefectId?: string
  requestId?: string
}

/** 签字锁定批次的只读快照，锁定后任何处置链变化都不改动它 */
export interface LockedSnapshot {
  version: number
  lockedAt: string
  lockedBy: string
  welds: Weld[]
  plans: InspectionPlan[]
  reviews: ReviewItem[]
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
  requestId?: string
}

/** 返修次数按处置链上的返修记录汇总，不再作为可随意 +1 的字段 */
export function totalRepairs(weld: Weld): number {
  return weld.defects.reduce((sum, defect) => sum + defect.repairs.length, 0)
}

/** 同一处复检合格前存在未闭合缺陷，下一道工序不得放行 */
export function hasOpenDefect(weld: Weld): boolean {
  return weld.defects.some((defect) => defect.gate !== '已闭合')
}
