import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { DialogModule } from 'primeng/dialog'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import { totalRepairs, type Weld } from '../types'

@Component({
  selector:'app-weld-map', standalone:true, imports:[CommonModule,ButtonModule,TagModule,DialogModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">二维构件定位</p><p class="eyebrow-sub">缺陷、逐次返修位置与复检状态都挂在同一条处置链上</p><h1>构件焊缝地图</h1><p>在构件展开图上定位焊缝、缺陷和返修位置，颜色代表当前质量状态；未闭合缺陷的焊缝不得放行。</p></div><p-button label="批量生成检测计划" icon="pi pi-calendar-plus" (onClick)="planDialog = true" /></div>
      <div class="map-grid"><section class="card drawing-card"><div class="drawing-head"><span>构件图 SG-07-屋面梁 · 展开示意</span><span>单位：mm · 比例 1:50</span></div><svg viewBox="0 0 100 90" class="weld-map"><defs><pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="#dbe2ea" stroke-width=".2"/></pattern></defs><rect x="3" y="3" width="94" height="84" fill="url(#grid)" stroke="#334155"/><path d="M8 20H92M8 42H92M8 66H92" stroke="#94a3b8" stroke-width="4"/><path d="M16 12V78M42 12V78M70 12V78M86 12V78" stroke="#cbd5e1" stroke-width="7"/><g *ngFor="let weld of state.welds"><circle [attr.cx]="weld.x" [attr.cy]="weld.y" r="3.2" [attr.fill]="color(weld)" stroke="#fff" stroke-width="1" (click)="select(weld)" /><text [attr.x]="weld.x+4" [attr.y]="weld.y-4" class="label">{{weld.id}}</text><circle *ngFor="let defect of openDefects(weld)" [attr.cx]="weld.x + defect.position / 30" [attr.cy]="weld.y + 4" r="1.4" fill="#dc2626" /></g><text x="50" y="86" class="axis">构件长度方向 →</text></svg></section>
        <aside class="card"><h2 class="panel-title">焊缝明细与处置链</h2><div *ngIf="selected" class="detail"><div class="detail-head"><div><small>{{selected.drawing}}</small><h3>{{selected.id}} · {{selected.component}}</h3></div><p-tag [value]="selected.status" [severity]="selected.status === '合格' || selected.status === '已关闭' ? 'success' : selected.status === '返修中' ? 'danger' : 'warn'" /></div><div class="kv"><span>焊接方法</span><b>{{selected.method}} / {{selected.joint}}</b></div><div class="kv"><span>焊工</span><b [class.danger]="!selected.qualificationValid">{{selected.welder}} · {{selected.qualificationValid ? '资质有效' : '资质已失效'}}</b></div><div class="kv"><span>检测比例</span><b [class.danger]="selected.inspectionRatio < selected.requiredRatio">{{selected.inspectionRatio}}% / {{selected.requiredRatio}}%</b></div><div class="kv"><span>返修次数（链上汇总）</span><b>{{totalRepairs(selected)}}</b></div><h3>缺陷处置链</h3><div *ngFor="let defect of selected.defects" class="defect"><b>{{defect.id}} · {{defect.type}} <p-tag [value]="defect.gate" [severity]="defect.gate === '已闭合' ? 'success' : 'warn'" styleClass="ml-1" /></b><p>位置 {{defect.position}}% · 长度 {{defect.length}}mm · {{defect.level}} · {{defect.method}}</p><p>返修 {{defect.repairs.length}} 次：<span *ngFor="let rp of defect.repairs; let last = last">第{{rp.seq}}次 {{rp.result}}（{{rp.method}}）<ng-container *ngIf="!last">；</ng-container></span></p><p>复检：<span *ngFor="let ri of defect.reinspections; let last = last">{{ri.method}} {{ri.result}}<ng-container *ngIf="!last">；</ng-container></span><span *ngIf="!defect.reinspections.length" class="muted">尚无</span></p><p class="conflict" *ngIf="defect.conflicts.length">⚠ {{defect.conflicts.length}} 笔后到录入留作冲突，待裁决</p></div><p class="muted" *ngIf="!selected.defects.length">当前无缺陷记录。</p><p-button label="申请放行下道工序" icon="pi pi-step-forward" [severity]="hasOpen(selected) ? 'danger' : 'success'" styleClass="w-full" (onClick)="requestAdvance(selected)" /></div></aside></div>
      <p-dialog header="生成批量检测计划" [(visible)]="planDialog" [modal]="true" [style]="{width:'560px'}"><div class="dialog-form"><label>检测方法</label><select><option>UT 超声检测</option><option>MT 磁粉检测</option><option>UT + MT</option></select><label>计划日期</label><input type="date" value="2026-10-02" /><label>检测人员</label><select><option>陈锋</option><option>赵岚</option></select><p>系统排除资质失效焊工与未闭合缺陷焊缝；复检不合格或资质失效时计划立即重算并退回复核。</p></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="planDialog = false" /><p-button label="生成计划" (onClick)="createPlan()" /></ng-template></p-dialog>
    </main>
  `,
  styles:[`.map-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(310px,.65fr);gap:16px}.drawing-card{padding:0;overflow:hidden}.drawing-head{display:flex;justify-content:space-between;padding:13px 16px;background:#f8fafc;border-bottom:1px solid #e1e7ef;color:#64748b;font-size:13px}.weld-map{width:100%;height:min(68vh,680px);display:block;background:#fff}.weld-map circle{cursor:pointer}.label{font-size:2.4px;font-weight:700;fill:#334155}.axis{font-size:2.2px;fill:#94a3b8}.detail-head{display:flex;justify-content:space-between}.detail-head small{color:#7a8798}.detail-head h3{margin:5px 0}.kv{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #edf0f5}.kv span{color:#667085}.defect{margin-top:10px;padding:10px;background:#fff1f2;border-left:3px solid #ef4444;border-radius:5px}.defect p{margin:4px 0 0;font-size:13px}.conflict{color:#b45309}.dialog-form{display:grid;gap:8px}.dialog-form input,.dialog-form select{padding:9px;border:1px solid #cbd5e1;border-radius:6px}.muted{color:#7a8798}.danger{color:#dc2626}.ml-1{margin-left:4px}`],
})
export class WeldMapComponent {
  readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  planDialog = false
  totalRepairs = totalRepairs
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get selected() { return this.state?.welds.find((item) => item.id === this.state.selectedId) }
  openDefects(weld: Weld) { return weld.defects.filter((d) => d.gate !== '已闭合') }
  hasOpen(weld: Weld) { return this.openDefects(weld).length > 0 }
  select(weld: Weld) { this.store.dispatch(A.selectWeld({ id: weld.id })) }
  color(weld: Weld) { return weld.status === '合格' || weld.status === '已关闭' ? '#16a34a' : weld.status === '返修中' || !weld.qualificationValid ? '#dc2626' : weld.status === '待复检' ? '#7c3aed' : '#f59e0b' }
  requestAdvance(weld: Weld) {
    this.store.dispatch(A.processAdvanceRequested({ weldId: weld.id, actor: '现场班组', nextProcess: '下道工序（转序/隐蔽）' }))
  }
  createPlan() { this.store.dispatch(A.createPlan({ plan:{ id:`IP-${Date.now().toString().slice(-6)}`, date:'2026-10-02', method:'UT + MT', weldIds:['W-105','W-106','W-108'], inspector:'陈锋', state:'待执行', revision:1 } })); this.planDialog = false }
}
