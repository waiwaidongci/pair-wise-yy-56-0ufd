import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { SelectModule } from 'primeng/select'
import { FormsModule } from '@angular/forms'
import { WeldGraphqlService } from '../services/weld-graphql.service'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import { hasOpenDefect, totalRepairs, type Weld } from '../types'

@Component({
  selector:'app-overview', standalone:true, imports:[CommonModule,TableModule,TagModule,ButtonModule,SelectModule,FormsModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">焊缝、资质与检测比例</p><h1>焊缝台账总览</h1><p>按构件、图纸和检验节点管理焊缝，优先暴露焊工资质过期、检测比例不足、未闭合缺陷与重复返修。</p></div><p-button label="批量导入焊缝" icon="pi pi-upload" severity="secondary" /></div>
      <div class="grid-4"><article class="card metric"><span>焊缝总数</span><strong>{{state.welds.length}}</strong><small>已建地图定位 {{state.welds.length}} 条</small></article><article class="card metric"><span>待检测 / 返修 / 待复检</span><strong class="warning">{{pending}}</strong><small>{{activePlans}} 项计划进行中 · {{recalcPlans}} 项待复核重算</small></article><article class="card metric"><span>预警或未闭合</span><strong class="danger">{{warnings}}</strong><small>必须处理后才可锁定</small></article><article class="card metric"><span>版本快照</span><strong>v{{state.version}}</strong><small>{{state.locked ? '批次已签字锁定（快照冻结）' : '可继续修改'}}</small></article></div>
      <div class="grid-2"><section class="card"><div class="toolbar"><p-select [options]="statusOptions" [(ngModel)]="filter" (ngModelChange)="applyFilter($event)" placeholder="筛选状态" styleClass="w-full md:w-40" /><span class="spacer"></span><p-button label="导出焊缝台账" icon="pi pi-file-excel" severity="secondary" /></div><p-table [value]="filtered" [paginator]="true" [rows]="8" selectionMode="single" (onRowSelect)="select($event.data)" dataKey="id"><ng-template #header><tr><th>焊缝 / 构件</th><th>方法与焊工</th><th>检测</th><th>返修 / 缺陷</th><th>状态</th></tr></ng-template><ng-template #body let-weld><tr><td><b>{{weld.id}}</b><small class="block">{{weld.drawing}} · {{weld.component}}</small></td><td>{{weld.method}} · {{weld.welder}}<small class="block" [class.danger]="!weld.qualificationValid">{{weld.qualificationValid ? '资质有效' : '资质已失效'}}</small></td><td><b [class.danger]="weld.inspectionRatio < weld.requiredRatio">{{weld.inspectionRatio}}% / {{weld.requiredRatio}}%</b><small class="block">要求检测比例</small></td><td>累计 {{totalRepairs(weld)}} 次<small class="block" *ngFor="let d of openDefects(weld)">⛓ {{d.id}} 位置 {{d.position}}% · {{d.gate}}</small><small class="block warning-text" *ngIf="repairs(weld) >= 2">重复返修关注</small></td><td><p-tag [value]="weld.status" [severity]="weld.status === '合格' || weld.status === '已关闭' ? 'success' : weld.status === '返修中' ? 'danger' : 'warn'" /></td></tr></ng-template></p-table></section>
      <aside class="card"><h2 class="panel-title">统一待复核结论</h2><p class="muted" *ngIf="!pendingReviews.length">暂无待复核项，各页面结论一致。</p><div class="warning-row" *ngFor="let r of pendingReviews"><i class="red"></i><div><b>{{r.kind}} · {{r.target}}</b><p>{{r.summary}}</p><small class="block muted">{{r.detail}}</small></div></div>
        <h2 class="panel-title second">规则预警</h2>
        <div class="warning-row"><i class="red"></i><div><b>W-109 焊工资质已失效</b><p>孙鹏证书 2026-10-01 到期，关联检测计划已重算剔除并退回复核。</p></div></div>
        <div class="warning-row"><i class="amber"></i><div><b>W-109 检测比例不足</b><p>当前计划 10%，图纸及规范要求 20%。</p></div></div>
        <div class="warning-row"><i class="amber"></i><div><b>W-104 同一位置二次返修</b><p>D-31 两次返修均留痕，复检未闭合前不得转序，须质量负责人确认工艺。</p></div></div>
      </aside></div>
    </main>
  `,
  styles:[`.block{display:block;color:#7a8798;margin-top:3px}.danger{color:#dc2626}.warning-text{color:#d97706}.muted{color:#94a3b8;font-size:12px}.second{margin-top:14px}.warning-row{display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #edf0f5}.warning-row i{width:6px;border-radius:5px;background:#f59e0b;flex:none}.warning-row i.red{background:#ef4444}.warning-row div{flex:1}.warning-row p{margin:4px 0 0;font-size:13px}`],
})
export class OverviewComponent implements OnInit {
  private readonly store = inject(Store<{ welds: WeldState }>)
  private readonly api = inject(WeldGraphqlService)
  state!: WeldState
  filter = '全部'
  statusOptions = ['全部','待检测','合格','返修中','待复检','已关闭']
  ngOnInit() {
    this.store.select('welds').subscribe((state) => this.state = state)
    this.api.load().subscribe(({ welds, plans, reviews }) => this.store.dispatch(A.loadWeldsSuccess({ welds, plans, reviews })))
  }
  get filtered() { return this.filter === '全部' ? this.state?.welds ?? [] : (this.state?.welds ?? []).filter((item) => item.status === this.filter) }
  get pending() { return (this.state?.welds ?? []).filter((item) => ['待检测','返修中','待复检'].includes(item.status)).length }
  get activePlans() { return (this.state?.plans ?? []).filter((p) => p.state === '执行中' || p.state === '待执行').length }
  get recalcPlans() { return (this.state?.plans ?? []).filter((p) => p.state === '待复核').length }
  get pendingReviews() { return (this.state?.reviews ?? []).filter((r) => r.state === '待复核') }
  get warnings() { return (this.state?.welds ?? []).filter((item) => !item.qualificationValid || item.inspectionRatio < item.requiredRatio || totalRepairs(item) >= 2 || hasOpenDefect(item)).length }
  totalRepairs = totalRepairs
  repairs(weld: Weld) { return totalRepairs(weld) }
  openDefects(weld: Weld) { return weld.defects.filter((d) => d.gate !== '已闭合') }
  applyFilter(status: string) { this.store.dispatch(A.filterStatus({ status })) }
  select(weld: Weld | Weld[] | undefined) { if (weld && !Array.isArray(weld)) this.store.dispatch(A.selectWeld({ id: weld.id })) }
}
