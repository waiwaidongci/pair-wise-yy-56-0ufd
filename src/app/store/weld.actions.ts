import { createAction, props } from '@ngrx/store'
import type { ConflictRecord, DefectLevel, InspectionPlan, Weld, WeldStatus } from '../types'

export const loadWelds = createAction('[Weld] Load')
export const loadWeldsSuccess = createAction('[Weld API] Load Success', props<{ welds: Weld[]; plans: InspectionPlan[] }>())
export const selectWeld = createAction('[Weld] Select', props<{ id: string }>())
export const filterStatus = createAction('[Weld] Filter Status', props<{ status: string }>())
export const advanceWeld = createAction('[Weld] Advance', props<{ id: string; status: WeldStatus; note?: string }>())
export const createPlan = createAction('[Inspection] Create Plan', props<{ plan: InspectionPlan; requestId?: string }>())
export const lockBaseline = createAction('[Approval] Lock Baseline')

// 处置链：缺陷 -> 返修 -> 复检 -> 计划
export const recordDefectEntry = createAction('[Chain] Defect Entry', props<{
  weldId: string; defectId?: string; position: number; defectType: string; length: number
  level: DefectLevel; method: string; report: string; requestId: string; baseVersion: number
}>())
export const recordRepair = createAction('[Chain] Record Repair', props<{
  weldId: string; defectId: string; position: number; method: string; requestId: string
}>())
export const submitRecheck = createAction('[Chain] Submit Recheck', props<{
  weldId: string; defectId: string; conclusion: '合格' | '不合格'; note: string; requestId: string
}>())
export const recoverWrite = createAction('[Chain] Recover Write', props<{ requestId: string }>())
export const resolveConflict = createAction('[Chain] Resolve Conflict', props<{ conflictId: string; decision: 'keep-winner' | 'apply-loser' }>())
export const qualificationExpired = createAction('[Chain] Qualification Expired', props<{ weldId: string }>())
