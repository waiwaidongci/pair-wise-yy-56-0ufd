export type WeldStatus = '待检测' | '合格' | '返修中' | '待复检' | '已关闭'
export type DefectLevel = 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'
export type PlanState = '待执行' | '执行中' | '已完成' | '待复核'
export type RepairResult = '返修中' | '待复检' | '复检合格' | '复检不合格'
export type RecheckConclusion = '合格' | '不合格'

export interface RecheckRecord {
  id: string
  repairId: string
  defectId: string
  weldId: string
  conclusion: RecheckConclusion
  inspector: string
  time: string
  note: string
  requestId: string
}

export interface RepairRecord {
  id: string
  defectId: string
  weldId: string
  round: number
  position: number
  method: string
  result: RepairResult
  requestId: string
  createdAt: string
  actor: string
  recheck?: RecheckRecord
}

export interface Defect {
  id: string
  weldId: string
  position: number
  type: string
  length: number
  level: DefectLevel
  method: string
  report: string
  version: number
  lastRequestId?: string
  repairs: RepairRecord[]
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
  repairs: number
  defects: Defect[]
}

export interface InspectionPlan {
  id: string
  date: string
  method: string
  weldIds: string[]
  inspector: string
  state: PlanState
  requestId?: string
}

export interface ConflictRecord {
  id: string
  defectId: string
  weldId: string
  time: string
  reason: string
  winnerRequestId: string
  loserRequestId: string
  incoming: { position: number; type: string; length: number; level: DefectLevel; method: string; report: string }
  resolved: boolean
}

export interface PendingWrite {
  requestId: string
  kind: 'repair' | 'recheck' | 'defect' | 'plan'
  payload: unknown
  status: 'failed' | 'applied'
  attempts: number
  error?: string
  time: string
}

export interface BatchSnapshot {
  id: string
  lockedAt: string
  version: number
  welds: Weld[]
  plans: InspectionPlan[]
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
}
