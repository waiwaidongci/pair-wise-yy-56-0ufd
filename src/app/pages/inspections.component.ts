import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { TextareaModule } from 'primeng/textarea'
import { SelectButtonModule } from 'primeng/selectbutton'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import { type Defect, type Weld } from '../types'

type Row = { weld: Weld; defect: Defect }

@Component({
  selector:'app-inspections', standalone:true, imports:[CommonModule,FormsModule,TableModule,TagModule,ButtonModule,DialogModule,InputTextModule,TextareaModule,SelectButtonModule],
  template:`
    <main class="page">
      <div class="page-head">
        <div><p class="eyebrow">NDT / 处置链闭环</p><h1>检测计划与返修</h1><p>缺陷 → 返修（逐次留痕）→ 复检结论 → 检测计划共用一条处置链；同一处复检合格前不开下一道工序。</p></div>
        <p-button label="录入检测结果" icon="pi pi-plus" (onClick)="openDefect()" />
      </div>

      <div class="grid-2">
        <section class="card">
          <h2 class="panel-title">批量检测计划（与处置链联动重算）</h2>
          <p-table [value]="state.plans" [paginator]="true" [rows]="6">
            <ng-template #header><tr><th>计划编号</th><th>日期 / 修订</th><th>方法</th><th>焊缝</th><th>检测人</th><th>状态</th></tr></ng-template>
            <ng-template #body let-plan>
              <tr [class.row-flag]="plan.state === '待复核'">
                <td>{{plan.id}}<small class="block" *ngIf="plan.recalcReason">重算：{{plan.recalcReason}}</small></td>
                <td>{{plan.date}}<small class="block">rev.{{plan.revision}}</small></td>
                <td>{{plan.method}}</td>
                <td>{{plan.weldIds.length}} 条<span class="block danger" *ngIf="plan.removedWeldIds?.length">已剔除 {{plan.removedWeldIds.join('、')}}</span></td>
                <td>{{plan.inspector}}</td>
                <td><p-tag [value]="plan.state" [severity]="plan.state === '已完成' ? 'success' : plan.state === '执行中' ? 'info' : 'danger'" /></td>
              </tr>
            </ng-template>
          </p-table>
        </section>

        <aside class="card">
          <h2 class="panel-title">待复核结论（各页面同一份）</h2>
          <p class="muted" *ngIf="!pendingReviews.length">暂无待复核项。</p>
          <div class="review" *ngFor="let r of pendingReviews">
            <div><b><p-tag [value]="r.kind" severity="danger" /> {{r.target}}</b><p>{{r.summary}}</p><small class="block muted">{{r.detail}}</small></div>
            <div class="review-actions">
              <p-button label="确认" size="small" (onClick)="resolve(r.id,'确认')" />
              <p-button label="退回复核" size="small" severity="danger" text (onClick)="resolve(r.id,'退回方案')" />
            </div>
          </div>
        </aside>
      </div>

      <section class="card mt-4">
        <h2 class="panel-title">缺陷处置链：逐次返修与复检</h2>
        <p-table [value]="chains" [paginator]="true" [rows]="8" [rowHover]="true">
          <ng-template #header><tr><th>缺陷 / 焊缝</th><th>位置与性质</th><th>返修记录（逐次）</th><th>复检结论</th><th>环节</th><th>处置</th></tr></ng-template>
          <ng-template #body let-row>
            <tr [class.row-open]="row.defect.gate !== '已闭合'">
              <td><b>{{row.defect.id}}</b><small class="block">{{row.weld.id}} · {{row.weld.component}}</small><small class="block muted" *ngIf="row.defect.conflicts.length">⚠ {{row.defect.conflicts.length}} 笔并发录入留作冲突</small></td>
              <td>{{row.defect.position}}% · {{row.defect.length}}mm<small class="block">{{row.defect.type}} · {{row.defect.level}} · {{row.defect.method}}</small></td>
              <td>
                <div class="attempt" *ngFor="let rp of row.defect.repairs">
                  <b>第{{rp.seq}}次</b>：{{rp.method}}<small class="block">位置 {{rp.position}}% · 结果 {{rp.result}} · {{rp.operator}} · {{rp.time}}</small>
                </div>
                <small class="muted" *ngIf="!row.defect.repairs.length">尚无返修</small>
              </td>
              <td>
                <div class="attempt" *ngFor="let ri of row.defect.reinspections">
                  <p-tag [value]="ri.result" [severity]="ri.result === '合格' ? 'success' : 'danger'" [style]="{'font-size':'11px'}" />
                  {{ri.method}}<small class="block">{{ri.inspector}} · {{ri.time}} · {{ri.report}}</small>
                </div>
                <small class="muted" *ngIf="!row.defect.reinspections.length">未复检</small>
              </td>
              <td><p-tag [value]="row.defect.gate" [severity]="row.defect.gate === '已闭合' ? 'success' : 'warn'" /></td>
              <td class="chain-actions">
                <p-button label="登记返修" size="small" (onClick)="openRepair(row)" />
                <p-button label="登记复检" size="small" severity="secondary" (onClick)="openReinspection(row)" />
                <p-button label="放行下道工序" size="small" text [severity]="row.defect.gate === '已闭合' ? 'success' : 'danger'" (onClick)="advance(row.weld)" />
              </td>
            </tr>
          </ng-template>
        </p-table>
      </section>

      <section class="card mt-4">
        <h2 class="panel-title">请求日志：失败按编号恢复（幂等）</h2>
        <p class="muted">每笔写入带请求编号；恢复或重放按编号去重，返修次数与计划条目不重复追加。</p>
        <p-table [value]="state.requests" [paginator]="true" [rows]="5">
          <ng-template #header><tr><th>请求编号</th><th>类型</th><th>摘要</th><th>状态</th><th>操作</th></tr></ng-template>
          <ng-template #body let-log>
            <tr [class.row-flag]="log.status === '失败待恢复'">
              <td><code>{{log.requestId}}</code><small class="block muted">{{log.time}}</small></td>
              <td>{{log.kind}}</td><td>{{log.summary}}</td>
              <td><p-tag [value]="log.status" [severity]="log.status === '失败待恢复' ? 'danger' : log.status === '已恢复' ? 'info' : 'success'" /></td>
              <td>
                <p-button *ngIf="log.status === '失败待恢复'" label="按编号恢复" icon="pi pi-refresh" size="small" (onClick)="recover(log.requestId)" />
                <span class="muted" *ngIf="log.status !== '失败待恢复'">—</span>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </section>

      <!-- 录入缺陷 -->
      <p-dialog header="录入检测结果 / 缺陷" [(visible)]="defectDialog" [modal]="true" [style]="{width:'620px'}">
        <div class="form">
          <label>焊缝编号</label><select [(ngModel)]="defectForm.weldId"><option *ngFor="let w of state.welds" [value]="w.id">{{w.id}} · {{w.component}}</option></select>
          <label>检测方法</label><select [(ngModel)]="defectForm.method"><option>UT</option><option>MT</option><option>PT</option></select>
          <label>缺陷位置（0–100%）</label><input pInputText type="number" [(ngModel)]="defectForm.position" />
          <label>缺陷类型与等级</label><input pInputText [(ngModel)]="defectForm.type" placeholder="如：未熔合 / Ⅲ级" />
          <label>报告编号与说明</label><textarea pTextarea [(ngModel)]="defectForm.report" rows="3"></textarea>
          <label class="check"><input type="checkbox" [(ngModel)]="defectForm.simulateFail" /> 模拟本次写入失败（演示按请求编号恢复）</label>
          <p class="muted">请求编号：<code>{{defectForm.requestId}}</code> · 同一焊缝同一位置并发录入时只放行先到一笔。</p>
        </div>
        <ng-template #footer><p-button label="取消" severity="secondary" (onClick)="defectDialog=false" /><p-button label="提交结果" [disabled]="!defectForm.weldId || !defectForm.report" (onClick)="submitDefect()" /></ng-template>
      </p-dialog>

      <!-- 登记返修 -->
      <p-dialog header="登记返修（逐次留痕）" [(visible)]="repairDialog" [modal]="true" [style]="{width:'560px'}">
        <div class="form" *ngIf="active as row">
          <p><b>{{row.weld.id}} / {{row.defect.id}}</b> · 位置 {{row.defect.position}}% · 已返修 {{row.defect.repairs.length}} 次</p>
          <label>返修位置（%）</label><input pInputText type="number" [(ngModel)]="repairForm.position" />
          <label>返修方法</label><input pInputText [(ngModel)]="repairForm.method" placeholder="如：碳弧气刨清根 + GMAW 补焊" />
          <label>返修结果</label><p-selectbutton [options]="['待复检','合格','不合格']" [(ngModel)]="repairForm.result" />
          <label>返修人 / 焊工确认</label><input pInputText [(ngModel)]="repairForm.operator" />
          <label class="check"><input type="checkbox" [(ngModel)]="repairForm.qualificationInvalid" /> 焊工资质已失效（立即重算相关计划并退回复核）</label>
          <label class="check"><input type="checkbox" [(ngModel)]="repairForm.simulateFail" /> 模拟写入失败（提交后到日志中恢复，次数不重复）</label>
        </div>
        <ng-template #footer><p-button label="取消" severity="secondary" (onClick)="repairDialog=false" /><p-button label="提交返修" (onClick)="submitRepair()" /></ng-template>
      </p-dialog>

      <!-- 登记复检 -->
      <p-dialog header="登记复检结论" [(visible)]="reinspectDialog" [modal]="true" [style]="{width:'520px'}">
        <div class="form" *ngIf="active as row">
          <p><b>{{row.weld.id}} / {{row.defect.id}}</b> · 位置 {{row.defect.position}}%</p>
          <label>复检方法</label><select [(ngModel)]="reinspectForm.method"><option>UT</option><option>MT</option><option>PT</option></select>
          <label>复检结论</label><p-selectbutton [options]="[{label:'合格（闭合缺陷、放行）',value:true},{label:'不合格（重算计划、退回复核）',value:false}]" [(ngModel)]="reinspectForm.passed" optionLabel="label" optionValue="value" />
          <label>复检报告</label><textarea pTextarea [(ngModel)]="reinspectForm.report" rows="3"></textarea>
          <label>检测人</label><input pInputText [(ngModel)]="reinspectForm.inspector" />
        </div>
        <ng-template #footer><p-button label="取消" severity="secondary" (onClick)="reinspectDialog=false" /><p-button label="提交复检" (onClick)="submitReinspection()" /></ng-template>
      </p-dialog>
    </main>
  `,
  styles:[`
    .block{display:block}.muted{color:#7a8798;font-size:12px}.danger{color:#dc2626}
    .mt-4{margin-top:16px}.row-open{background:#fff7ed}.row-flag{background:#fef2f2}
    .attempt{padding:6px 0;border-bottom:1px dashed #e2e8f0;font-size:13px}.attempt:last-child{border-bottom:0}
    .chain-actions{display:flex;flex-direction:column;gap:4px;align-items:flex-start}
    .review{padding:12px 0;border-bottom:1px solid #edf0f5}.review b{display:flex;align-items:center;gap:6px}.review p{margin:5px 0 3px;font-size:13px}.review-actions{display:flex;gap:6px;margin-top:6px}
    .form{display:grid;gap:9px}.form input[type="text"],.form input:not([type]),.form select,.form textarea,.form input[type="number"]{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}
    .form label.check{display:flex;align-items:center;gap:8px;font-size:13px}.form label.check input{width:auto}
    code{background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:12px}
  `],
})
export class InspectionsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState

  defectDialog = false
  repairDialog = false
  reinspectDialog = false
  active: Row | null = null

  defectForm = this.freshDefect()
  repairForm = { position: 0, method: '', result: '待复检' as '合格' | '不合格' | '待复检', operator: '', qualificationInvalid: false, simulateFail: false }
  reinspectForm = { method: 'UT', passed: true, report: '', inspector: '赵岚' }

  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }

  get chains(): Row[] {
    return (this.state?.welds ?? []).flatMap((weld) => weld.defects.map((defect) => ({ weld, defect })))
  }
  get pendingReviews() { return (this.state?.reviews ?? []).filter((r) => r.state === '待复核') }

  private freshDefect() {
    return { weldId: 'W-109', method: 'UT', position: 42, type: '夹渣 / Ⅱ级', report: 'UT-2026-1001-01；按 NB/T 47013.3 评定。', requestId: this.newRequestId(), simulateFail: false }
  }
  private newRequestId() { return `REQ-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}` }

  openDefect() { this.defectForm = this.freshDefect(); this.defectDialog = true }

  openRepair(row: Row) {
    this.active = row
    this.repairForm = { position: row.defect.position, method: '', result: '待复检', operator: row.weld.welder, qualificationInvalid: false, simulateFail: false }
    this.repairDialog = true
  }

  openReinspection(row: Row) {
    this.active = row
    this.reinspectForm = { method: row.defect.method, passed: true, report: '', inspector: '赵岚' }
    this.reinspectDialog = true
  }

  submitDefect() {
    const f = this.defectForm
    const [defectType, levelRaw] = f.type.split('/').map((s) => s.trim())
    const level = ((levelRaw ?? 'Ⅱ级').replace(/\s/g, '')) as 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'
    const props = {
      requestId: f.requestId, weldId: f.weldId, inspector: '陈锋',
      position: Number(f.position), defectType: defectType || f.type,
      level,
      length: 10, method: f.method, report: f.report,
    }
    if (f.simulateFail) {
      // 写入失败：只留编号和原始请求，处置链不产生任何变化
      this.store.dispatch(A.writeFailed({
        requestId: f.requestId, kind: '缺陷登记',
        summary: `${f.weldId} · 位置 ${f.position}% · ${f.type}`,
        payload: { ...props, type: props.defectType },
      }))
    } else {
      this.store.dispatch(A.defectSubmitted(props))
    }
    this.defectDialog = false
  }

  submitRepair() {
    if (!this.active) return
    const row = this.active
    const f = this.repairForm
    const requestId = this.newRequestId()
    const props = {
      requestId, weldId: row.weld.id, defectId: row.defect.id,
      position: Number(f.position) || row.defect.position, method: f.method || '按 WPS 补焊',
      result: f.result, operator: f.operator || row.weld.welder, qualificationInvalid: f.qualificationInvalid,
    }
    if (f.simulateFail) {
      this.store.dispatch(A.writeFailed({ requestId, kind: '返修登记', summary: `${row.weld.id} · ${props.method} · ${f.result}`, payload: props }))
    } else {
      this.store.dispatch(A.repairSubmitted(props))
    }
    this.repairDialog = false
  }

  submitReinspection() {
    if (!this.active) return
    const row = this.active
    const f = this.reinspectForm
    this.store.dispatch(A.reinspectionSubmitted({
      requestId: this.newRequestId(), weldId: row.weld.id, defectId: row.defect.id,
      method: f.method, passed: f.passed, inspector: f.inspector || '赵岚',
      report: f.report || (f.passed ? '复检合格，准予闭合' : '复检不合格，退回返修'),
    }))
    this.reinspectDialog = false
  }

  advance(weld: Weld) {
    const open = weld.defects.filter((d) => d.gate !== '已闭合')
    if (open.length) {
      this.store.dispatch(A.processAdvanceRequested({ weldId: weld.id, actor: '陈锋', nextProcess: '下道工序（转序/隐蔽）' }))
      return
    }
    this.store.dispatch(A.advanceWeld({ id: weld.id, status: '合格' }))
  }

  resolve(id: string, decision: '确认' | '退回方案') { this.store.dispatch(A.reviewResolved({ id, decision, actor: '质量负责人' })) }
  recover(requestId: string) { this.store.dispatch(A.writeRecovered({ requestId })) }
}
