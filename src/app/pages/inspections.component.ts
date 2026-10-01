import { Component, inject, ViewChild } from '@angular/core'
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
import type { Defect, Weld } from '../types'
import { ReviewBannerComponent } from '../shared/review-banner.component'
import { ChainDialogsComponent } from '../shared/chain-dialogs.component'

@Component({
  selector:'app-inspections', standalone:true, imports:[CommonModule,FormsModule,TableModule,TagModule,ButtonModule,DialogModule,InputTextModule,TextareaModule,SelectButtonModule,ReviewBannerComponent,ChainDialogsComponent],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">NDT / 返修闭环</p><h1>检测计划与返修</h1><p>缺陷、返修结果、复检结论与检测计划共用一条处置链：同一处复检合格前不开下一道工序，写入按请求编号幂等恢复。</p></div><p-button label="新增检测结果" icon="pi pi-plus" (onClick)="dialog = true" /></div>
      <app-review-banner />
      <div class="grid-2 mt-3"><section class="card"><h2 class="panel-title">批量检测计划</h2><p-table [value]="state.plans" [paginator]="true" [rows]="6"><ng-template #header><tr><th>计划编号</th><th>日期</th><th>方法</th><th>焊缝</th><th>检测人</th><th>状态</th></tr></ng-template><ng-template #body let-plan><tr><td>{{plan.id}}</td><td>{{plan.date}}</td><td>{{plan.method}}</td><td>{{plan.weldIds.length}} 条</td><td>{{plan.inspector}}</td><td><p-tag [value]="plan.state" [severity]="plan.state === '已完成' ? 'success' : plan.state === '执行中' ? 'info' : plan.state === '待复核' ? 'danger' : 'warn'" /></td></tr></ng-template></p-table></section>
      <aside class="card"><h2 class="panel-title">返修状态流转</h2><div class="step" *ngFor="let weld of repairWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.defects.length}} 个缺陷 · 已返修 {{weld.repairs}} 次</small></div><p-tag [value]="weld.status" severity="warn" /><p-selectbutton [options]="['返修中','待复检','合格']" [ngModel]="weld.status" (ngModelChange)="advance(weld.id,$event)" /></div><p-button label="提交质量负责人审核" icon="pi pi-send" styleClass="w-full" /></aside></div>
      <section class="card mt-4"><h2 class="panel-title">缺陷与处置链明细</h2><p-table [value]="defects" [paginator]="true" [rows]="8"><ng-template #header><tr><th>缺陷编号</th><th>焊缝</th><th>位置 / 长度</th><th>类型 / 等级</th><th>检测方法</th><th>返修处置链</th><th>操作</th></tr></ng-template><ng-template #body let-item><tr><td>{{item.defect.id}}</td><td>{{item.weld.id}}</td><td>{{item.defect.position}}% · {{item.defect.length}}mm</td><td>{{item.defect.type}} · {{item.defect.level}}</td><td>{{item.defect.method}}</td><td><div class="chain" *ngIf="item.defect.repairs.length"><span class="round" *ngFor="let r of item.defect.repairs" [class.open]="r.result === '返修中' || r.result === '待复检'"><b>第{{r.round}}轮</b> · {{r.position}}% · {{r.method}} · <i [class.danger]="r.result === '复检不合格'" [class.success]="r.result === '复检合格'">{{r.result}}</i><em *ngIf="r.recheck">（复检 {{r.recheck.conclusion}}）</em></span></div><span class="muted" *ngIf="!item.defect.repairs.length">尚未登记返修</span></td><td><p-button label="登记返修" icon="pi pi-wrench" size="small" text (onClick)="chain.openRepair(item.weld,item.defect)" /><p-button label="提交复检" icon="pi pi-check-circle" size="small" text (onClick)="chain.openRecheck(item.weld,item.defect)" /></td></tr></ng-template></p-table></section>
      <div class="grid-2 mt-4"><section class="card"><h2 class="panel-title">并发录入冲突 <p-tag [value]="state.conflicts.length + ' 笔'" severity="danger" /></h2><p class="muted" *ngIf="!state.conflicts.length">无冲突记录。两名质检员同时录入同一缺陷时，先到的一笔放行，后到内容留作冲突。</p><div class="conflict" *ngFor="let c of state.conflicts"><div><b>{{c.defectId}} · {{c.time}}</b><small>{{c.reason}}</small><small>后到内容：{{c.incoming.type}} · {{c.incoming.length}}mm · {{c.incoming.method}} · 请求 {{c.loserRequestId}}</small></div><p-tag [value]="c.resolved ? '已处理' : '待处理'" [severity]="c.resolved ? 'success' : 'danger'" /><p-button label="保留先到" size="small" text [disabled]="c.resolved" (onClick)="resolve(c.id,'keep-winner')" /><p-button label="采纳后到" size="small" [disabled]="c.resolved" (onClick)="resolve(c.id,'apply-loser')" /></div></section>
      <section class="card"><h2 class="panel-title">写入失败与恢复 <p-tag [value]="failedWrites.length + ' 笔待恢复'" severity="warn" /></h2><p class="muted" *ngIf="!failedWrites.length">无失败写入。所有写操作按请求编号幂等重试，返修次数与计划条目不重复追加。</p><div class="conflict" *ngFor="let w of failedWrites"><div><b>{{w.kind}} · {{w.requestId}}</b><small>{{w.error}} · 已尝试 {{w.attempts}} 次 · {{w.time}}</small></div><p-button label="按请求编号恢复" icon="pi pi-replay" size="small" (onClick)="recover(w.requestId)" /></div></section></div>
      <p-dialog header="录入检测结果" [(visible)]="dialog" [modal]="true" [style]="{width:'620px'}"><div class="form"><label>焊缝编号</label><input pInputText [(ngModel)]="form.weldId" /><label>检测方法</label><select [(ngModel)]="form.method"><option>UT</option><option>MT</option><option>PT</option></select><label>缺陷位置（0–100%）</label><input pInputText type="number" [(ngModel)]="form.position" /><label>缺陷类型与等级</label><input pInputText [(ngModel)]="form.type" placeholder="如：未熔合 / Ⅲ级" /><label>报告编号与说明</label><textarea pTextarea [(ngModel)]="form.report" rows="4"></textarea></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="dialog=false" /><p-button label="提交结果" [disabled]="!form.weldId || !form.report" (onClick)="submitEntry(false)" /><p-button label="模拟另一质检员同时录入" severity="help" (onClick)="submitEntry(true)" /></ng-template></p-dialog>
      <app-chain-dialogs #chain />
    </main>
  `,
  styles:[`.step{display:grid;grid-template-columns:1fr auto;gap:9px;padding:12px 0;border-bottom:1px solid #edf0f5}.step>div,.step small{display:block}.step small{color:#7a8798;margin-top:4px}.step p-selectbutton{grid-column:1/-1}.form{display:grid;gap:9px}.form input,.form select,.form textarea{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.mt-3{margin-top:12px}.mt-4{margin-top:16px}.chain{display:flex;flex-wrap:wrap;gap:6px}.round{font-size:12px;background:#f1f5f9;border-radius:4px;padding:3px 7px}.round.open{background:#fef3c7}.round i{font-style:normal}.conflict{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid #edf0f5}.conflict b,.conflict small{display:block}.conflict small{color:#7a8798;margin-top:3px}.muted{color:#7a8798}.danger{color:#dc2626}.success{color:#15803d}@media(max-width:760px){.conflict{grid-template-columns:1fr}}`],
})
export class InspectionsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  dialog = false
  form = { weldId:'W-107', method:'UT', position:68, type:'未熔合 / Ⅲ级', report:'UT-2026-0929-08；按 NB/T 47013.3 评定。' }
  @ViewChild('chain') chain!: ChainDialogsComponent
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get repairWelds() { return (this.state?.welds ?? []).filter((item) => ['返修中','待复检'].includes(item.status)) }
  get defects() { return (this.state?.welds ?? []).flatMap((weld) => weld.defects.map((defect) => ({ weld, defect }))) }
  get failedWrites() { return (this.state?.pendingWrites ?? []).filter((w) => w.status === 'failed') }
  advance(id: string, status: string) { this.store.dispatch(A.advanceWeld({ id, status: status as never })) }
  submitEntry(simulateConflict: boolean) {
    const weld = this.state.welds.find((w) => w.id === this.form.weldId)
    const defect = weld?.defects[weld.defects.length - 1]
    const baseVersion = simulateConflict ? (defect?.version ?? 1) - 1 : (defect?.version ?? 0)
    this.store.dispatch(A.recordDefectEntry({
      weldId: this.form.weldId, position: Number(this.form.position), defectType: this.form.type,
      length: 0, level: 'Ⅲ级', method: this.form.method, report: this.form.report,
      requestId: `REQ-DF-${Date.now()}`, baseVersion,
    }))
    this.dialog = false
  }
  recover(requestId: string) { this.store.dispatch(A.recoverWrite({ requestId })) }
  resolve(conflictId: string, decision: 'keep-winner' | 'apply-loser') { this.store.dispatch(A.resolveConflict({ conflictId, decision })) }
}
